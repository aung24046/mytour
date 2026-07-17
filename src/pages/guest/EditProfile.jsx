import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId } from '../../lib/guestSession'
import { groupFieldsByCategory, CATEGORY_STYLE } from '../../lib/formFieldGroups'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import DynamicField from '../../components/common/DynamicField'
import Icon from '../../components/common/Icon'
import GuestNav from '../../components/common/GuestNav'

// ให้ลูกทัวร์แก้ไขข้อมูลที่ตัวเองลงทะเบียนไว้ได้เอง (ไม่ต้องรอทีมงานแก้ผ่าน GuestManager)
// ใช้ฟิลด์ชุดเดียวกับตอนลงทะเบียน (form_fields ของทริปนี้) — core field เขียนลง guests โดยตรง
// ส่วน custom field เขียนลง guest_form_responses เหมือนตอน Register.jsx / GuestManager.jsx
export default function EditProfile() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const guestId = getGuestId()

  const [fields, setFields] = useState([])
  const [guest, setGuest] = useState(null)
  const [values, setValues] = useState({})
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
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

      const [fieldsRes, guestRes] = await Promise.all([
        supabase
          .from('form_fields')
          .select('id, field_key, label, field_type, options, is_required, is_core, sort_order, category')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabase.from('guests').select('*').eq('id', guestId).maybeSingle(),
      ])

      if (!isMounted) return

      if (fieldsRes.error || guestRes.error || !guestRes.data) {
        console.error('[EditProfile] load failed', fieldsRes.error, guestRes.error)
        setLoadError(t('common.error'))
        setLoading(false)
        return
      }

      const fieldList = fieldsRes.data ?? []
      setFields(fieldList)
      setGuest(guestRes.data)

      const customFieldIds = fieldList.filter((f) => !f.is_core).map((f) => f.id)
      let responsesByFieldId = {}
      if (customFieldIds.length > 0) {
        const { data: responses } = await supabase
          .from('guest_form_responses')
          .select('field_id, value')
          .eq('guest_id', guestId)
          .in('field_id', customFieldIds)
        for (const r of responses ?? []) responsesByFieldId[r.field_id] = r.value
      }

      const initial = {}
      for (const f of fieldList) {
        const raw = f.is_core ? guestRes.data[f.field_key] : responsesByFieldId[f.id]
        initial[f.id] =
          f.field_type === 'checkbox'
            ? raw
              ? raw.split(',').map((s) => s.trim()).filter(Boolean)
              : []
            : raw ?? ''
      }
      setValues(initial)
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
    setErrors((prev) => ({ ...prev, [fieldId]: undefined }))
    setSavedAt(null)
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
    setSaveError(null)
    if (!validate()) return

    setSaving(true)
    try {
      const corePayload = {}
      const customUpserts = []

      for (const f of fields) {
        const raw = values[f.id]
        const value = f.field_type === 'checkbox' ? (raw ?? []).join(', ') : (raw ?? '').toString().trim()

        if (f.is_core) {
          corePayload[f.field_key] = value || null
        } else if (value) {
          customUpserts.push({ guest_id: guestId, field_id: f.id, value })
        }
      }

      if (Object.keys(corePayload).length > 0) {
        const { error } = await supabase.from('guests').update(corePayload).eq('id', guestId)
        if (error) throw error
      }

      if (customUpserts.length > 0) {
        // upsert ตาม (guest_id, field_id) เผื่อฟิลด์นี้เพิ่งถูกเพิ่มทีหลัง ยังไม่เคยมีคำตอบเดิม
        const { error } = await supabase
          .from('guest_form_responses')
          .upsert(customUpserts, { onConflict: 'guest_id,field_id' })
        if (error) throw error
      }

      setSavedAt(Date.now())
    } catch (err) {
      console.error('[EditProfile] save failed', err)
      setSaveError(err.message ?? t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-1 text-2xl font-extrabold text-ink">{t('guest.editProfile.title')}</h1>
          <p className="mb-4 text-sm text-ink-muted">{t('guest.editProfile.subtitle')}</p>

          {!guestId && (
            <Card className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-ink-muted">{t('guest.editProfile.notRegistered')}</p>
              <Button onClick={() => navigate('/')} fullWidth={false} className="px-6">
                {t('guest.editProfile.goRegister')}
              </Button>
            </Card>
          )}

          {guestId && loading && <p className="text-ink-muted">{t('common.loading')}</p>}
          {guestId && loadError && <p className="text-danger">{loadError}</p>}

          {guestId && !loading && !loadError && guest && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              {groupFieldsByCategory(fields).map(({ category, fields: groupFields }) => {
                const st = CATEGORY_STYLE[category] || CATEGORY_STYLE.other
                return (
                  <div key={category} className="overflow-hidden rounded-2xl border border-neutral-bg bg-surface shadow-card">
                    <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: st.tint }}>
                      <Icon name={st.icon} size={18} color={st.iconColor} />
                      <span className="text-sm font-bold" style={{ color: st.text }}>
                        {t(`guest.register.category.${category}`)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-4 p-4">
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
                  </div>
                )
              })}

              {saveError && <p className="text-sm text-danger">{saveError}</p>}
              {savedAt && (
                <p className="text-sm font-semibold text-success">{t('guest.editProfile.saved')}</p>
              )}

              <Button type="submit" disabled={saving}>
                {saving ? t('guest.editProfile.saving') : t('common.save')}
              </Button>
            </form>
          )}
        </div>
      </div>

      <GuestNav />
    </div>
  )
}
