// ตัวช่วยจัดการ "เนื้อหาคลังใช้ร่วม" ให้ถูกที่
//
// เนื้อหา (ฟอร์ม/คู่มือ/ศัพท์/เบอร์ฉุกเฉิน) เก็บครั้งเดียวในตารางฐาน
// แล้วแต่ละทริปชี้มาผ่าน junction ซึ่งเก็บ "ทริปนี้แสดงยังไง"
//
//   แก้เนื้อหา   → ตารางฐาน  → ทุกทริปที่ใช้อยู่เห็นเหมือนกัน
//   เปิด/ปิด/เรียง → junction  → ต่างกันได้ทุกทริป
//   ลบ           → detach     → ถอดออกจากทริปนี้เท่านั้น
//
// อ่านข้อมูลให้ใช้ view `v_tour_*` เสมอ (ดู Design v2 §4.4)

import { supabase } from './supabase'

/** ตารางฐาน → { junction, fk, ฟิลด์ที่เป็นของ "ต่อทริป" } */
export const CONTENT_MAP = {
  form_fields: {
    junction: 'tour_form_fields',
    fk: 'field_id',
    perTour: ['is_active', 'sort_order'],
  },
  guide_categories: {
    junction: 'tour_guide_categories',
    fk: 'category_id',
    perTour: ['is_active', 'sort_order'],
  },
  guide_articles: {
    junction: 'tour_guide_articles',
    fk: 'article_id',
    // itinerary_item_id ต้องเป็นต่อทริป — กำหนดการของแต่ละทริปคนละ item
    perTour: ['is_published', 'is_featured', 'sort_order', 'itinerary_item_id'],
  },
  phrasebook_entries: {
    junction: 'tour_phrasebook_entries',
    fk: 'entry_id',
    perTour: ['is_active', 'sort_order', 'itinerary_item_id'],
  },
  emergency_contacts: {
    junction: 'tour_emergency_contacts',
    fk: 'contact_id',
    perTour: ['is_active', 'sort_order'],
  },
}

/** แยก patch เป็น 2 ก้อน: ของที่ลงตารางฐาน กับของที่ลง junction */
export function splitPatch(table, patch) {
  const conf = CONTENT_MAP[table]
  if (!conf) return { base: patch, perTour: {} }

  const base = {}
  const perTour = {}
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (conf.perTour.includes(k)) perTour[k] = v
    else base[k] = v
  }
  return { base, perTour }
}

/**
 * บันทึก patch ลงที่ถูกต้องอัตโนมัติ
 * คืน { error } แบบเดียวกับ supabase เพื่อให้เรียกแทนของเดิมได้เลย
 */
export async function saveContent(table, rowId, tourId, patch) {
  const conf = CONTENT_MAP[table]
  if (!conf) return supabase.from(table).update(patch).eq('id', rowId)

  const { base, perTour } = splitPatch(table, patch)

  if (Object.keys(base).length) {
    const { error } = await supabase.from(table).update(base).eq('id', rowId)
    if (error) return { error }
  }

  if (Object.keys(perTour).length) {
    const { error } = await supabase
      .from(conf.junction)
      .update(perTour)
      .eq('tour_id', tourId)
      .eq(conf.fk, rowId)
    if (error) return { error }
  }

  return { error: null }
}

/** แก้เฉพาะฟิลด์ต่อทริป (เปิด/ปิด, ลำดับ) — ไม่แตะเนื้อหา */
export function saveAssignment(table, rowId, tourId, patch) {
  const conf = CONTENT_MAP[table]
  if (!conf) return supabase.from(table).update(patch).eq('id', rowId)

  return supabase
    .from(conf.junction)
    .update(patch)
    .eq('tour_id', tourId)
    .eq(conf.fk, rowId)
}

/**
 * ถอดเนื้อหาออกจากทริปนี้
 * ถ้าไม่มีทริปไหนใช้แล้ว ฝั่ง DB จะลบแถวต้นฉบับให้เอง
 * → { data: { deleted, used_in_tours }, error }
 */
export function detachContent(table, rowId, tourId) {
  return supabase.rpc('detach_content', {
    p_table: table,
    p_row_id: rowId,
    p_tour_id: tourId,
  })
}

/** แยกสำเนาเฉพาะทริปนี้ แล้วแก้ต่อได้โดยไม่กระทบทริปอื่น → { data: newId } */
export function forkContent(table, rowId, tourId) {
  return supabase.rpc('fork_content', {
    p_table: table,
    p_row_id: rowId,
    p_tour_id: tourId,
  })
}

/**
 * ข้อความเตือนตอนกำลังจะแก้ของที่หลายทริปใช้ร่วมกัน
 * usedInTours มาจากคอลัมน์ used_in_tours ใน view
 */
export function sharedWarning(usedInTours) {
  if (!usedInTours || usedInTours <= 1) return null
  return `เนื้อหานี้ใช้อยู่ใน ${usedInTours} ทริป — แก้แล้วจะเปลี่ยนทุกทริปที่ใช้อยู่`
}
