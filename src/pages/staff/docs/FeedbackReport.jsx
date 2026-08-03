import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import { DOC_TITLES, DOC_TYPES, useDocumentContext } from '../../../lib/documentData'
import { PAPER } from '../../../lib/printProfiles'
import DocumentHeader from '../../../components/document/DocumentHeader'
import DocumentFooter from '../../../components/document/DocumentFooter'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'

// รายงานความพึงพอใจ (DataSpec §8) — A4 แนวตั้ง กราฟแท่งนอนเรียงลง
//
// ไม่ระบุตัวตนเป็นค่าตั้งต้น: ความเห็นปลายเปิดแสดงข้อความอย่างเดียว ไม่มีชื่อผู้ตอบ
// ถ้าจะเชื่อมกลับไปหาคนตอบต้องเข้าไปดูในหน้า FeedbackSummary แทน
export default function FeedbackReport() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.FEEDBACK_REPORT)

  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [guestCount, setGuestCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [fieldsRes, guestsRes] = await Promise.all([
        supabase
          .from('v_tour_form_fields')
          .select('id, label, field_type, is_active, sort_order')
          .eq('tour_id', tourId)
          .eq('form_type', 'feedback')
          .order('sort_order'),
        supabase.from('guests').select('id', { count: 'exact', head: true }).eq('tour_id', tourId),
      ])

      if (cancelled) return
      if (fieldsRes.error) {
        console.error('[FeedbackReport] load failed', fieldsRes.error)
        setError('โหลดแบบประเมินไม่สำเร็จ')
        setLoading(false)
        return
      }

      const list = (fieldsRes.data ?? []).filter((f) => f.is_active !== false)
      setFields(list)
      setGuestCount(guestsRes.count ?? 0)

      if (list.length > 0) {
        const { data } = await supabase
          .from('guest_form_responses')
          .select('field_id, guest_id, value')
          .in('field_id', list.map((f) => f.id))
        if (!cancelled) setResponses(data ?? [])
      }
      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  const ratingRows = useMemo(() => {
    return fields
      .filter((f) => f.field_type === 'rating')
      .map((f) => {
        const values = responses
          .filter((r) => r.field_id === f.id)
          .map((r) => Number(r.value))
          .filter((n) => Number.isFinite(n) && n > 0)
        const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
        return { id: f.id, label: f.label, avg, count: values.length }
      })
      .filter((r) => r.count > 0)
  }, [fields, responses])

  const comments = useMemo(() => {
    const textFieldIds = new Set(
      fields.filter((f) => ['text', 'textarea'].includes(f.field_type)).map((f) => f.id)
    )
    return responses
      .filter((r) => textFieldIds.has(r.field_id) && r.value?.trim())
      .map((r) => r.value.trim())
  }, [fields, responses])

  const respondents = useMemo(
    () => new Set(responses.map((r) => r.guest_id)).size,
    [responses]
  )

  const overallAvg = useMemo(() => {
    if (ratingRows.length === 0) return 0
    return ratingRows.reduce((sum, r) => sum + r.avg, 0) / ratingRows.length
  }, [ratingRows])

  const responseRate = guestCount > 0 ? Math.round((respondents / guestCount) * 100) : 0
  const meta = DOC_TITLES.feedback_report

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a4_portrait}
      onPrint={defaultPrint}
      printDisabled={ratingRows.length === 0 && comments.length === 0}
    >
      <DocumentHeader
        org={ctx.org}
        tour={ctx.tour}
        leader={ctx.leader}
        title={meta.title}
        subtitle={`ตอบ ${respondents} จาก ${guestCount} ท่าน · ${responseRate}%`}
        rightSlot={
          <>
            <p className="doc-num text-[16pt] font-medium">{overallAvg.toFixed(1)}</p>
            <p className="text-[7.5pt] text-gray-500">เฉลี่ยรวม</p>
          </>
        }
      />

      <div className="mt-3 space-y-1.5 text-[9pt]">
        {ratingRows.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <span className="w-28 shrink-0 truncate">{r.label}</span>
            <div className="h-3 flex-1 rounded-sm bg-gray-100">
              <div
                className={`h-3 rounded-sm ${r.avg >= 4 ? 'bg-emerald-600' : r.avg >= 3 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{
                  width: `${Math.round((r.avg / 5) * 100)}%`,
                  printColorAdjust: 'exact',
                  WebkitPrintColorAdjust: 'exact',
                }}
              />
            </div>
            <span className="doc-num w-8 shrink-0 text-right">{r.avg.toFixed(1)}</span>
            <span className="w-12 shrink-0 text-right text-[7.5pt] text-gray-500">n={r.count}</span>
          </div>
        ))}
        {ratingRows.length === 0 && (
          <p className="py-4 text-center text-gray-400">ยังไม่มีคะแนนประเมิน</p>
        )}
      </div>

      {comments.length > 0 && (
        <>
          <div
            className="mt-4 bg-gray-100 px-2 py-1 text-[9pt] font-medium"
            style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
          >
            ความเห็นเพิ่มเติม
          </div>
          <div className="mt-1.5 space-y-1 text-[8.5pt] text-gray-700">
            {comments.map((c, i) => (
              <p key={i}>“{c}”</p>
            ))}
          </div>
        </>
      )}

      <DocumentFooter org={ctx.org} summary="ไม่ระบุตัวตน" />
    </DocumentShell>
  )
}
