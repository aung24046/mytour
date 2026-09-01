import { supabase } from './supabase'

// อัปโหลดรูป/วิดีโอประกอบคำถามควิซ
//
// ข้อจำกัดที่ตั้งไว้ ไม่ได้ตั้งเอาสวย — มาจากสภาพหน้างานจริง:
//   • วิดีโอยาวไม่เกิน 15 วินาที และไม่เกิน 10 MB
//     ควิซเล่นบนรถบัสที่ทุกคนแชร์ 4G เสาเดียวกัน คลิปยาวๆ = จอค้างกลางเกม
//     และคำถามหนึ่งข้อมีเวลาแค่ 20 วิ ถ้าคลิปยาวกว่านั้นก็ดูไม่จบอยู่ดี
//   • รูปไม่เกิน 5 MB — รูปจากมือถือปกติ 2-4 MB ผ่านสบาย
//
// ตรวจสองชั้น: ที่นี่ (บอกผู้ใช้ได้ทันทีว่าทำไมไม่ผ่าน) และที่ bucket
// (ของจริง กันคนยิง API ตรง — ดู supabase/storage_quiz_media.sql)

const BUCKET = 'quiz-media'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
// ย่อรูปให้พอดีจอก่อนอัปโหลด — เหตุผลอยู่ที่ resizeImage() ข้างล่าง
export const MAX_IMAGE_WIDTH = 1920
export const IMAGE_QUALITY = 0.82
export const MAX_VIDEO_BYTES = 10 * 1024 * 1024
export const MAX_VIDEO_SECONDS = 15

// ── เพดานของเกมปริศนาใบ้คำ ────────────────────────────────────────────
// ควิซมีรูปข้อละ 1 รูป และตั้งใจไม่ส่งให้มือถือเมื่อมีจอใหญ่
// เกมปริศนากลับกันทั้งสองข้อ — ได้ถึง 6 รูปต่อข้อ และมือถือทุกเครื่องต้องเห็น
// เลขจึงคูณกันได้ถึง 120 เท่า ถ้าใช้เพดานเดียวกับควิซจะหมดโควตา egress ในเกมเดียว
//
// รูปใบ้เป็นรูปของ "ของหนึ่งชิ้น" (อีกา กะละมัง แพะ) ไม่ใช่ภาพวิว
// 900px คุณภาพ 0.8 ≈ 80 KB จึงไม่เสียอะไรเลย
export const CLUE_IMAGE_WIDTH = 900
export const CLUE_IMAGE_QUALITY = 0.8
// ยกเว้นภาพเฉลย — ขึ้นเต็มจอโปรเจกเตอร์เป็นจังหวะพีคของข้อ และโหลดแค่ตอนเฉลย
export const ANSWER_IMAGE_WIDTH = 1600
export const ANSWER_IMAGE_QUALITY = 0.82

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const VIDEO_TYPES = ['video/mp4', 'video/webm']

export function mediaKindOf(file) {
  if (IMAGE_TYPES.includes(file.type)) return 'image'
  if (VIDEO_TYPES.includes(file.type)) return 'video'
  return null
}

// ย่อรูปในเบราว์เซอร์ก่อนอัปโหลด
//
// ทำไมถึงคุ้มมาก ไม่ใช่แค่ "ประหยัดนิดหน่อย":
//   รูปจากมือถือทุกวันนี้ราว 3-4 MB (4000px) แต่จอโปรเจกเตอร์กับทีวีบนรถ
//   แสดงได้จริงแค่ ~1920px — ที่เหลือคือข้อมูลที่ไม่มีใครได้เห็น
//   ย่อแล้วเหลือราว 200-300 KB คือเล็กลงกว่าสิบเท่า และมีผลสามทาง:
//     1. Storage ของ Supabase free มี 1 GB — รูปสะสมถาวร ไม่รีเซ็ตรายเดือน
//        4 MB/รูป = เก็บได้ ~250 รูป (ราว 12 ชุดคำถาม) ซึ่งชนเพดานเร็วกว่าที่คิด
//        250 KB/รูป = ~4,000 รูป
//     2. Egress ต่อเกม ลดลงตามสัดส่วนเดียวกัน
//     3. สำคัญที่สุด — จอบนรถโหลดทัน คำถามขึ้นพร้อมนาฬิกา ไม่ใช่ขึ้นทีหลัง
//        (นาฬิกาเดินตั้งแต่ question_started_at ไม่ได้รอไฟล์)
//
// GIF ไม่ย่อ เพราะ canvas จะเหลือแค่เฟรมแรก ภาพเคลื่อนไหวหายหมด
async function resizeImage(file, maxWidth = MAX_IMAGE_WIDTH, quality = IMAGE_QUALITY) {
  if (file.type === 'image/gif') return file

  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file                     // เบราว์เซอร์เก่า — ส่งไฟล์เดิมไป

  // เดิมข้ามการย่อทันทีถ้ากว้างไม่เกินเพดาน ซึ่งพลาดเคสรูปกว้าง 1600px แต่หนัก 6 MB
  // (ภาพสแกน / ภาพถ่ายคุณภาพสูง) — ไฟล์แบบนั้นจะไปตกด่านตรวจขนาดข้างล่าง
  // ทั้งที่บีบคุณภาพให้ผ่านได้ ขัดกับเจตนาที่เขียนไว้ตรงจุดเรียก resizeImage()
  if (bitmap.width <= maxWidth && file.size <= MAX_IMAGE_BYTES) {
    bitmap.close?.()
    return file
  }

  const targetWidth = Math.min(bitmap.width, maxWidth)
  const scale = targetWidth / bitmap.width
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob || blob.size >= file.size) return file   // ย่อแล้วไม่เล็กลง ใช้ของเดิม

  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
    type: 'image/jpeg',
  })
}

