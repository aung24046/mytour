import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { detachContent } from '../../lib/tourContent'
import { getStaffSession, useActiveTourId } from '../../lib/staffSession'
import { findFieldByPurpose, buildResponsesByGuestId, resolveGuestPhone } from '../../lib/guestFields'
import { genderTextClass } from '../../lib/genderColor'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import Icon from '../../components/common/Icon'
import StaffHeader from '../../components/common/StaffHeader'
import TextField from '../../components/common/TextField'
import SelectField from '../../components/common/SelectField'

const CATEGORIES = ['guide', 'staff', 'government', 'hospital', 'other']
const NEW_CONTACT_TEMPLATE = { label: '', phone: '', category: 'other' }
// ต้องตรงกับ QUICK_CALL_MAX ใน src/pages/guest/SOS.jsx — ปุ่มโทรด่วนวางเป็นตาราง 2×2
const QUICK_CALL_MAX = 4

function timeAgoLabel(t, dateStr) {
  if (!dateStr) return t('staff.locationMonitor.never')
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return t('staff.locationMonitor.justNow')
  if (mins < 60) return t('staff.locationMonitor.minutesAgo', { count: mins })
  const hours = Math.floor(mins / 60)
  return t('staff.locationMonitor.hoursAgo', { count: hours })
}

const STATUS_STYLES = {
  open: 'border-l-danger bg-danger-bg',
  acknowledged: 'border-l-warning bg-warning-bg',
  resolved: 'border-l-success bg-success-bg',
}

