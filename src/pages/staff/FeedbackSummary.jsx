import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useActiveTourId } from '../../lib/staffSession'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import Icon from '../../components/common/Icon'
import DynamicField from '../../components/common/DynamicField'
import { nextSlipNumber, slipNo, slipPrefix } from '../../lib/feedbackPaper'

function csvEscape(value) {
  const str = String(value ?? '')
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function downloadCsv(filename, rows) {
  const csvContent = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export default function FeedbackSummary() {
  const tourId = useActiveTourId()
  const { t } = useTranslation()

  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [guests, setGuests] = useState([])
  const [tour, setTour] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [entryOpen, setEntryOpen] = useState(false)

  // ⚠️ เดิม deps เป็น [t] อย่างเดียว ทั้งที่ query ใช้ tourId — แอดมินสลับทริปแล้วหน้านี้
  // ยังค้างข้อมูลทริปเดิมจนกว่าจะรีเฟรช แก้พร้อมกันตรงนี้
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [fieldsRes, guestsRes, tourRes] = await Promise.all([
      supabase
        .from('v_tour_form_fields')
        .select('id, label, field_type, options, is_required, is_active, sort_order')
        .eq('tour_id', tourId)
        .eq('form_type', 'feedback')
        .order('sort_order', { ascending: true }),
      supabase
        .from('guests')
        .select('id, name, nickname')
        .eq('tour_id', tourId)
        .order('name'),
      supabase.from('tours').select('join_code').eq('id', tourId).maybeSingle(),
    ])

    if (fieldsRes.error || guestsRes.error) {
      console.error('[FeedbackSummary] load failed', fieldsRes.error, guestsRes.error)
      setError(t('common.error'))
      setLoading(false)
      return
    }

    const fieldList = fieldsRes.data ?? []
    setFields(fieldList)
    setGuests(guestsRes.data ?? [])
    setTour(tourRes.data ?? null)

    if (fieldList.length > 0) {
      const { data: responsesData, error: responsesError } = await supabase
        .from('guest_form_responses')
        .select('id, field_id, guest_id, value, source, paper_slip_no')
        .in('field_id', fieldList.map((f) => f.id))

      if (!responsesError) setResponses(responsesData ?? [])
    } else {
      setResponses([])
    }

    setLoading(false)
  }, [tourId, t])

  useEffect(() => {
    load()
  }, [load])

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  // นับผู้ตอบ = คนที่ตอบในแอป (guest_id) + ใบกระดาษที่คีย์เข้ามา (paper_slip_no)
  //
  // ห้ามนับด้วย guest_id อย่างเดียว: ใบกระดาษที่ไม่ระบุชื่อลงเป็น guest_id = NULL ทุกใบ
  // Set จะยุบ NULL ทั้งกองเหลือ 1 ทำให้ 30 ใบนับได้ 1 คน
  const respondedGuestCount = useMemo(() => {
    const appGuests = new Set(responses.filter((r) => r.guest_id).map((r) => r.guest_id))
    const slips = new Set(responses.filter((r) => r.paper_slip_no).map((r) => r.paper_slip_no))
    // ใบกระดาษที่ระบุชื่อลูกทัวร์ถูกนับไปแล้วในชุดแรก ไม่ให้นับซ้ำ
    for (const r of responses) {
      if (r.paper_slip_no && r.guest_id) slips.delete(r.paper_slip_no)
    }
    return appGuests.size + slips.size
  }, [responses])

  const paperCount = useMemo(
    () => new Set(responses.filter((r) => r.source === 'paper').map((r) => r.paper_slip_no)).size,
    [responses]
  )

  const ratingFields = useMemo(() => fields.filter((f) => f.field_type === 'rating'), [fields])
  const commentFields = useMemo(
    () => fields.filter((f) => ['text', 'textarea'].includes(f.field_type)),
    [fields]
  )
  const otherFields = useMemo(
    () => fields.filter((f) => !['rating', 'text', 'textarea'].includes(f.field_type)),
    [fields]
  )
  const isFormOpen = fields.some((f) => f.is_active)

  // หนึ่งแถว = หนึ่งผู้ตอบ โดยผู้ตอบอาจเป็นลูกทัวร์ (guest_id) หรือใบกระดาษไม่ระบุชื่อ (เลขที่ใบ)
  // จึงจับกลุ่มด้วยคีย์ผสม ไม่ใช่วนตามรายชื่อลูกทัวร์อย่างเดิม ซึ่งทำให้ใบกระดาษหายไปจาก CSV
  function handleExportCsv() {
    const header = [
      t('staff.feedbackSummary.csvNameHeader'),
      'ที่มา',
      'เลขที่ใบ',
      ...fields.map((f) => f.label),
    ]

    const byRespondent = new Map()
    for (const r of responses) {
      const key = r.guest_id ?? `slip:${r.paper_slip_no ?? r.id}`
      if (!byRespondent.has(key)) {
        byRespondent.set(key, {
          guestId: r.guest_id ?? null,
          slip: r.paper_slip_no ?? '',
          source: r.source ?? 'app',
          answers: {},
        })
      }
      const entry = byRespondent.get(key)
      entry.answers[r.field_id] = r.value ?? ''
      if (r.paper_slip_no) entry.slip = r.paper_slip_no
      if (r.source === 'paper') entry.source = 'paper'
    }

    const rows = [header]
    for (const e of byRespondent.values()) {
      const g = e.guestId ? guestById[e.guestId] : null
      rows.push([
        g ? g.nickname || g.name : 'ไม่ระบุชื่อ',
        e.source === 'paper' ? 'กระดาษ' : 'แอป',
        e.slip,
        ...fields.map((f) => e.answers[f.id] ?? ''),
      ])
    }
    downloadCsv(`feedback-summary.csv`, rows)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">{t('staff.feedbackSummary.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('staff.feedbackSummary.subtitle')}</p>

        {loading && <p className="mt-4 text-gray-500">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-red-500">{error}</p>}

        {!loading && !error && fields.length === 0 && (
          <Card className="mt-4">
            <p className="text-sm text-gray-500">{t('staff.feedbackSummary.noFields')}</p>
          </Card>
        )}

        {!loading && !error && fields.length > 0 && (
          <>
            <Card className="mt-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">
                  {t('staff.feedbackSummary.responseCount', {
                    count: respondedGuestCount,
                    total: guests.length,
                  })}
                  {paperCount > 0 && (
                    <span className="text-gray-400"> · จากกระดาษ {paperCount} ใบ</span>
                  )}
                </p>
                <p className={`mt-0.5 text-xs font-semibold ${isFormOpen ? 'text-green-600' : 'text-gray-400'}`}>
                  {isFormOpen ? t('staff.feedbackSummary.formOpen') : t('staff.feedbackSummary.formClosed')}
                </p>
              </div>
              <Button
                variant="secondary"
                fullWidth={false}
                className="shrink-0 px-4"
                onClick={handleExportCsv}
              >
                {t('staff.feedbackSummary.exportCsv')}
              </Button>
            </Card>

            {/* ทางเข้าฝั่งกระดาษ — ทั้งพิมพ์ฟอร์มเปล่าและคีย์คำตอบกลับ อยู่ตรงที่หัวหน้าทัวร์
                นึกถึงเรื่องนี้จริง ๆ คือหน้าสรุปผล ไม่ใช่หน้ารวมเอกสาร */}
            <Card className="mt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">แบบประเมินฉบับกระดาษ</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    สำหรับลูกทัวร์ที่กรอกในมือถือไม่สะดวก
                  </p>
                </div>
                <Link
                  to="/staff/documents/feedback-form"
                  className="shrink-0 rounded-control px-3 py-2 text-sm font-semibold text-sky-700 ring-1 ring-sky-200"
                >
                  พิมพ์ฟอร์มเปล่า
                </Link>
              </div>

              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => setEntryOpen((v) => !v)}
              >
                {entryOpen ? 'ปิดหน้าคีย์ข้อมูล' : 'คีย์คำตอบจากกระดาษ'}
              </Button>
            </Card>

            {entryOpen && (
              <PaperEntry
                fields={fields}
                guests={guests}
                responses={responses}
                joinCode={tour?.join_code}
                onSaved={load}
              />
            )}

            {ratingFields.length > 0 && (
              <>
                <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
                  {t('staff.feedbackSummary.ratings')}
                </h2>
                {ratingFields.map((f) => (
                  <RatingBar key={f.id} field={f} responses={responses} />
                ))}
              </>
            )}

            {commentFields.length > 0 && (
              <>
                <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
                  {t('staff.feedbackSummary.comments')}
                </h2>
                {commentFields.map((f) => (
                  <CommentList key={f.id} field={f} responses={responses} guestById={guestById} t={t} />
                ))}
              </>
            )}

            {otherFields.length > 0 && (
              <>
                <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
                  {t('staff.feedbackSummary.otherAnswers')}
                </h2>
                {otherFields.map((f) => (
                  <CommentList key={f.id} field={f} responses={responses} guestById={guestById} t={t} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// หน้าคีย์คำตอบจากใบกระดาษ — ใช้ DynamicField ตัวเดียวกับฝั่งลูกทัวร์
// จะได้ไม่มีวันเกิดกรณี "กระดาษมีคำถามที่ฟอร์มในแอปไม่มี" หรือชนิดฟิลด์ไม่ตรงกัน
function PaperEntry({ fields, guests, responses, joinCode, onSaved }) {
  const prefix = useMemo(() => slipPrefix(joinCode), [joinCode])

  const [slip, setSlip] = useState('')
  const [guestId, setGuestId] = useState('')
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedSlip, setSavedSlip] = useState(null)

  const suggested = useMemo(
    () => slipNo(prefix, nextSlipNumber(responses, prefix)),
    [responses, prefix]
  )

  // เติมเลขที่ที่เดาไว้ให้อัตโนมัติ แต่ไม่ทับถ้าคนคีย์พิมพ์เองแล้ว
  useEffect(() => {
    setSlip((cur) => cur || suggested)
  }, [suggested])

  const usedSlips = useMemo(
    () => new Set(responses.filter((r) => r.paper_slip_no).map((r) => r.paper_slip_no)),
    [responses]
  )
  const slipTaken = slip.trim() !== '' && usedSlips.has(slip.trim())

  function reset(nextSlip) {
    setValues({})
    setGuestId('')
    setSlip(nextSlip)
  }

  async function handleSave() {
    const trimmed = slip.trim()
    if (!trimmed) {
      setSaveError('ใส่เลขที่ใบก่อน — เลขนี้คือตัวจับกลุ่มคำตอบของใบเดียวกัน')
      return
    }

    setSaving(true)
    setSaveError(null)

    try {
      const rows = []
      for (const f of fields) {
        const raw = values[f.id]
        const value = Array.isArray(raw) ? raw.join(', ') : (raw ?? '').toString().trim()
        if (!value) continue
        rows.push({
          guest_id: guestId || null,
          field_id: f.id,
          value,
          source: 'paper',
          paper_slip_no: trimmed,
        })
      }

      if (rows.length === 0) {
        setSaveError('ยังไม่ได้กรอกคำตอบสักข้อ')
        setSaving(false)
        return
      }

      const { error } = await supabase.from('guest_form_responses').insert(rows)
      if (error) throw error

      setSavedSlip(trimmed)
      // เดินเลขต่อให้เอง คนคีย์จะได้หยิบใบถัดไปแล้วกรอกต่อได้เลย ไม่ต้องแตะช่องเลขที่
      const n = Number(trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : NaN)
      reset(Number.isFinite(n) ? slipNo(prefix, n + 1) : '')
      await onSaved()
    } catch (err) {
      console.error('[FeedbackSummary] paper entry failed', err)
      // ชนกับ unique index = ใบนี้เคยคีย์ไปแล้ว ซึ่งเป็นความผิดพลาดที่เกิดบ่อยสุดตอนคีย์ทีละหลายสิบใบ
      setSaveError(
        err?.code === '23505'
          ? `ใบเลขที่ ${slip.trim()} คีย์เข้าระบบไปแล้ว — ตรวจเลขบนกระดาษอีกครั้ง`
          : (err.message ?? 'บันทึกไม่สำเร็จ')
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mt-3">
      <p className="font-semibold text-gray-900">คีย์คำตอบจากกระดาษ</p>
      <p className="mt-0.5 text-xs text-gray-500">
        กรอกเฉพาะข้อที่ลูกทัวร์ตอบ ข้อที่เว้นว่างไว้ระบบจะข้ามให้เอง
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <label className="text-xs font-semibold text-gray-500">
          เลขที่ใบ
          <input
            type="text"
            value={slip}
            onChange={(e) => setSlip(e.target.value)}
            placeholder={suggested}
            className="mt-1 block w-full rounded-control border border-gray-200 px-3 py-2 text-sm text-ink"
          />
          {slipTaken && (
            <span className="mt-1 block font-normal text-danger">
              เลขนี้คีย์ไปแล้ว บันทึกซ้ำไม่ได้
            </span>
          )}
        </label>

        <label className="text-xs font-semibold text-gray-500">
          ผู้ตอบ
          <select
            value={guestId}
            onChange={(e) => setGuestId(e.target.value)}
            className="mt-1 block w-full rounded-control border border-gray-200 px-3 py-2 text-sm text-ink"
          >
            <option value="">ไม่ระบุชื่อ</option>
            {guests.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nickname ? `${g.name} (${g.nickname})` : g.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-gray-400">
            เลือกชื่อเฉพาะเมื่อลูกทัวร์เขียนชื่อบนใบ — ชื่อไม่บังคับตั้งแต่บนกระดาษแล้ว
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-5 border-t border-gray-100 pt-4">
        {fields.map((f) => (
          <DynamicField
            key={f.id}
            field={{ ...f, is_required: false }}
            value={values[f.id]}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.id]: v }))}
          />
        ))}
      </div>

      {saveError && <p className="mt-3 text-sm text-danger">{saveError}</p>}
      {savedSlip && !saveError && (
        <p className="mt-3 text-sm font-semibold text-success">บันทึกใบ {savedSlip} แล้ว</p>
      )}

      <Button className="mt-3" onClick={handleSave} disabled={saving || slipTaken}>
        {saving ? 'กำลังบันทึก…' : 'บันทึกใบนี้'}
      </Button>
    </Card>
  )
}

function RatingBar({ field, responses }) {
  const values = responses
    .filter((r) => r.field_id === field.id)
    .map((r) => Number(r.value))
    .filter((n) => n >= 1 && n <= 5)
  const count = values.length
  const average = count > 0 ? values.reduce((a, b) => a + b, 0) / count : 0
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: values.filter((v) => v === star).length,
  }))
  const maxCount = Math.max(1, ...distribution.map((d) => d.count))

  return (
    <Card className="mb-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-gray-900">{field.label}</p>
        <div className="flex items-center gap-1 text-amber-500">
          <Icon name="star" size={18} filled color="#f59e0b" />
          <span className="font-bold">{count > 0 ? average.toFixed(1) : '—'}</span>
          <span className="text-xs text-gray-400">({count})</span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {distribution.map(({ star, count: c }) => (
          <div key={star} className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-6 shrink-0">{star}★</span>
            <div className="h-2 flex-1 overflow-hidden rounded-pill bg-gray-100">
              <div
                className="h-full rounded-pill bg-amber-400"
                style={{ width: `${(c / maxCount) * 100}%` }}
              />
            </div>
            <span className="w-6 shrink-0 text-right">{c}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function CommentList({ field, responses, guestById, t }) {
  const items = responses.filter((r) => r.field_id === field.id && r.value?.trim())

  return (
    <Card className="mb-3">
      <p className="mb-2 font-semibold text-gray-900">{field.label}</p>
      {items.length === 0 && (
        <p className="text-sm text-gray-400">{t('staff.feedbackSummary.noComments')}</p>
      )}
      <div className="flex flex-col divide-y divide-gray-100">
        {items.map((r) => (
          <div key={r.id} className="py-2 first:pt-0 last:pb-0">
            <p className="text-sm text-gray-800">{r.value}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              {guestById[r.guest_id]?.nickname ||
                guestById[r.guest_id]?.name ||
                (r.paper_slip_no ? `ไม่ระบุชื่อ · ใบ ${r.paper_slip_no}` : '—')}
              {r.source === 'paper' && <span className="ml-1 text-gray-300">· กระดาษ</span>}
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}
