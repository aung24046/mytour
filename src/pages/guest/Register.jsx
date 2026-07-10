import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId, saveGuestId, clearGuestId } from '../../lib/guestSession'
import { findFieldByPurpose } from '../../lib/guestFields'
import { groupFieldsByCategory } from '../../lib/formFieldGroups'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import DynamicField from '../../components/common/DynamicField'
import BottomSheet from '../../components/common/BottomSheet'
import QrScanner from '../../components/common/QrScanner'
import Icon from '../../components/common/Icon'
import GuestNav from '../../components/common/GuestNav'

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

  // เครื่องนี้เคยลงทะเบียนไว้แล้วหรือยัง — ถ้าเคย ไม่ต้องโชว์ฟอร์มเปล่าซ้ำ
  const [checkingExisting, setCheckingExisting] = useState(true)
  const [existingGuest, setExistingGuest] = useState(null)

  // กู้คืนตัวตนบนเครื่องใหม่ — ค้นด้วยเบอร์โทร หรือสแกน QR เดิม
  const [recoverySheetOpen, setRecoverySheetOpen] = useState(false)
  const [recoveryTab, setRecoveryTab] = useState('phone') // 'phone' | 'qr'
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneSearching, setPhoneSearching] = useState(false)
  const [phoneMatches, setPhoneMatches] = useState(null) // null = not searched yet, [] = no match, [..] = matches
  const [phoneSearchError, setPhoneSearchError] = useState(null)
  const [qrScanError, setQrScanError] = useState(null)

  function restoreGuestSession(guest) {
    saveGuestId(guest.id)
    setExistingGuest(guest)
    setRecoverySheetOpen(false)
  }

  async function searchByPhone(e) {
    e.preventDefault()
    const phone = phoneInput.trim()
    if (!phone) return

    setPhoneSearching(true)
    setPhoneSearchError(null)
    setPhoneMatches(null)

    try {
      const { data: fieldsData, error: fieldsError } = await supabase
        .from('form_fields')
        .select('id, field_key, field_purpose, is_core')
        .eq('tour_id', ACTIVE_TOUR_ID)

      if (fieldsError) throw fieldsError

      const phoneField = findFieldByPurpose(fieldsData ?? [], 'phone')

      let matches = []
      if (!phoneField || phoneField.is_core) {
        const coreKey = phoneField?.field_key || 'phone'
        const { data, error } = await supabase
          .from('guests')
          .select('id, name, nickname, qr_token')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .eq(coreKey, phone)

        if (error) throw error
        matches = data ?? []
      } else {
        const { data: responseRows, error: responseError } = await supabase
          .from('guest_form_responses')
          .select('guest_id, value')
          .eq('field_id', phoneField.id)
          .eq('value', phone)

        if (responseError) throw responseError

        const guestIds = (responseRows ?? []).map((r) => r.guest_id)
        if (guestIds.length > 0) {
          const { data, error } = await supabase
            .from('guests')
            .select('id, name, nickname, qr_token')
            .eq('tour_id', ACTIVE_TOUR_ID)
            .in('id', guestIds)

          if (error) throw error
          matches = data ?? []
        }
      }

      setPhoneMatches(matches)
    } catch (err) {
      console.error('[Register] phone search failed', err)
      setPhoneSearchError(t('common.error'))
    } finally {
      setPhoneSearching(false)
    }
  }

  async function handleRestoreScan(decodedText) {
    setQrScanError(null)
    const { data, error } = await supabase
      .from('guests')
      .select('id, name, nickname')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .eq('qr_token', decodedText)
      .maybeSingle()

    if (error || !data) {
      setQrScanError(t('guest.register.recoveryQrNotFound'))
      return
    }

    restoreGuestSession(data)
  }

  function handleRestoreScanError() {
    setQrScanError(t('staff.checkIn.scanCameraError'))
  }

  function openRecoverySheet() {
    setRecoveryTab('phone')
    setPhoneInput('')
    setPhoneMatches(null)
    setPhoneSearchError(null)
    setQrScanError(null)
    setRecoverySheetOpen(true)
  }

  useEffect(() => {
    let isMounted = true

    async function checkExisting() {
      const guestId = getGuestId()
      if (!guestId) {
        setCheckingExisting(false)
        return
      }

      const { data, error } = await supabase
        .from('guests')
        .select('id, name, nickname')
        .eq('id', guestId)
        .maybeSingle()

      if (!isMounted) return

      if (error || !data) {
        // guest_id ในเครื่องไม่ตรงกับข้อมูลจริงแล้ว (เช่นถูกลบไปฝั่ง staff) — เคลียร์แล้วให้ลงทะเบียนใหม่
        clearGuestId()
      } else {
        setExistingGuest(data)
      }
      setCheckingExisting(false)
    }

    checkExisting()
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadFields() {
      setLoadingFields(true)
      setLoadError(null)

      const { data, error } = await supabase
        .from('form_fields')
        .select('id, field_key, label, field_type, options, is_required, is_core, sort_order, category')
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

  if (savedGuest || existingGuest) {
    const guestForDisplay = savedGuest || existingGuest
    const displayName = guestForDisplay?.nickname || guestForDisplay?.name

    return (
      <div className="min-h-screen">
        <AnnouncementBanner />
        <div className="p-4 pb-28">
          <div className="mx-auto max-w-md">
            {/* Hero ต้อนรับ */}
            <div className="mt-2 overflow-hidden rounded-card bg-brand-gradient p-5 text-white shadow-brand">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-2xl">
                  {savedGuest ? '🎉' : '👋'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-white/80">
                    {savedGuest ? t('guest.register.successTitle') : t('guest.home.welcomeBack')}
                  </p>
                  <h1 className="truncate text-2xl font-extrabold">
                    {displayName || t('guest.home.traveler')}
                  </h1>
                </div>
              </div>
              <p className="mt-3 text-sm text-white/85">
                {savedGuest ? t('guest.register.successBody') : t('guest.home.subtitle')}
              </p>
            </div>

            {/* QR หลัก */}
            <button
              onClick={() => navigate('/my-qr')}
              className="mt-4 flex w-full items-center gap-4 rounded-card border border-white/60 bg-surface p-4 text-left shadow-card ring-1 ring-black/[0.02] transition active:scale-[0.99]"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-light text-brand-hover">
                <Icon name="ticket" size={26} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-ink">{t('guest.nav.myQr')}</p>
                <p className="truncate text-sm text-ink-muted">{t('guest.home.qrSubtitle')}</p>
              </div>
              <span className="text-lg text-ink-muted" aria-hidden="true">›</span>
            </button>

            {/* เมนูลัด */}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <HubTile icon="map" label={t('guest.nav.itinerary')} onClick={() => navigate('/itinerary')} />
              <HubTile icon="bed" label={t('guest.nav.myRoom')} onClick={() => navigate('/my-room')} />
              <HubTile icon="target" label={t('guest.nav.bingo')} onClick={() => navigate('/bingo')} />
              <HubTile icon="location" label={t('guest.nav.shareLocation')} onClick={() => navigate('/share-location')} />
            </div>
          </div>
        </div>

        <GuestNav active="home" />
      </div>
    )
  }

  if (checkingExisting) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AnnouncementBanner />
        <div className="p-4">
          <p className="text-gray-500">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4">
        <div className="mx-auto max-w-md">
          <div className="mb-5 mt-2 flex flex-col items-center text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-[18px] bg-brand-gradient text-white shadow-brand">
              <Icon name="compass" size={30} />
            </div>
            <h1 className="text-2xl font-extrabold text-ink">
              {t('guest.register.title')}
            </h1>
          </div>

          <Card className="shadow-card-hover">
            {loadingFields && <p className="text-gray-500">{t('common.loading')}</p>}
            {loadError && <p className="text-red-500">{loadError}</p>}

            {!loadingFields && !loadError && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                {groupFieldsByCategory(fields).map(({ category, fields: groupFields }) => (
                  <div key={category} className="flex flex-col gap-4">
                    <h2 className="border-b border-neutral-bg pb-1.5 text-sm font-bold uppercase tracking-wide text-brand">
                      {t(`guest.register.category.${category}`)}
                    </h2>
                    {groupFields.map((f) => (
                      <DynamicField
                        key={f.id}
                        field={f}
                        value={values[f.id]}
                        onChange={(v) => setFieldValue(f.id, v)}
                        error={errors[f.id]}
                      />
                    ))}
                  </div>
                ))}

                {submitError && <p className="text-sm text-red-500">{submitError}</p>}

                <Button type="submit" disabled={submitting}>
                  {submitting ? t('guest.register.submitting') : t('guest.register.submit')}
                </Button>
              </form>
            )}
          </Card>

          <button
            onClick={openRecoverySheet}
            className="mt-4 w-full text-center text-sm font-semibold text-brand underline decoration-brand-light underline-offset-2 hover:text-brand-hover"
          >
            {t('guest.register.alreadyRegisteredLink')}
          </button>
        </div>
      </div>

      <BottomSheet
        open={recoverySheetOpen}
        onClose={() => setRecoverySheetOpen(false)}
        title={t('guest.register.recoveryTitle')}
      >
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setRecoveryTab('phone')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              recoveryTab === 'phone' ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('guest.register.recoveryByPhone')}
          </button>
          <button
            onClick={() => setRecoveryTab('qr')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              recoveryTab === 'qr' ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('guest.register.recoveryByQr')}
          </button>
        </div>

        {recoveryTab === 'phone' && (
          <div>
            <form onSubmit={searchByPhone} className="flex gap-2">
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder={t('guest.register.phonePlaceholder')}
                className="min-w-0 flex-1 rounded-control border border-transparent bg-surface-sunken px-3.5 py-3 text-base text-ink shadow-inner focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
              />
              <Button type="submit" disabled={phoneSearching} fullWidth={false} className="shrink-0 px-4">
                {t('common.search')}
              </Button>
            </form>

            {phoneSearching && <p className="mt-3 text-sm text-gray-500">{t('common.loading')}</p>}
            {phoneSearchError && <p className="mt-3 text-sm text-red-500">{phoneSearchError}</p>}

            {phoneMatches && phoneMatches.length === 0 && (
              <p className="mt-3 text-sm text-gray-500">{t('guest.register.recoveryNoMatch')}</p>
            )}

            {phoneMatches && phoneMatches.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-sm text-gray-500">{t('guest.register.recoverySelectYou')}</p>
                {phoneMatches.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => restoreGuestSession(g)}
                    className="rounded-xl border border-gray-200 px-3 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
                  >
                    {g.nickname || g.name}
                    {g.nickname && <span className="ml-1 text-gray-400">({g.name})</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {recoveryTab === 'qr' && (
          <div>
            <QrScanner onScan={handleRestoreScan} onError={handleRestoreScanError} />
            <p className="mt-3 text-center text-sm text-gray-500">
              {t('guest.register.recoveryQrHint')}
            </p>
            {qrScanError && (
              <p className="mt-2 text-center text-sm text-red-500">{qrScanError}</p>
            )}
          </div>
        )}

        <Button
          variant="secondary"
          className="mt-3"
          onClick={() => setRecoverySheetOpen(false)}
        >
          {t('common.cancel')}
        </Button>
      </BottomSheet>
    </div>
  )
}

// ปุ่มเมนูลัดบนหน้าหลัก
function HubTile({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-card border border-white/60 bg-surface p-4 text-left shadow-card ring-1 ring-black/[0.02] transition active:scale-[0.98]"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-light text-brand-hover">
        <Icon name={icon} size={24} />
      </span>
      <span className="font-semibold text-ink">{label}</span>
    </button>
  )
}