export default function SOSMonitor() {
  const tourId = useActiveTourId()
  const { t } = useTranslation()
  const staffSession = getStaffSession()

  const [tab, setTab] = useState('alerts') // 'alerts' | 'contacts'

  // --- Alerts ---
  const [alerts, setAlerts] = useState([])
  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [loadingAlerts, setLoadingAlerts] = useState(true)
  const [staffById, setStaffById] = useState({})

  async function loadAlerts() {
    setLoadingAlerts(true)
    const { data, error } = await supabase
      .from('sos_alerts')
      .select('id, guest_id, lat, lng, accuracy, note, status, created_at, resolved_by')
      .eq('tour_id', tourId)
      .order('created_at', { ascending: false })

    if (!error) setAlerts(data ?? [])
    setLoadingAlerts(false)
  }

  async function loadGuestsAndFields() {
    const [guestsRes, fieldsRes, staffRes] = await Promise.all([
      supabase
        .from('guests')
        .select('id, name, nickname, gender, phone')
        .eq('tour_id', tourId),
      supabase
        .from('v_tour_form_fields')
        .select('id, field_key, field_purpose, is_core')
        .eq('tour_id', tourId)
        .eq('form_type', 'registration'),
      supabase.from('v_tour_staff').select('id, name').eq('tour_id', tourId),
    ])

    setGuests(guestsRes.data ?? [])
    setFields(fieldsRes.data ?? [])

    const staffMap = {}
    for (const s of staffRes.data ?? []) staffMap[s.id] = s.name
    setStaffById(staffMap)

    const phoneField = findFieldByPurpose(fieldsRes.data ?? [], 'phone')
    if (phoneField && !phoneField.is_core) {
      const { data: responsesData } = await supabase
        .from('guest_form_responses')
        .select('guest_id, field_id, value')
        .eq('field_id', phoneField.id)
      setResponses(responsesData ?? [])
    }
  }

  useEffect(() => {
    loadAlerts()
    loadGuestsAndFields()

    const channel = supabase
      .channel(`sos-alerts-${tourId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sos_alerts', filter: `tour_id=eq.${tourId}` },
        () => loadAlerts()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const phoneField = useMemo(() => findFieldByPurpose(fields, 'phone'), [fields])
  const responsesByGuestId = useMemo(() => buildResponsesByGuestId(responses), [responses])

  const openCount = alerts.filter((a) => a.status === 'open').length

  async function updateAlertStatus(alert, status) {
    const patch = { status }
    // session คือ { staff, orgRole, ... } — id ของคนอยู่ใน .staff.id ไม่ใช่ระดับบนสุด
    // เดิมอ่าน staffSession?.id ที่เป็น undefined เสมอ ทุกเคสที่ปิดจึงไม่มีชื่อคนปิดติดไว้
    if (status === 'resolved') patch.resolved_by = staffSession?.staff?.id ?? null

    const { error } = await supabase.from('sos_alerts').update(patch).eq('id', alert.id)
    if (error) {
      console.error('[SOSMonitor] update status failed', error)
      return
    }
    setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, ...patch } : a)))
  }

  // --- Contacts ---
  const [contacts, setContacts] = useState([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newContact, setNewContact] = useState(NEW_CONTACT_TEMPLATE)
  const [creatingContact, setCreatingContact] = useState(false)
  const [guideStaff, setGuideStaff] = useState([])

  async function loadContacts() {
    setLoadingContacts(true)
    const [contactsRes, guideRes] = await Promise.all([
      supabase
        .from('v_tour_emergency_contacts')
        .select('id, assignment_id, label, phone, category, sort_order, is_active, is_quick')
        .eq('tour_id', tourId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('v_tour_staff')
        .select('id, assignment_id, name, phone, show_to_guest, is_quick')
        .eq('tour_id', tourId)
        .eq('show_to_guest', true),
    ])

    if (!contactsRes.error) setContacts(contactsRes.data ?? [])
    if (!guideRes.error) setGuideStaff(guideRes.data ?? [])
    setLoadingContacts(false)
  }

  useEffect(() => {
    if (tab !== 'contacts') return
    loadContacts()

    const channel = supabase
      .channel(`emergency-contacts-${tourId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_contacts', filter: `tour_id=eq.${tourId}` },
        () => loadContacts()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function handleCreateContact(e) {
    e.preventDefault()
    if (!newContact.label.trim() || !newContact.phone.trim()) return

    setCreatingContact(true)
    const maxSort = contacts.reduce((max, c) => Math.max(max, c.sort_order ?? 0), 0)

    const { error } = await supabase.from('emergency_contacts').insert({
      tour_id: tourId,
      label: newContact.label.trim(),
      phone: newContact.phone.trim(),
      category: newContact.category,
      sort_order: maxSort + 1,
    })

    if (error) {
      console.error('[SOSMonitor] create contact failed', error)
    } else {
      setNewContact(NEW_CONTACT_TEMPLATE)
      setShowNewForm(false)
      loadContacts()
    }
    setCreatingContact(false)
  }

  async function deleteContact(contact) {
    const confirmed = window.confirm(t('staff.sosMonitor.confirmDeleteContact', { label: contact.label }))
    if (!confirmed) return

    // ถอดออกจากทริปนี้ — ทริปอื่นที่ใช้เบอร์เดียวกันไม่กระทบ
    const { error } = await detachContent('emergency_contacts', contact.id, tourId)
    if (!error) setContacts((prev) => prev.filter((c) => c.id !== contact.id))
  }

  // --- โทรด่วน ---
  // ปุ่มโทรด่วนใต้ปุ่ม SOS ฝั่งลูกทัวร์รับได้ 4 เบอร์ ปักหมุดจากที่นี่
  // ธงอยู่ที่ตารางเชื่อม (tour_emergency_contacts / tour_staff) → ปักคนละชุดได้ทุกทริป
  const quickCount = useMemo(
    () => contacts.filter((c) => c.is_quick).length + guideStaff.filter((s) => s.is_quick).length,
    [contacts, guideStaff]
  )
  const quickFull = quickCount >= QUICK_CALL_MAX

  async function toggleQuick(kind, row) {
    const next = !row.is_quick
    if (next && quickFull) return

    const table = kind === 'staff' ? 'tour_staff' : 'tour_emergency_contacts'
    const setter = kind === 'staff' ? setGuideStaff : setContacts

    // อัปเดตจอก่อนแล้วค่อยยิง — ปุ่มดาวต้องตอบสนองทันที ถ้าพลาดค่อยถอยกลับ
    setter((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_quick: next } : r)))

    const { error } = await supabase
      .from(table)
      .update({ is_quick: next })
      .eq('id', row.assignment_id)

    if (error) {
      console.error('[SOSMonitor] toggle quick call failed', error)
      setter((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_quick: row.is_quick } : r)))
    }
  }

  function QuickStar({ kind, row }) {
    const on = !!row.is_quick
    const blocked = !on && quickFull
    return (
      <button
        type="button"
        onClick={() => toggleQuick(kind, row)}
        disabled={blocked}
        aria-pressed={on}
        title={blocked ? t('staff.sosMonitor.quickFull', { max: QUICK_CALL_MAX }) : t('staff.sosMonitor.quickToggle')}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
          on
            ? 'bg-warning-bg text-warning-text'
            : blocked
              ? 'text-ink-faint opacity-40'
              : 'text-ink-faint hover:bg-surface-sunken'
        }`}
      >
        <Icon name="star" size={18} filled={on} />
      </button>
    )
  }

  const contactsByCategory = useMemo(() => {
    const groups = {}
    for (const c of contacts) {
      if (!groups[c.category]) groups[c.category] = []
      groups[c.category].push(c)
    }
    return groups
  }, [contacts])

  return (
    <div className="min-h-screen bg-surface-muted">
      <StaffHeader icon="alert" title={t('staff.sosMonitor.title')} />
      <div className="mx-auto max-w-md p-4">
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setTab('alerts')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              tab === 'alerts' ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('staff.sosMonitor.tabAlerts')}
            {openCount > 0 && (
              <span className="ml-1.5 rounded-full bg-danger px-1.5 py-0.5 text-xs font-bold text-white">
                {openCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('contacts')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              tab === 'contacts' ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('staff.sosMonitor.tabContacts')}
          </button>
        </div>

        {tab === 'alerts' && (
          <>
            {loadingAlerts && <p className="text-ink-muted">{t('common.loading')}</p>}
            {!loadingAlerts && alerts.length === 0 && (
              <p className="text-sm text-ink-faint">{t('staff.sosMonitor.noAlerts')}</p>
            )}

            <div className="flex flex-col gap-2">
              {alerts.map((alert) => {
                const guest = guestById[alert.guest_id]
                const phone = guest ? resolveGuestPhone(guest, phoneField, responsesByGuestId) : null
                const mapsUrl =
                  alert.lat != null && alert.lng != null
                    ? `https://www.google.com/maps?q=${alert.lat},${alert.lng}`
                    : null

                return (
                  <Card key={alert.id} className={`border-l-4 ${STATUS_STYLES[alert.status] ?? ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`font-semibold ${genderTextClass(guest?.gender) || 'text-ink'}`}>
                          {guest ? guest.nickname || guest.name : t('staff.sosMonitor.unknownGuest')}
                        </p>
                        <p className="text-xs text-ink-muted">{timeAgoLabel(t, alert.created_at)}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          alert.status === 'open'
                            ? 'bg-danger text-white'
                            : alert.status === 'acknowledged'
                              ? 'bg-warning text-on-warning'
                              : 'bg-success text-white'
                        }`}
                      >
                        {t(`staff.sosMonitor.status${alert.status[0].toUpperCase()}${alert.status.slice(1)}`)}
                      </span>
                    </div>

                    {alert.note && (
                      <p className="mt-2 rounded-lg bg-surface/70 px-2.5 py-2 text-sm text-neutral-text">
                        <span className="font-medium text-ink-muted">{t('staff.sosMonitor.noteLabel')}: </span>
                        {alert.note}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {phone && (
                        <a
                          href={`tel:${phone}`}
                          className="rounded-pill bg-surface px-3 py-1.5 text-sm font-semibold text-brand shadow-sm ring-1 ring-line-subtle"
                        >
                          {t('staff.sosMonitor.callGuest')} {phone}
                        </a>
                      )}
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-pill bg-brand px-3 py-1.5 text-sm font-semibold text-white"
                        >
                          {t('staff.sosMonitor.viewOnMap')}
                        </a>
                      )}
                      {alert.status === 'open' && (
                        <Button
                          fullWidth={false}
                          variant="secondary"
                          className="px-3 py-1.5 text-sm"
                          onClick={() => updateAlertStatus(alert, 'acknowledged')}
                        >
                          {t('staff.sosMonitor.acknowledge')}
                        </Button>
                      )}
                      {alert.status !== 'resolved' && (
                        <Button
                          fullWidth={false}
                          variant="danger"
                          className="px-3 py-1.5 text-sm"
                          onClick={() => updateAlertStatus(alert, 'resolved')}
                        >
                          {t('staff.sosMonitor.resolve')}
                        </Button>
                      )}
                    </div>

                    {alert.status === 'resolved' && alert.resolved_by && staffById[alert.resolved_by] && (
                      <p className="mt-2 text-xs text-ink-faint">
                        {t('staff.sosMonitor.resolvedBy', { name: staffById[alert.resolved_by] })}
                      </p>
                    )}
                  </Card>
                )
              })}
            </div>
          </>
        )}

        {tab === 'contacts' && (
          <>
            <button
              onClick={() => setShowNewForm((v) => !v)}
              className="mb-3 w-full rounded-xl border border-dashed border-line-strong px-4 py-2.5 text-sm font-medium text-ink-muted hover:border-brand hover:text-brand"
            >
              + {t('staff.sosMonitor.addContact')}
            </button>

            {showNewForm && (
              <Card className="mb-3">
                <form onSubmit={handleCreateContact} className="flex flex-col gap-3">
                  <TextField
                    label={t('staff.sosMonitor.contactLabel')}
                    required
                    value={newContact.label}
                    onChange={(e) => setNewContact((prev) => ({ ...prev, label: e.target.value }))}
                  />
                  <TextField
                    label={t('staff.sosMonitor.contactPhone')}
                    required
                    value={newContact.phone}
                    onChange={(e) => setNewContact((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                  <SelectField
                    label={t('staff.sosMonitor.contactCategory')}
                    options={CATEGORIES.filter((c) => c !== 'guide').map((c) => ({
                      value: c,
                      label: t(`staff.sosMonitor.category.${c}`),
                    }))}
                    value={newContact.category}
                    onChange={(e) => setNewContact((prev) => ({ ...prev, category: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={creatingContact}>
                      {creatingContact ? t('guest.register.submitting') : t('common.save')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setShowNewForm(false)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            {loadingContacts && <p className="text-ink-muted">{t('common.loading')}</p>}

            {!loadingContacts && (
              <div className="flex flex-col gap-4">
                <Card className="flex items-start gap-2.5 border-warning/40 bg-warning-bg/50 p-3">
                  <Icon name="star" size={18} filled className="mt-0.5 text-warning-text" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {t('staff.sosMonitor.quickTitle')}{' '}
                      <span className="tabular-nums text-ink-muted">
                        {quickCount}/{QUICK_CALL_MAX}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {quickCount === 0
                        ? t('staff.sosMonitor.quickEmptyHint')
                        : t('staff.sosMonitor.quickHint', { max: QUICK_CALL_MAX })}
                    </p>
                  </div>
                </Card>

                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase text-ink-faint">
                    {t('staff.sosMonitor.guideNumbersTitle')}
                  </p>
                  <p className="mb-2 text-xs text-ink-faint">{t('staff.sosMonitor.guideNumbersHint')}</p>
                  {guideStaff.length === 0 && (
                    <p className="text-sm text-ink-faint">{t('staff.sosMonitor.noContacts')}</p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {guideStaff.map((s) => (
                      <Card key={s.id} className="flex items-center gap-2 p-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{s.name}</span>
                          <span className="block truncate text-sm tabular-nums text-ink-muted">
                            {s.phone || '—'}
                          </span>
                        </span>
                        <QuickStar kind="staff" row={s} />
                      </Card>
                    ))}
                  </div>
                </div>

                {CATEGORIES.filter((c) => c !== 'guide').map((category) => (
                  <div key={category}>
                    <p className="mb-1.5 text-xs font-semibold uppercase text-ink-faint">
                      {t(`staff.sosMonitor.category.${category}`)}
                    </p>
                    {(contactsByCategory[category] ?? []).length === 0 && (
                      <p className="text-sm text-ink-faint">{t('staff.sosMonitor.noContacts')}</p>
                    )}
                    <div className="flex flex-col gap-1.5">
                      {(contactsByCategory[category] ?? []).map((contact) => (
                        <Card key={contact.id} className="flex items-center gap-2 p-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-ink">{contact.label}</p>
                            <p className="truncate text-sm tabular-nums text-ink-muted">{contact.phone}</p>
                          </div>
                          <QuickStar kind="contact" row={contact} />
                          <button
                            onClick={() => deleteContact(contact)}
                            className="shrink-0 text-sm font-medium text-danger"
                          >
                            {t('staff.sosMonitor.deleteContact')}
                          </button>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
