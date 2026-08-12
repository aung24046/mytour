import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { buildPrintCss } from '../../lib/printProfiles'
import Button from '../common/Button'
import Icon from '../common/Icon'

// เปลือกร่วมของหน้าเอกสาร — แถบควบคุมที่ซ่อนตอนพิมพ์ + ฉีด @page ตามแนวกระดาษที่คำนวณได้
//
// แยกออกมาเพราะ @page size ต้องเปลี่ยนตามคอลัมน์ที่เลือก จึงฉีดเป็น <style> runtime
// ไม่ใช่เขียนตายใน CSS ไฟล์
//
// ── การแสดงตัวอย่างบนจอเล็ก (แก้ ส.ค. 2569) ──────────────────────────────
// เดิมกระดาษจำลองตั้ง `width: <กว้างจริง>mm` คู่กับ `maxWidth: 100%` ผลคือกล่องหดตามจอ
// แต่ตารางข้างในกว้างเป็นมิลลิเมตรคงที่ (ตาม COLUMN_WIDTH_MM) เนื้อหาจึงทะลุออกนอกขอบ
// กระดาษเวลาเปิดบนมือถือ — เห็นชัดสุดกับเอกสารแนวนอนที่กว้าง 297mm
//
// วิธีใหม่: กระดาษกว้างเท่าของจริงเสมอ แล้วย่อทั้งแผ่นด้วย transform ให้พอดีจอ
// (สลับเป็นขนาดเต็มแล้วเลื่อนดูเองได้) ตอนพิมพ์ CSS สั่ง transform:none กลับไปใช้ขนาดจริง
const MM_TO_PX = 96 / 25.4

export default function DocumentShell({
  paper,
  orientationNote,
  toolbar,
  children,
  onPrint,
  onExportXlsx,
  printDisabled = false,
  title,
}) {
  const navigate = useNavigate()
  const frameRef = useRef(null)
  const [fit, setFit] = useState(true)
  const [scale, setScale] = useState(1)

  // วัดความกว้างที่มีจริงแล้วคำนวณอัตราย่อ — ต้องวัดใหม่เมื่อหมุนจอหรือสลับแนวกระดาษ
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    function measure() {
      const available = frame.clientWidth
      const paperPx = paper.widthMm * MM_TO_PX
      // ไม่ขยายเกินขนาดจริง — จอใหญ่ให้เห็น 100% พอ
      setScale(available > 0 && paperPx > available ? available / paperPx : 1)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [paper.widthMm])

  // จอกว้างพอแล้วไม่ต้องมีปุ่มย่อ/ขยายให้รก
  const needsFit = scale < 0.999
  const applied = fit && needsFit ? scale : 1

  useEffect(() => {
    if (!needsFit) setFit(true)
  }, [needsFit])

  return (
    <div className="doc-root min-h-screen bg-gray-50 p-4 print:bg-white print:p-0">
      <style>{buildPrintCss(paper)}</style>
      {/* ตอนพิมพ์ต้องล้างทุกอย่างที่ใส่ไว้เพื่อ "ดูตัวอย่างบนจอ" ออกให้หมด
          ⚠️ ต้องมี !important — สไตล์พวกนี้ผูกเป็น inline style จึงชนะ class ธรรมดา
             บั๊กที่เคยเกิด: กรอบนอกถูกกำหนดความสูงคงที่ + overflow:hidden ไว้ตอนย่อจอ
             เวลาสั่งพิมพ์ความสูงนั้นยังอยู่ เอกสารเลยถูกตัดกลางแถวและพิมพ์ออกมาไม่ครบ */}
      <style>{`@media print {
  .doc-frame { height: auto !important; max-height: none !important; overflow: visible !important; }
  .doc-paper { zoom: 1 !important; transform: none !important; width: auto !important;
               margin: 0 !important; padding: 0 !important; box-shadow: none !important; }
}`}</style>

      <div className="no-print mx-auto mb-4 max-w-5xl">
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg text-ink-muted ring-1 ring-black/5"
            aria-label="ย้อนกลับ"
          >
            ←
          </button>
          <h1 className="text-xl font-bold text-ink">{title}</h1>
        </div>

        {toolbar}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 text-xs text-ink-muted">
            <span className="font-semibold text-ink">{paper.label}</span>
            {orientationNote && <span> · {orientationNote}</span>}
          </div>

          {needsFit && (
            <button
              onClick={() => setFit((v) => !v)}
              className="rounded-pill bg-white px-3 py-1.5 text-xs font-semibold text-ink-muted ring-1 ring-black/5"
            >
              {fit ? `ขนาดจริง (${Math.round(scale * 100)}%)` : 'ย่อให้พอดีจอ'}
            </button>
          )}

          {onExportXlsx && (
            <Button
              variant="secondary"
              onClick={onExportXlsx}
              disabled={printDisabled}
              fullWidth={false}
              className="px-4"
            >
              Excel
            </Button>
          )}

          <Button onClick={onPrint} disabled={printDisabled} fullWidth={false} className="px-6">
            <Icon name="print" size={20} color="currentColor" />
            พิมพ์
          </Button>
        </div>
      </div>

      {/* กรอบนอก: เลื่อนแนวนอนได้เมื่อเลือกดูขนาดจริง */}
      <div ref={frameRef} className="doc-frame overflow-x-auto">
        <div
          className="doc-paper mx-auto bg-white p-6 shadow-card"
          style={{
            width: `${paper.widthMm}mm`,
            // ใช้ zoom ไม่ใช่ transform: scale — zoom คำนวณ layout ใหม่ตามขนาดที่ย่อ
            // จึงไม่ต้องวัดความสูงแล้วหนีบกล่องเอง (วิธีหนีบเคยทำให้ "พิมพ์แล้วข้อมูลขาดกลางแถว")
            zoom: applied < 1 ? applied : undefined,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export function defaultPrint() {
  window.print()
}
