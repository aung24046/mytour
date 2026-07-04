import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { saveCache, loadCache } from '../../lib/offlineCache'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import GuestNav from '../../components/common/GuestNav'

const STATUS_STYLES = {
  completed: 'opacity-50',
  current: 'border-l-4 border-l-sky-500 bg-sky-50',
  upcoming: '',
}

const CACHE_KEY = 'itinerary_items'

function formatTime(timeStr) {
  if (!timeStr) return ''
  // scheduled_time comes back as "HH:MM:SS+TZ" — just show HH:MM
  return timeStr.slice(0, 5)
}

export default function Itinerary() {
  const { t } = useTranslation()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [usingCache, setUsingCache] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadItinerary() {
      setLoading(true)
      setError(null)

      const { data, error: fetchError } = await supabase
        .from('itinerary_items')
        .select('id, day_number, scheduled_time, title, description, location_name, maps_url, status, sort_order')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('day_number', { ascending: true })
        .order('sort_order', { ascending: true })

      if (!isMounted) return

      if (fetchError) {
        console.error('[Itinerary] load failed — falling back to offline cache', fetchError)
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setItems(cached)
          setUsingCache(true)
        } else {
          setError(t('common.error'))
        }
      } else {
        setItems(data ?? [])
        setUsingCache(false)
        saveCache(CACHE_KEY, data ?? [])
      }
      setLoading(false)
    }

    loadItinerary()

    // Realtime: staff อาจอัปเดต status (upcoming/current/completed) ระหว่างทริป
    const channel = supabase
      .channel(`itinerary-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'itinerary_items',
          filter: `tour_id=eq.${ACTIVE_TOUR_ID}`,
        },
        () => loadItinerary()
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [t])

  const dayGroups = items.reduce((acc, item) => {
    const day = item.day_number ?? 1
    acc[day] = acc[day] ? [...acc[day], item] : [item]
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-gray-50">
      <AnnouncementBanner />
      <div className="p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-4 text-xl font-bold text-gray-900">
          {t('guest.itinerary.title')}
        </h1>

        <GuestNav active="itinerary" />

        {usingCache && (
          <p className="mb-3 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
            {t('guest.itinerary.usingCache')}
          </p>
        )}

        {loading && <p className="text-gray-500">{t('common.loading')}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading &&
          !error &&
          Object.entries(dayGroups).map(([day, dayItems]) => (
            <div key={day} className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {t('guest.itinerary.day', { day })}
              </h2>

              <div className="flex flex-col gap-2">
                {dayItems.map((item) => (
                  <Card key={item.id} className={STATUS_STYLES[item.status] ?? ''}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        {item.scheduled_time && (
                          <p className="text-sm font-medium text-sky-600">
                            {formatTime(item.scheduled_time)}
                          </p>
                        )}
                        <p className="font-semibold text-gray-900">{item.title}</p>
                        {item.location_name && (
                          <p className="text-sm text-gray-500">{item.location_name}</p>
                        )}
                        {item.description && (
                          <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                        )}
                      </div>

                      {item.maps_url && (
                        <a
                          href={item.maps_url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white"
                        >
                          {t('guest.itinerary.navigate')}
                        </a>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}

        {!loading && !error && items.length === 0 && (
          <p className="text-gray-500">{t('guest.itinerary.empty')}</p>
        )}
      </div>
      </div>
    </div>
  )
}
