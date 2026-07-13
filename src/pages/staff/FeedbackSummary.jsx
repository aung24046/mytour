import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import Icon from '../../components/common/Icon'

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
  const { t } = useTranslation()

  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function load() {
      setLoading(true)
      setError(null)

      const [fieldsRes, guestsRes] = await Promise.all([
        supabase
          .from('form_fields')
          .select('id, label, field_type, is_active, sort_order')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .eq('form_type', 'feedback')
          .order('sort_order', { ascending: true }),
        supabase
          .from('guests')
          .select('id, name, nickname')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .order('name'),
      ])

      if (!isMounted) return

      if (fieldsRes.error || guestsRes.error) {
        console.error('[FeedbackSummary] load failed', fieldsRes.error, guestsRes.error)
        setError(t('common.error'))
        setLoading(false)
        return
      }

      const fieldList = fieldsRes.data ?? []
      setFields(fieldList)
      setGuests(guestsRes.data ?? [])

      if (fieldList.length > 0) {
        const { data: responsesData, error: responsesError } = await supabase
          .from('guest_form_responses')
          .select('id, field_id, guest_id, value')
          .in('field_id', fieldList.map((f) => f.id))

        if (!responsesError && isMounted) setResponses(responsesData ?? [])
      }

      setLoading(false)
    }

    load()
    return () => {
      isMounted = false
    }
  }, [t])

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const respondedGuestCount = useMemo(
    () => new Set(responses.map((r) => r.guest_id)).size,
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

  function handleExportCsv() {
    const header = [t('staff.feedbackSummary.csvNameHeader'), ...fields.map((f) => f.label)]
    const rows = [header]
    for (const g of guests) {
      const row = [g.nickname || g.name]
      for (const f of fields) {
        const r = responses.find((res) => res.field_id === f.id && res.guest_id === g.id)
        row.push(r?.value ?? '')
      }
      rows.push(row)
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
              {guestById[r.guest_id]?.nickname || guestById[r.guest_id]?.name || '—'}
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}
