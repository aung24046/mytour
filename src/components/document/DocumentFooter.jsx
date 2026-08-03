import { formatThaiDate } from '../../lib/documentData'
import { TYPE_SCALE } from '../../lib/printProfiles'

// ท้ายกระดาษร่วม — ข้อความจาก organizations.doc_footer_note ซ้ายมือ สรุปยอด+วันที่พิมพ์ขวามือ
export default function DocumentFooter({ org, summary, pageLabel }) {
  return (
    <div
      className="mt-3 flex justify-between gap-4 border-t border-gray-300 pt-1.5 text-gray-500"
      style={{
        fontSize: `${TYPE_SCALE.footer.sizePt}pt`,
        lineHeight: TYPE_SCALE.footer.lineHeight,
      }}
    >
      <span className="min-w-0 truncate">{org?.doc_footer_note}</span>
      <span className="shrink-0">
        {[summary, `พิมพ์ ${formatThaiDate(new Date().toISOString())}`, pageLabel]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  )
}
