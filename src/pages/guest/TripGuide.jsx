import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { saveCache, loadCache } from '../../lib/offlineCache'
import { catColor, catLabel, tagColor } from '../../lib/guideCategoryStyle'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import GuestNav from '../../components/common/GuestNav'
import BottomSheet from '../../components/common/BottomSheet'
import Icon from '../../components/common/Icon'

const CACHE_KEY = 'trip_guide'
const LIST_LIMIT = 3
const SCROLL_LIMIT = 6

function excerpt(body, len = 70) {
  if (!body) return ''
  const plain = body
    .replace(/[#*_>`]/g, '')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
  return plain.length > len ? plain.slice(0, len) + '…' : plain
}

export default function TripGuide() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  const [mode, setMode] = useState('article') // 'article' | 'phrasebook'
  const [categories, setCategories] = useState([])
  const [articles, setArticles] = useState([])
  const [phrases, setPhrases] = useState([])
  const [itineraryItems, setItineraryItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [usingCache, setUsingCache] = useState(false)

  const [articleSearch, setArticleSearch] = useState('')
  const [search, setSearch] = useState('') // phrasebook search
  const [openArticle, setOpenArticle] = useState(null)
  const [targetLang, setTargetLang] = useState(null) // 'zh' | 'en'
  const [phraseGroupBy, setPhraseGroupBy] = useState('place') // 'place' | 'type'
  const [expandedCats, setExpandedCats] = useState({})
  const [expandedPhraseGroups, setExpandedPhraseGroups] = useState(() => new Set())

  function toggleExpand(id) {
    setExpandedCats((prev) => ({ ...prev, [id]: !prev[id] }))
  }
  function togglePhraseGroup(label) {
    setExpandedPhraseGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  useEffect(() => {
    let isMounted = true

    async function load() {
      setLoading(true)
      const [catsRes, articlesRes, phrasesRes, itemsRes] = await Promise.all([
        supabase
          .from('guide_categories')
          .select('id, label_th, label_en, label_zh, icon, color, layout, sort_order, is_active')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('guide_articles')
          .select('id, category_id, title, body, source_url, image_url, itinerary_item_id, sort_order, is_featured')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .eq('is_published', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('phrasebook_entries')
          .select('id, category_l1, category_l2, phrase, place_label, itinerary_item_id, translation_zh, pronunciation_zh, translation_en, sort_order')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .order('sort_order', { ascending: true }),
        supabase
          .from('itinerary_items')
          .select('id, day_number, scheduled_time, title, location_name')
          .eq('tour_id', ACTIVE_TOUR_ID),
      ])

      if (!isMounted) return

      if (catsRes.error && articlesRes.error && phrasesRes.error) {
        console.error('[TripGuide] load failed — falling back to cache')
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setCategories(cached.categories ?? [])
          setArticles(cached.articles ?? [])
          setPhrases(cached.phrases ?? [])
          setItineraryItems(cached.itineraryItems ?? [])
          setUsingCache(true)
        }
        setLoading(false)
        return
      }

      const next = {
        categories: catsRes.data ?? [],
        articles: articlesRes.data ?? [],
        phrases: phrasesRes.data ?? [],
        itineraryItems: itemsRes.data ?? [],
      }
      setCategories(next.categories)
      setArticles(next.articles)
      setPhrases(next.phrases)
      setItineraryItems(next.itineraryItems)
      setUsingCache(false)
      saveCache(CACHE_KEY, next)
      setLoading(false)
    }

    load()
    return () => {
      isMounted = false
    }
  }, [])

  const itineraryById = useMemo(() => {
    const map = {}
    for (const it of itineraryItems) map[it.id] = it
    return map
  }, [itineraryItems])

  const featured = useMemo(() => articles.filter((a) => a.is_featured), [articles])

  // จัดกลุ่มบทความ (ไม่รวม featured) ตามหมวด + เรียงในหมวด: "แวะ" (มี itinerary) ก่อน "ผ่าน"
  const groups = useMemo(() => {
    const groupable = articles.filter((a) => !a.is_featured)
    const byCat = {}
    for (const a of groupable) {
      const key = a.category_id ?? '__uncat__'
      if (!byCat[key]) byCat[key] = []
      byCat[key].push(a)
    }

    function orderItems(items) {
      const timeOf = (a) => itineraryById[a.itinerary_item_id]?.scheduled_time ?? null
      return [...items].sort((a, b) => {
        const la = a.itinerary_item_id ? 1 : 0
        const lb = b.itinerary_item_id ? 1 : 0
        if (la !== lb) return lb - la // linked (แวะ) ก่อน
        if (la === 1) {
          const ta = timeOf(a) ?? ''
          const tb = timeOf(b) ?? ''
          if (ta !== tb) return ta.localeCompare(tb)
        }
        return (a.sort_order ?? 0) - (b.sort_order ?? 0)
      })
    }

    const result = []
    for (const cat of categories) {
      const items = byCat[cat.id]
      if (items && items.length) {
        result.push({ cat, items: orderItems(items), hasLinked: items.some((a) => a.itinerary_item_id) })
      }
    }
    const uncat = byCat['__uncat__']
    if (uncat && uncat.length) {
      result.push({ cat: null, items: orderItems(uncat), hasLinked: uncat.some((a) => a.itinerary_item_id) })
    }
    return result
  }, [articles, categories, itineraryById])

  const searchResults = useMemo(() => {
    const q = articleSearch.trim().toLowerCase()
    if (!q) return null
    return articles.filter(
      (a) => a.title.toLowerCase().includes(q) || (a.body ?? '').toLowerCase().includes(q)
    )
  }, [articles, articleSearch])

  // ----- phrasebook (multi-language) -----
  // ภาษาเป้าหมายที่มีข้อมูลจริง (จีน/อังกฤษ)
  const availableLangs = useMemo(() => {
    const langs = []
    if (phrases.some((p) => p.translation_zh)) langs.push('zh')
    if (phrases.some((p) => p.translation_en)) langs.push('en')
    return langs
  }, [phrases])

  // เลือกภาษาเริ่มต้นให้อัตโนมัติเมื่อโหลดเสร็จ
  useEffect(() => {
    if (!targetLang && availableLangs.length) setTargetLang(availableLangs[0])
  }, [availableLangs, targetLang])

  const activeLang = targetLang && availableLangs.includes(targetLang) ? targetLang : availableLangs[0]

  function transOf(p) {
    return activeLang === 'en' ? p.translation_en : p.translation_zh
  }
  function pronOf(p) {
    return activeLang === 'en' ? null : p.pronunciation_zh
  }
  function placeOf(p) {
    if (p.itinerary_item_id && itineraryById[p.itinerary_item_id]) {
      const it = itineraryById[p.itinerary_item_id]
      return it.location_name || it.title || t('guest.tripGuide.generalGroup')
    }
    return p.place_label || t('guest.tripGuide.generalGroup')
  }

  const phraseGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const groupsMap = new Map() // label -> { items, linked, day, time }
    for (const p of phrases) {
      const tr = activeLang === 'en' ? p.translation_en : p.translation_zh
      if (!tr) continue // แสดงเฉพาะคำที่มีคำแปลในภาษาที่เลือก
      const pr = activeLang === 'en' ? null : p.pronunciation_zh
      const matches =
        !q ||
        p.phrase.toLowerCase().includes(q) ||
        tr.toLowerCase().includes(q) ||
        (pr ?? '').toLowerCase().includes(q) ||
        (p.place_label ?? '').toLowerCase().includes(q) ||
        (p.category_l1 ?? '').toLowerCase().includes(q) ||
        (p.category_l2 ?? '').toLowerCase().includes(q)
      if (!matches) continue

      let label
      let it = null
      if (phraseGroupBy === 'type') {
        label = p.category_l1 || t('guest.tripGuide.otherType')
      } else {
        label = placeOf(p)
        it = p.itinerary_item_id ? itineraryById[p.itinerary_item_id] : null
      }
      if (!groupsMap.has(label)) {
        groupsMap.set(label, { items: [], linked: false, day: null, time: null })
      }
      const g = groupsMap.get(label)
      g.items.push(p)
      if (it && !g.linked) {
        g.linked = true
        g.day = it.day_number ?? null
        g.time = it.scheduled_time ?? null
      }
    }

    let arr = [...groupsMap.entries()].map(([label, g]) => ({ label, ...g }))
    // โหมดสถานที่: กลุ่มที่อยู่ในกำหนดการเรียงขึ้นบนตามวัน/เวลา, ที่เหลือไว้ล่าง
    if (phraseGroupBy === 'place') {
      arr = arr
        .map((g, i) => ({ ...g, _i: i }))
        .sort((a, b) => {
          if (a.linked !== b.linked) return a.linked ? -1 : 1
          if (a.linked && b.linked) {
            if ((a.day ?? 0) !== (b.day ?? 0)) return (a.day ?? 0) - (b.day ?? 0)
            if ((a.time ?? '') !== (b.time ?? '')) return (a.time ?? '').localeCompare(b.time ?? '')
          }
          return a._i - b._i
        })
    }
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phrases, search, activeLang, phraseGroupBy, itineraryById])

  const hasPhrasebook = phrases.length > 0

  function timeLabel(article) {
    const it = itineraryById[article.itinerary_item_id]
    if (!it?.scheduled_time) return null
    return it.scheduled_time.slice(0, 5)
  }

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
            <Icon name="book" size={26} />
            {t('guest.tripGuide.title')}
          </h1>

          <GuestNav active="tripGuide" />

          {usingCache && (
            <p className="mb-3 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
              {t('guest.tripGuide.offlineNotice')}
            </p>
          )}

          {/* สลับโหมด (ซ่อนคลังศัพท์ถ้าไม่มีข้อมูล) */}
          {hasPhrasebook && (
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setMode('article')}
                className={`flex-1 rounded-control px-2 py-2 text-sm font-semibold transition ${
                  mode === 'article' ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
                }`}
              >
                {t('guest.tripGuide.tabArticles')}
              </button>
              <button
                onClick={() => setMode('phrasebook')}
                className={`flex-1 rounded-control px-2 py-2 text-sm font-semibold transition ${
                  mode === 'phrasebook' ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
                }`}
              >
                {t('guest.tripGuide.tabPhrasebook')}
              </button>
            </div>
          )}

          {loading && <p className="text-ink-muted">{t('common.loading')}</p>}

          {/* ---------- โหมดบทความ ---------- */}
          {!loading && mode === 'article' && (
            <div>
              <div className="relative mb-4">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
                  <Icon name="search" size={18} />
                </span>
                <input
                  type="text"
                  value={articleSearch}
                  onChange={(e) => setArticleSearch(e.target.value)}
                  placeholder={t('guest.tripGuide.searchArticles')}
                  className="w-full rounded-control border border-transparent bg-surface-sunken py-3 pl-10 pr-3.5 text-base text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
                />
              </div>

              {/* ผลค้นหา (flat) */}
              {searchResults && (
                <div className="flex flex-col gap-2">
                  {searchResults.length === 0 && (
                    <p className="text-sm text-ink-faint">{t('guest.tripGuide.noResults')}</p>
                  )}
                  {searchResults.map((a) => {
                    const cat = categories.find((c) => c.id === a.category_id)
                    return (
                      <ListCard
                        key={a.id}
                        article={a}
                        col={catColor(cat?.color)}
                        badge={a.itinerary_item_id ? { kind: 'stop', time: timeLabel(a) } : null}
                        onOpen={() => setOpenArticle(a)}
                        t={t}
                      />
                    )
                  })}
                </div>
              )}

              {/* มุมมองปกติ: hero + หมวดไล่ตามเส้นทาง */}
              {!searchResults && (
                <>
                  {featured.map((a) => (
                    <HeroCard key={a.id} article={a} onOpen={() => setOpenArticle(a)} t={t} />
                  ))}

                  {groups.length === 0 && featured.length === 0 && (
                    <p className="text-sm text-ink-faint">{t('guest.tripGuide.noArticles')}</p>
                  )}

                  {groups.map(({ cat, items, hasLinked }) => {
                    const col = catColor(cat?.color)
                    const key = cat?.id ?? '__uncat__'
                    const isScroll = cat?.layout === 'scroll'
                    const expanded = !!expandedCats[key]
                    const limit = isScroll ? SCROLL_LIMIT : LIST_LIMIT
                    const shown = expanded ? items : items.slice(0, limit)
                    const remaining = items.length - shown.length

                    return (
                      <div key={key} className="mb-5">
                        <div className="mb-2 flex items-center gap-1.5">
                          {cat && <Icon name={cat.icon} size={16} color={col.text} />}
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: col.text }}>
                            {cat ? catLabel(cat, lang) : t('guest.tripGuide.moreArticles')}
                          </p>
                          <span className="text-xs font-normal text-ink-faint">({items.length})</span>
                        </div>

                        {isScroll ? (
                          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
                            {shown.map((a) => (
                              <ScrollCard key={a.id} article={a} col={col} onOpen={() => setOpenArticle(a)} />
                            ))}
                            {!expanded && remaining > 0 && (
                              <button
                                onClick={() => toggleExpand(key)}
                                className="flex w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-surface-sunken text-sm font-semibold text-brand"
                              >
                                <span className="text-lg">+{remaining}</span>
                                {t('guest.tripGuide.seeAll')}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {shown.map((a) => (
                              <ListCard
                                key={a.id}
                                article={a}
                                col={col}
                                badge={
                                  a.itinerary_item_id
                                    ? { kind: 'stop', time: timeLabel(a) }
                                    : hasLinked
                                    ? { kind: 'pass' }
                                    : null
                                }
                                onOpen={() => setOpenArticle(a)}
                                t={t}
                              />
                            ))}
                            {remaining > 0 && (
                              <button
                                onClick={() => toggleExpand(key)}
                                className="flex items-center justify-center gap-1 rounded-control border border-surface-sunken bg-surface-sunken/50 py-2.5 text-sm font-semibold text-neutral-text"
                              >
                                {t('guest.tripGuide.seeMore', { count: remaining })}
                                <span className="text-xs">▾</span>
                              </button>
                            )}
                            {expanded && items.length > limit && (
                              <button
                                onClick={() => toggleExpand(key)}
                                className="flex items-center justify-center gap-1 py-1 text-sm font-medium text-ink-faint"
                              >
                                {t('guest.tripGuide.collapse')}
                                <span className="text-xs">▴</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}

          {/* ---------- โหมดคลังศัพท์ ---------- */}
          {!loading && mode === 'phrasebook' && (
            <div>
              <div className="relative mb-3">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
                  <Icon name="search" size={18} />
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('guest.tripGuide.searchPlaceholder')}
                  className="w-full rounded-control border border-transparent bg-surface-sunken py-3 pl-10 pr-3.5 text-base text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
                />
              </div>

              {/* จัดกลุ่ม + เลือกภาษาเป้าหมาย */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-faint">{t('guest.tripGuide.groupByLabel')}</span>
                <button
                  onClick={() => setPhraseGroupBy('place')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    phraseGroupBy === 'place' ? 'bg-brand text-white' : 'bg-surface-sunken text-neutral-text'
                  }`}
                >
                  {t('guest.tripGuide.groupPlace')}
                </button>
                <button
                  onClick={() => setPhraseGroupBy('type')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                    phraseGroupBy === 'type' ? 'bg-brand text-white' : 'bg-surface-sunken text-neutral-text'
                  }`}
                >
                  {t('guest.tripGuide.groupType')}
                </button>

                {availableLangs.length > 1 && (
                  <div className="ml-auto flex gap-1.5">
                    {availableLangs.map((lg) => (
                      <button
                        key={lg}
                        onClick={() => setTargetLang(lg)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                          activeLang === lg ? 'bg-accent text-white' : 'bg-surface-sunken text-neutral-text'
                        }`}
                      >
                        {t(`guest.tripGuide.lang.${lg}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {phraseGroups.length === 0 && (
                <p className="text-sm text-ink-faint">{t('guest.tripGuide.noPhrases')}</p>
              )}

              <div className="flex flex-col gap-2.5">
                {phraseGroups.map((group) => {
                  const { label, items, linked, day, time } = group
                  const isOpen = expandedPhraseGroups.has(label)
                  const timeText = linked
                    ? [day ? t('guest.tripGuide.dayShort', { day }) : null, time ? time.slice(0, 5) : null]
                        .filter(Boolean)
                        .join(' · ')
                    : null
                  return (
                    <div
                      key={label}
                      className={`overflow-hidden rounded-card border ${
                        linked ? 'border-brand-light' : 'border-surface-sunken'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => togglePhraseGroup(label)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-2 px-3 py-3 text-left"
                      >
                        {phraseGroupBy === 'place' && (
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                              linked ? 'bg-brand-light text-brand-deep' : 'bg-surface-sunken text-ink-faint'
                            }`}
                          >
                            <Icon name={linked ? 'calendar' : 'location'} size={16} color="currentColor" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-ink">{label}</span>
                            <span className="shrink-0 text-xs font-normal text-ink-faint">({items.length})</span>
                          </span>
                          {timeText && (
                            <span className="mt-0.5 block text-[11px] font-medium text-brand">{timeText}</span>
                          )}
                        </span>
                        <svg
                          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${
                            isOpen ? '' : '-rotate-90'
                          }`}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {isOpen && (
                        <div className="flex flex-col gap-2 px-3 pb-3">
                          {items.map((p) => (
                            <PhraseCard
                              key={p.id}
                              phrase={p}
                              translation={transOf(p)}
                              pronunciation={pronOf(p)}
                              lang={activeLang}
                              tagText={
                                phraseGroupBy === 'type'
                                  ? p.category_l2
                                  : [p.category_l1, p.category_l2].filter(Boolean).join(' › ')
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
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

function HeroCard({ article, onOpen, t }) {
  return (
    <button
      onClick={onOpen}
      className="mb-5 w-full overflow-hidden rounded-card border border-brand-light text-left"
    >
      <div className="relative">
        {article.image_url ? (
          <img src={article.image_url} alt={article.title} className="h-28 w-full object-cover" />
        ) : (
          <div className="h-24 w-full bg-brand-gradient" />
        )}
        <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand-deep">
          {t('guest.tripGuide.featuredBadge')}
        </span>
      </div>
      <div className="bg-brand-light/60 px-3.5 py-2.5">
        <p className="font-bold text-ink">{article.title}</p>
        {article.body && <p className="mt-0.5 text-sm text-ink-muted">{excerpt(article.body, 80)}</p>}
      </div>
    </button>
  )
}

function ScrollCard({ article, col, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="flex w-32 shrink-0 flex-col overflow-hidden rounded-card border border-surface-sunken text-left"
    >
      {article.image_url ? (
        <img src={article.image_url} alt={article.title} className="h-16 w-full object-cover" />
      ) : (
        <div className="flex h-16 w-full items-center justify-center" style={{ background: col.tint }}>
          <Icon name="star" size={22} color={col.text} />
        </div>
      )}
      <div className="px-2 py-1.5">
        <p className="line-clamp-2 text-xs font-semibold text-ink">{article.title}</p>
      </div>
    </button>
  )
}

function ListCard({ article, col, badge, onOpen, t }) {
  const pass = badge?.kind === 'pass'
  return (
    <button
      onClick={onOpen}
      className="flex items-stretch gap-3 overflow-hidden rounded-r-card border border-surface-sunken bg-white p-2.5 text-left"
      style={{ borderLeft: `3px solid ${pass ? '#B4B2A9' : col.border}`, opacity: pass ? 0.9 : 1 }}
    >
      {article.image_url ? (
        <img src={article.image_url} alt={article.title} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
          style={{ background: pass ? '#F1EFE8' : col.tint }}
        >
          <Icon name={pass ? 'bus' : 'location'} size={20} color={pass ? '#5F5E5A' : col.text} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        {badge && (
          <span
            className="mb-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={
              badge.kind === 'stop'
                ? { background: '#E1F5EE', color: '#0F6E56' }
                : { background: '#F1EFE8', color: '#444441' }
            }
          >
            {badge.kind === 'stop'
              ? `${t('guest.tripGuide.stopBadge')}${badge.time ? ' · ' + badge.time : ''}`
              : t('guest.tripGuide.passBadge')}
          </span>
        )}
        <p className="truncate font-bold text-ink">{article.title}</p>
        {article.body && <p className="truncate text-sm text-ink-muted">{excerpt(article.body)}</p>}
      </div>
    </button>
  )
}

function PhraseCard({ phrase, translation, pronunciation, tagText, lang }) {
  const tag = tagText ? tagColor(tagText) : null
  const tagEl = tag && (
    <span
      className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: tag.tint, color: tag.text }}
    >
      {tagText}
    </span>
  )

  // อังกฤษ (และภาษาที่คำแปลยาวแบบละติน) — วางเป็นแนวตั้ง อ่านง่ายเต็มความกว้าง
  if (lang === 'en') {
    return (
      <div className="rounded-card border border-surface-sunken bg-white p-3">
        <p className="text-sm text-ink-muted">{phrase.phrase}</p>
        <p className="mt-0.5 text-lg font-semibold leading-snug text-brand">{translation}</p>
        {tagEl}
      </div>
    )
  }

  // จีน (และค่าเริ่มต้น) — อักษรตัวใหญ่ + คำอ่านชิดขวา อ่านง่ายสำหรับตัวอักษร CJK
  return (
    <div className="flex items-start justify-between gap-3 rounded-card border border-surface-sunken bg-white p-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{phrase.phrase}</p>
        {tagEl}
      </div>
      <div className="shrink-0 pl-2 text-right">
        <p className="text-xl font-semibold leading-tight text-brand">{translation}</p>
        {pronunciation && <p className="mt-0.5 text-xs text-ink-faint">{pronunciation}</p>}
      </div>
    </div>
  )
}
