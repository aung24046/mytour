import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'

function timeAgoLabel(t, dateStr) {
  if (!dateStr) return t('staff.locationMonitor.never')
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return t('staff.locationMonitor.justNow')
  if (mins < 60) return t('staff.locationMonitor.minutesAgo', { count: mins })
  const hours = Math.floor(mins / 60)
  return t('staff.locationMonitor.hoursAgo', { count: hours })
}

export default function LocationMonitor() {
  const { t } = useTranslation()

  const [session, setSession] = useState(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [sessionLabel, setSessionLabel] = useState('')
  const [starting, setStarting] = useState(false)

  const [guests, setGuests] = useState([])
  const [locations, setLocations] = useState([]) // latest row per guest_id
  const [loadingLocations, setLoadingLocations] = useState(true)

  async function loadSession() {
    setLoadingSession(true)
    const { data } = await supabase
      .from('location_sessions')
      .select('id, label, is_active, started_at, ends_at')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .eq('is_active', true)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    setSession(data ?? null)
    setLoadingSession(false)
  }

  async function loadLocations() {
    setLoadingLocations(true)

    const [guestsRes, locationsRes] = await Promise.all([
      supabase.from('guests').select('id, name, nickname').eq('tour_id', ACTIVE_TOUR_ID).order('name'),
      supabase
        .from('guest_locations')
        .select('id, guest_id, latitude, longitude, accuracy, recorded_at')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('recorded_at', { ascending: false }),
    ])

    setGuests(guestsRes.data ?? [])

    // เก็บแค่ record ล่าสุดต่อ guest_id (locationsRes เรียงจากใหม่ไปเก่าแล้ว)
    const latestByGuest = {}
    for (const loc of locationsRes.data ?? []) {
      if (!latestByGuest[loc.guest_id]) latestByGuest[loc.guest_id] = loc
    }
    setLocations(Object.values(latestByGuest))
    setLoadingLocations(false)
  }

  useEffect(() => {
    loadSession()
    loadLocations()

    const sessionChannel = supabase
      .channel(`location-sessions-monitor-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'location_sessions',
          filter: `tour_id=eq.${ACTIVE_TOUR_ID}`,
        },
        () => loadSession()
      )
      .subscribe()

    const locationChannel = supabase
      .channel(`guest-locations-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'guest_locations',
          filter: `tour_id=eq.${ACTIVE_TOUR_ID}`,
        },
        () => loadLocations()
      )
      .subscribe()

    // refresh "time ago" labels periodically even with no new data
    const tickInterval = setInterval(() => setLocations((prev) => [...prev]), 30000)

    return () => {
      supabase.removeChannel(sessionChannel)
      supabase.removeChannel(locationChannel)
      clearInterval(tickInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startSession() {
    setStarting(true)
    const { error } = await supabase.from('location_sessions').insert({
      tour_id: ACTIVE_TOUR_ID,
      label: sessionLabel.trim() || null,
      is_active: true,
      started_at: new Date().toISOString(),
    })
    if (!error) {
      setSessionLabel('')
      loadSession()
    } else {
      console.error('[LocationMonitor] start session failed', error)
    }
    setStarting(false)
  }

  async function stopSession() {
    if (!session) return
    const confirmed = window.confirm(t('staff.locationMonitor.confirmStop'))
    if (!confirmed) return

    const { error } = await supabase
      .from('location_sessions')
      .update({ is_active: false, ends_at: new Date().toISOString() })
      .eq('id', session.id)

    if (!error) loadSession()
  }

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const sortedLocations = useMemo(
    () =>
      [...locations].sort(
        (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
      ),
    [locations]
  );

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold text-gray-900">
          {t('staff.locationMonitor.title')}
        </h1>

        {loadingSession && <p className="mt-2 text-gray-500">{t('common.loading')}</p>}

        {!loadingSession && !session && (
          <Card className="mt-3">
            <p className="mb-3 text-sm text-gray-600">{t('staff.locationMonitor.noSession')}</p>
            <TextField
              label={t('staff.locationMonitor.sessionLabel')}
              placeholder={t('staff.locationMonitor.sessionLabelPlaceholder')}
              value={sessionLabel}
              onChange={(e) => setSessionLabel(e.target.value)}
            />
            <Button className="mt-3" onClick={startSession} disabled={starting}>
              {starting ? t('guest.register.submitting') : t('staff.locationMonitor.startSession')}
            </Button>
          </Card>
        )}

        {!loadingSession && session && (
          <Card className="mt-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-700">
                  {t('staff.locationMonitor.sessionActive')}
                </p>
                {session.label && <p className="text-sm text-gray-600">{session.label}</p>}
              </div>
              <Button variant="danger" fullWidth={false} className="px-3 py-2 text-sm" onClick={stopSession}>
                {t('staff.locationMonitor.stopSession')}
              </Button>
            </div>
          </Card>
        )}

        <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
          {t('staff.locationMonitor.guestPositions')}
        </h2>

        {loadingLocations && <p className="text-gray-500">{t('common.loading')}</p>}

        {!loadingLocations && sortedLocations.length === 0 && (
          <p className="text-sm text-gray-400">{t('staff.locationMonitor.noLocations')}</p>
        )}

        <div className="flex flex-col gap-2">
          {sortedLocations.map((loc) => {
            const guest = guestById[loc.guest_id]
            const mapsUrl = `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`
            return (
              <Card key={loc.id} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">
                    {guest ? guest.nickname || guest.name : t('staff.locationMonitor.unknownGuest')}
                  </p>
                  <p className="text-xs text-gray-500">{timeAgoLabel(t, loc.recorded_at)}</p>
                </div>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white"
                >
                  {t('staff.locationMonitor.viewOnMap')}
                </a>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