/** อ่านความยาววิดีโอโดยไม่ต้องอัปโหลดก่อน — ผู้ใช้จะได้รู้ผลทันที */
function videoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(el.duration)
    }
    // อ่านไม่ได้ก็ปล่อยผ่าน ให้ bucket เป็นด่านสุดท้าย ดีกว่าบล็อกคนที่ไฟล์ปกติ
    el.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    el.src = url
  })
}

/**
 * คืน { kind, url } หรือโยน Error ที่มี .code ให้หน้าจอไปแปลเป็นข้อความเอง
 * code: 'type' | 'imageTooBig' | 'videoTooBig' | 'videoTooLong' | 'upload'
 */
export async function uploadQuizMedia(setId, inputFile, opts = {}) {
  const kind = mediaKindOf(inputFile)
  if (!kind) {
    const e = new Error('unsupported type')
    e.code = 'type'
    throw e
  }

  // ย่อก่อนแล้วค่อยตรวจขนาด — รูปจากมือถือส่วนใหญ่เกิน 5 MB ตั้งแต่ยังไม่ย่อ
  // ถ้าตรวจก่อนย่อ สตาฟจะโดนปฏิเสธทั้งที่ระบบย่อให้ผ่านได้อยู่แล้ว
  const file =
    kind === 'image'
      ? await resizeImage(
          inputFile,
          opts.maxWidth ?? MAX_IMAGE_WIDTH,
          opts.quality ?? IMAGE_QUALITY
        )
      : inputFile

  if (kind === 'image' && file.size > MAX_IMAGE_BYTES) {
    const e = new Error('image too big')
    e.code = 'imageTooBig'
    throw e
  }

  if (kind === 'video') {
    if (file.size > MAX_VIDEO_BYTES) {
      const e = new Error('video too big')
      e.code = 'videoTooBig'
      throw e
    }
    const seconds = await videoDuration(file)
    if (seconds && seconds > MAX_VIDEO_SECONDS + 0.5) {
      const e = new Error('video too long')
      e.code = 'videoTooLong'
      e.seconds = Math.round(seconds)
      throw e
    }
  }

  // ชื่อไฟล์สุ่ม ไม่เอาชื่อเดิมของผู้ใช้ — bucket เป็น public ใครเดา URL ถูกก็เปิดได้
  // ถ้าใช้ชื่อเดิม ไฟล์ชื่อ "คำตอบคือโตเกียว.jpg" จะกลายเป็นการแจกเฉลย
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 5)
  const path = `${setId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) {
    const e = new Error(error.message)
    e.code = 'upload'
    throw e
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { kind, url: data.publicUrl }
}

/** แกะ path ในถังออกจาก public URL — ใช้ตอนลบของเก่า */
export function pathFromPublicUrl(url) {
  if (!url) return null
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const i = url.indexOf(marker)
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length))
}

/**
 * ลบไฟล์เก่าตอนสตาฟเปลี่ยนรูป
 * ตั้งใจไม่โยน error — ถ้าลบไม่สำเร็จก็แค่มีไฟล์กำพร้าค้างในถัง
 * ซึ่งไม่ควรทำให้ "บันทึกคำถาม" ล้มเหลวตามไปด้วย
 */
export async function removeQuizMedia(url) {
  const path = pathFromPublicUrl(url)
  if (!path) return
  try {
    await supabase.storage.from(BUCKET).remove([path])
  } catch (err) {
    console.warn('[quiz] ลบไฟล์เก่าไม่สำเร็จ ปล่อยค้างไว้', err)
  }
}

/**
 * ลบไฟล์สื่อทั้งหมดของชุดคำถามหนึ่งชุด — ใช้ตอนลบชุด
 *
 * รับ url มาจาก RPC quiz_delete_set (ซึ่งเก็บไว้ให้ก่อนลบแถว)
 * ไม่ list โฟลเดอร์เอง เพราะ path เป็น `${setId}/...` ก็จริง
 * แต่ถ้าวันหนึ่งเปลี่ยนรูปแบบ path การ list จะพลาดเงียบๆ
 * ส่วนการอ่านจากแถวจริงพลาดไม่ได้
 *
 * ไม่โยน error — ลบไฟล์ไม่สำเร็จไม่ควรทำให้ผู้ใช้คิดว่า "ลบชุดไม่สำเร็จ"
 * ทั้งที่แถวในฐานข้อมูลหายไปแล้วจริงๆ
 */
export async function removeQuizMediaMany(urls) {
  const paths = (urls ?? []).map(pathFromPublicUrl).filter(Boolean)
  if (paths.length === 0) return
  try {
    await supabase.storage.from(BUCKET).remove(paths)
  } catch (err) {
    console.warn('[quiz] ลบไฟล์สื่อของชุดที่ลบไปไม่สำเร็จ ปล่อยค้างไว้', err)
  }
}
