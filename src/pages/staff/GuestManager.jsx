import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import DynamicField from '../../components/common/DynamicField'
import StatusBadge from '../../components/common/StatusBadge'
import { groupFieldsByCategory } from '../../lib/formFieldGroups'
import { genderTextClass } from '../../lib/genderColor'

const CORE_FIELD_KEYS = [
  'name',
  'nickname',
  'gender',
  'phone',
  'food_allergy',
  'medical_condition',
  'emergency_contact_name',
  'emergency_contact_phone',
  'note',
]

export default function GuestManager() {
  const { t } = useTranslation()

  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  // แก้ไขข้อมูลลูกทัวร์ — รองรับกรณีฟอร์มมีคำถามเพิ่ม/เปลี่ยนแปลงหลังลูกทัวร์คนนี้ลงทะเบียนไปแล้ว
  const [editingId, setEditingId] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [guestsRes, fieldsRes, responsesRes] = await Promise.all([
      supabase
        .from('guests')
        .select(
          'id, name, nickname, gender, phone, food_allergy, medical_condition, emergency_contact_name, emergency_contact_phone, note, check_in_status, created_at, qr_token'
        )
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('created_at', { ascending: false }),
      supabase
        .from('form_fields')
        .select('id, field_key, label, field_type, options, is_core, is_active, sort_order, category')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('sort_order', { ascending: true }),
      supabase.from('guest_form_responses').select('guest_id, field_id, value'),
    ])

    if (guestsRes.error || fieldsRes.error || responsesRes.error) {
      console.error(
        '[GuestManager] load failed',
        guestsRes.error,
        fieldsRes.error,
        responsesRes.error
      )
      setError(t('common.error'))
      setLoading(false)
      return
    }

    setGuests(guestsRes.data ?? [])
    setFields(fieldsRes.data ?? [])
    setResponses(responsesRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()

    const channel = supabase
      .channel(`guest-manager-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'guests', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadAll()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'guest_form_responses' },
        () => loadAll()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const responsesByGuestId = useMemo(() => {
    const map = {}
    for (const r of responses) {
      if (!map[r.guest_id]) map[r.guest_id] = {}
      map[r.guest_id][r.field_id] = r.value
    }
    return map
  }, [responses])

  // ฟิลด์ทั้งหมดที่ active อยู่ เรียงตาม sort_order — ใช้ทั้งแสดงผลและค้นหา
  const activeFields = useMemo(
    () => fields.filter((f) => f.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [fields]
  )

  function getFieldValue(guest, field) {
    if (field.is_core && CORE_FIELD_KEYS.includes(field.field_key)) {
      return guest[field.field_key] ?? ''
    }
    return responsesByGuestId[guest.id]?.[field.id] ?? ''
  }

  // checkbox เก็บเป็น string คั่นด้วย ", " ทั้งใน guests และ guest_form_responses (ตามที่ Register.jsx บันทึกไว้)
  // ตอนแก้ไขต้องแปลงกลับเป็น array ให้ DynamicField ใช้ แล้วค่อย join กลับตอนบันทึก
  function startEditing(guest) {
    const initial = {}
    for (const f of activeFields) {
      const raw = getFieldValue(guest, f)
      initial[f.id] = f.field_type === 'checkbox'
        ? (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [])
        : raw
    }
    setEditValues(initial)
    setSaveError(null)
    setEditingId(guest.id)
  }

  function cancelEditing() {
    setEditingId(null)
    setEditValues({})
    setSaveError(null)
  }

  function setEditFieldValue(fieldId, value) {
    setEditValues((prev) => ({ ...prev, [fieldId]: value }))
  }

  async function saveEditing(guest) {
    setSaving(true)
    setSaveError(null)

    try {
      const corePayload = {}
      const customUpserts = []

      for (const f of activeFields) {
        const raw = editValues[f.id]
        const value = f.field_type === 'checkbox' ? (raw ?? []).join(', ') : (raw ?? '').toString().trim()

        if (f.is_core && CORE_FIELD_KEYS.includes(f.field_key)) {
          corePayload[f.field_key] = value || null
        } else {
          customUpserts.push({ guest_id: guest.id, field_id: f.id, value })
        }
      }

      if (Object.keys(corePayload).length > 0) {
        const { error: coreError } = await supabase
          .from('guests')
          .update(corePayload)
          .eq('id', guest.id)

        if (coreError) throw coreError
      }

      if (customUpserts.length > 0) {
        // upsert ตาม (guest_id, field_id) — เผื่อฟิลด์นี้เพิ่งถูกเพิ่มเข้าฟอร์มทีหลัง คนนี้เลยยังไม่มีคำตอบเดิม
        const { error: responsesError } = await supabase
          .from('guest_form_responses')
          .upsert(customUpserts, { onConflict: 'guest_id,field_id' })

        if (responsesError) throw responsesError
      }

      await loadAll()
      setEditingId(null)
      setEditValues({})
    } catch (err) {
      console.error('[GuestManager] save edit failed', err)
      setSaveError(err.message ?? t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const filteredGuests = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return guests
    return guests.filter((g) => {
      const haystack = activeFields
        .map((f) => getFieldValue(g, f))
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guests, search, activeFields, responsesByGuestId])

  async function deleteGuest(guest) {
    const confirmed = window.confirm(
      t('staff.guestManager.confirmDelete', { name: guest.nickname || guest.name })
    )
    if (!confirmed) return

    const { error: deleteError } = await supabase.from('guests').delete().eq('id', guest.id)
    if (deleteError) {
      console.error('[GuestManager] delete guest failed', deleteError)
      return
    }
    setGuests((prev) => prev.filter((g) => g.id !== guest.id))
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold text-gray-900">{t('staff.guestManager.title')}</h1>
        <p className="mb-3 text-sm text-gray-500">
          {t('staff.guestManager.subtitle', { count: guests.length })}
        </p>

        {loading && <p className="text-gray-500">{t('common.loading')}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && (
          <>
            <input
              type="text"
              placeholder={t('staff.guestManager.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />

            {filteredGuests.length === 0 && (
              <p className="text-sm text-gray-400">{t('staff.guestManager.noResults')}</p>
            )}

            <div className="flex flex-col gap-2">
              {filteredGuests.map((guest) => {
                const isExpanded = expandedId === guest.id
                return (
                  <Card key={guest.id} className="p-3">
                    <button
                      onClick={() => {
                        if (editingId === guest.id) cancelEditing()
                        setExpandedId(isExpanded ? null : guest.id)
                      }}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <div className="min-w-0">
                        <p className={`truncate font-medium ${genderTextClass(guest.gender) || 'text-gray-900'}`}>
                          {guest.nickname || guest.name}
                        </p>
                        {guest.nickname && (
                          <p className="truncate text-xs text-gray-400">{guest.name}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge tone={guest.check_in_status ? 'success' : 'neutral'}>
                          {guest.check_in_status
                            ? t('staff.checkIn.arrived')
                            : t('staff.checkIn.notArrived')}
                        </StatusBadge>
                        <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {isExpanded && editingId !== guest.id && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-gray-100 pt-3">
                        {groupFieldsByCategory(activeFields).map(({ category, fields: groupFields }) => (
                          <div key={category} className="flex flex-col gap-2">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-sky-600">
                              {t(`guest.register.category.${category}`)}
                            </p>
                            {groupFields.map((field) => {
                              const value = getFieldValue(guest, field)
                              return (
                                <div key={field.id}>
                                  <p className="text-xs font-medium text-gray-400">{field.label}</p>
                                  <p className="text-sm text-gray-900">
                                    {value || (
                                      <span className="text-gray-300">
                                        {t('staff.guestManager.noValue')}
                                      </span>
                                    )}
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        ))}

                        {guest.phone && (
                          <a
                            href={`tel:${guest.phone}`}
                            className="mt-1 w-full rounded-xl bg-sky-600 px-3 py-2 text-center text-sm font-semibold text-white"
                          >
                            {t('staff.guestManager.callGuest', { phone: guest.phone })}
                          </a>
                        )}

                        <button
                          onClick={() => startEditing(guest)}
                          className="mt-1 w-full rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
                        >
                          {t('staff.guestManager.editGuest')}
                        </button>

                        <button
                          onClick={() => deleteGuest(guest)}
                          className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-600"
                        >
                          {t('staff.guestManager.deleteGuest')}
                        </button>
                      </div>
                    )}

                    {isExpanded && editingId === guest.id && (
                      <div className="mt-3 flex flex-col gap-4 border-t border-gray-100 pt-3">
                        {groupFieldsByCategory(activeFields).map(({ category, fields: groupFields }) => (
                          <div key={category} className="flex flex-col gap-3">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-sky-600">
                              {t(`guest.register.category.${category}`)}
                            </p>
                            {groupFields.map((field) => (
                              <DynamicField
                                key={field.id}
                                field={field}
                                value={editValues[field.id]}
                                onChange={(v) => setEditFieldValue(field.id, v)}
                              />
                            ))}
                          </div>
                        ))}

                        {saveError && <p className="text-sm text-red-500">{saveError}</p>}

                        <Button onClick={() => saveEditing(guest)} disabled={saving}>
                          {saving ? t('common.loading') : t('common.save')}
                        </Button>
                        <Button variant="secondary" onClick={cancelEditing} disabled={saving}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
