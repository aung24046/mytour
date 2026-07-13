import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'
import SelectField from '../../components/common/SelectField'
import BottomSheet from '../../components/common/BottomSheet'

const ARTICLE_CATEGORIES = ['place', 'knowledge', 'culture', 'tips']

const EMPTY_ARTICLE = {
  category: 'knowledge',
  title: '',
  body: '',
  source_url: '',
  itinerary_item_id: '',
  is_published: true,
}

const EMPTY_PHRASE = { category: '', phrase: '', translation: '', pronunciation: '', language_pair: '' }
const LANGUAGE_PAIR_PRESETS = ['ไทย-จีน', 'ไทย-อังกฤษ', 'อังกฤษ-ไทย', 'จีน-ไทย']

// แยกแต่ละแถวของข้อความที่วางมา — รองรับ TSV (คัดลอกจาก Excel/Sheets) และ CSV (มี "" ครอบข้อความที่มีคอมมาได้)
function splitLine(line) {
  if (line.includes('\t')) return line.split('\t')
  const result = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result
}

const HEADER_HINTS = ['category', 'หมวด', 'หมวดหมู่', 'phrase', 'คำ', 'คำ/วลี']

function parseImportText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  const rows = []
  const errorLines = []
  if (lines.length === 0) return { rows, errorLines }

  let startIndex = 0
  const firstCell = (splitLine(lines[0])[0] ?? '').trim().toLowerCase()
  if (HEADER_HINTS.includes(firstCell)) startIndex = 1

  for (let i = startIndex; i < lines.length; i++) {
    const cells = splitLine(lines[i])
    const [category, phrase, translation, pronunciation] = cells
    if (!category?.trim() || !phrase?.trim() || !translation?.trim()) {
      errorLines.push(i + 1)
      continue
    }
    rows.push({
      category: category.trim(),
      phrase: phrase.trim(),
      translation: translation.trim(),
      pronunciation: pronunciation?.trim() || null,
    })
  }
  return { rows, errorLines }
}

// บีบอัดรูปฝั่ง client ก่อนอัปโหลด — เหมือน pattern ใน LuggageManager (ย่อ ~800px, quality 0.7)
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()

    reader.onload = (e) => {
      img.onload = () => {
        const maxDim = 800
        let { width, height } = img
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.7)
      }
      img.onerror = reject
      img.src = e.target.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function itineraryItemLabel(item) {
  const time = item.scheduled_time ? item.scheduled_time.slice(0, 5) : ''
  return `Day ${item.day_number}${time ? ' · ' + time : ''} · ${item.title}`
}

