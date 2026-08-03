import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import { DOC_TITLES, DOC_TYPES, formatThaiDate, useDocumentContext } from '../../../lib/documentData'
import { PAPER } from '../../../lib/printProfiles'
import DocumentHeader from '../../../components/document/DocumentHeader'
import DocumentFooter from '../../../components/document/DocumentFooter'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'

// รายงานค่าใช้จ่าย (DataSpec §7) — ส่งบัญชี A4 แนวนอน
// สรุปรายหมวดอยู่ท้ายตาราง เพราะบัญชีต้องกระทบยอดรายการก่อนดูสรุป

const CATEGORY_LABELS = {
  food: 'อาหาร',
  transport: 'เดินทาง',
  accommodation: 'ที่พัก',
  entrance: 'ค่าเข้าชม',
  tip: 'ทิป',
  misc: 'อื่นๆ',
}

export default function ExpenseReport() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.EXPENSE_REPORT)

  const [expenses, setExpenses] = useState([])
  const [guestCount, setGuestCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [expensesRes, guestsRes] = await Promise.all([
        supabase
          .from('expenses')
          .select('id, amount, category, description, receipt_url, paid_by, expense_date')
          .eq('tour_id', tourId)
          .order('expense_date', { ascending: true }),
        supabase.from('guests').select('id', { count: 'exact', head: true }).eq('tour_id', tourId),
      ])

      if (cancelled) return
      if (expensesRes.error) {
        console.error('[ExpenseReport] load failed', expensesRes.error)
        setError('โหลดค่าใช้จ่ายไม่สำเร็จ')
        setLoading(false)
        return
      }

      setExpenses(expensesRes.data ?? [])
      setGuestCount(guestsRes.count ?? 0)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  const total = useMemo(
    () => expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0),
    [expenses]
  )

  const byCategory = useMemo(() => {
    const map = {}
    for (const e of expenses) {
      const key = e.category ?? 'misc'
      map[key] = (map[key] ?? 0) + Number(e.amount ?? 0)
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1])
  }, [expenses])

  const perHead = guestCount > 0 ? total / guestCount : 0
  const meta = DOC_TITLES.expense_report

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a4_landscape}
      orientationNote="แนวนอน — เผื่อคอลัมน์สกุลเงินต่างประเทศ"
      onPrint={defaultPrint}
      printDisabled={expenses.length === 0}
    >
      <DocumentHeader
        org={ctx.org}
        tour={ctx.tour}
        leader={ctx.leader}
        title={meta.title}
        subtitle={meta.subtitle}
        rightSlot={
          <>
            <p className="doc-num text-[13pt] font-medium">{formatBaht(total)}</p>
            <p className="text-[7.5pt] text-gray-500">
              ต่อหัว {formatBaht(perHead)} · {guestCount} ท่าน
            </p>
          </>
        }
      />

      <table className="doc-table mt-2 w-full border-collapse text-[9pt]" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '10%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '37%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr>
            {['วันที่', 'หมวด', 'รายละเอียด', 'ผู้จ่าย', 'จำนวน (บาท)', 'ใบเสร็จ'].map((h, i) => (
              <th
                key={h}
                className="border border-gray-300 bg-gray-100 px-1.5 py-1 font-medium"
                style={{ textAlign: i === 4 ? 'right' : 'left' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id} className="doc-row-group">
              <td className="doc-num border border-gray-300 px-1.5 py-0.5">
                {formatThaiDate(e.expense_date)}
              </td>
              <td className="border border-gray-300 px-1.5 py-0.5">
                {CATEGORY_LABELS[e.category] ?? e.category ?? '—'}
              </td>
              <td className="border border-gray-300 px-1.5 py-0.5">
                <span className="block truncate">{e.description || '—'}</span>
              </td>
              <td className="border border-gray-300 px-1.5 py-0.5">{e.paid_by || '—'}</td>
              <td className="doc-num border border-gray-300 px-1.5 py-0.5 text-right">
                {formatBaht(Number(e.amount ?? 0))}
              </td>
              <td className="border border-gray-300 px-1.5 py-0.5 text-center">
                {e.receipt_url ? 'มี' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-right font-medium">
              รวมทั้งสิ้น
            </td>
            <td className="doc-num border border-gray-300 bg-gray-100 px-1.5 py-1 text-right font-medium">
              {formatBaht(total)}
            </td>
            <td className="border border-gray-300 bg-gray-100" />
          </tr>
        </tfoot>
      </table>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {byCategory.map(([cat, amount]) => (
          <div
            key={cat}
            className="rounded bg-gray-100 px-2 py-1.5"
            style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
          >
            <div className="text-[7.5pt] text-gray-600">{CATEGORY_LABELS[cat] ?? cat}</div>
            <div className="doc-num text-[10pt] font-medium">{formatBaht(amount)}</div>
          </div>
        ))}
      </div>

      <DocumentFooter org={ctx.org} summary={`${expenses.length} รายการ`} />
    </DocumentShell>
  )
}

function formatBaht(n) {
  return `฿${Math.round(n).toLocaleString('th-TH')}`
}
