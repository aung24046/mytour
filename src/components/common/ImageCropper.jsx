import { useEffect, useMemo, useRef, useState } from 'react'
import Cropper from 'react-cropper'
import 'cropperjs/dist/cropper.css'

import Button from './Button'
import { CROP_RATIOS } from '../../lib/tileGrid'

// ครอปภาพก่อนยืนยัน — กรอบลากได้ มีมือจับมุม สลับอัตราส่วนสำเร็จรูป และหมุนภาพ
// แบบเดียวกับแอปแต่งรูปในมือถือ
//
// ⚠️ ห้าม import ไฟล์นี้ตรงๆ จากหน้าจอ — ต้องผ่าน React.lazy เท่านั้น
//    cropperjs หนักและมีแต่สตาฟที่กดเข้า Builder เท่านั้นที่ได้ใช้
//    ถ้าเข้าไปอยู่ใน bundle หลัก ลูกทัวร์ 40 คนบนรถจะโหลดไลบรารีแต่งรูปที่ไม่มีวันได้ใช้
//    ตั้งแต่เปิดแอปครั้งแรก บน 4G เสาเดียวกัน โดยไม่มีอะไรฟ้อง
//    (ดู vite.config.js — manualChunks + workbox.globIgnores ต้องมาคู่กัน)
//
// ── ทำลายต้นฉบับหรือไม่ ──────────────────────────────────────────────
// ปกติ **ไม่ทำลาย**: คืนกรอบเป็นสัดส่วน 0-1 แล้วให้ TileBoard คิดตอนเรนเดอร์
// ข้อดีคือปรับกรอบใหม่ได้ตลอดโดยไม่ต้องหาไฟล์ต้นฉบับในมือถืออีก
//
// ยกเว้นเมื่อผู้ใช้ "หมุนหรือกลับด้าน" ภาพ — การหมุนแสดงเป็นสี่เหลี่ยมในพิกัดเดิมไม่ได้
// กรณีนั้นจึงอบภาพใหม่ออกมาเป็นไฟล์ (baked) แล้วใช้กรอบเต็มใบแทน
// ผู้เรียกไม่ต้องรู้เรื่องนี้ แค่ดูว่ามี baked มาไหม

