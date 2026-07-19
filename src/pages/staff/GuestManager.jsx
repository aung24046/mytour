import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import DynamicField from '../../components/common/DynamicField'
import StatusBadge from '../../components/common/StatusBadge'
import Icon from '../../components/common/Icon'
import { groupFieldsByCategory, CATEGORY_STYLE } from '../../lib/formFieldGroups'
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

// หัวการ์ดหมวดสุขภาพจะเปลี่ยนเป็นสีเตือนเมื่อมีข้อมูล (แพ้อาหาร/โรค) — staff เห็นชัดตอนดูแลหน้างาน
const HEALTH_WARNING_STYLE = { icon: 'alert', tint: '#FEF3C7', text: '#B45309', iconColor: '#B45309' }

function guestInitials(g) {
  const s = (g.nickname || g.name || '').trim()
  return s ? s.slice(0, 2) : '–'
}

function avatarClasses(gender) {
  if (gender === 'ชาย') return 'bg-blue-100 text-blue-700'
  if (gender === 'หญิง') return 'bg-pink-100 text-pink-700'
  return 'bg-gray-100 text-gray-600'
}

export default function GuestManager() {
  const { t, i18n } = useTranslation()

  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [buses, setBuses] = useState([])
  const [busSeats, setBusSeats] = useState([])
  const [staffGuestIds, setStaffGuestIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [filterGender, setFilterGender] = useState('all')
  const [filterBus, setFilterBus] = useState('all')
  const [filterBirthdayMonth, setFilterBirthdayMonth] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  // แก้ไขข้อมูลลูกทัวร์ — รองรับกรณีฟอร์มมีคำถามเพิ่ม/เปลี่ยนแปลงหลังลูกทัวร์คนนี้ลงทะเบียนไปแล้ว
  const [editingId, setEditingId] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [guestsRes, fieldsRes, responsesRes, busesRes, busSeatsRes, staffRes] = await Promise.all([
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
      supabase.from('buses').select('id, name').eq('tour_id', ACTIVE_TOUR_ID).order('name', { ascending: true }),
      supabase.from('bus_seats').select('bus_id, guest_id').eq('tour_id', ACTIVE_TOUR_ID).not('guest_id', 'is', null),
      supabase.from('staff').select('id, guest_id').eq('tour_id', ACTIVE_TOUR_ID).not('guest_id', 'is', null),
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
    if (!busesRes.error) setBuses(busesRes.data ?? [])
    if (!busSeatsRes.error) setBusSeats(busSeatsRes.data ?? [])
    if (!staffRes.error) setStaffGuestIds((staffRes.data ?? []).map((s) => s.guest_id))
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

  // ตัวเลือกเพศสำหรับฟิลเตอร์ — ดึงจาก options ของฟิลด์ gender จริง (ตั้งค่าได้ผ่าน FormBuilder)
  // เผื่อไม่มีฟิลด์นี้ (ถูกลบ/ปิดไว้) fallback เป็นชาย/หญิงตามค่าเริ่มต้นของระบบ
  const genderOptions = useMemo(() => {
    const genderField = fields.find((f) => f.field_key === 'gender')
    if (genderField?.options?.length) return genderField.options
    return [
      { label: 'ชาย', value: 'ชาย' },
      { label: 'หญิง', value: 'หญิง' },
    ]
  }, [fields])

  // บัสที่แต่ละลูกทัวร์ถูกจัดที่นั่งไว้ (guest_id -> bus_id) — คนหนึ่งควรอยู่บัสเดียว เอาอันแรกที่เจอ
  const busIdByGuestId = useMemo(() => {
    const map = {}
    for (const s of busSeats) {
      if (s.guest_id && !map[s.guest_id]) map[s.guest_id] = s.bus_id
    }
    return map
  }, [busSeats])

  const staffGuestIdSet = useMemo(() => new Set(staffGuestIds), [staffGuestIds])

  // ฟิลด์วันเกิดเป็นฟิลด์ไดนามิก (custom_birthdate, type date) เก็บใน guest_form_responses รูปแบบ YYYY-MM-DD
  const birthdayFieldId = useMemo(
    () => fields.find((f) => f.field_key === 'custom_birthdate')?.id ?? null,
    [fields]
  )
  const currentMonth = useMemo(() => new Date().getMonth() + 1, [])

  function getBirthday(guest) {
    if (!birthdayFieldId) return ''
    return responsesByGuestId[guest.id]?.[birthdayFieldId] ?? ''
  }

  function isBirthdayThisMonth(guest) {
    const raw = getBirthday(guest)
    if (!raw) return false
    const month = Number(raw.slice(5, 7))
    return month === currentMonth
  }

  function formatBirthdayShort(raw) {
    const date = new Date(`${raw}T00:00:00`)
    if (Number.isNaN(date.getTime())) return raw
    return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(date)
  }

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

  // ฟิลเตอร์ค้นหา/เพศ/รถบัส — ยังไม่รวมฟิลเตอร์วันเกิด เผื่อต้องใช้นับจำนวนสำหรับปุ่มด้วย
  const preBirthdayGuests = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = guests

    if (q) {
      list = list.filter((g) => {
        const haystack = activeFields
          .map((f) => getFieldValue(g, f))
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
    }

    if (filterGender !== 'all') {
      list = list.filter((g) => g.gender === filterGender)
    }

    if (filterBus !== 'all') {
      list = list.filter((g) =>
        filterBus === '__none__' ? !busIdByGuestId[g.id] : busIdByGuestId[g.id] === filterBus
      )
    }

    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guests, search, activeFields, responsesByGuestId, filterGender, filterBus, busIdByGuestId])

  // จำนวนคนเกิดเดือนนี้ในผลลัพธ์ปัจจุบัน (ก่อนกรองวันเกิด) — ใช้โชว์ตัวเลขบนปุ่มฟิลเตอร์
  const birthdayCount = useMemo(
    () => preBirthdayGuests.filter((g) => isBirthdayThisMonth(g)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preBirthdayGuests, birthdayFieldId, responsesByGuestId, currentMonth]
  )

  const filteredGuests = useMemo(() => {
    const list = filterBirthdayMonth
      ? preBirthdayGuests.filter((g) => isBirthdayThisMonth(g))
      : preBirthdayGuests

    // เรียงตามชื่อเล่น (ถ้าไม่มีใช้ชื่อจริงแทน) — ใช้ locale ไทยให้เรียงตัวอักษรถูกต้อง
    return [...list].sort((a, b) =>
      (a.nickname || a.name || '').localeCompare(b.nickname || b.name || '', 'th')
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preBirthdayGuests, filterBirthdayMonth, birthdayFieldId, responsesByGuestId, currentMonth])

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
              className="mb-2 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />

            <div className="mb-1.5 flex flex-wrap gap-1.5">
              <button
                onClick={() => setFilterBirthdayMonth((prev) => !prev)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  filterBirthdayMonth ? 'bg-pink-600 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                🎂 {t('staff.guestManager.filterBirthdayMonth', { count: birthdayCount })}
              </button>
            </div>

            <div className="mb-1.5 flex flex-wrap gap-1.5">
              <button
                onClick={() => setFilterGender('all')}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  filterGender === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {t('staff.guestManager.filterAllGenders')}
              </button>
              {genderOptions.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setFilterGender(g.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    filterGender === g.value ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {buses.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                <button
                  onClick={() => setFilterBus('all')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    filterBus === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {t('staff.checkIn.allBuses')}
                </button>
                {buses.map((bus) => (
                  <button
                    key={bus.id}
                    onClick={() => setFilterBus(bus.id)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                      filterBus === bus.id ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    🚌 {bus.name}
                  </button>
                ))}
                <button
                  onClick={() => setFilterBus('__none__')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    filterBus === '__none__' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {t('staff.guestManager.filterNoBus')}
                </button>
              </div>
            )}

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
                      className="flex w-full items-center gap-3 text-left"
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarClasses(guest.gender)}`}
                      >
                        {guestInitials(guest)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className={`truncate font-medium ${genderTextClass(guest.gender) || 'text-gray-900'}`}>
                            {guest.nickname || guest.name}
                          </p>
                          {isBirthdayThisMonth(guest) && (
                            <span className="shrink-0 rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-semibold text-pink-700">
                              {t('staff.guestManager.birthdayBadge', { date: formatBirthdayShort(getBirthday(guest)) })}
                            </span>
                          )}
                          {staffGuestIdSet.has(guest.id) && (
                            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              {t('staff.guestManager.staffBadge')}
                            </span>
                          )}
                        </div>
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
                      <div className="mt-3 flex flex-col gap-2.5 border-t border-gray-100 pt-3">
                        {groupFieldsByCategory(activeFields).map(({ category, fields: groupFields }) => {
                          const hasData = groupFields.some((f) => String(getFieldValue(guest, f) || '').trim())
                          const warn = category === 'health' && hasData
                          const st = warn ? HEALTH_WARNING_STYLE : CATEGORY_STYLE[category] || CATEGORY_STYLE.other
                          return (
                            <div key={category} className="overflow-hidden rounded-xl border border-gray-100">
                              <div className="flex items-center gap-2 px-3 py-2" style={{ background: st.tint }}>
                                <Icon name={st.icon} size={15} color={st.iconColor} />
                                <span className="text-xs font-bold" style={{ color: st.text }}>
                                  {t(`guest.register.category.${category}`)}
                                  {warn && ` · ${t('staff.guestManager.healthWarning')}`}
                                </span>
                              </div>
                              <div className="px-3 py-1.5">
                                {groupFields.map((field) => {
                                  const value = getFieldValue(guest, field)
                                  const isWarnField = warn && String(value || '').trim()
                                  return (
                                    <div key={field.id} className="flex justify-between gap-3 py-1 text-sm">
                                      <span className="shrink-0 text-gray-400">{field.label}</span>
                                      <span
                                        className={`min-w-0 flex-1 text-right ${
                                          isWarnField ? 'font-semibold text-amber-700' : 'text-gray-900'
                                        }`}
                                      >
                                        {value || (
                                          <span className="text-gray-300">{t('staff.guestManager.noValue')}</span>
                                        )}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}

                        <div className="mt-1 flex gap-2">
                          {guest.phone && (
                            <a
                              href={`tel:${guest.phone}`}
                              className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white"
                            >
                              <Icon name="phone" size={15} color="#fff" /> {t('staff.guestManager.call')}
                            </a>
                          )}
                          <button
                            onClick={() => startEditing(guest)}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"
                          >
                            <Icon name="edit" size={15} /> {t('staff.itineraryBuilder.edit')}
                          </button>
                          <button
                            onClick={() => deleteGuest(guest)}
                            className="rounded-xl bg-red-50 px-3 py-2 text-red-600"
                            aria-label={t('staff.guestManager.deleteGuest')}
                          >
                            <Icon name="trash" size={16} color="#dc2626" />
                          </button>
                        </div>
                      </div>
                    )}

                    {isExpanded && editingId === guest.id && (
                      <div className="mt-3 flex flex-col gap-2.5 border-t border-gray-100 pt-3">
                        {groupFieldsByCategory(activeFields).map(({ category, fields: groupFields }) => {
                          const st = CATEGORY_STYLE[category] || CATEGORY_STYLE.other
                          return (
                            <div key={category} className="overflow-hidden rounded-xl border border-gray-100">
                              <div className="flex items-center gap-2 px-3 py-2" style={{ background: st.tint }}>
                                <Icon name={st.icon} size={15} color={st.iconColor} />
                                <span className="text-xs font-bold" style={{ color: st.text }}>
                                  {t(`guest.register.category.${category}`)}
                                </span>
                              </div>
                              <div className="flex flex-col gap-3 px-3 py-3">
                                {groupFields.map((field) => (
                                  <DynamicField
                                    key={field.id}
                                    field={field}
                                    value={editValues[field.id]}
                                    onChange={(v) => setEditFieldValue(field.id, v)}
                                  />
                                ))}
                              </div>
                            </div>
                          )
                        })}

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
