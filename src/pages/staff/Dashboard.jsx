import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { findFieldByPurpose, buildResponsesByGuestId, resolveGuestPhone } from '../../lib/guestFields'
import { getStaffSession, clearStaffSession } from '../../lib/staffSession'
import Card from '../../components/common/Card'

const LINKS = [
  { to: '/staff/check-in', key: 'checkIn', icon: '✅' },
  { to: '/staff/guest-manager', key: 'guestManager', icon: '👥' },
  { to: '/staff/luggage-manager', key: 'luggageManager', icon: '🧳' },
  { to: '/staff/print', key: 'printExport', icon: '🖨️' },
  { to: '/staff/broadcast', key: 'broadcast', icon: '📢' },
  { to: '/staff/itinerary-builder', key: 'itineraryBuilder', icon: '🗺️' },
  { to: '/staff/dietary-summary', key: 'dietarySummary', icon: '🍽️' },
  { to: '/staff/seat-map', key: 'seatMap', icon: '💺' },
  { to: '/staff/room-map', key: 'roomMap', icon: '🛏️' },
  { to: '/staff/location-monitor', key: 'locationMonitor', icon: '📍' },
  { to: '/staff/bingo-host', key: 'bingoHost', icon: '🎯' },
  { to: '/staff/form-builder', key: 'formBuilder', icon: '📝' },
  { to: '/staff/staff-manager', key: 'staffManager', icon: '⚙️' },
]

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const staffSession = getStaffSession()

  function handleLogout() {
    clearStaffSession()
    navigate('/staff/login')
  }

  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function loadSummary() {
    setLoading(true)
    setError(null)

    const [guestsRes, fieldsRes] = await Promise.all([
      supabase
        .from('guests')
        .select('id, name, nickname, phone, check_in_status')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('name'),
      supabase
        .from('form_fields')
        .select('id, field_key, field_purpose, is_core')
        .eq('tour_id', ACTIVE_TOUR_ID),
    ])

    if (guestsRes.error || fieldsRes.error) {
      console.error('[Dashboard] load failed', guestsRes.error, fieldsRes.error)
      setError(t('common.error'))
      setLoading(false)
      return
    }

    setGuests(guestsRes.data ?? [])
    setFields(fieldsRes.data ?? [])

    // Only need to fetch guest_form_responses if the phone field turns out to be custom.
    const phoneField = findFieldByPurpose(fieldsRes.data ?? [], 'phone')
    if (phoneField && !phoneField.is_core) {
      const { data: responsesData, error: responsesError } = await supabase
        .from('guest_form_responses')
        .select('guest_id, field_id, value')
        .eq('field_id', phoneField.id)

      if (!responsesError) setResponses(responsesData ?? [])
    }

    setLoading(false)
  }

  useEffect(() => {
    loadSummary()

    const channel = supabase
      .channel(`dashboard-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'guests', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        (payload) => {
          setGuests((prev) =>
            prev.map((g) => (g.id === payload.new.id ? { ...g, ...payload.new } : g))
          )
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const phoneField = useMemo(() => findFieldByPurpose(fields, 'phone'), [fields])
  const responsesByGuestId = useMemo(() => buildResponsesByGuestId(responses), [responses])

  const checkedInCount = guests.filter((g) => g.check_in_status).length
  const missingGuests = guests.filter((g) => !g.check_in_status)

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-md">
        <div className="hero-gradient mb-5 rounded-card p-5 shadow-brand">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">
                MyTour
              </p>
              <h1 className="text-2xl font-extrabold text-white">{t('staff.dashboard.title')}</h1>
              {staffSession?.name && (
                <p className="mt-0.5 text-sm text-white/80">{staffSession.name}</p>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="rounded-pill bg-white/20 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/30"
            >
              {t('staff.dashboard.logout')}
            </button>
          </div>

          {!loading && !error && (
            <div className="mt-4 rounded-control bg-white/15 p-4 backdrop-blur">
              <p className="text-sm font-medium text-white/80">{t('staff.dashboard.headcount')}</p>
              <p className="mt-0.5 text-4xl font-extrabold text-white">
                {checkedInCount}
                <span className="text-xl font-semibold text-white/60"> / {guests.length}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-pill bg-white/25">
                <div
                  className="h-full rounded-pill bg-white transition-all"
                  style={{ width: `${guests.length ? (checkedInCount / guests.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {loading && <p className="text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="text-danger">{error}</p>}

        {!loading && !error && missingGuests.length > 0 && (
          <Card className="mb-5">
            <p className="mb-2 text-sm font-semibold text-ink">
              {t('staff.dashboard.missingList', { count: missingGuests.length })}
            </p>
            <div className="flex flex-col gap-1.5">
              {missingGuests.map((g) => {
                const phone = resolveGuestPhone(g, phoneField, responsesByGuestId)
                return (
                  <div
                    key={g.id}
                    className="flex items-center justify-between rounded-control bg-danger-bg/60 px-3 py-2.5"
                  >
                    <span className="font-semibold text-ink">
                      {g.nickname || g.name}
                    </span>
                    {phone ? (
                      <a
                        href={`tel:${phone}`}
                        className="rounded-pill bg-white px-3 py-1 text-sm font-semibold text-brand shadow-sm"
                      >
                        {phone}
                      </a>
                    ) : (
                      <span className="text-sm text-ink-faint">
                        {t('staff.dashboard.noPhone')}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          {LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="group">
              <Card className="flex h-full flex-col gap-2 transition-all group-hover:-translate-y-0.5 group-hover:shadow-card-hover">
                <span className="flex h-11 w-11 items-center justify-center rounded-control bg-brand-lighter text-xl">
                  {link.icon}
                </span>
                <span className="text-sm font-semibold leading-tight text-ink">
                  {t(`staff.${link.key}.title`)}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
