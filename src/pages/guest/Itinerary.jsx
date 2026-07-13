import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { saveCache, loadCache } from '../../lib/offlineCache'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import GuestNav from '../../components/common/GuestNav'
import BottomSheet from '../../components/common/BottomSheet'

const STATUS_STYLES = {
  completed: 'opacity-55',
  current: 'border-l-4 border-l-brand bg-brand-lighter ring-1 ring-brand-light',
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
  const [linkedArticles, setLinkedArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [usingCache, setUsingCache] = useState(false)
  // แต่ละวันย่อ/ขยายได้ — เก็บเฉพาะวันที่ถูก"ย่อ" (ค่าเริ่มต้นคือขยายทุกวัน)
  const [collapsedDays, setCollapsedDays] = useState({})
  const [openArticle, setOpenArticle] = useState(null)

  const toggleDay = (day) =>
    setCollapsedDays((prev) => ({ ...prev, [day]: !prev[day] }))

  useEffect(() => {
    let isMounted = true

    async function loadItinerary() {
      setLoading(true)
      setError(null)

      const [itemsRes, articlesRes] = await Promise.all([
        supabase
          .from('itinerary_items')
          .select('id, day_number, scheduled_time, title, description, location_name, maps_url, status, sort_order')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .order('day_number', { ascending: true })
          .order('sort_order', { ascending: true }),
        supabase
          .from('guide_articles')
          .select('id, title, body, source_url, image_url, itinerary_item_id')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .eq('is_published', true)
          .not('itinerary_item_id', 'is', null),
      ])

      if (!isMounted) return

      if (itemsRes.error) {
        console.error('[Itinerary] load failed — falling back to offline cache', itemsRes.error)
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setItems(cached.items ?? cached)
          setLinkedArticles(cached.linkedArticles ?? [])
          setUsingCache(true)
        } else {
          setError(t('common.error'))
        }
      } else {
        const nextItems = itemsRes.data ?? []
        const nextArticles = articlesRes.data ?? []
        setItems(nextItems)
        setLinkedArticles(nextArticles)
        setUsingCache(false)
        saveCache(CACHE_KEY, { items: nextItems, linkedArticles: nextArticles })
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

  const articleByItemId = useMemo(() => {
    const map = {}
    for (const a of linkedArticles) map[a.itinerary_item_id] = a
    return map
  }, [linkedArticles])

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
      <div className="mx-auto max-w-md">
        <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
          <span aria-hidden="true">🗺️</span>
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
          Object.entries(dayGroups).map(([day, dayItems]) => {
            const isCollapsed = !!collapsedDays[day]
            return (
              <div key={day} className="mb-4">
                <button
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-expanded={!isCollapsed}
                  className="mb-2.5 flex w-full items-center justify-between gap-2 rounded-pill bg-brand-light px-3 py-2 text-left text-sm font-bold uppercase tracking-wide text-brand-deep transition active:scale-[0.99]"
                >
                  <span className="flex items-center gap-2">
                    {t('guest.itinerary.day', { day })}
                    <span className="rounded-full bg-white/60 px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal text-brand-deep">
                      {t('guest.itinerary.itemCount', { count: dayItems.length })}
                    </span>
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-4 w-4 shrink-0 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {!isCollapsed && (
                  <div className="flex flex-col gap-2">
                    {dayItems.map((item) => (
                      <Card key={item.id} className={STATUS_STYLES[item.status] ?? ''}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {item.scheduled_time && (
                              <p className="text-sm font-bold text-brand">
                                {formatTime(item.scheduled_time)}
                              </p>
                            )}
                            <p className="font-bold text-ink">{item.title}</p>

                            {item.location_name && (
                              <p className="mt-1 flex items-start gap-1.5 text-sm font-semibold text-ink">
                                <span aria-hidden="true" className="leading-5">📍</span>
                                <span className="min-w-0">{item.location_name}</span>
                              </p>
                            )}

                            {item.description && (
                              <div className="mt-2 rounded-lg border-l-2 border-brand-light bg-surface-sunken px-2.5 py-1.5 text-sm text-ink-muted">
                                <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-brand">
                                  {t('guest.itinerary.note')}
                                </span>
                                <span className="whitespace-pre-wrap">{item.description}</span>
                              </div>
                            )}

                            {articleByItemId[item.id] && (
                              <button
                                onClick={() => setOpenArticle(articleByItemId[item.id])}
                                className="mt-2 text-sm font-semibold text-brand underline decoration-brand-light underline-offset-2"
                              >
                                {t('guest.itinerary.viewGuide')}
                              </button>
                            )}
                          </div>

                          {item.maps_url && (
                            <a
                              href={item.maps_url}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 rounded-control bg-brand-gradient px-3 py-2 text-sm font-semibold text-white shadow-brand"
                            >
                              {t('guest.itinerary.navigate')}
                            </a>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

        {!loading && !error && items.length === 0 && (
          <p className="text-gray-500">{t('guest.itinerary.empty')}</p>
        )}
      </div>
      </div>

      <BottomSheet open={!!openArticle} onClose={() => setOpenArticle(null)} title={openArticle?.title}>
        {openArticle && (
          <div>
            {openArticle.image_url && (
              <img
                src={openArticle.image_url}
                alt={openArticle.title}
                className="mb-3 h-44 w-full rounded-xl object-cover"
              />
            )}
            {openArticle.source_url && (
              <a
                href={openArticle.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1.5 text-sm font-semibold text-brand-deep underline"
              >
                🔗 {t('guest.tripGuide.sourceLink')}
              </a>
            )}
            {openArticle.body && (
              <div className="max-w-none text-ink [&_a]:text-brand [&_a]:underline [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-2 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2 [&_li]:mb-1">
                <ReactMarkdown>{openArticle.body}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
