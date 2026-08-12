import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useActiveTourId } from '../../lib/staffSession'
import { findFieldByPurpose, buildResponsesByGuestId, resolveGuestPhone } from '../../lib/guestFields'
import { saveCache, loadCache } from '../../lib/offlineCache'
import { genderTextClass } from '../../lib/genderColor'
import { useCheckinEvent } from '../../lib/useCheckinEvent'
import Card from '../../components/common/Card'
import StaffHeader from '../../components/common/StaffHeader'
import Button from '../../components/common/Button'
import BottomSheet from '../../components/common/BottomSheet'
import QrScanner from '../../components/common/QrScanner'

const FILTERS = ['all', 'arrived', 'not_arrived']
const CACHE_KEY = 'checkin_guests'

export default function CheckIn() {
  const tourId = useActiveTourId()
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [buses, setBuses] = useState([])
  const [busSeats, setBusSeats] = useState([])
  const [staffGuestIds, setStaffGuestIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [usingCache, setUsingCache] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [busFilter, setBusFilter] = useState('all')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanFeedback, setScanFeedback] = useState(null) // { type: 'success' | 'error' | 'duplicate', name }

  // ลอจิกจุดเช็คอิน/ติ๊ก/คิวออฟไลน์ อยู่ใน useCheckinEvent ทั้งหมด
  // หน้าผังที่นั่งกับแดชบอร์ดใช้ hook เดียวกัน ตัวเลขและจุดที่เลือกจึงตรงกันเสมอ
  const {
    events,
    itineraryItems,
    selectedEvent,
    selectedEventId,
    selectEvent,
    isCoreEvent,
    isCheckedIn,
    checkedInGuestIds,
    checkedInCount,
    toggle,
    togglingId,
    createEvent,
    pendingCount,
    isOnline,
  } = useCheckinEvent(tourId, { guests, setGuests })

  const [eventPickerOpen, setEventPickerOpen] = useState(false)
  const [createEventOpen, setCreateEventOpen] = useState(false)
  const [createEventTab, setCreateEventTab] = useState('itinerary') // 'itinerary' | 'custom'
  const [selectedItineraryItemId, setSelectedItineraryItemId] = useState('')
  const [newEventTitle, setNewEventTitle] = useState('')
  const [creatingEvent, setCreatingEvent] = useState(false)

  // เปิดกล้องสแกนอัตโนมัติเมื่อมาจากปุ่มลัดบนแดชบอร์ด (?scan=1)
  useEffect(() => {
    if (searchParams.get('scan') === '1') {
      setScanFeedback(null)
      setScannerOpen(true)
      searchParams.delete('scan')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let isMounted = true

    async function loadGuests() {
      setLoading(true)
      setLoadError(null)

      const [guestsRes, fieldsRes, busesRes, busSeatsRes, staffRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, name, nickname, gender, phone, qr_token, check_in_status, check_in_time, bus_id')
          .eq('tour_id', tourId)
          .order('name', { ascending: true }),
        supabase
          .from('v_tour_form_fields')
          .select('id, field_key, field_purpose, is_core')
          .eq('tour_id', tourId)
          .eq('form_type', 'registration'),
        supabase.from('buses').select('id, name').eq('tour_id', tourId).order('name'),
        supabase
          .from('bus_seats')
          .select('bus_id, guest_id')
          .eq('tour_id', tourId)
          .not('guest_id', 'is', null),
        supabase
          .from('v_tour_staff')
          .select('id, guest_id')
          .eq('tour_id', tourId)
          .not('guest_id', 'is', null),
      ])

      if (!isMounted) return

      if (guestsRes.error || fieldsRes.error || busesRes.error || busSeatsRes.error) {
        console.error(
          '[CheckIn] load failed — falling back to offline cache',
          guestsRes.error,
          fieldsRes.error,
          busesRes.error,
          busSeatsRes.error
        )
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setGuests(cached.guests ?? [])
          setFields(cached.fields ?? [])
          setBuses(cached.buses ?? [])
          setBusSeats(cached.busSeats ?? [])
          setStaffGuestIds(cached.staffGuestIds ?? [])
          setUsingCache(true)
        } else {
          setLoadError(t('staff.checkIn.loadError'))
        }
        setLoading(false)
        return
      }

      setGuests(guestsRes.data ?? [])
      setFields(fieldsRes.data ?? [])
      setBuses(busesRes.data ?? [])
      setBusSeats(busSeatsRes.data ?? [])
      setStaffGuestIds(staffRes.error ? [] : (staffRes.data ?? []).map((s) => s.guest_id))
      setUsingCache(false)

      let responsesData = []
      const phoneField = findFieldByPurpose(fieldsRes.data ?? [], 'phone')
      if (phoneField && !phoneField.is_core) {
        const { data, error: responsesError } = await supabase
          .from('guest_form_responses')
          .select('guest_id, field_id, value')
          .eq('field_id', phoneField.id)

        if (!responsesError && isMounted) {
          responsesData = data ?? []
          setResponses(responsesData)
        }
      }

      saveCache(CACHE_KEY, {
        guests: guestsRes.data ?? [],
        fields: fieldsRes.data ?? [],
        buses: busesRes.data ?? [],
        busSeats: busSeatsRes.data ?? [],
        staffGuestIds: staffRes.error ? [] : (staffRes.data ?? []).map((s) => s.guest_id),
        responses: responsesData,
      })

      setLoading(false)
    }

    loadGuests()

    // Realtime: sync check-in status if another staff member checks someone in
    const channel = supabase
      .channel(`checkin-${tourId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'guests',
          filter: `tour_id=eq.${tourId}`,
        },
        (payload) => {
          setGuests((prev) =>
            prev.map((g) => (g.id === payload.new.id ? { ...g, ...payload.new } : g))
          )
        }
      )
      .subscribe()

    // เน็ตกลับมา → โหลดรายชื่อใหม่ (ส่วนคิวที่ค้าง hook จัดการให้เอง)
    function handleOnline() {
      loadGuests()
    }
    window.addEventListener('online', handleOnline)

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
      window.removeEventListener('online', handleOnline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])


  async function handleCreateEvent(e) {
    e.preventDefault()

    const title = newEventTitle.trim()
    const itineraryItemId = createEventTab === 'itinerary' ? selectedItineraryItemId || null : null

    if (createEventTab === 'itinerary' && !itineraryItemId) return
    if (!title) return

    setCreatingEvent(true)
    const { error } = await createEvent({ title, itineraryItemId })

    if (!error) {
      setNewEventTitle('')
      setSelectedItineraryItemId('')
      setCreateEventTab('itinerary')
      setCreateEventOpen(false)
      setEventPickerOpen(false)
    }
    setCreatingEvent(false)
  }

  function pickItineraryItem(item) {
    setSelectedItineraryItemId(item.id)
    setNewEventTitle(item.location_name || item.title)
  }

  function itineraryItemLabel(item) {
    const time = item.scheduled_time ? item.scheduled_time.slice(0, 5) : ''
    const place = item.location_name ? ` — ${item.location_name}` : ''
    return `${t('staff.checkIn.dayLabel', { day: item.day_number })}${time ? ' · ' + time : ''} · ${item.title}${place}`
  }


  async function handleScan(decodedText) {
    setScannerOpen(false)

    const guest = guests.find((g) => g.qr_token === decodedText)
    if (!guest) {
      setScanFeedback({ type: 'error' })
      return
    }

    if (isCheckedIn(guest)) {
      setScanFeedback({ type: 'duplicate', name: guest.nickname || guest.name })
      return
    }

    await toggle(guest)
    setScanFeedback({ type: 'success', name: guest.nickname || guest.name })
  }

  function handleScanError(err) {
    setScannerOpen(false)
    console.error('[CheckIn] camera error', err)
    setScanFeedback({ type: 'camera_error' })
  }

  // ถ้ายังไม่ได้เลือกที่นั่ง (ไม่มีแถวใน bus_seats ที่ผูก guest_id) แต่จับลงคันแล้ว ให้ fallback ไปใช้ guests.bus_id
  const guestBusId = useMemo(() => {
    const map = {}
    for (const s of busSeats) if (s.guest_id) map[s.guest_id] = s.bus_id
    for (const g of guests) if (g.bus_id && !map[g.id]) map[g.id] = g.bus_id
    return map
  }, [busSeats, guests])

  const staffGuestIdSet = useMemo(() => new Set(staffGuestIds), [staffGuestIds])

  const filteredGuests = useMemo(() => {
    const q = search.trim().toLowerCase()
    return guests.filter((g) => {
      const matchesSearch =
        !q ||
        g.name?.toLowerCase().includes(q) ||
        g.nickname?.toLowerCase().includes(q)

      const checkedIn = isCheckedIn(g)
      const matchesFilter =
        filter === 'all' ||
        (filter === 'arrived' && checkedIn) ||
        (filter === 'not_arrived' && !checkedIn)

      const matchesBus = busFilter === 'all' || guestBusId[g.id] === busFilter

      return matchesSearch && matchesFilter && matchesBus
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guests, search, filter, busFilter, guestBusId, isCoreEvent, checkedInGuestIds])

  const phoneField = useMemo(() => findFieldByPurpose(fields, 'phone'), [fields])
  const responsesByGuestId = useMemo(() => buildResponsesByGuestId(responses), [responses])

  return (
    <div className="min-h-screen bg-surface-muted">
      <StaffHeader
        icon="check"
        title={t('staff.checkIn.title')}
        subtitle={t('staff.checkIn.summary', { checkedIn: checkedInCount, total: guests.length })}
      />
      <div className="mx-auto max-w-md p-4">
        <button
          onClick={() => setEventPickerOpen(true)}
          className="mt-2 flex w-full items-center justify-between rounded-xl border border-brand-light bg-brand-lighter px-3 py-2.5 text-left"
        >
          <span className="min-w-0 truncate text-sm font-semibold text-brand-deep">
            📍 {selectedEvent ? selectedEvent.title : t('common.loading')}
          </span>
          <span className="shrink-0 text-xs font-medium text-brand">{t('staff.checkIn.changeEvent')}</span>
        </button>

        {(!isOnline || usingCache || pendingCount > 0) && (
          <div className="mt-2 rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning-text">
            {!isOnline && <p>{t('staff.checkIn.offline')}</p>}
            {usingCache && <p>{t('staff.checkIn.usingCache')}</p>}
            {pendingCount > 0 && <p>{t('staff.checkIn.pendingSync', { count: pendingCount })}</p>}
          </div>
        )}

        {scanFeedback && (
          <div
            className={`mt-2 rounded-xl px-3 py-2 text-sm font-medium ${
              scanFeedback.type === 'success'
                ? 'bg-success-bg text-success-text'
                : scanFeedback.type === 'duplicate'
                  ? 'bg-warning-bg text-warning-text'
                  : 'bg-danger-bg text-danger-text'
            }`}
          >
            {scanFeedback.type === 'success' &&
              t('staff.checkIn.scanSuccess', { name: scanFeedback.name })}
            {scanFeedback.type === 'duplicate' &&
              t('staff.checkIn.scanDuplicate', { name: scanFeedback.name })}
            {scanFeedback.type === 'error' && t('staff.checkIn.scanNotFound')}
            {scanFeedback.type === 'camera_error' && t('staff.checkIn.scanCameraError')}
            <button
              onClick={() => setScanFeedback(null)}
              className="ml-2 font-bold underline"
            >
              {t('common.close')}
            </button>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder={t('staff.checkIn.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-line-strong px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
          />
          <button
            onClick={() => {
              setScanFeedback(null)
              setScannerOpen(true)
            }}
            className="shrink-0 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white"
          >
            {t('staff.checkIn.scanQr')}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                filter === f
                  ? 'bg-brand text-white'
                  : 'bg-surface-sunken text-neutral-text'
              }`}
            >
              {f === 'all' && t('staff.checkIn.filterAll')}
              {f === 'arrived' && t('staff.checkIn.filterArrived')}
              {f === 'not_arrived' && t('staff.checkIn.filterNotArrived')}
            </button>
          ))}
        </div>

        {buses.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => setBusFilter('all')}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                busFilter === 'all' ? 'bg-neutral-text text-white' : 'bg-surface-sunken text-neutral-text'
              }`}
            >
              {t('staff.checkIn.allBuses')}
            </button>
            {buses.map((bus) => (
              <button
                key={bus.id}
                onClick={() => setBusFilter(bus.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  busFilter === bus.id ? 'bg-neutral-text text-white' : 'bg-surface-sunken text-neutral-text'
                }`}
              >
                {bus.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {loading && <p className="text-ink-muted">{t('common.loading')}</p>}
          {loadError && <p className="text-danger">{loadError}</p>}
          {!loading && !loadError && filteredGuests.length === 0 && (
            <p className="text-ink-muted">{t('staff.checkIn.noResults')}</p>
          )}

          {filteredGuests.map((guest) => {
            const phone = resolveGuestPhone(guest, phoneField, responsesByGuestId)
            const checkedIn = isCheckedIn(guest)
            return (
              <Card
                key={guest.id}
                className={`flex cursor-pointer items-center justify-between border-l-4 transition ${
                  checkedIn
                    ? 'border-l-success bg-success-bg'
                    : 'border-l-danger bg-danger-bg'
                } ${togglingId === guest.id ? 'opacity-60' : ''}`}
                onClick={() => toggle(guest)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <p className={`min-w-0 max-w-full truncate font-medium ${genderTextClass(guest.gender) || 'text-ink'}`}>
                      {guest.name}
                    </p>
                    {staffGuestIdSet.has(guest.id) && (
                      <span className="shrink-0 rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-text">
                        {t('staff.checkIn.staffBadge')}
                      </span>
                    )}
                  </div>
                  {guest.nickname && (
                    <p className="text-sm text-ink-muted">{guest.nickname}</p>
                  )}
                  {phone && (
                    <a
                      href={`tel:${phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 inline-block text-sm font-medium text-brand"
                    >
                      {phone}
                    </a>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${
                    checkedIn
                      ? 'bg-success text-white'
                      : 'bg-danger text-white'
                  }`}
                >
                  {checkedIn
                    ? t('staff.checkIn.arrived')
                    : t('staff.checkIn.notArrived')}
                </span>
              </Card>
            )
          })}
        </div>
      </div>

      <BottomSheet
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title={t('staff.checkIn.scanQr')}
      >
        <QrScanner onScan={handleScan} onError={handleScanError} />
        <p className="mt-3 text-center text-sm text-ink-muted">
          {t('staff.checkIn.scanHint')}
        </p>
        <Button variant="secondary" className="mt-3" onClick={() => setScannerOpen(false)}>
          {t('common.cancel')}
        </Button>
      </BottomSheet>

      <BottomSheet
        open={eventPickerOpen}
        onClose={() => setEventPickerOpen(false)}
        title={t('staff.checkIn.selectEvent')}
      >
        <div className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto">
          {events.map((ev) => (
            <button
              key={ev.id}
              onClick={() => {
                selectEvent(ev.id)
                setEventPickerOpen(false)
              }}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${
                ev.id === selectedEventId
                  ? 'border-brand bg-brand-lighter text-brand-deep'
                  : 'border-line text-ink hover:bg-surface-muted'
              }`}
            >
              {ev.title}
              {ev.is_core && (
                <span className="ml-2 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-ink-muted">
                  {t('staff.checkIn.coreEventTag')}
                </span>
              )}
            </button>
          ))}
        </div>

        <Button
          className="mt-3"
          onClick={() => {
            setEventPickerOpen(false)
            setCreateEventOpen(true)
          }}
        >
          {t('staff.checkIn.createEvent')}
        </Button>
        <Button variant="secondary" className="mt-2" onClick={() => setEventPickerOpen(false)}>
          {t('common.close')}
        </Button>
      </BottomSheet>

      <BottomSheet
        open={createEventOpen}
        onClose={() => setCreateEventOpen(false)}
        title={t('staff.checkIn.createEvent')}
      >
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => setCreateEventTab('itinerary')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              createEventTab === 'itinerary'
                ? 'bg-brand-gradient text-white shadow-brand'
                : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('staff.checkIn.fromItinerary')}
          </button>
          <button
            type="button"
            onClick={() => setCreateEventTab('custom')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              createEventTab === 'custom'
                ? 'bg-brand-gradient text-white shadow-brand'
                : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('staff.checkIn.customEvent')}
          </button>
        </div>

        <form onSubmit={handleCreateEvent} className="flex flex-col gap-3">
          {createEventTab === 'itinerary' && (
            <div className="max-h-[30vh] overflow-y-auto rounded-xl border border-line-subtle">
              {itineraryItems.length === 0 && (
                <p className="p-3 text-sm text-ink-faint">{t('staff.checkIn.noItineraryItems')}</p>
              )}
              {itineraryItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => pickItineraryItem(item)}
                  className={`block w-full border-b border-line-subtle px-3 py-2 text-left text-sm last:border-b-0 ${
                    selectedItineraryItemId === item.id
                      ? 'bg-brand-lighter font-semibold text-brand-hover'
                      : 'text-ink'
                  }`}
                >
                  {itineraryItemLabel(item)}
                </button>
              ))}
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-neutral-text">
              {t('staff.checkIn.eventTitleLabel')}
            </span>
            <input
              type="text"
              value={newEventTitle}
              onChange={(e) => setNewEventTitle(e.target.value)}
              placeholder={t('staff.checkIn.eventTitlePlaceholder')}
              className="w-full rounded-xl border border-line-strong px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
            />
          </label>

          <Button
            type="submit"
            disabled={
              creatingEvent ||
              !newEventTitle.trim() ||
              (createEventTab === 'itinerary' && !selectedItineraryItemId)
            }
          >
            {creatingEvent ? t('common.loading') : t('staff.checkIn.createEvent')}
          </Button>
          <Button variant="secondary" type="button" onClick={() => setCreateEventOpen(false)}>
            {t('common.cancel')}
          </Button>
        </form>
      </BottomSheet>
    </div>
  )
}
