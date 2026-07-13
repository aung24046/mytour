import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { saveCache, loadCache } from '../../lib/offlineCache'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import GuestNav from '../../components/common/GuestNav'
import BottomSheet from '../../components/common/BottomSheet'
import Icon from '../../components/common/Icon'

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
  // แท็บวันที่เลือกอยู่ + รายการที่ถูกกดขยาย (นอกจากจุดหมายปัจจุบันที่กางไว้เสมอ)
  const [activeDay, setActiveDay] = useState(null)
  const [expandedItems, setExpandedItems] = useState({})
  const [openArticle, setOpenArticle] = useState(null)
  // กันตั้งค่าวันเริ่มต้นซ้ำ (เช่นตอน realtime อัปเดต) และกันเลื่อนจอซ้ำ
  const didInitDay = useRef(false)
  const didScrollToCurrent = useRef(false)

  const toggleItem = (id) =>
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }))

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

  // วันที่กำลังท่องเที่ยวอยู่ตอนนี้ (มีรายการที่ status === 'current')
  const currentDay = useMemo(() => {
    const cur = items.find((item) => item.status === 'current')
    return cur ? cur.day_number ?? 1 : null
  }, [items])

  const days = useMemo(
    () => [...new Set(items.map((item) => item.day_number ?? 1))].sort((a, b) => a - b),
    [items]
  )

  const dayItems = activeDay != null ? dayGroups[activeDay] ?? [] : []
  const doneCount = dayItems.filter((it) => it.status === 'completed').length

  // ตั้งค่าเริ่มต้น: เปิดที่วันปัจจุบัน (ไม่งั้นวันแรก) — ทำครั้งเดียวตอนโหลดเสร็จ
  useEffect(() => {
    if (loading || didInitDay.current || days.length === 0) return
    didInitDay.current = true
    setActiveDay(currentDay ?? days[0])
  }, [loading, days, currentDay])

  // เลื่อนจอไปยังจุดหมายปัจจุบันอัตโนมัติตอนเปิดหน้า (ทำครั้งเดียว)
  useEffect(() => {
    if (loading || didScrollToCurrent.current || activeDay == null) return
    const el = document.getElementById('current-itinerary-item')
    if (el) {
      didScrollToCurrent.current = true
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [loading, activeDay])

  // ปุ่ม คู่มือ / นำทาง (ใช้ทั้งจุดหมายปัจจุบันและรายการที่กางออก)
  function renderActions(item, article) {
    if (!article && !item.maps_url) return null
    return (
      <div className="mt-2.5 flex gap-2">
        {article && (
          <button
            onClick={() => setOpenArticle(article)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-brand-lighter py-2 text-sm font-semibold text-brand-hover"
          >
            <Icon name="book" size={15} /> {t('guest.nav.tripGuide')}
          </button>
        )}
        {item.maps_url && (
          <a
            href={item.maps_url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-brand-gradient py-2 text-sm font-semibold text-white shadow-brand"
          >
            <Icon name="navigation" size={15} /> {t('guest.itinerary.navigate')}
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
      <div className="mx-auto max-w-md">
        <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
          <Icon name="map" size={24} color="#0e7490" />
          {t('guest.itinerary.title')}
        </h1>

        <GuestNav active="itinerary" />

        {usingCache && (
          <p className="mb-3 rounded-control bg-warning-bg px-3 py-2 text-sm text-warning-text">
            {t('guest.itinerary.usingCache')}
          </p>
        )}

        {loading && <p className="text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="text-danger">{error}</p>}

        {!loading && !error && items.length === 0 && (
          <p className="text-ink-muted">{t('guest.itinerary.empty')}</p>
        )}

        {!loading && !error && days.length > 0 && (
          <>
            {/* แท็บวัน */}
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {days.map((day) => (
                <button
                  key={day}
                  onClick={() => setActiveDay(day)}
                  className={`shrink-0 rounded-pill px-4 py-2 text-sm font-semibold transition ${
                    activeDay === day
                      ? 'bg-brand text-white shadow-brand'
                      : 'bg-surface text-ink-muted ring-1 ring-black/[0.04]'
                  }`}
                >
                  {t('guest.itinerary.day', { day })}
                </button>
              ))}
            </div>

            {/* ความคืบหน้าของวัน */}
            {dayItems.length > 0 && (
              <div className="mb-3 flex items-center gap-2.5 px-0.5">
                <span className="whitespace-nowrap text-xs text-ink-muted">
                  {t('guest.itinerary.progress', { done: doneCount, total: dayItems.length })}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-pill bg-ink-faint/20">
                  <div
                    className="h-full rounded-pill bg-success transition-all"
                    style={{ width: `${dayItems.length ? (doneCount / dayItems.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* รายการ */}
            <div className="flex flex-col gap-2.5">
              {dayItems.map((item) => {
                const isCurrent = item.status === 'current'
                const isDone = item.status === 'completed'
                const article = articleByItemId[item.id]
                const expanded = isCurrent || !!expandedItems[item.id]
                const hasDetail = !!(item.description || article || item.maps_url)

                if (isCurrent) {
                  return (
                    <div
                      key={item.id}
                      id="current-itinerary-item"
                      className="rounded-[12px] border border-success/30 border-l-4 border-l-success bg-success-bg/40 p-3.5 shadow-card"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        {item.scheduled_time ? (
                          <span className="text-[13px] font-bold text-success-text">
                            {formatTime(item.scheduled_time)}
                          </span>
                        ) : (
                          <span />
                        )}
                        <span className="inline-flex items-center gap-1.5 rounded-pill bg-success px-2.5 py-0.5 text-[10px] font-semibold text-white">
                          <span className="h-1 w-1 rounded-full bg-white" />
                          {t('guest.itinerary.nowLabel')}
                        </span>
                      </div>
                      <p className="text-base font-semibold text-ink">{item.title}</p>
                      {item.location_name && (
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-muted">
                          <Icon name="location" size={14} color="#5b7580" />
                          {item.location_name}
                        </p>
                      )}
                      {item.description && (
                        <div className="mt-2.5 whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-sm text-ink-muted">
                          {item.description}
                        </div>
                      )}
                      {renderActions(item, article)}
                    </div>
                  )
                }

                return (
                  <div
                    key={item.id}
                    className={`overflow-hidden rounded-[12px] border border-black/[0.06] border-l-4 bg-surface shadow-card ${
                      isDone ? 'border-l-success/60' : 'border-l-ink-faint/30'
                    } ${isDone && !expanded ? 'opacity-60' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => hasDetail && toggleItem(item.id)}
                      aria-expanded={expanded}
                      className="flex w-full items-start gap-3 p-3 text-left"
                    >
                      <span className="w-[42px] shrink-0 pt-0.5 text-[13px] font-semibold text-ink-muted">
                        {formatTime(item.scheduled_time)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-ink">{item.title}</p>
                        {item.location_name && (
                          <p className="mt-0.5 flex items-start gap-1 text-xs text-ink-faint">
                            <Icon name="location" size={12} className="mt-0.5 shrink-0" />
                            <span>{item.location_name}</span>
                          </p>
                        )}
                      </div>

                      {isDone ? (
                        <Icon name="check" size={19} color="#1d9e75" />
                      ) : (
                        <>
                          {article && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenArticle(article)
                              }}
                              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-brand-lighter text-brand-hover"
                            >
                              <Icon name="book" size={16} />
                            </span>
                          )}
                          {item.maps_url && (
                            <a
                              href={item.maps_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-brand-lighter text-brand-hover"
                            >
                              <Icon name="navigation" size={16} />
                            </a>
                          )}
                        </>
                      )}

                      {hasDetail && (
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      )}
                    </button>

                    {expanded && hasDetail && (
                      <div className="px-3 pb-3">
                        {item.description && (
                          <div className="whitespace-pre-wrap rounded-lg bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
                            {item.description}
                          </div>
                        )}
                        {renderActions(item, article)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
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
