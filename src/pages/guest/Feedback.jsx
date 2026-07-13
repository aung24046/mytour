import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId } from '../../lib/guestSession'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import DynamicField from '../../components/common/DynamicField'
import GuestNav from '../../components/common/GuestNav'

export default function Feedback() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const guestId = getGuestId()

  const [fields, setFields] = useState([])
  const [existingResponses, setExistingResponses] = useState([]) // [{ id, field_id, value }]
  const [values, setValues] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function load() {
      if (!guestId) {
        setLoading(false)
        return
      }
      setLoading(true)
      setLoadError(null)

      const { data: fieldsData, error: fieldsError } = await supabase
        .from('form_fields')
        .select('id, field_key, label, field_type, options, is_required, sort_order')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('form_type', 'feedback')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (!isMounted) return

      if (fieldsError) {
        console.error('[Feedback] load fields failed', fieldsError)
        setLoadError(t('common.error'))
        setLoading(false)
        return
      }

      const fieldList = fieldsData ?? []
      setFields(fieldList)

      if (fieldList.length > 0) {
        const { data: responsesData, error: responsesError } = await supabase
          .from('guest_form_responses')
          .select('id, field_id, value')
          .eq('guest_id', guestId)
          .in('field_id', fieldList.map((f) => f.id))

        if (!isMounted) return

        if (!responsesError) {
          const rows = responsesData ?? []
          setExistingResponses(rows)
          const initial = {}
          for (const f of fieldList) {
            const existing = rows.find((r) => r.field_id === f.id)
            initial[f.id] = existing?.value ?? (f.field_type === 'checkbox' ? [] : '')
          }
          setValues(initial)
        }
      }

      setLoading(false)
    }

    load()
    return () => {
      isMounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, t])

  function setFieldValue(fieldId, value) {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
    setSavedAt(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    setSubmitting(true)

    try {
      const responseByFieldId = {}
      for (const r of existingResponses) responseByFieldId[r.field_id] = r

      const toInsert = []
      const toUpdate = []

      for (const f of fields) {
        const raw = values[f.id]
        const value = Array.isArray(raw) ? raw.join(', ') : (raw ?? '').toString().trim()
        if (!value) continue

        const existing = responseByFieldId[f.id]
        if (existing) {
          if (existing.value !== value) toUpdate.push({ id: existing.id, value })
        } else {
          toInsert.push({ guest_id: guestId, field_id: f.id, value })
        }
      }

      if (toInsert.length > 0) {
        const { error } = await supabase.from('guest_form_responses').insert(toInsert)
        if (error) throw error
      }

      for (const u of toUpdate) {
        const { error } = await supabase
          .from('guest_form_responses')
          .update({ value: u.value })
          .eq('id', u.id)
        if (error) throw error
      }

      const { data: refreshed } = await supabase
        .from('guest_form_responses')
        .select('id, field_id, value')
        .eq('guest_id', guestId)
        .in('field_id', fields.map((f) => f.id))
      setExistingResponses(refreshed ?? [])
      setSavedAt(Date.now())
    } catch (err) {
      console.error('[Feedback] submit failed', err)
      setSubmitError(err.message ?? t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
            <span aria-hidden="true">⭐</span>
            {t('guest.feedback.title')}
          </h1>
          <p className="mb-4 text-sm text-ink-muted">{t('guest.feedback.subtitle')}</p>

          {!guestId && (
            <Card className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-ink-muted">{t('guest.feedback.notRegistered')}</p>
              <Button onClick={() => navigate('/')} fullWidth={false} className="px-6">
                {t('guest.feedback.goRegister')}
              </Button>
            </Card>
          )}

          {guestId && loading && <p className="text-ink-muted">{t('common.loading')}</p>}
          {guestId && loadError && <p className="text-danger">{loadError}</p>}

          {guestId && !loading && !loadError && fields.length === 0 && (
            <Card className="py-8 text-center">
              <p className="text-sm text-ink-muted">{t('guest.feedback.notOpenYet')}</p>
            </Card>
          )}

          {guestId && !loading && !loadError && fields.length > 0 && (
            <Card className="shadow-card-hover">
              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                {fields.map((f) => (
                  <DynamicField
                    key={f.id}
                    field={f}
                    value={values[f.id]}
                    onChange={(v) => setFieldValue(f.id, v)}
                  />
                ))}

                {submitError && <p className="text-sm text-danger">{submitError}</p>}
                {savedAt && (
                  <p className="text-sm font-semibold text-success">{t('guest.feedback.saved')}</p>
                )}

                <Button type="submit" disabled={submitting}>
                  {submitting ? t('guest.feedback.submitting') : t('guest.feedback.submit')}
                </Button>
              </form>
            </Card>
          )}
        </div>
      </div>

      <GuestNav />
    </div>
  )
}
