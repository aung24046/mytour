import { useNavigate } from 'react-router-dom'

import { buildPrintCss } from '../../lib/printProfiles'
import Button from '../common/Button'
import Icon from '../common/Icon'

// เปลือกร่วมของหน้าเอกสาร — แถบควบคุมที่ซ่อนตอนพิมพ์ + ฉีด @page ตามแนวกระดาษที่คำนวณได้
//
// แยกออกมาเพราะ @page size ต้องเปลี่ยนตามคอลัมน์ที่เลือก จึงฉีดเป็น <style> runtime
// ไม่ใช่เขียนตายใน CSS ไฟล์
export default function DocumentShell({
  paper,
  orientationNote,
  toolbar,
  children,
  onPrint,
  printDisabled = false,
  title,
}) {
  const navigate = useNavigate()

  return (
    <div className="doc-root min-h-screen bg-gray-50 p-4 print:bg-white print:p-0">
      <style>{buildPrintCss(paper)}</style>

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

        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 text-xs text-ink-muted">
            <span className="font-semibold text-ink">{paper.label}</span>
            {orientationNote && <span> · {orientationNote}</span>}
          </div>
          <Button onClick={onPrint} disabled={printDisabled} fullWidth={false} className="px-6">
            <Icon name="print" size={20} color="currentColor" />
            พิมพ์
          </Button>
        </div>
      </div>

      {/* กระดาษจำลอง — ความกว้างตามแนวที่คำนวณได้ ให้เห็นหน้าตาจริงก่อนพิมพ์ */}
      <div
        className="mx-auto bg-white p-6 shadow-card print:m-0 print:w-auto print:p-0 print:shadow-none"
        style={{ width: `${paper.widthMm}mm`, maxWidth: '100%' }}
      >
        {children}
      </div>
    </div>
  )
}

export function defaultPrint() {
  window.print()
}
