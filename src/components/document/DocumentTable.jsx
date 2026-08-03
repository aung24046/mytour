import { Fragment, useMemo } from 'react'

import { OVERFLOW, COLUMN_WIDTH_MM, TYPE_SCALE } from '../../lib/printProfiles'

// ตารางเอกสารที่บังคับใช้นโยบายข้อความยาวรายคอลัมน์ (DataSpec §10)
//
// ⚠️ หลักการหลังทดสอบพิมพ์จริง (2026-08-03):
//    เอกสารพิมพ์ต้องเห็นข้อมูลครบเสมอ — ไม่ตัดด้วย … และไม่ยุบ 2 ฟิลด์ไว้ช่องเดียว
//    แถวสูงไม่เท่ากันยอมรับได้ ข้อมูลขาดยอมรับไม่ได้
//    ทางเลือกเมื่อคอลัมน์ยาวเกินไปคือย้ายไป subrow หรือ footnote ไม่ใช่ตัดทิ้ง
//
// columns: [{ key, label, overflow, sensitive, align }]
// rows:    [{ _id, [key]: string, ... }]
//
// ค่า cell ต้องเป็น string ที่ format มาเรียบร้อยแล้วจากหน้าเรียกใช้
// คอมโพเนนต์นี้ไม่รู้จัก schema — รู้แค่ว่าจะจัดวางข้อความยาวยังไง

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
            <col key={col.key} style={{ width: `${COLUMN_WIDTH_MM[col.key] ?? 26}mm` }} />
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
                {col.label}
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
              <tr className="doc-row-group">
                {plan.visibleCols.map((col) => (
                  <td
                    key={col.key}
                    className={`border border-gray-300 px-1.5 py-1 align-top ${
                      isNumeric(col) ? 'doc-num' : ''
                    }`}
                    style={{
                      textAlign: col.align ?? 'left',
                      // แสดงเต็มเสมอ — ตัดคำได้ถ้าจำเป็น แต่ห้ามซ่อนข้อความ
                      whiteSpace: col.overflow === OVERFLOW.NOWRAP ? 'nowrap' : 'normal',
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                    }}
                  >
                    {clean(row[col.key]) || '—'}
                  </td>
                ))}
                {showNoteColumn && (
                  <td
                    className="border border-gray-300 px-1.5 py-1 align-top"
                    style={{ overflowWrap: 'anywhere' }}
                  >
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
                    style={{
                      printColorAdjust: 'exact',
                      WebkitPrintColorAdjust: 'exact',
                      overflowWrap: 'anywhere',
                    }}
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

// แยกคอลัมน์ตามนโยบาย: อันไหนขึ้นตาราง อันไหนลงแถวย่อย อันไหนไปท้ายหน้า
function buildPlan(columns) {
  return {
    visibleCols: columns.filter(
      (c) => c.overflow !== OVERFLOW.FOOTNOTE && c.overflow !== OVERFLOW.SUBROW
    ),
    subrowCols: columns.filter((c) => c.overflow === OVERFLOW.SUBROW),
    footnoteCols: columns.filter((c) => c.overflow === OVERFLOW.FOOTNOTE),
  }
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
