import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getStaffSession } from '../../lib/staffSession'
import { findFieldByPurpose, buildResponsesByGuestId, resolveGuestPhone } from '../../lib/guestFields'
import { genderTextClass } from '../../lib/genderColor'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import SelectField from '../../components/common/SelectField'

const CATEGORIES = ['guide', 'staff', 'government', 'hospital', 'other']
const NEW_CONTACT_TEMPLATE = { label: '', phone: '', category: 'other' }

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
  open: 'border-l-red-500 bg-red-50',
  acknowledged: 'border-l-amber-500 bg-amber-50',
  resolved: 'border-l-green-500 bg-green-50',
}

export default function SOSMonitor() {
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
      .eq('tour_id', ACTIVE_TOUR_ID)
      .order('created_at', { ascending: false })

    if (!error) setAlerts(data ?? [])
    setLoadingAlerts(false)
  }

  async function loadGuestsAndFields() {
    const [guestsRes, fieldsRes, staffRes] = await Promise.all([
      supabase
        .from('guests')
        .select('id, name, nickname, gender, phone')
        .eq('tour_id', ACTIVE_TOUR_ID),
      supabase
        .from('form_fields')
        .select('id, field_key, field_purpose, is_core')
        .eq('tour_id', ACTIVE_TOUR_ID),
      supabase.from('staff').select('id, name').eq('tour_id', ACTIVE_TOUR_ID),
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
      .channel(`sos-alerts-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sos_alerts', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
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
    if (status === 'resolved') patch.resolved_by = staffSession?.id ?? null

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
        .from('emergency_contacts')
        .select('id, label, phone, category, sort_order, is_active')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('sort_order', { ascending: true }),
      supabase
        .from('staff')
        .select('id, name, phone, show_to_guest')
        .eq('tour_id', ACTIVE_TOUR_ID)
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
      .channel(`emergency-contacts-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'emergency_contacts', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
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
      tour_id: ACTIVE_TOUR_ID,
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

    const { error } = await supabase.from('emergency_contacts').delete().eq('id', contact.id)
    if (!error) setContacts((prev) => prev.filter((c) => c.id !== contact.id))
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
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-3 text-xl font-bold text-gray-900">{t('staff.sosMonitor.title')}</h1>

        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setTab('alerts')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              tab === 'alerts' ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('staff.sosMonitor.tabAlerts')}
            {openCount > 0 && (
              <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">
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
            {loadingAlerts && <p className="text-gray-500">{t('common.loading')}</p>}
            {!loadingAlerts && alerts.length === 0 && (
              <p className="text-sm text-gray-400">{t('staff.sosMonitor.noAlerts')}</p>
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
                        <p className={`font-semibold ${genderTextClass(guest?.gender) || 'text-gray-900'}`}>
                          {guest ? guest.nickname || guest.name : t('staff.sosMonitor.unknownGuest')}
                        </p>
                        <p className="text-xs text-gray-500">{timeAgoLabel(t, alert.created_at)}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          alert.status === 'open'
                            ? 'bg-red-600 text-white'
                            : alert.status === 'acknowledged'
                              ? 'bg-amber-500 text-white'
                              : 'bg-green-600 text-white'
                        }`}
                      >
                        {t(`staff.sosMonitor.status${alert.status[0].toUpperCase()}${alert.status.slice(1)}`)}
                      </span>
                    </div>

                    {alert.note && (
                      <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 text-sm text-gray-700">
                        <span className="font-medium text-gray-500">{t('staff.sosMonitor.noteLabel')}: </span>
                        {alert.note}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {phone && (
                        <a
                          href={`tel:${phone}`}
                          className="rounded-pill bg-white px-3 py-1.5 text-sm font-semibold text-brand shadow-sm ring-1 ring-black/5"
                        >
                          {t('staff.sosMonitor.callGuest')} {phone}
                        </a>
                      )}
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-pill bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white"
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
                      <p className="mt-2 text-xs text-gray-400">
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
              className="mb-3 w-full rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
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

            {loadingContacts && <p className="text-gray-500">{t('common.loading')}</p>}

            {!loadingContacts && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase text-gray-400">
                    {t('staff.sosMonitor.guideNumbersTitle')}
                  </p>
                  <p className="mb-2 text-xs text-gray-400">{t('staff.sosMonitor.guideNumbersHint')}</p>
                  {guideStaff.length === 0 && (
                    <p className="text-sm text-gray-400">{t('staff.sosMonitor.noContacts')}</p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {guideStaff.map((s) => (
                      <Card key={s.id} className="flex items-center justify-between p-3">
                        <span className="font-medium text-gray-900">{s.name}</span>
                        <span className="text-sm text-gray-500">{s.phone || '—'}</span>
                      </Card>
                    ))}
                  </div>
                </div>

                {CATEGORIES.filter((c) => c !== 'guide').map((category) => (
                  <div key={category}>
                    <p className="mb-1.5 text-xs font-semibold uppercase text-gray-400">
                      {t(`staff.sosMonitor.category.${category}`)}
                    </p>
                    {(contactsByCategory[category] ?? []).length === 0 && (
                      <p className="text-sm text-gray-400">{t('staff.sosMonitor.noContacts')}</p>
                    )}
                    <div className="flex flex-col gap-1.5">
                      {(contactsByCategory[category] ?? []).map((contact) => (
                        <Card key={contact.id} className="flex items-center justify-between p-3">
                          <div>
                            <p className="font-medium text-gray-900">{contact.label}</p>
                            <p className="text-sm text-gray-500">{contact.phone}</p>
                          </div>
                          <button
                            onClick={() => deleteContact(contact)}
                            className="shrink-0 text-sm font-medium text-red-500"
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
