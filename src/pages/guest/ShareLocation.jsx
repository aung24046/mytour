import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId } from '../../lib/guestSession'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import GuestNav from '../../components/common/GuestNav'

const SEND_INTERVAL_MS = 15000 // ส่งพิกัดทุก 15 วิ ระหว่างเปิดหน้าค้างไว้

export default function ShareLocation() {
  const { t } = useTranslation()
  const guestId = getGuestId()

  const [activeSession, setActiveSession] = useState(null)
  const [loadingSession, setLoadingSession] = useState(true)
  const [consented, setConsented] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [geoError, setGeoError] = useState(null)
  const [lastSentAt, setLastSentAt] = useState(null)

  const watchIdRef = useRef(null)
  const intervalRef = useRef(null)
  const latestPositionRef = useRef(null)

  // โหลด session ที่ staff เปิดไว้ (is_active = true) — ถ้าไม่มี ไม่ต้องให้แชร์
  useEffect(() => {
    let isMounted = true

    async function loadSession() {
      setLoadingSession(true)
      const { data, error } = await supabase
        .from('location_sessions')
        .select('id, label, is_active, started_at')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('is_active', true)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!isMounted) return
      if (!error) setActiveSession(data ?? null)
      setLoadingSession(false)
    }

    loadSession()

    const channel = supabase
      .channel(`location-sessions-${ACTIVE_TOUR_ID}`)
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

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [])

  // หยุดแชร์ทันทีถ้า session ถูกปิดจากฝั่ง staff
  useEffect(() => {
    if (!activeSession && sharing) {
      stopSharing()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession])

  useEffect(() => {
    return () => stopSharing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function sendLatestPosition() {
    const pos = latestPositionRef.current
    if (!pos || !guestId) return

    const { error } = await supabase.from('guest_locations').insert({
      tour_id: ACTIVE_TOUR_ID,
      guest_id: guestId,
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    })

    if (!error) setLastSentAt(new Date())
  }

  function startSharing() {
    if (!navigator.geolocation) {
      setGeoError(t('guest.shareLocation.notSupported'))
      return
    }

    setGeoError(null)
    setSharing(true)

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        latestPositionRef.current = pos
      },
      (err) => {
        console.error('[ShareLocation] geolocation error', err)
        setGeoError(t('guest.shareLocation.permissionDenied'))
        stopSharing()
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    )

    // ส่งพิกัดล่าสุดทันที แล้วค่อยส่งซ้ำเป็นช่วงๆ
    intervalRef.current = setInterval(sendLatestPosition, SEND_INTERVAL_MS)
  }

  function stopSharing() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setSharing(false)
  }

  function handleToggleConsent(e) {
    const checked = e.target.checked
    setConsented(checked)
    if (checked) {
      startSharing()
    } else {
      stopSharing()
    }
  }

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
            <span aria-hidden="true">📍</span>{t('guest.shareLocation.title')}
          </h1>

          <GuestNav active="shareLocation" />

          {loadingSession && <p className="text-gray-500">{t('common.loading')}</p>}

          {!loadingSession && !activeSession && (
            <Card>
              <p className="text-gray-500">{t('guest.shareLocation.noActiveSession')}</p>
            </Card>
          )}

          {!loadingSession && activeSession && (
            <Card>
              {activeSession.label && (
                <p className="mb-2 text-sm font-medium text-sky-600">{activeSession.label}</p>
              )}

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={handleToggleConsent}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-sm text-gray-700">{t('guest.shareLocation.consent')}</span>
              </label>

              {geoError && <p className="mt-3 text-sm text-red-500">{geoError}</p>}

              {sharing && !geoError && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-green-50 px-3 py-2">
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-500" />
                  <p className="text-sm text-green-700">
                    {lastSentAt
                      ? t('guest.shareLocation.sharingSince', {
                          time: lastSentAt.toLocaleTimeString(),
                        })
                      : t('guest.shareLocation.sharingStarting')}
                  </p>
                </div>
              )}

              {!sharing && !geoError && consented === false && (
                <p className="mt-3 text-xs text-gray-400">{t('guest.shareLocation.hint')}</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