export default function ImageCropper({
  file = null,
  src = null,
  initialCrop = null,
  aspectLock = null,        // ล็อกอัตราส่วนตายตัว (ไม่ใช้ในเกมเปิดแผ่นป้าย)
  title = 'ครอปภาพ',
  onCancel,
  onDone,
}) {
  const cropperRef = useRef(null)
  const [ratio, setRatio] = useState(aspectLock ?? null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  const url = useObjectUrl(file, src)

  // ตั้งกรอบเดิมกลับให้ตรงตอนเปิดมาแก้ซ้ำ — ไม่งั้นคนกดเข้ามาดูเฉยๆ แล้วกดยืนยัน
  // จะได้กรอบเต็มใบทับของเดิมที่ตั้งไว้ดีแล้ว
  function handleReady() {
    setReady(true)
    const cropper = cropperRef.current?.cropper
    if (!cropper || !initialCrop) return
    const data = cropper.getImageData()
    const w = data.naturalWidth
    const h = data.naturalHeight
    if (!w || !h) return
    cropper.setData({
      x: (initialCrop.x ?? 0) * w,
      y: (initialCrop.y ?? 0) * h,
      width: (initialCrop.w ?? 1) * w,
      height: (initialCrop.h ?? 1) * h,
    })
  }

  /**
   * สลับอัตราส่วนกรอบ
   *
   * ⚠️ ต้องสั่ง setAspectRatio เองทุกครั้ง — react-cropper อ่าน prop aspectRatio
   *    แค่ตอน mount ครั้งเดียว แล้วไม่เฝ้าดูอีกเลย (ยืนยันจากซอร์ส dist ของมัน:
   *    ทั้งไฟล์ไม่มีคำว่า setAspectRatio) ถ้าเปลี่ยนแต่ state ปุ่มจะไฮไลต์ถูก
   *    แต่กรอบไม่ขยับ — บั๊กที่ดูผ่านๆ เหมือนทำงานอยู่
   *
   *    ตั้งตรงนี้แทนที่จะทำใน useEffect โดยตั้งใจ: ถ้าใช้ effect มันจะยิงตอน mount ด้วย
   *    แล้วไป reset กรอบที่ handleReady เพิ่งตั้งจาก initialCrop ทิ้ง
   */
  function pickRatio(v) {
    setRatio(v)
    cropperRef.current?.cropper?.setAspectRatio(v ?? NaN)
  }

  function rotate(deg) {
    cropperRef.current?.cropper?.rotate(deg)
  }

  function reset() {
    cropperRef.current?.cropper?.reset()
    setRatio(aspectLock ?? null)
  }

  async function confirm() {
    const cropper = cropperRef.current?.cropper
    if (!cropper) return
    setBusy(true)
    try {
      const d = cropper.getData(true)
      const img = cropper.getImageData()
      const w = img.naturalWidth || 1
      const h = img.naturalHeight || 1
      const transformed =
        Math.round(d.rotate ?? 0) % 360 !== 0 || d.scaleX === -1 || d.scaleY === -1

      if (!transformed) {
        // เส้นทางปกติ — เก็บแค่ตัวเลข ไม่แตะไฟล์
        onDone?.({
          crop: clampFrac({ x: d.x / w, y: d.y / h, w: d.width / w, h: d.height / h }),
          baked: null,
        })
        return
      }

      // หมุน/กลับด้านแล้ว — ต้องอบภาพใหม่ กรอบจึงกลายเป็นเต็มใบ
      const canvas = cropper.getCroppedCanvas({
        maxWidth: 2400,
        maxHeight: 2400,
        imageSmoothingQuality: 'high',
      })
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
      const name = (file?.name ?? 'image').replace(/\.[^.]+$/, '') + '.jpg'
      onDone?.({
        crop: { x: 0, y: 0, w: 1, h: 1 },
        baked: blob ? new File([blob], name, { type: 'image/jpeg' }) : null,
      })
    } finally {
      setBusy(false)
    }
  }

  if (!url) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="font-bold text-white">{title}</p>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-2xl leading-none text-white/80"
          aria-label="ปิด"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 px-2">
        <Cropper
          ref={cropperRef}
          src={url}
          style={{ height: '100%', width: '100%' }}
          aspectRatio={ratio ?? NaN}
          viewMode={1}
          dragMode="move"
          autoCropArea={1}
          background={false}
          responsive
          checkOrientation
          guides
          ready={handleReady}
        />
      </div>

      <div className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {!aspectLock && (
          <div className="flex flex-wrap gap-2">
            {CROP_RATIOS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => pickRatio(r.value)}
                className={[
                  'rounded-full px-3 py-1.5 text-sm font-semibold transition',
                  ratio === r.value ? 'bg-white text-slate-900' : 'bg-white/15 text-white',
                ].join(' ')}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* รูปถ่ายจากมือถือที่ EXIF เพี้ยนแล้วมาตะแคงเจอบ่อยกว่าที่คิด
              ถ้าไม่มีปุ่มนี้คือใช้รูปนั้นไม่ได้เลย ต้องไปแก้ในแอปอื่นก่อน ซึ่งจะไม่มีใครทำ */}
          <button type="button" onClick={() => rotate(-90)}
                  className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white">
            ↺ หมุนซ้าย
          </button>
          <button type="button" onClick={() => rotate(90)}
                  className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white">
            ↻ หมุนขวา
          </button>
          <button type="button" onClick={reset}
                  className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold text-white">
            เริ่มใหม่
          </button>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>ยกเลิก</Button>
          <Button className="flex-1" onClick={confirm} disabled={busy || !ready}>
            {busy ? 'กำลังตัด…' : 'ใช้ภาพนี้'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function clampFrac(c) {
  const lim = (v) => Math.min(Math.max(Number(v) || 0, 0), 1)
  let w = Math.min(Math.max(Number(c.w) || 1, 0.01), 1)
  let h = Math.min(Math.max(Number(c.h) || 1, 0.01), 1)
  const x = Math.min(lim(c.x), 1 - w)
  const y = Math.min(lim(c.y), 1 - h)
  return { x, y, w, h }
}

/** ไฟล์ที่เพิ่งเลือกต้องแปลงเป็น object URL และ **ต้องคืนทิ้ง** ไม่งั้นรั่วทุกครั้งที่เปิดครอป */
function useObjectUrl(file, src) {
  const [url, setUrl] = useState(src ?? null)

  useEffect(() => {
    if (!file) {
      setUrl(src ?? null)
      return undefined
    }
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, src])

  return url
}