export default function GuideBuilder() {
  const { t } = useTranslation()
  const [tab, setTab] = useState('articles') // 'articles' | 'phrasebook'

  // ----- Articles -----
  const [articles, setArticles] = useState([])
  const [itineraryItems, setItineraryItems] = useState([])
  const [loadingArticles, setLoadingArticles] = useState(true)
  const [articleSheetOpen, setArticleSheetOpen] = useState(false)
  const [editingArticleId, setEditingArticleId] = useState(null) // null = new
  const [articleDraft, setArticleDraft] = useState(EMPTY_ARTICLE)
  const [articlePhotoFile, setArticlePhotoFile] = useState(null)
  const [articlePhotoPreview, setArticlePhotoPreview] = useState(null)
  const [savingArticle, setSavingArticle] = useState(false)
  const [articleError, setArticleError] = useState(null)
  const fileInputRef = useRef(null)
  const articleBodyRef = useRef(null)

  async function loadArticles() {
    setLoadingArticles(true)
    const [articlesRes, itemsRes] = await Promise.all([
      supabase
        .from('guide_articles')
        .select('id, category, title, body, source_url, image_url, itinerary_item_id, sort_order, is_published')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('sort_order', { ascending: true }),
      supabase
        .from('itinerary_items')
        .select('id, day_number, scheduled_time, title')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('day_number', { ascending: true })
        .order('sort_order', { ascending: true }),
    ])

    if (!articlesRes.error) setArticles(articlesRes.data ?? [])
    if (!itemsRes.error) setItineraryItems(itemsRes.data ?? [])
    setLoadingArticles(false)
  }

  useEffect(() => {
    if (tab !== 'articles') return
    loadArticles()

    const channel = supabase
      .channel(`guide-articles-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'guide_articles', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadArticles()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const itineraryItemById = useMemo(() => {
    const map = {}
    for (const it of itineraryItems) map[it.id] = it
    return map
  }, [itineraryItems])

  const articlesByCategory = useMemo(() => {
    const groups = {}
    for (const a of articles) {
      if (!groups[a.category]) groups[a.category] = []
      groups[a.category].push(a)
    }
    return groups
  }, [articles])

  function openNewArticle(category) {
    setEditingArticleId(null)
    setArticleDraft({ ...EMPTY_ARTICLE, category: category ?? 'knowledge' })
    setArticlePhotoFile(null)
    setArticlePhotoPreview(null)
    setArticleError(null)
    setArticleSheetOpen(true)
  }

  function openEditArticle(article) {
    setEditingArticleId(article.id)
    setArticleDraft({
      category: article.category,
      title: article.title,
      body: article.body ?? '',
      source_url: article.source_url ?? '',
      itinerary_item_id: article.itinerary_item_id ?? '',
      is_published: article.is_published,
    })
    setArticlePhotoFile(null)
    setArticlePhotoPreview(null)
    setArticleError(null)
    setArticleSheetOpen(true)
  }

  function handleArticlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setArticlePhotoFile(file)
    setArticlePhotoPreview(URL.createObjectURL(file))
  }

  // แทรก markdown syntax ที่ตำแหน่ง cursor ของช่องเนื้อหาบทความ — รองรับตัวหนา/ตัวเอียง/bullet list
  function applyMarkdownFormat(type) {
    const textarea = articleBodyRef.current
    if (!textarea) return

    const { selectionStart, selectionEnd, value } = textarea
    const selected = value.slice(selectionStart, selectionEnd)
    let insertion = selected
    let newStart = selectionStart
    let newEnd = selectionEnd

    if (type === 'bold') {
      const inner = selected || 'ข้อความ'
      insertion = `**${inner}**`
      newStart = selectionStart + 2
      newEnd = newStart + inner.length
    } else if (type === 'italic') {
      const inner = selected || 'ข้อความ'
      insertion = `*${inner}*`
      newStart = selectionStart + 1
      newEnd = newStart + inner.length
    } else if (type === 'bullet') {
      const before = value.slice(0, selectionStart)
      const needsNewline = before.length > 0 && !before.endsWith('\n')
      if (selected) {
        const lines = selected.split('\n').map((line) => (line.trim() ? `- ${line}` : line))
        insertion = (needsNewline ? '\n' : '') + lines.join('\n')
      } else {
        insertion = (needsNewline ? '\n' : '') + '- '
      }
      newStart = selectionStart + insertion.length
      newEnd = newStart
    }

    const nextValue = value.slice(0, selectionStart) + insertion + value.slice(selectionEnd)
    setArticleDraft((prev) => ({ ...prev, body: nextValue }))

    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(newStart, newEnd)
    })
  }

  async function saveArticle() {
    if (!articleDraft.title.trim()) return
    setSavingArticle(true)
    setArticleError(null)

    try {
      let imageUrl = editingArticleId
        ? articles.find((a) => a.id === editingArticleId)?.image_url ?? null
        : null

      if (articlePhotoFile) {
        const compressed = await compressImage(articlePhotoFile)
        const path = `${ACTIVE_TOUR_ID}/${Date.now()}.jpg`
        const { error: uploadError } = await supabase.storage
          .from('guide-images')
          .upload(path, compressed, { contentType: 'image/jpeg', upsert: true })
        if (uploadError) throw uploadError

        const { data: publicUrlData } = supabase.storage.from('guide-images').getPublicUrl(path)
        imageUrl = publicUrlData.publicUrl
      }

      const payload = {
        tour_id: ACTIVE_TOUR_ID,
        category: articleDraft.category,
        title: articleDraft.title.trim(),
        body: articleDraft.body.trim() || null,
        source_url: articleDraft.source_url.trim() || null,
        image_url: imageUrl,
        itinerary_item_id: articleDraft.itinerary_item_id || null,
        is_published: articleDraft.is_published,
      }

      let saveResult
      if (editingArticleId) {
        saveResult = await supabase.from('guide_articles').update(payload).eq('id', editingArticleId)
      } else {
        const catItems = articlesByCategory[payload.category] ?? []
        const maxSort = catItems.reduce((max, a) => Math.max(max, a.sort_order ?? 0), 0)
        saveResult = await supabase.from('guide_articles').insert({ ...payload, sort_order: maxSort + 1 })
      }

      if (saveResult.error) throw saveResult.error

      setArticleSheetOpen(false)
      loadArticles()
    } catch (err) {
      console.error('[GuideBuilder] save article failed', err)
      setArticleError(err.message ?? t('common.error'))
    } finally {
      setSavingArticle(false)
    }
  }

  async function togglePublish(article) {
    setArticles((prev) =>
      prev.map((a) => (a.id === article.id ? { ...a, is_published: !a.is_published } : a))
    )
    const { error } = await supabase
      .from('guide_articles')
      .update({ is_published: !article.is_published })
      .eq('id', article.id)
    if (error) {
      console.error('[GuideBuilder] toggle publish failed', error)
      loadArticles()
    }
  }

  async function deleteArticle(article) {
    const confirmed = window.confirm(t('staff.guideBuilder.confirmDeleteArticle', { title: article.title }))
    if (!confirmed) return

    const { error } = await supabase.from('guide_articles').delete().eq('id', article.id)
    if (!error) setArticles((prev) => prev.filter((a) => a.id !== article.id))
  }

  // ----- Phrasebook -----
  const [phrases, setPhrases] = useState([])
  const [loadingPhrases, setLoadingPhrases] = useState(true)
  const [phraseSheetOpen, setPhraseSheetOpen] = useState(false)
  const [phraseDraft, setPhraseDraft] = useState(EMPTY_PHRASE)
  const [savingPhrase, setSavingPhrase] = useState(false)
  const [phraseError, setPhraseError] = useState(null)
  const [pairFilter, setPairFilter] = useState('all')
  const [collapsedPhraseCategories, setCollapsedPhraseCategories] = useState({})

  function togglePhraseCategory(category) {
    setCollapsedPhraseCategories((prev) => ({ ...prev, [category]: !prev[category] }))
  }

  // ----- Import คำศัพท์เป็นชุด (CSV/TSV) -----
  const [importSheetOpen, setImportSheetOpen] = useState(false)
  const [importLanguagePair, setImportLanguagePair] = useState('')
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)
  const [importResult, setImportResult] = useState(null)

  async function loadPhrases() {
    setLoadingPhrases(true)
    const { data, error } = await supabase
      .from('phrasebook_entries')
      .select('id, category, phrase, translation, pronunciation, language_pair, sort_order')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .order('sort_order', { ascending: true })

    if (!error) setPhrases(data ?? [])
    setLoadingPhrases(false)
  }

  useEffect(() => {
    if (tab !== 'phrasebook') return
    loadPhrases()

    const channel = supabase
      .channel(`phrasebook-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'phrasebook_entries', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadPhrases()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const languagePairs = useMemo(() => {
    const seen = new Set()
    const list = []
    for (const p of phrases) {
      const key = p.language_pair || ''
      if (key && !seen.has(key)) {
        seen.add(key)
        list.push(key)
      }
    }
    return list
  }, [phrases])

  const filteredPhrases = useMemo(() => {
    if (pairFilter === 'all') return phrases
    return phrases.filter((p) => (p.language_pair || '') === pairFilter)
  }, [phrases, pairFilter])

  const phraseCategories = useMemo(() => {
    const seen = new Set()
    const list = []
    for (const p of filteredPhrases) {
      if (!seen.has(p.category)) {
        seen.add(p.category)
        list.push(p.category)
      }
    }
    return list
  }, [filteredPhrases])

  const phrasesByCategory = useMemo(() => {
    const groups = {}
    for (const p of filteredPhrases) {
      if (!groups[p.category]) groups[p.category] = []
      groups[p.category].push(p)
    }
    return groups
  }, [filteredPhrases])

  function openNewPhrase(category) {
    setPhraseDraft({
      ...EMPTY_PHRASE,
      category: category ?? '',
      language_pair: pairFilter !== 'all' ? pairFilter : '',
    })
    setPhraseError(null)
    setPhraseSheetOpen(true)
  }

  async function savePhrase() {
    if (!phraseDraft.category.trim() || !phraseDraft.phrase.trim() || !phraseDraft.translation.trim()) return
    setSavingPhrase(true)
    setPhraseError(null)

    const catItems = phrasesByCategory[phraseDraft.category.trim()] ?? []
    const maxSort = catItems.reduce((max, p) => Math.max(max, p.sort_order ?? 0), 0)

    const { error } = await supabase.from('phrasebook_entries').insert({
      tour_id: ACTIVE_TOUR_ID,
      category: phraseDraft.category.trim(),
      phrase: phraseDraft.phrase.trim(),
      translation: phraseDraft.translation.trim(),
      pronunciation: phraseDraft.pronunciation.trim() || null,
      language_pair: phraseDraft.language_pair.trim() || null,
      sort_order: maxSort + 1,
    })

    if (error) {
      console.error('[GuideBuilder] save phrase failed', error)
      setPhraseError(error.message ?? t('common.error'))
    } else {
      setPhraseSheetOpen(false)
      loadPhrases()
    }
    setSavingPhrase(false)
  }

  async function deletePhrase(phrase) {
    const confirmed = window.confirm(t('staff.guideBuilder.confirmDeletePhrase', { phrase: phrase.phrase }))
    if (!confirmed) return

    const { error } = await supabase.from('phrasebook_entries').delete().eq('id', phrase.id)
    if (!error) setPhrases((prev) => prev.filter((p) => p.id !== phrase.id))
  }

  function openImportSheet() {
    setImportLanguagePair(pairFilter !== 'all' ? pairFilter : '')
    setImportText('')
    setImportError(null)
    setImportResult(null)
    setImportSheetOpen(true)
  }

  async function runImport() {
    const { rows, errorLines } = parseImportText(importText)

    if (rows.length === 0) {
      setImportError(t('staff.guideBuilder.importEmptyError'))
      return
    }

    setImporting(true)
    setImportError(null)
    setImportResult(null)

    // sort_order เดินต่อจากค่าสูงสุดที่มีอยู่แล้วต่อหมวด — กันชนกับของเดิม
    const sortCounters = {}
    for (const p of phrases) {
      sortCounters[p.category] = Math.max(sortCounters[p.category] ?? 0, p.sort_order ?? 0)
    }

    const payload = rows.map((r) => {
      sortCounters[r.category] = (sortCounters[r.category] ?? 0) + 1
      return {
        tour_id: ACTIVE_TOUR_ID,
        category: r.category,
        phrase: r.phrase,
        translation: r.translation,
        pronunciation: r.pronunciation,
        language_pair: importLanguagePair.trim() || null,
        sort_order: sortCounters[r.category],
      }
    })

    const { error } = await supabase.from('phrasebook_entries').insert(payload)

    if (error) {
      console.error('[GuideBuilder] import phrases failed', error)
      setImportError(error.message ?? t('common.error'))
    } else {
      setImportResult({ count: payload.length, skipped: errorLines.length })
      setImportText('')
      loadPhrases()
    }
    setImporting(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold text-gray-900">{t('staff.guideBuilder.title')}</h1>
        <p className="mb-3 text-sm text-gray-500">{t('staff.guideBuilder.subtitle')}</p>

        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setTab('articles')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              tab === 'articles' ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('staff.guideBuilder.tabArticles')}
          </button>
          <button
            onClick={() => setTab('phrasebook')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              tab === 'phrasebook' ? 'bg-brand-gradient text-white shadow-brand' : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('staff.guideBuilder.tabPhrasebook')}
          </button>
        </div>

        {tab === 'articles' && (
          <>
            {loadingArticles && <p className="text-gray-500">{t('common.loading')}</p>}

            {!loadingArticles &&
              ARTICLE_CATEGORIES.map((category) => (
                <div key={category} className="mb-4">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase text-gray-400">
                      {t(`staff.guideBuilder.category.${category}`)}
                    </p>
                    <button
                      onClick={() => openNewArticle(category)}
                      className="text-xs font-semibold text-sky-600"
                    >
                      + {t('staff.guideBuilder.addArticle')}
                    </button>
                  </div>

                  {(articlesByCategory[category] ?? []).length === 0 && (
                    <p className="text-sm text-gray-400">{t('staff.guideBuilder.noArticles')}</p>
                  )}

                  <div className="flex flex-col gap-2">
                    {(articlesByCategory[category] ?? []).map((article) => (
                      <Card key={article.id} className="p-3">
                        <div className="flex items-start gap-3">
                          {article.image_url ? (
                            <img
                              src={article.image_url}
                              alt={article.title}
                              className="h-12 w-12 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300">
                              📄
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-gray-900">{article.title}</p>
                            {article.itinerary_item_id && itineraryItemById[article.itinerary_item_id] && (
                              <p className="truncate text-xs text-sky-600">
                                {itineraryItemLabel(itineraryItemById[article.itinerary_item_id])}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => togglePublish(article)}
                            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                              article.is_published
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {article.is_published
                              ? t('staff.guideBuilder.published')
                              : t('staff.guideBuilder.unpublished')}
                          </button>
                        </div>
                        <div className="mt-2 flex gap-3 border-t border-gray-100 pt-2">
                          <button
                            onClick={() => openEditArticle(article)}
                            className="text-sm font-medium text-sky-600"
                          >
                            {t('staff.itineraryBuilder.edit')}
                          </button>
                          <button
                            onClick={() => deleteArticle(article)}
                            className="text-sm font-medium text-red-500"
                          >
                            {t('staff.guideBuilder.deleteArticle')}
                          </button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
          </>
        )}

        {tab === 'phrasebook' && (
          <>
            <div className="mb-3 flex gap-2">
              <button
                onClick={() => openNewPhrase()}
                className="flex-1 rounded-xl border border-dashed border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
              >
                + {t('staff.guideBuilder.addPhrase')}
              </button>
              <button
                onClick={openImportSheet}
                className="flex-1 rounded-xl border border-dashed border-sky-300 px-4 py-2.5 text-sm font-semibold text-sky-600 hover:border-sky-400"
              >
                ⇪ {t('staff.guideBuilder.importPhrases')}
              </button>
            </div>

            {languagePairs.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setPairFilter('all')}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    pairFilter === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {t('staff.guideBuilder.allLanguagePairs')}
                </button>
                {languagePairs.map((pair) => (
                  <button
                    key={pair}
                    onClick={() => setPairFilter(pair)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                      pairFilter === pair ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {pair}
                  </button>
                ))}
              </div>
            )}

            {loadingPhrases && <p className="text-gray-500">{t('common.loading')}</p>}

            {!loadingPhrases && phraseCategories.length === 0 && (
              <p className="text-sm text-gray-400">{t('staff.guideBuilder.noPhrases')}</p>
            )}

            {!loadingPhrases &&
              phraseCategories.map((category) => {
                const isCollapsed = collapsedPhraseCategories[category]
                const items = phrasesByCategory[category] ?? []
                return (
                  <div key={category} className="mb-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => togglePhraseCategory(category)}
                        aria-expanded={!isCollapsed}
                        className="flex items-center gap-1.5 text-xs font-semibold uppercase text-gray-400"
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
                        <span className="font-normal text-gray-300">({items.length})</span>
                      </button>
                      <button
                        onClick={() => openNewPhrase(category)}
                        className="text-xs font-semibold text-sky-600"
                      >
                        + {t('staff.guideBuilder.addPhrase')}
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="overflow-x-auto rounded-xl border border-gray-100">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-gray-50 text-xs uppercase text-gray-400">
                            <tr>
                              <th className="px-3 py-2 font-semibold">{t('staff.guideBuilder.phraseText')}</th>
                              <th className="px-3 py-2 font-semibold">{t('staff.guideBuilder.translation')}</th>
                              <th className="px-3 py-2 font-semibold">{t('staff.guideBuilder.pronunciation')}</th>
                              <th className="px-3 py-2 font-semibold">{t('staff.guideBuilder.languagePair')}</th>
                              <th className="px-3 py-2" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 bg-white">
                            {items.map((phrase) => (
                              <tr key={phrase.id}>
                                <td className="px-3 py-2 font-medium text-gray-900">{phrase.phrase}</td>
                                <td className="px-3 py-2 text-gray-700">{phrase.translation}</td>
                                <td className="px-3 py-2 text-gray-400">{phrase.pronunciation || '—'}</td>
                                <td className="px-3 py-2">
                                  {phrase.language_pair ? (
                                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-600">
                                      {phrase.language_pair}
                                    </span>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    onClick={() => deletePhrase(phrase)}
                                    className="text-sm font-medium text-red-500"
                                  >
                                    {t('staff.guideBuilder.deletePhrase')}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
          </>
        )}
      </div>

      <BottomSheet
        open={articleSheetOpen}
        onClose={() => setArticleSheetOpen(false)}
        title={editingArticleId ? t('staff.itineraryBuilder.edit') : t('staff.guideBuilder.addArticle')}
      >
        <div className="flex flex-col gap-3">
          <SelectField
            label={t('staff.guideBuilder.articleCategory')}
            options={ARTICLE_CATEGORIES.map((c) => ({ value: c, label: t(`staff.guideBuilder.category.${c}`) }))}
            value={articleDraft.category}
            onChange={(e) => setArticleDraft((prev) => ({ ...prev, category: e.target.value }))}
          />
          <TextField
            label={t('staff.guideBuilder.articleTitle')}
            required
            value={articleDraft.title}
            onChange={(e) => setArticleDraft((prev) => ({ ...prev, title: e.target.value }))}
          />
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-text">{t('staff.guideBuilder.articleBody')}</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => applyMarkdownFormat('bold')}
                  title={t('staff.guideBuilder.formatBold')}
                  className="rounded-lg bg-gray-100 px-2.5 py-1 text-sm font-bold text-gray-700 hover:bg-gray-200"
                >
                  B
                </button>
                <button
                  type="button"
                  onClick={() => applyMarkdownFormat('italic')}
                  title={t('staff.guideBuilder.formatItalic')}
                  className="rounded-lg bg-gray-100 px-2.5 py-1 text-sm italic text-gray-700 hover:bg-gray-200"
                >
                  I
                </button>
                <button
                  type="button"
                  onClick={() => applyMarkdownFormat('bullet')}
                  title={t('staff.guideBuilder.formatBullet')}
                  className="rounded-lg bg-gray-100 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-200"
                >
                  • List
                </button>
              </div>
            </div>
            <TextAreaField
              ref={articleBodyRef}
              value={articleDraft.body}
              onChange={(e) => setArticleDraft((prev) => ({ ...prev, body: e.target.value }))}
              rows={6}
            />
            <p className="mt-1 text-xs text-gray-400">{t('staff.guideBuilder.formatUnderlineHint')}</p>
          </div>

          <TextField
            label={t('staff.guideBuilder.sourceUrl')}
            type="url"
            placeholder={t('staff.guideBuilder.sourceUrlPlaceholder')}
            value={articleDraft.source_url}
            onChange={(e) => setArticleDraft((prev) => ({ ...prev, source_url: e.target.value }))}
          />

          <div>
            <p className="mb-1.5 text-sm font-semibold text-neutral-text">{t('staff.guideBuilder.articleImage')}</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleArticlePhotoChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-xl bg-gray-100 px-3 py-2.5 text-sm font-semibold text-gray-700"
            >
              {t('staff.guideBuilder.takePhoto')}
            </button>
            {(articlePhotoPreview ||
              (editingArticleId && articles.find((a) => a.id === editingArticleId)?.image_url)) && (
              <img
                src={
                  articlePhotoPreview ||
                  articles.find((a) => a.id === editingArticleId)?.image_url
                }
                alt="preview"
                className="mt-2 h-32 w-full rounded-xl object-cover"
              />
            )}
          </div>

          <SelectField
            label={t('staff.guideBuilder.linkItinerary')}
            options={itineraryItems.map((it) => ({ value: it.id, label: itineraryItemLabel(it) }))}
            value={articleDraft.itinerary_item_id}
            onChange={(e) => setArticleDraft((prev) => ({ ...prev, itinerary_item_id: e.target.value }))}
          />

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={articleDraft.is_published}
              onChange={(e) => setArticleDraft((prev) => ({ ...prev, is_published: e.target.checked }))}
              className="h-5 w-5 rounded border-gray-300 text-brand focus:ring-brand-light"
            />
            <span className="text-sm font-medium text-neutral-text">{t('staff.guideBuilder.published')}</span>
          </label>

          {articleError && <p className="text-sm text-red-500">{articleError}</p>}

          <Button onClick={saveArticle} disabled={savingArticle || !articleDraft.title.trim()}>
            {savingArticle ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={() => setArticleSheetOpen(false)} disabled={savingArticle}>
            {t('common.cancel')}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={phraseSheetOpen}
        onClose={() => setPhraseSheetOpen(false)}
        title={t('staff.guideBuilder.addPhrase')}
      >
        <div className="flex flex-col gap-3">
          <TextField
            label={t('staff.guideBuilder.languagePair')}
            list="language-pairs"
            placeholder={t('staff.guideBuilder.languagePairPlaceholder')}
            value={phraseDraft.language_pair}
            onChange={(e) => setPhraseDraft((prev) => ({ ...prev, language_pair: e.target.value }))}
          />
          <datalist id="language-pairs">
            {[...new Set([...LANGUAGE_PAIR_PRESETS, ...languagePairs])].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <TextField
            label={t('staff.guideBuilder.phraseCategory')}
            required
            list="phrase-categories"
            placeholder={t('staff.guideBuilder.phraseCategoryPlaceholder')}
            value={phraseDraft.category}
            onChange={(e) => setPhraseDraft((prev) => ({ ...prev, category: e.target.value }))}
          />
          <datalist id="phrase-categories">
            {phraseCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <TextField
            label={t('staff.guideBuilder.phraseText')}
            required
            value={phraseDraft.phrase}
            onChange={(e) => setPhraseDraft((prev) => ({ ...prev, phrase: e.target.value }))}
          />
          <TextField
            label={t('staff.guideBuilder.translation')}
            required
            value={phraseDraft.translation}
            onChange={(e) => setPhraseDraft((prev) => ({ ...prev, translation: e.target.value }))}
          />
          <TextField
            label={t('staff.guideBuilder.pronunciation')}
            value={phraseDraft.pronunciation}
            onChange={(e) => setPhraseDraft((prev) => ({ ...prev, pronunciation: e.target.value }))}
          />

          {phraseError && <p className="text-sm text-red-500">{phraseError}</p>}

          <Button
            onClick={savePhrase}
            disabled={
              savingPhrase ||
              !phraseDraft.category.trim() ||
              !phraseDraft.phrase.trim() ||
              !phraseDraft.translation.trim()
            }
          >
            {savingPhrase ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={() => setPhraseSheetOpen(false)} disabled={savingPhrase}>
            {t('common.cancel')}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={importSheetOpen}
        onClose={() => setImportSheetOpen(false)}
        title={t('staff.guideBuilder.importPhrases')}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">{t('staff.guideBuilder.importInstructions')}</p>

          <TextField
            label={t('staff.guideBuilder.languagePair')}
            list="language-pairs-import"
            placeholder={t('staff.guideBuilder.languagePairPlaceholder')}
            value={importLanguagePair}
            onChange={(e) => setImportLanguagePair(e.target.value)}
          />
          <datalist id="language-pairs-import">
            {[...new Set([...LANGUAGE_PAIR_PRESETS, ...languagePairs])].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>

          <TextAreaField
            label={t('staff.guideBuilder.importTextareaLabel')}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            placeholder={'ทักทาย\tสวัสดี\t你好\tหนี่ห่าว\nอาหาร\tน้ำ\t水\tสุ่ย'}
          />

          {importText.trim() && (
            <p className="text-xs text-gray-400">
              {t('staff.guideBuilder.importPreview', { count: parseImportText(importText).rows.length })}
            </p>
          )}

          {importError && <p className="text-sm text-red-500">{importError}</p>}

          {importResult && (
            <p className="text-sm font-medium text-green-600">
              {t('staff.guideBuilder.importSuccess', { count: importResult.count })}
              {importResult.skipped > 0 &&
                ` — ${t('staff.guideBuilder.importSkipped', { count: importResult.skipped })}`}
            </p>
          )}

          <Button onClick={runImport} disabled={importing || !importText.trim()}>
            {importing
              ? t('common.loading')
              : t('staff.guideBuilder.importSubmit', { count: parseImportText(importText).rows.length })}
          </Button>
          <Button variant="secondary" onClick={() => setImportSheetOpen(false)} disabled={importing}>
            {t('common.cancel')}
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}
