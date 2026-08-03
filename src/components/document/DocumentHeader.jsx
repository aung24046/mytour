import { TYPE_SCALE } from '../../lib/printProfiles'

// หัวกระดาษร่วมของเอกสาร export ทุกใบ (DataSpec §0)
// ซ้ายเป็นข้อมูลบริษัทจาก organizations, ขวาเป็นชื่อเอกสาร, แถวล่างเป็นข้อมูลทริป
//
// org อาจเป็น null ระหว่างที่ยังไม่ได้ตั้งค่าข้อมูลบริษัท — ไม่ throw
// แต่แสดงข้อความเตือนแทน เพื่อไม่ให้ใครเผลอส่งเอกสารไม่มีหัวออกไปข้างนอก
export default function DocumentHeader({
  org,
  tour,
  leader,
  title,
  subtitle,
  rightSlot,
  pageLabel,
}) {
  const orgReady = Boolean(org?.name)

  const contactLine = [org?.address, org?.phone].filter(Boolean).join(' · ')
  const licenseLine = [
    org?.tat_license_no && `ใบอนุญาต ททท. ${org.tat_license_no}`,
    org?.tax_id && `ทะเบียน ${org.tax_id}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const tripRange = formatTripRange(tour?.start_date, tour?.end_date)

  return (
    <header className="doc-header">
      <div className="flex items-start gap-3 border-b-2 border-gray-800 pb-2">
        {org?.logo_url ? (
          <img
            src={org.logo_url}
            alt=""
            className="h-12 w-12 shrink-0 object-contain"
            style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-100 text-[7pt] text-gray-400">
            LOGO
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" style={{ fontSize: `${TYPE_SCALE.docTitle.sizePt}pt` }}>
            {orgReady ? org.name : 'ยังไม่ได้ตั้งค่าข้อมูลบริษัท'}
          </p>
          {org?.name_en && (
            <p className="truncate text-gray-500" style={{ fontSize: `${TYPE_SCALE.orgMeta.sizePt}pt` }}>
              {org.name_en}
            </p>
          )}
          <p
            className="text-gray-500"
            style={{
              fontSize: `${TYPE_SCALE.orgMeta.sizePt}pt`,
              lineHeight: TYPE_SCALE.orgMeta.lineHeight,
            }}
          >
            {contactLine}
            {contactLine && licenseLine && <br />}
            {licenseLine}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-medium" style={{ fontSize: `${TYPE_SCALE.docTitle.sizePt}pt` }}>
            {title}
          </p>
          {subtitle && (
            <p className="text-gray-500" style={{ fontSize: `${TYPE_SCALE.orgMeta.sizePt}pt` }}>
              {subtitle}
            </p>
          )}
          {rightSlot}
        </div>
      </div>

      <div
        className="flex items-baseline justify-between gap-4 pt-2 text-gray-700"
        style={{ fontSize: `${TYPE_SCALE.orgMeta.sizePt}pt` }}
      >
        <span className="min-w-0 truncate">
          {[tour?.join_code, tour?.name].filter(Boolean).join(' · ')}
        </span>
        <span className="shrink-0">
          {[tripRange, leader && `หัวหน้าทัวร์ ${leader.name}`, pageLabel]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {!orgReady && (
        <p
          className="no-print mt-2 rounded bg-amber-50 px-3 py-2 text-amber-800"
          style={{ fontSize: '8pt' }}
        >
          ยังไม่ได้กรอกข้อมูลบริษัท — เอกสารจะพิมพ์ออกมาโดยไม่มีหัวกระดาษ
          ไปที่ตั้งค่า → ข้อมูลบริษัท เพื่อกรอกก่อน
        </p>
      )}
    </header>
  )
}

// 12–16 ก.ย. 2569 / ถ้าข้ามเดือนก็แสดงเดือนทั้งสองฝั่ง
function formatTripRange(start, end) {
  if (!start) return ''
  const s = new Date(start)
  const e = end ? new Date(end) : null
  if (Number.isNaN(s.getTime())) return ''

  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  const beYear = (d) => d.getFullYear() + 543

  if (!e || Number.isNaN(e.getTime())) {
    return `${s.getDate()} ${months[s.getMonth()]} ${beYear(s)}`
  }
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.getDate()} ${months[s.getMonth()]} ${beYear(s)}`
  }
  return `${s.getDate()} ${months[s.getMonth()]} – ${e.getDate()} ${months[e.getMonth()]} ${beYear(e)}`
}
