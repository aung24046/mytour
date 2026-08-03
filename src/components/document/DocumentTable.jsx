import { Fragment, useMemo } from 'react'

import { OVERFLOW, COLUMN_WIDTH_MM, TYPE_SCALE } from '../../lib/printProfiles'

// ตารางเอกสารที่บังคับใช้นโยบายข้อความยาวรายคอลัมน์ (DataSpec §10)
//
// ปัญหาที่แก้: ปล่อยให้ wrap อิสระแล้วแถวสูงไม่เท่ากัน สายตาไล่ข้ามคอลัมน์ไม่ได้
// วิธีแก้คือบังคับความสูงแถวให้สม่ำเสมอ แล้วผลักข้อความยาวออกไปที่อื่นแทน
//
// columns: [{ key, label, overflow, stackWith, lines, sensitive, align }]
// rows:    [{ _id, [key]: string, ... }]
//
// ค่า cell ต้องเป็น string ที่ format มาเรียบร้อยแล้วจากหน้าเรียกใช้
// คอมโพเนนต์นี้ไม่รู้จัก schema — รู้แค่ว่าจะจัดวางข้อความยาวยังไง

const DEFAULT_ROW_HEIGHT_MM = 8

export default function DocumentTable({
  columns,
  rows,
  emptyText = 'ไม่มีข้อมูล',
  footnoteLabel = 'ข้อควรทราบ',
}) {
  const plan = useMemo(() => buildPlan(columns), [columns])

  // เดินทีละแถวเพื่อแจกเลขเชิงอรรถตามลำดับที่ปรากฏจริงบนกระดาษ
  const { renderRows, footnotes } = useMemo(() => {
    const notes = []
    const out = rows.map((row) => {
      const markers = []
      for (const col of plan.footnoteCols) {
        const value = clean(row[col.key])
        if (!value) continue
        notes.push({ n: notes.length + 1, label: col.label, value })
        markers.push({ n: notes.length, label: col.label })
      }

      const subrowParts = plan.subrowCols
        .map((col) => {
          const value = clean(row[col.key])
          return value ? `${col.label}: ${value}` : null
        })
        .filter(Boolean)

      return { row, markers, subrowText: subrowParts.join(' · ') }
    })
    return { renderRows: out, footnotes: notes }
  }, [rows, plan])

  const showNoteColumn = plan.footnoteCols.length > 0
  const bodyStyle = {
    fontSize: `${TYPE_SCALE.tableBody.sizePt}pt`,
    lineHeight: TYPE_SCALE.tableBody.lineHeight,
  }

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-gray-400" style={bodyStyle}>
        {emptyText}
      </p>
    )
  }

  return (
    <>
      <table className="doc-table w-full border-collapse" style={{ tableLayout: 'fixed', ...bodyStyle }}>
        <colgroup>
          {plan.visibleCols.map((col) => (
            <col key={col.key} style={{ width: `${widthOf(col)}mm` }} />
          ))}
          {showNoteColumn && <col style={{ width: '24mm' }} />}
        </colgroup>

        <thead>
          <tr>
            {plan.visibleCols.map((col) => (
              <th
                key={col.key}
                className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left align-bottom font-medium"
                style={{ textAlign: col.align ?? 'left' }}
              >
                {col.stackWith ? (
                  <>
                    {col.label}
                    <span className="font-normal text-gray-500"> / {labelOf(columns, col.stackWith)}</span>
                  </>
                ) : (
                  col.label
                )}
              </th>
            ))}
            {showNoteColumn && (
              <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left align-bottom font-medium">
                {footnoteLabel}
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {renderRows.map(({ row, markers, subrowText }, i) => (
            <Fragment key={row._id ?? i}>
              <tr className="doc-row-group" style={{ height: `${DEFAULT_ROW_HEIGHT_MM}mm` }}>
                {plan.visibleCols.map((col) => (
                  <td
                    key={col.key}
                    className={`border border-gray-300 px-1.5 py-1 align-top ${
                      isNumeric(col) ? 'doc-num' : ''
                    }`}
                    style={{ textAlign: col.align ?? 'left' }}
                  >
                    <Cell col={col} row={row} />
                  </td>
                ))}
                {showNoteColumn && (
                  <td className="border border-gray-300 px-1.5 py-1 align-top">
                    {markers.length === 0
                      ? '—'
                      : markers.map((m, idx) => (
                          <span key={m.n}>
                            {idx > 0 && ' · '}
                            {m.label} <sup>{m.n}</sup>
                          </span>
                        ))}
                  </td>
                )}
              </tr>

              {/* แถวย่อยเต็มความกว้าง — โผล่เฉพาะแถวที่มีข้อมูลจริง */}
              {subrowText && (
                <tr className="doc-row-group">
                  <td
                    colSpan={plan.visibleCols.length + (showNoteColumn ? 1 : 0)}
                    className="border border-t-0 border-gray-300 bg-amber-50 px-1.5 py-1 text-amber-900"
                    style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
                  >
                    {subrowText}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      {footnotes.length > 0 && (
        <div
          className="mt-2 border-t border-gray-300 pt-1.5 text-gray-700"
          style={{
            fontSize: `${TYPE_SCALE.footnote.sizePt}pt`,
            lineHeight: TYPE_SCALE.footnote.lineHeight,
          }}
        >
          {footnotes.map((f) => (
            <div key={f.n}>
              <sup>{f.n}</sup> {f.label}: {f.value}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Cell({ col, row }) {
  const value = clean(row[col.key]) || '—'

  if (col.overflow === OVERFLOW.STACK && col.stackWith) {
    const second = clean(row[col.stackWith])
    return (
      <>
        <span className="block truncate">{value}</span>
        {second && <span className="block truncate text-gray-500">{second}</span>}
      </>
    )
  }

  if (col.overflow === OVERFLOW.CLAMP) {
    return (
      <span
        style={{
          display: '-webkit-box',
          WebkitLineClamp: col.lines ?? 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {value}
      </span>
    )
  }

  // nowrap เป็นค่าตั้งต้น — ตัดด้วย … ดีกว่าปล่อยให้ดันแถวสูงขึ้น
  return <span className="block truncate">{value}</span>
}

// แยกคอลัมน์ตามนโยบาย: อันไหนขึ้นตาราง อันไหนลงแถวย่อย อันไหนไปท้ายหน้า
function buildPlan(columns) {
  const stackedAway = new Set(
    columns
      .filter((c) => c.overflow === OVERFLOW.STACK && c.stackWith)
      .map((c) => c.stackWith)
  )

  return {
    visibleCols: columns.filter(
      (c) =>
        c.overflow !== OVERFLOW.FOOTNOTE &&
        c.overflow !== OVERFLOW.SUBROW &&
        !stackedAway.has(c.key)
    ),
    subrowCols: columns.filter((c) => c.overflow === OVERFLOW.SUBROW),
    footnoteCols: columns.filter((c) => c.overflow === OVERFLOW.FOOTNOTE),
  }
}

function widthOf(col) {
  const own = COLUMN_WIDTH_MM[col.key] ?? 26
  if (col.overflow === OVERFLOW.STACK && col.stackWith) {
    return Math.max(own, COLUMN_WIDTH_MM[col.stackWith] ?? 26)
  }
  return own
}

function labelOf(columns, key) {
  return columns.find((c) => c.key === key)?.label ?? key
}

function isNumeric(col) {
  return ['index', 'amount', 'national_id', 'passport_no', 'phone',
    'emergency_contact_phone', 'room_number', 'floor', 'seat_number'].includes(col.key)
}

function clean(v) {
  if (v == null) return ''
  const s = String(v).trim()
  return s === '—' ? '' : s
}
