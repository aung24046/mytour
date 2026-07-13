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
import Icon from '../../components/common/Icon'

const CACHE_KEY = 'trip_guide'
const TABS = ['place', 'knowledge', 'phrasebook']
const KNOWLEDGE_CATEGORIES = ['knowledge', 'culture', 'tips']

export default function TripGuide() {
  const { t } = useTranslation()

  const [tab, setTab] = useState('place')
  const [articles, setArticles] = useState([])
  const [phrases, setPhrases] = useState([])
  const [loading, setLoading] = useState(true)
  const [usingCache, setUsingCache] = useState(false)
  const [search, setSearch] = useState('')
  const [openArticle, setOpenArticle] = useState(null)
  const [pairFilter, setPairFilter] = useState('all')
  const [collapsedPhraseCategories, setCollapsedPhraseCategories] = useState({})

  function togglePhraseCategory(category) {
    setCollapsedPhraseCategories((prev) => ({ ...prev, [category]: !prev[category] }))
  }

  useEffect(() => {
    let isMounted = true

    async function load() {
      setLoading(true)
      const [articlesRes, phrasesRes] = await Promise.all([
        supabase
          .from('guide_articles')
          .select('id, category, title, body, source_url, image_url, itinerary_item_id, sort_order')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .eq('is_published', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('phrasebook_entries')
          .select('id, category, phrase, translation, pronunciation, language_pair, sort_order')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .order('sort_order', { ascending: true }),
      ])

      if (!isMounted) return

      if (articlesRes.error && phrasesRes.error) {
        console.error('[TripGuide] load failed — falling back to cache', articlesRes.error, phrasesRes.error)
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setArticles(cached.articles ?? [])
          setPhrases(cached.phrases ?? [])
          setUsingCache(true)
        }
        setLoading(false)
        return
      }

      const nextArticles = articlesRes.data ?? []
      const nextPhrases = phrasesRes.data ?? []
      setArticles(nextArticles)
      setPhrases(nextPhrases)
      setUsingCache(false)
      saveCache(CACHE_KEY, { articles: nextArticles, phrases: nextPhrases })
      setLoading(false)
    }

    load()
    return () => {
      isMounted = false
    }
  }, [])

  const placeArticles = useMemo(
    () => articles.filter((a) => a.category === 'place'),
    [articles]
  )

  const knowledgeGroups = useMemo(() => {
    const groups = {}
    for (const cat of KNOWLEDGE_CATEGORIES) groups[cat] = []
    for (const a of articles) {
      if (KNOWLEDGE_CATEGORIES.includes(a.category)) groups[a.category].push(a)
    }
    return KNOWLEDGE_CATEGORIES.map((category) => ({ category, items: groups[category] })).filter(
      (g) => g.items.length > 0
    )
  }, [articles])

  const languagePairs = useMemo(() => {
    const seen = new Set()
    const list = []
    for (const p of phrases) {
      if (p.language_pair && !seen.has(p.language_pair)) {
        seen.add(p.language_pair)
        list.push(p.language_pair)
      }
    }
    return list
  }, [phrases])

  const phraseGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const groups = {}
    for (const p of phrases) {
      if (pairFilter !== 'all' && (p.language_pair || '') !== pairFilter) continue
      const matches =
        !q ||
        p.phrase.toLowerCase().includes(q) ||
        p.translation.toLowerCase().includes(q) ||
        (p.pronunciation ?? '').toLowerCase().includes(q)
      if (!matches) continue
      if (!groups[p.category]) groups[p.category] = []
      groups[p.category].push(p)
    }
    return Object.entries(groups)
  }, [phrases, search, pairFilter])

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
            <span aria-hidden="true">📖</span>
            {t('guest.tripGuide.title')}
          </h1>

          <GuestNav active="tripGuide" />

          {usingCache && (
            <p className="mb-3 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
              {t('guest.tripGuide.offlineNotice')}
            </p>
          )}

          <div className="mb-4 flex gap-2">
            {TABS.map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                className={`flex-1 rounded-control px-2 py-2 text-sm font-semibold transition ${
                  tab === tabKey
                    ? 'bg-brand-gradient text-white shadow-brand'
                    : 'bg-surface-sunken text-neutral-text'
                }`}
              >
                {t(`guest.tripGuide.tab${tabKey === 'place' ? 'Places' : tabKey === 'knowledge' ? 'Knowledge' : 'Phrasebook'}`)}
              </button>
            ))}
          </div>

          {loading && <p className="text-ink-muted">{t('common.loading')}</p>}

          {!loading && tab === 'place' && (
            <div className="flex flex-col gap-2">
              {placeArticles.length === 0 && (
                <p className="text-sm text-ink-faint">{t('guest.tripGuide.noArticles')}</p>
              )}
              {placeArticles.map((article) => (
                <ArticleCard key={article.id} article={article} onOpen={() => setOpenArticle(article)} t={t} />
              ))}
            </div>
          )}

          {!loading && tab === 'knowledge' && (
            <div className="flex flex-col gap-4">
              {knowledgeGroups.length === 0 && (
                <p className="text-sm text-ink-faint">{t('guest.tripGuide.noArticles')}</p>
              )}
              {knowledgeGroups.map((group) => (
                <div key={group.category}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    {t(`guest.tripGuide.category.${group.category}`)}
                  </p>
                  <div className="flex flex-col gap-2">
                    {group.items.map((article) => (
                      <ArticleCard key={article.id} article={article} onOpen={() => setOpenArticle(article)} t={t} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && tab === 'phrasebook' && (
            <div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('guest.tripGuide.searchPlaceholder')}
                className="mb-3 w-full rounded-control border border-transparent bg-surface-sunken px-3.5 py-3 text-base text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
              />

              {languagePairs.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => setPairFilter('all')}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                      pairFilter === 'all' ? 'bg-brand text-white' : 'bg-surface-sunken text-neutral-text'
                    }`}
                  >
                    {t('guest.tripGuide.allLanguagePairs')}
                  </button>
                  {languagePairs.map((pair) => (
                    <button
                      key={pair}
                      onClick={() => setPairFilter(pair)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                        pairFilter === pair ? 'bg-brand text-white' : 'bg-surface-sunken text-neutral-text'
                      }`}
                    >
                      {pair}
                    </button>
                  ))}
                </div>
              )}

              {phraseGroups.length === 0 && (
                <p className="text-sm text-ink-faint">{t('guest.tripGuide.noPhrases')}</p>
              )}

              <div className="flex flex-col gap-4">
                {phraseGroups.map(([category, items]) => {
                  const isCollapsed = collapsedPhraseCategories[category]
                  return (
                    <div key={category}>
                      <button
                        type="button"
                        onClick={() => togglePhraseCategory(category)}
                        aria-expanded={!isCollapsed}
                        className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint"
                      >
                        <svg
                          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                            isCollapsed ? '-rotate-90' : ''
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
                        {category}
                        <span className="font-normal text-ink-faint/70">({items.length})</span>
                      </button>
                      {!isCollapsed && (
                        <Card className="overflow-x-auto p-0">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-surface-sunken text-xs uppercase text-ink-faint">
                              <tr>
                                <th className="px-3 py-2 font-semibold">{t('guest.tripGuide.colPhrase')}</th>
                                <th className="px-3 py-2 font-semibold">{t('guest.tripGuide.colTranslation')}</th>
                                <th className="px-3 py-2 font-semibold">{t('guest.tripGuide.colPronunciation')}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-sunken">
                              {items.map((p) => (
                                <tr key={p.id}>
                                  <td className="px-3 py-2 font-semibold text-ink">{p.phrase}</td>
                                  <td className="px-3 py-2 text-brand">{p.translation}</td>
                                  <td className="px-3 py-2 text-ink-faint">{p.pronunciation || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </Card>
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

function ArticleCard({ article, onOpen, t }) {
  return (
    <Card hover className="cursor-pointer" onClick={onOpen}>
      <div className="flex items-center gap-3">
        {article.image_url ? (
          <img
            src={article.image_url}
            alt={article.title}
            className="h-14 w-14 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-faint">
            <Icon name="book" size={22} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">{article.title}</p>
          <p className="mt-0.5 text-sm text-brand">{t('guest.tripGuide.viewDetail')}</p>
        </div>
      </div>
    </Card>
  )
}
