import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { findFieldByPurpose, buildResponsesByGuestId, resolveGuestPhone } from '../../lib/guestFields'
import { saveCache, loadCache } from '../../lib/offlineCache'
import { enqueue, getQueue, removeFromQueue } from '../../lib/offlineQueue'
import { genderTextClass } from '../../lib/genderColor'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import BottomSheet from '../../components/common/BottomSheet'
import QrScanner from '../../components/common/QrScanner'

const FILTERS = ['all', 'arrived', 'not_arrived']
const CACHE_KEY = 'checkin_guests'

export default function CheckIn() {
  const { t } = useTranslation()

  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [buses, setBuses] = useState([])
  const [busSeats, setBusSeats] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [usingCache, setUsingCache] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [busFilter, setBusFilter] = useState('all')
  const [togglingId, setTogglingId] = useState(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanFeedback, setScanFeedback] = useState(null) // { type: 'success' | 'error' | 'duplicate', name }

  function refreshPendingCount() {
    setPendingCount(getQueue().filter((a) => a.type === 'checkin').length)
  }

  async function flushQueue() {
    const queue = getQueue().filter((a) => a.type === 'checkin')
    for (const action of queue) {
      const { error } = await supabase
        .from('guests')
        .update({ check_in_status: action.status, check_in_time: action.checkInTime })
        .eq('id', action.guestId)

      if (!error) {
        removeFromQueue(action.id)
      }
    }
    refreshPendingCount()
  }

  useEffect(() => {
    let isMounted = true

    async function loadGuests() {
      setLoading(true)
      setLoadError(null)

      const [guestsRes, fieldsRes, busesRes, busSeatsRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, name, nickname, gender, phone, qr_token, check_in_status, check_in_time')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .order('name', { ascending: true }),
        supabase
          .from('form_fields')
          .select('id, field_key, field_purpose, is_core')
          .eq('tour_id', ACTIVE_TOUR_ID),
        supabase.from('buses').select('id, name').eq('tour_id', ACTIVE_TOUR_ID).order('name'),
        supabase
          .from('bus_seats')
          .select('bus_id, guest_id')
          .eq('tour_id', ACTIVE_TOUR_ID)
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
        responses: responsesData,
      })

      setLoading(false)
    }

    loadGuests()
    refreshPendingCount()
    flushQueue()

    // Realtime: sync check-in status if another staff member checks someone in
    const channel = supabase
      .channel(`checkin-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'guests',
          filter: `tour_id=eq.${ACTIVE_TOUR_ID}`,
        },
        (payload) => {
          setGuests((prev) =>
            prev.map((g) => (g.id === payload.new.id ? { ...g, ...payload.new } : g))
          )
        }
      )
      .subscribe()

    function handleOnline() {
      setIsOnline(true)
      loadGuests()
      flushQueue()
    }
    function handleOffline() {
      setIsOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // กันเคสที่ browser ไม่ยิง online/offline event แม่นยำ — ลองรีเฟรชคิวเป็นระยะ
    const retryInterval = setInterval(() => {
      if (navigator.onLine) flushQueue()
    }, 15000)

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(retryInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  async function toggleCheckIn(guest) {
    setTogglingId(guest.id)
    const nextStatus = !guest.check_in_status
    const checkInTime = nextStatus ? new Date().toISOString() : null

    // Optimistic update — ติ๊กได้ทันทีไม่ว่าจะออนไลน์หรือไม่
    setGuests((prev) =>
      prev.map((g) =>
        g.id === guest.id ? { ...g, check_in_status: nextStatus, check_in_time: checkInTime } : g
      )
    )

    if (!navigator.onLine) {
      enqueue({ type: 'checkin', guestId: guest.id, status: nextStatus, checkInTime })
      refreshPendingCount()
      setTogglingId(null)
      return
    }

    const { error } = await supabase
      .from('guests')
      .update({ check_in_status: nextStatus, check_in_time: checkInTime })
      .eq('id', guest.id)

    if (error) {
      console.error('[CheckIn] toggle failed — queued for retry', error)
      enqueue({ type: 'checkin', guestId: guest.id, status: nextStatus, checkInTime })
      refreshPendingCount()
    }
    setTogglingId(null)
  }

  async function handleScan(decodedText) {
    setScannerOpen(false)

    const guest = guests.find((g) => g.qr_token === decodedText)
    if (!guest) {
      setScanFeedback({ type: 'error' })
      return
    }

    if (guest.check_in_status) {
      setScanFeedback({ type: 'duplicate', name: guest.nickname || guest.name })
      return
    }

    await toggleCheckIn(guest)
    setScanFeedback({ type: 'success', name: guest.nickname || guest.name })
  }

  function handleScanError(err) {
    setScannerOpen(false)
    console.error('[CheckIn] camera error', err)
    setScanFeedback({ type: 'camera_error' })
  }

  const guestBusId = useMemo(() => {
    const map = {}
    for (const s of busSeats) map[s.guest_id] = s.bus_id
    return map
  }, [busSeats])

  const filteredGuests = useMemo(() => {
    const q = search.trim().toLowerCase()
    return guests.filter((g) => {
      const matchesSearch =
        !q ||
        g.name?.toLowerCase().includes(q) ||
        g.nickname?.toLowerCase().includes(q)

      const matchesFilter =
        filter === 'all' ||
        (filter === 'arrived' && g.check_in_status) ||
        (filter === 'not_arrived' && !g.check_in_status)

      const matchesBus = busFilter === 'all' || guestBusId[g.id] === busFilter

      return matchesSearch && matchesFilter && matchesBus
    })
  }, [guests, search, filter, busFilter, guestBusId])

  const checkedInCount = guests.filter((g) => g.check_in_status).length

  const phoneField = useMemo(() => findFieldByPurpose(fields, 'phone'), [fields])
  const responsesByGuestId = useMemo(() => buildResponsesByGuestId(responses), [responses])

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">{t('staff.checkIn.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {t('staff.checkIn.summary', { checkedIn: checkedInCount, total: guests.length })}
        </p>

        {(!isOnline || usingCache || pendingCount > 0) && (
          <div className="mt-2 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
            {!isOnline && <p>{t('staff.checkIn.offline')}</p>}
            {usingCache && <p>{t('staff.checkIn.usingCache')}</p>}
            {pendingCount > 0 && <p>{t('staff.checkIn.pendingSync', { count: pendingCount })}</p>}
          </div>
        )}

        {scanFeedback && (
          <div
            className={`mt-2 rounded-xl px-3 py-2 text-sm font-medium ${
              scanFeedback.type === 'success'
                ? 'bg-green-100 text-green-800'
                : scanFeedback.type === 'duplicate'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-red-100 text-red-700'
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
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />
          <button
            onClick={() => {
              setScanFeedback(null)
              setScannerOpen(true)
            }}
            className="shrink-0 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white"
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
                  ? 'bg-sky-600 text-white'
                  : 'bg-gray-100 text-gray-700'
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
                busFilter === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {t('staff.checkIn.allBuses')}
            </button>
            {buses.map((bus) => (
              <button
                key={bus.id}
                onClick={() => setBusFilter(bus.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  busFilter === bus.id ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {bus.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {loading && <p className="text-gray-500">{t('common.loading')}</p>}
          {loadError && <p className="text-red-500">{loadError}</p>}
          {!loading && !loadError && filteredGuests.length === 0 && (
            <p className="text-gray-500">{t('staff.checkIn.noResults')}</p>
          )}

          {filteredGuests.map((guest) => {
            const phone = resolveGuestPhone(guest, phoneField, responsesByGuestId)
            return (
              <Card
                key={guest.id}
                className={`flex cursor-pointer items-center justify-between border-l-4 transition ${
                  guest.check_in_status
                    ? 'border-l-green-500 bg-green-50'
                    : 'border-l-red-400 bg-red-50'
                } ${togglingId === guest.id ? 'opacity-60' : ''}`}
                onClick={() => toggleCheckIn(guest)}
              >
                <div>
                  <p className={`font-medium ${genderTextClass(guest.gender) || 'text-gray-900'}`}>
                    {guest.name}
                  </p>
                  {guest.nickname && (
                    <p className="text-sm text-gray-500">{guest.nickname}</p>
                  )}
                  {phone && (
                    <a
                      href={`tel:${phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 inline-block text-sm font-medium text-sky-600"
                    >
                      {phone}
                    </a>
                  )}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    guest.check_in_status
                      ? 'bg-green-500 text-white'
                      : 'bg-red-400 text-white'
                  }`}
                >
                  {guest.check_in_status
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
        <p className="mt-3 text-center text-sm text-gray-500">
          {t('staff.checkIn.scanHint')}
        </p>
        <Button variant="secondary" className="mt-3" onClick={() => setScannerOpen(false)}>
          {t('common.cancel')}
        </Button>
      </BottomSheet>
    </div>
  )
}
