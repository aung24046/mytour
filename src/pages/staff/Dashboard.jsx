import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { findFieldByPurpose, buildResponsesByGuestId, resolveGuestPhone } from '../../lib/guestFields'
import { getStaffSession, clearStaffSession } from '../../lib/staffSession'
import Card from '../../components/common/Card'

const LINKS = [
  { to: '/staff/check-in', key: 'checkIn' },
  { to: '/staff/guest-manager', key: 'guestManager' },
  { to: '/staff/broadcast', key: 'broadcast' },
  { to: '/staff/itinerary-builder', key: 'itineraryBuilder' },
  { to: '/staff/dietary-summary', key: 'dietarySummary' },
  { to: '/staff/seat-map', key: 'seatMap' },
  { to: '/staff/room-map', key: 'roomMap' },
  { to: '/staff/location-monitor', key: 'locationMonitor' },
  { to: '/staff/bingo-host', key: 'bingoHost' },
  { to: '/staff/form-builder', key: 'formBuilder' },
  { to: '/staff/staff-manager', key: 'staffManager' },
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
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{t('staff.dashboard.title')}</h1>
            {staffSession?.name && (
              <p className="text-sm text-gray-500">{staffSession.name}</p>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-600"
          >
            {t('staff.dashboard.logout')}
          </button>
        </div>

        {loading && <p className="text-gray-500">{t('common.loading')}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && (
          <Card className="mb-4">
            <p className="text-sm text-gray-500">{t('staff.dashboard.headcount')}</p>
            <p className="mt-1 text-3xl font-bold text-gray-900">
              {checkedInCount}
              <span className="text-lg font-medium text-gray-400"> / {guests.length}</span>
            </p>

            {missingGuests.length > 0 && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <p className="mb-2 text-sm font-medium text-gray-600">
                  {t('staff.dashboard.missingList', { count: missingGuests.length })}
                </p>
                <div className="flex flex-col gap-1.5">
                  {missingGuests.map((g) => {
                    const phone = resolveGuestPhone(g, phoneField, responsesByGuestId)
                    return (
                      <div
                        key={g.id}
                        className="flex items-center justify-between rounded-xl bg-red-50 px-3 py-2"
                      >
                        <span className="font-medium text-gray-900">
                          {g.nickname || g.name}
                        </span>
                        {phone ? (
                          <a
                            href={`tel:${phone}`}
                            className="rounded-lg bg-white px-2.5 py-1 text-sm font-semibold text-sky-600 shadow-sm"
                          >
                            {phone}
                          </a>
                        ) : (
                          <span className="text-sm text-gray-400">
                            {t('staff.dashboard.noPhone')}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </Card>
        )}

        <div className="flex flex-col gap-2">
          {LINKS.map((link) => (
            <Link key={link.to} to={link.to}>
              <Card className="flex items-center justify-between hover:bg-gray-50">
                <span className="font-medium text-gray-900">
                  {t(`staff.${link.key}.title`)}
                </span>
                <span className="text-gray-400">›</span>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
