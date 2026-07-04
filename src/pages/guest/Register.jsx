import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { saveGuestId } from '../../lib/guestSession'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import DynamicField from '../../components/common/DynamicField'

export default function Register() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [fields, setFields] = useState([])
  const [loadingFields, setLoadingFields] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const [values, setValues] = useState({})
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [savedGuest, setSavedGuest] = useState(null)

  useEffect(() => {
    let isMounted = true

    async function loadFields() {
      setLoadingFields(true)
      setLoadError(null)

      const { data, error } = await supabase
        .from('form_fields')
        .select('id, field_key, label, field_type, options, is_required, is_core, sort_order')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (!isMounted) return

      if (error) {
        console.error('[Register] load form_fields failed', error)
        setLoadError(t('common.error'))
      } else {
        setFields(data ?? [])
        // checkbox fields need an array default
        const initial = {}
        for (const f of data ?? []) {
          initial[f.id] = f.field_type === 'checkbox' ? [] : ''
        }
        setValues(initial)
      }
      setLoadingFields(false)
    }

    loadFields()
    return () => {
      isMounted = false
    }
  }, [t])

  function setFieldValue(fieldId, value) {
    setValues((prev) => ({ ...prev, [fieldId]: value }))
    setErrors((prev) => ({ ...prev, [fieldId]: undefined }))
  }

  function validate() {
    const nextErrors = {}
    for (const f of fields) {
      const v = values[f.id]
      const isEmpty = f.field_type === 'checkbox' ? !v || v.length === 0 : !v || !String(v).trim()
      if (f.is_required && isEmpty) {
        nextErrors[f.id] = t('guest.register.requiredField')
      }
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError(null)
    if (!validate()) return

    setSubmitting(true)
    try {
      // Core fields go straight onto the guests row; custom fields go to guest_form_responses.
      const corePayload = { tour_id: ACTIVE_TOUR_ID }
      const customAnswers = []

      for (const f of fields) {
        const raw = values[f.id]
        const value = f.field_type === 'checkbox' ? raw ?? [] : (raw ?? '').toString().trim()

        if (f.is_core) {
          corePayload[f.field_key] = f.field_type === 'checkbox' ? value.join(', ') : value || null
        } else {
          const stringValue = f.field_type === 'checkbox' ? value.join(', ') : value
          if (stringValue) {
            customAnswers.push({ field_id: f.id, value: stringValue })
          }
        }
      }

      const { data: guest, error: guestError } = await supabase
        .from('guests')
        .insert(corePayload)
        .select('id, qr_token')
        .single()

      if (guestError) throw guestError

      if (customAnswers.length > 0) {
        const { error: responsesError } = await supabase
          .from('guest_form_responses')
          .insert(customAnswers.map((a) => ({ ...a, guest_id: guest.id })))

        if (responsesError) throw responsesError
      }

      saveGuestId(guest.id)
      setSavedGuest(guest)
    } catch (err) {
      console.error('[Register] submit failed', err)
      setSubmitError(err.message ?? t('common.error'))
    } finally {
      setSubmitting(false)
    }
  }

  if (savedGuest) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AnnouncementBanner />
        <div className="p-4">
          <Card className="mx-auto mt-8 max-w-md text-center">
            <h1 className="text-xl font-bold text-gray-900">
              {t('guest.register.successTitle')}
            </h1>
            <p className="mt-2 text-gray-600">{t('guest.register.successBody')}</p>

            <div className="mt-6 flex flex-col gap-3">
              <Button onClick={() => navigate('/my-qr')}>
                {t('guest.register.viewMyQr')}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/itinerary')}>
                {t('guest.register.viewItinerary')}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AnnouncementBanner />
      <div className="p-4">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 text-xl font-bold text-gray-900">
            {t('guest.register.title')}
          </h1>

          <Card>
            {loadingFields && <p className="text-gray-500">{t('common.loading')}</p>}
            {loadError && <p className="text-red-500">{loadError}</p>}

            {!loadingFields && !loadError && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                {fields.map((f) => (
                  <DynamicField
                    key={f.id}
                    field={f}
                    value={values[f.id]}
                    onChange={(v) => setFieldValue(f.id, v)}
                    error={errors[f.id]}
                  />
                ))}

                {submitError && <p className="text-sm text-red-500">{submitError}</p>}

                <Button type="submit" disabled={submitting}>
                  {submitting ? t('guest.register.submitting') : t('guest.register.submit')}
                </Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
