import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import {
  catLabel,
  catColor,
  tagColor,
  CATEGORY_COLOR_KEYS,
  CATEGORY_ICON_CHOICES,
  CATEGORY_LAYOUTS,
} from '../../lib/guideCategoryStyle'
import { parseLatLngFromMapsUrl, nearestNeighborOrder } from '../../lib/geo'
import { THAI_PROVINCES, guessProvinceFromText } from '../../lib/thaiProvinces'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import Icon from '../../components/common/Icon'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'
import SelectField from '../../components/common/SelectField'
import BottomSheet from '../../components/common/BottomSheet'

const EMPTY_ARTICLE = {
  category_id: '',
  title: '',
  body: '',
  source_url: '',
  maps_url: '',
  province: '',
  itinerary_item_id: '',
  is_published: true,
  is_featured: false,
}

const EMPTY_CATEGORY = {
  label_th: '',
  label_en: '',
  label_zh: '',
  icon: 'book',
  color: 'blue',
  layout: 'list',
}

const EMPTY_PHRASE = {
  phrase: '',
  itinerary_item_id: '',
  place_label: '',
  category_l1: '',
  category_l2: '',
  translation_zh: '',
  pronunciation_zh: '',
  translation_en: '',
}

// ตัวเลือกแนะนำสำหรับ datalist (พิมพ์เพิ่มเองได้อิสระ)
const PHRASE_CAT1_PRESETS = [
  'สถานที่', 'อาหาร/ของกิน', 'วัฒนธรรม/ประเพณี', 'บุคคล/ประวัติศาสตร์', 'การเดินทาง',
  'ที่พัก', 'ช้อปปิ้ง/ของฝาก', 'สื่อสารทั่วไป', 'สุขภาพ/ฉุกเฉิน',
]
const PHRASE_CAT2_PRESETS = [
  'วัด/ศาสนสถาน', 'พระราชวัง/วัง', 'โบราณสถาน/ปราสาท', 'พิพิธภัณฑ์', 'อนุสาวรีย์/ศาล',
  'ตลาด/ย่านเก่า/ชุมชน', 'ทะเล/ชายหาด/เกาะ', 'ภูเขา/น้ำตก/ถ้ำ', 'สวน/อุทยาน/ธรรมชาติ', 'จุดชมวิว/แลนด์มาร์ก',
  'อาหารคาว', 'ของหวาน/ขนม', 'เครื่องดื่ม/กาแฟ', 'ผลไม้', 'สตรีทฟู้ด/ของกินเล่น', 'วัตถุดิบ/เครื่องปรุง', 'รสชาติ/ความเผ็ด',
  'ศาสนา/ความเชื่อ', 'พิธีกรรม/การไหว้', 'เทศกาล/งานประเพณี', 'ศิลปะ/หัตถกรรม', 'การแต่งกาย', 'มารยาท/ข้อควรปฏิบัติ',
  'พระมหากษัตริย์/ราชวงศ์', 'บุคคลสำคัญ/วีรบุรุษ', 'พระสงฆ์/นักบวช', 'เทพ/ตัวละครในตำนาน', 'ศิลปิน/ช่างฝีมือ', 'เหตุการณ์/ยุคสมัย',
  'ยานพาหนะ', 'ทิศทาง/บอกทาง', 'ป้าย/สัญลักษณ์', 'ตั๋ว/ค่าโดยสาร', 'เวลา/ตารางเดินทาง',
  'ประเภทห้อง', 'สิ่งอำนวยความสะดวก', 'เช็คอิน/เช็คเอาท์', 'ปัญหา/การร้องขอ',
  'ของที่ระลึก', 'การต่อราคา/ราคา', 'หน่วย/จำนวน', 'การชำระเงิน',
  'ทักทาย/กล่าวลา', 'ขอบคุณ/ขอโทษ', 'ตัวเลข/การนับ', 'เวลา/วันที่', 'คำถามพื้นฐาน', 'อารมณ์/ความรู้สึก',
  'อาการเจ็บป่วย', 'ยา/เภสัช', 'โรงพยาบาล/หมอ', 'เหตุฉุกเฉิน/ขอความช่วยเหลือ', 'ความปลอดภัย',
]

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

const HEADER_HINTS = ['place', 'สถานที่', 'หมวด', 'หมวดหมู่', 'phrase', 'คำ', 'คำ/วลี']

// รูปแบบต่อแถว (หลายภาษาในไฟล์เดียว):
// สถานที่, คำ/วลี(ไทย), คำแปลจีน, พินอิน, คำแปลอังกฤษ, หมวด L1, หมวด L2
// บังคับ: คำไทย + คำแปลอย่างน้อย 1 ภาษา (จีนหรืออังกฤษ) — ที่เหลือเว้นว่างได้
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
    const [place, phrase, tZh, pZh, tEn, l1, l2] = cells
    if (!phrase?.trim() || (!tZh?.trim() && !tEn?.trim())) {
      errorLines.push(i + 1)
      continue
    }
    rows.push({
      place_label: place?.trim() || null,
      phrase: phrase.trim(),
      translation_zh: tZh?.trim() || null,
      pronunciation_zh: pZh?.trim() || null,
      translation_en: tEn?.trim() || null,
      category_l1: l1?.trim() || null,
      category_l2: l2?.trim() || null,
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
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [tab, setTab] = useState('articles') // 'articles' | 'phrasebook'

  // ----- Categories (dynamic) -----
  const [categories, setCategories] = useState([])
  const [manageCats, setManageCats] = useState(false)
  const [catSheetOpen, setCatSheetOpen] = useState(false)
  const [editingCatId, setEditingCatId] = useState(null)
  const [catDraft, setCatDraft] = useState(EMPTY_CATEGORY)
  const [savingCat, setSavingCat] = useState(false)
  const [catError, setCatError] = useState(null)

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

  async function loadCategories() {
    const { data, error } = await supabase
      .from('guide_categories')
      .select('id, label_th, label_en, label_zh, icon, color, layout, sort_order, is_active')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .order('sort_order', { ascending: true })
    if (!error) setCategories(data ?? [])
  }

  async function loadArticles() {
    setLoadingArticles(true)
    const [articlesRes, itemsRes, catsRes] = await Promise.all([
      supabase
        .from('guide_articles')
        .select('id, category_id, title, body, source_url, maps_url, province, image_url, itinerary_item_id, sort_order, is_published, is_featured')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('sort_order', { ascending: true }),
      supabase
        .from('itinerary_items')
        .select('id, day_number, scheduled_time, title')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('day_number', { ascending: true })
        .order('sort_order', { ascending: true }),
      supabase
        .from('guide_categories')
        .select('id, label_th, label_en, label_zh, icon, color, layout, sort_order, is_active')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('sort_order', { ascending: true }),
    ])

    if (!articlesRes.error) setArticles(articlesRes.data ?? [])
    if (!itemsRes.error) setItineraryItems(itemsRes.data ?? [])
    if (!catsRes.error) setCategories(catsRes.data ?? [])
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'guide_categories', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadCategories()
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
      const key = a.category_id ?? '__uncat__'
      if (!groups[key]) groups[key] = []
      groups[key].push(a)
    }
    return groups
  }, [articles])

  function openNewArticle(categoryId) {
    setEditingArticleId(null)
    setArticleDraft({
      ...EMPTY_ARTICLE,
      category_id: categoryId ?? categories[0]?.id ?? '',
    })
    setArticlePhotoFile(null)
    setArticlePhotoPreview(null)
    setArticleError(null)
    setArticleSheetOpen(true)
  }

  function openEditArticle(article) {
    setEditingArticleId(article.id)
    const linkedLocation = itineraryItemById[article.itinerary_item_id]?.location_name ?? ''
    setArticleDraft({
      category_id: article.category_id ?? '',
      title: article.title,
      body: article.body ?? '',
      source_url: article.source_url ?? '',
      maps_url: article.maps_url ?? '',
      province: article.province ?? guessProvinceFromText(`${article.title} ${linkedLocation}`) ?? '',
      itinerary_item_id: article.itinerary_item_id ?? '',
      is_published: article.is_published,
      is_featured: article.is_featured ?? false,
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
        category_id: articleDraft.category_id || null,
        title: articleDraft.title.trim(),
        body: articleDraft.body.trim() || null,
        source_url: articleDraft.source_url.trim() || null,
        maps_url: articleDraft.maps_url.trim() || null,
        province: articleDraft.province.trim() || null,
        image_url: imageUrl,
        itinerary_item_id: articleDraft.itinerary_item_id || null,
        is_published: articleDraft.is_published,
        is_featured: articleDraft.is_featured,
      }

      let saveResult
      if (editingArticleId) {
        saveResult = await supabase.from('guide_articles').update(payload).eq('id', editingArticleId)
      } else {
        const catItems = articlesByCategory[payload.category_id ?? '__uncat__'] ?? []
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

  // สลับลำดับบทความภายในหมวดเดียวกัน (สลับ sort_order กับตัวข้างเคียง) — เหมือน moveCategory
  async function moveArticle(article, dir) {
    const key = article.category_id ?? '__uncat__'
    const group = articlesByCategory[key] ?? []
    const idx = group.findIndex((a) => a.id === article.id)
    const swapWith = group[idx + dir]
    if (!swapWith) return

    setArticles((prev) =>
      prev.map((a) => {
        if (a.id === article.id) return { ...a, sort_order: swapWith.sort_order }
        if (a.id === swapWith.id) return { ...a, sort_order: article.sort_order }
        return a
      })
    )
    await Promise.all([
      supabase.from('guide_articles').update({ sort_order: swapWith.sort_order }).eq('id', article.id),
      supabase.from('guide_articles').update({ sort_order: article.sort_order }).eq('id', swapWith.id),
    ])
    loadArticles()
  }

  // จัดเรียงบทความในหมวดเดียวกันอัตโนมัติ ตามพิกัดที่แกะได้จากลิงก์ Google Maps (nearest-neighbor)
  // บทความที่ไม่มีพิกัด (ไม่มีลิงก์ หรือลิงก์แบบย่อที่แกะพิกัดไม่ได้) จะถูกเลื่อนไปต่อท้าย โดยคงลำดับเดิมของกันเอง
  async function autoArrangeCategory(categoryKey) {
    const items = articlesByCategory[categoryKey] ?? []
    const withCoords = []
    const withoutCoords = []
    for (const a of items) {
      const point = parseLatLngFromMapsUrl(a.maps_url)
      if (point) withCoords.push({ ...a, _point: point })
      else withoutCoords.push(a)
    }

    if (withCoords.length < 2) {
      window.alert(t('staff.guideBuilder.autoArrangeNeedCoords'))
      return
    }

    const ordered = nearestNeighborOrder(withCoords, (a) => a._point)
    const finalOrder = [...ordered, ...withoutCoords]
    const baseSort = Math.min(...items.map((a) => a.sort_order ?? 0))
    const updates = finalOrder.map((a, i) => ({ id: a.id, sort_order: baseSort + i }))

    setArticles((prev) => {
      const nextSortById = new Map(updates.map((u) => [u.id, u.sort_order]))
      return prev.map((a) => (nextSortById.has(a.id) ? { ...a, sort_order: nextSortById.get(a.id) } : a))
    })

    await Promise.all(
      updates.map((u) =>
        supabase.from('guide_articles').update({ sort_order: u.sort_order }).eq('id', u.id)
      )
    )
    loadArticles()
  }

  // ----- Category management -----
  function openNewCategory() {
    setEditingCatId(null)
    setCatDraft(EMPTY_CATEGORY)
    setCatError(null)
    setCatSheetOpen(true)
  }

  function openEditCategory(cat) {
    setEditingCatId(cat.id)
    setCatDraft({
      label_th: cat.label_th ?? '',
      label_en: cat.label_en ?? '',
      label_zh: cat.label_zh ?? '',
      icon: cat.icon ?? 'book',
      color: cat.color ?? 'blue',
      layout: cat.layout ?? 'list',
    })
    setCatError(null)
    setCatSheetOpen(true)
  }

  async function saveCategory() {
    if (!catDraft.label_th.trim()) return
    setSavingCat(true)
    setCatError(null)

    const payload = {
      tour_id: ACTIVE_TOUR_ID,
      label_th: catDraft.label_th.trim(),
      label_en: catDraft.label_en.trim() || null,
      label_zh: catDraft.label_zh.trim() || null,
      icon: catDraft.icon,
      color: catDraft.color,
      layout: catDraft.layout,
    }

    let result
    if (editingCatId) {
      result = await supabase.from('guide_categories').update(payload).eq('id', editingCatId)
    } else {
      const maxSort = categories.reduce((max, c) => Math.max(max, c.sort_order ?? 0), 0)
      result = await supabase.from('guide_categories').insert({ ...payload, sort_order: maxSort + 1 })
    }

    if (result.error) {
      console.error('[GuideBuilder] save category failed', result.error)
      setCatError(result.error.message ?? t('common.error'))
    } else {
      setCatSheetOpen(false)
      loadCategories()
    }
    setSavingCat(false)
  }

  async function toggleCategoryActive(cat) {
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, is_active: !c.is_active } : c)))
    const { error } = await supabase
      .from('guide_categories')
      .update({ is_active: !cat.is_active })
      .eq('id', cat.id)
    if (error) loadCategories()
  }

  async function moveCategory(cat, dir) {
    const idx = categories.findIndex((c) => c.id === cat.id)
    const swapWith = categories[idx + dir]
    if (!swapWith) return
    // สลับ sort_order กัน
    setCategories((prev) => {
      const next = [...prev]
      const a = { ...next[idx], sort_order: swapWith.sort_order }
      const b = { ...next[idx + dir], sort_order: cat.sort_order }
      next[idx] = a
      next[idx + dir] = b
      return next.sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
    })
    await Promise.all([
      supabase.from('guide_categories').update({ sort_order: swapWith.sort_order }).eq('id', cat.id),
      supabase.from('guide_categories').update({ sort_order: cat.sort_order }).eq('id', swapWith.id),
    ])
    loadCategories()
  }

  async function deleteCategory(cat) {
    const count = (articlesByCategory[cat.id] ?? []).length
    if (count > 0) {
      window.alert(t('staff.guideBuilder.catHasArticles', { count }))
      return
    }
    const confirmed = window.confirm(
      t('staff.guideBuilder.confirmDeleteCategory', { title: catLabel(cat, lang) })
    )
    if (!confirmed) return
    const { error } = await supabase.from('guide_categories').delete().eq('id', cat.id)
    if (!error) setCategories((prev) => prev.filter((c) => c.id !== cat.id))
  }

  // ----- Phrasebook -----
  const [phrases, setPhrases] = useState([])
  const [loadingPhrases, setLoadingPhrases] = useState(true)
  const [phraseSheetOpen, setPhraseSheetOpen] = useState(false)
  const [editingPhraseId, setEditingPhraseId] = useState(null)
  const [phraseDraft, setPhraseDraft] = useState(EMPTY_PHRASE)
  const [savingPhrase, setSavingPhrase] = useState(false)
  const [phraseError, setPhraseError] = useState(null)
  const [expandedPhraseGroups, setExpandedPhraseGroups] = useState(() => new Set())
  const [phraseSelectMode, setPhraseSelectMode] = useState(false)
  const [selectedPhraseIds, setSelectedPhraseIds] = useState(() => new Set())
  const [assignSheetOpen, setAssignSheetOpen] = useState(false)
  const [assignItineraryId, setAssignItineraryId] = useState('')
  const [assignPlaceLabel, setAssignPlaceLabel] = useState('')
  const [assigning, setAssigning] = useState(false)

  function togglePhraseGroup(label) {
    setExpandedPhraseGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  function togglePhraseSelect(id) {
    setSelectedPhraseIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setPhraseSelectMode(false)
    setSelectedPhraseIds(new Set())
  }

  function openAssignPlace() {
    if (selectedPhraseIds.size === 0) return
    setAssignItineraryId('')
    setAssignPlaceLabel('')
    setAssignSheetOpen(true)
  }

  async function applyAssignPlace() {
    const ids = [...selectedPhraseIds]
    if (ids.length === 0) return
    setAssigning(true)
    // ผูกกับกำหนดการ -> ล้าง place_label; ไม่ผูก -> ใช้ place_label ที่ระบุ
    const patch = assignItineraryId
      ? { itinerary_item_id: assignItineraryId, place_label: null }
      : { itinerary_item_id: null, place_label: assignPlaceLabel.trim() || null }
    const { error } = await supabase.from('phrasebook_entries').update(patch).in('id', ids)
    if (!error) {
      setAssignSheetOpen(false)
      exitSelectMode()
      loadPhrases()
    } else {
      console.error('[GuideBuilder] bulk assign place failed', error)
    }
    setAssigning(false)
  }

  async function bulkDeletePhrases() {
    const ids = [...selectedPhraseIds]
    if (ids.length === 0) return
    const confirmed = window.confirm(t('staff.guideBuilder.confirmBulkDeletePhrases', { count: ids.length }))
    if (!confirmed) return
    const { error } = await supabase.from('phrasebook_entries').delete().in('id', ids)
    if (!error) {
      setPhrases((prev) => prev.filter((p) => !selectedPhraseIds.has(p.id)))
      exitSelectMode()
    } else {
      console.error('[GuideBuilder] bulk delete phrases failed', error)
      loadPhrases()
    }
  }

  // ----- Import คำศัพท์เป็นชุด (CSV/TSV) -----
  const [importSheetOpen, setImportSheetOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState(null)
  const [importResult, setImportResult] = useState(null)

  async function loadPhrases() {
    setLoadingPhrases(true)
    const [phrasesRes, itemsRes] = await Promise.all([
      supabase
        .from('phrasebook_entries')
        .select('id, category_l1, category_l2, phrase, place_label, itinerary_item_id, translation_zh, pronunciation_zh, translation_en, sort_order')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('sort_order', { ascending: true }),
      supabase
        .from('itinerary_items')
        .select('id, day_number, scheduled_time, title, location_name')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('day_number', { ascending: true })
        .order('sort_order', { ascending: true }),
    ])

    if (!phrasesRes.error) setPhrases(phrasesRes.data ?? [])
    if (!itemsRes.error) setItineraryItems(itemsRes.data ?? [])
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

  const [phraseSearch, setPhraseSearch] = useState('')
  const [phraseFilter, setPhraseFilter] = useState('all') // 'all' | 'missing_en' | 'unlinked'

  // ป้ายชื่อสถานที่ของคำ (จากกำหนดการ ถ้าผูก ไม่งั้นใช้ place_label)
  function phrasePlaceLabel(p) {
    if (p.itinerary_item_id && itineraryItemById[p.itinerary_item_id]) {
      const it = itineraryItemById[p.itinerary_item_id]
      return it.location_name || it.title || t('staff.guideBuilder.generalGroup')
    }
    return p.place_label || t('staff.guideBuilder.generalGroup')
  }

  // รายชื่อสถานที่ (place_label) ที่เคยใช้ — สำหรับ datalist
  const knownPlaces = useMemo(() => {
    const seen = new Set()
    for (const p of phrases) if (p.place_label) seen.add(p.place_label)
    return [...seen]
  }, [phrases])

  const phraseCat1Options = useMemo(() => {
    const seen = new Set(PHRASE_CAT1_PRESETS)
    for (const p of phrases) if (p.category_l1) seen.add(p.category_l1)
    return [...seen]
  }, [phrases])

  const phraseCat2Options = useMemo(() => {
    const seen = new Set(PHRASE_CAT2_PRESETS)
    for (const p of phrases) if (p.category_l2) seen.add(p.category_l2)
    return [...seen]
  }, [phrases])

  // จัดกลุ่มตามสถานที่ + กรอง/ค้นหา + เก็บสถานะผูกกำหนดการ (เรียงกลุ่มในกำหนดการขึ้นบน)
  const phraseGroups = useMemo(() => {
    const q = phraseSearch.trim().toLowerCase()
    const groups = new Map() // label -> { items, linked, day, time }
    for (const p of phrases) {
      if (phraseFilter === 'missing_en' && p.translation_en) continue
      if (phraseFilter === 'unlinked' && p.itinerary_item_id) continue
      if (q) {
        const hay = [
          p.phrase,
          p.translation_zh,
          p.pronunciation_zh,
          p.translation_en,
          p.place_label,
          p.category_l1,
          p.category_l2,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) continue
      }
      const label = phrasePlaceLabel(p)
      const it = p.itinerary_item_id ? itineraryItemById[p.itinerary_item_id] : null
      if (!groups.has(label)) {
        groups.set(label, { items: [], linked: false, day: null, time: null })
      }
      const g = groups.get(label)
      g.items.push(p)
      if (it && !g.linked) {
        g.linked = true
        g.day = it.day_number ?? null
        g.time = it.scheduled_time ?? null
      }
    }
    return [...groups.entries()]
      .map(([label, g], i) => ({ label, ...g, _i: i }))
      .sort((a, b) => {
        if (a.linked !== b.linked) return a.linked ? -1 : 1
        if (a.linked && b.linked) {
          if ((a.day ?? 0) !== (b.day ?? 0)) return (a.day ?? 0) - (b.day ?? 0)
          if ((a.time ?? '') !== (b.time ?? '')) return (a.time ?? '').localeCompare(b.time ?? '')
        }
        return a._i - b._i
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phrases, itineraryItemById, phraseSearch, phraseFilter])

  function openNewPhrase(seed) {
    setEditingPhraseId(null)
    setPhraseDraft({ ...EMPTY_PHRASE, ...(seed || {}) })
    setPhraseError(null)
    setPhraseSheetOpen(true)
  }

  function openEditPhrase(p) {
    setEditingPhraseId(p.id)
    setPhraseDraft({
      phrase: p.phrase ?? '',
      itinerary_item_id: p.itinerary_item_id ?? '',
      place_label: p.place_label ?? '',
      category_l1: p.category_l1 ?? '',
      category_l2: p.category_l2 ?? '',
      translation_zh: p.translation_zh ?? '',
      pronunciation_zh: p.pronunciation_zh ?? '',
      translation_en: p.translation_en ?? '',
    })
    setPhraseError(null)
    setPhraseSheetOpen(true)
  }

  async function savePhrase() {
    const hasTrans = phraseDraft.translation_zh.trim() || phraseDraft.translation_en.trim()
    if (!phraseDraft.phrase.trim() || !hasTrans) return
    setSavingPhrase(true)
    setPhraseError(null)

    const payload = {
      tour_id: ACTIVE_TOUR_ID,
      phrase: phraseDraft.phrase.trim(),
      itinerary_item_id: phraseDraft.itinerary_item_id || null,
      place_label: phraseDraft.place_label.trim() || null,
      category_l1: phraseDraft.category_l1.trim() || null,
      category_l2: phraseDraft.category_l2.trim() || null,
      translation_zh: phraseDraft.translation_zh.trim() || null,
      pronunciation_zh: phraseDraft.pronunciation_zh.trim() || null,
      translation_en: phraseDraft.translation_en.trim() || null,
    }

    let error
    if (editingPhraseId) {
      ;({ error } = await supabase.from('phrasebook_entries').update(payload).eq('id', editingPhraseId))
    } else {
      const maxSort = phrases.reduce((max, p) => Math.max(max, p.sort_order ?? 0), 0)
      ;({ error } = await supabase.from('phrasebook_entries').insert({ ...payload, sort_order: maxSort + 1 }))
    }

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

    let sortCounter = phrases.reduce((max, p) => Math.max(max, p.sort_order ?? 0), 0)

    const payload = rows.map((r) => {
      sortCounter += 1
      return {
        tour_id: ACTIVE_TOUR_ID,
        phrase: r.phrase,
        place_label: r.place_label,
        category_l1: r.category_l1,
        category_l2: r.category_l2,
        translation_zh: r.translation_zh,
        pronunciation_zh: r.pronunciation_zh,
        translation_en: r.translation_en,
        sort_order: sortCounter,
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

            {/* จัดการหมวดหมู่ */}
            {!loadingArticles && (
              <div className="mb-4 rounded-xl border border-gray-200 bg-white">
                <button
                  type="button"
                  onClick={() => setManageCats((v) => !v)}
                  aria-expanded={manageCats}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold text-gray-700"
                >
                  <span className="flex items-center gap-1.5">
                    <Icon name="settings" size={16} />
                    {t('staff.guideBuilder.manageCategories')}
                    <span className="font-normal text-gray-400">({categories.length})</span>
                  </span>
                  <svg
                    className={`h-4 w-4 transition-transform ${manageCats ? '' : '-rotate-90'}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {manageCats && (
                  <div className="border-t border-gray-100 p-3">
                    <div className="flex flex-col gap-2">
                      {categories.map((cat, idx) => {
                        const col = catColor(cat.color)
                        const count = (articlesByCategory[cat.id] ?? []).length
                        return (
                          <div
                            key={cat.id}
                            className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-2"
                            style={{ borderLeft: `3px solid ${col.border}`, opacity: cat.is_active ? 1 : 0.55 }}
                          >
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                              style={{ background: col.tint, color: col.text }}
                            >
                              <Icon name={cat.icon} size={18} color={col.text} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-gray-800">{catLabel(cat, lang)}</p>
                              <p className="text-xs text-gray-400">
                                {t(`staff.guideBuilder.layout.${cat.layout}`)} · {count} {t('staff.guideBuilder.articlesUnit')}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                onClick={() => moveCategory(cat, -1)}
                                disabled={idx === 0}
                                className="rounded p-1 text-gray-400 disabled:opacity-30"
                                aria-label={t('staff.guideBuilder.moveUp')}
                              >▲</button>
                              <button
                                onClick={() => moveCategory(cat, 1)}
                                disabled={idx === categories.length - 1}
                                className="rounded p-1 text-gray-400 disabled:opacity-30"
                                aria-label={t('staff.guideBuilder.moveDown')}
                              >▼</button>
                              <button
                                onClick={() => toggleCategoryActive(cat)}
                                className="rounded p-1 text-gray-500"
                                aria-label={t('staff.guideBuilder.toggleActive')}
                              >
                                <Icon name={cat.is_active ? 'check' : 'lock'} size={16} />
                              </button>
                              <button
                                onClick={() => openEditCategory(cat)}
                                className="rounded p-1 text-sky-600"
                                aria-label={t('staff.itineraryBuilder.edit')}
                              >
                                <Icon name="edit" size={16} />
                              </button>
                              <button
                                onClick={() => deleteCategory(cat)}
                                className="rounded p-1 text-red-400"
                                aria-label={t('staff.guideBuilder.deleteCategory')}
                              >
                                <Icon name="trash" size={16} />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <button
                      onClick={openNewCategory}
                      className="mt-2 w-full rounded-lg border border-dashed border-sky-300 px-3 py-2 text-sm font-semibold text-sky-600 hover:border-sky-400"
                    >
                      + {t('staff.guideBuilder.addCategory')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {!loadingArticles &&
              [...categories, null].map((cat) => {
                const key = cat ? cat.id : '__uncat__'
                const items = articlesByCategory[key] ?? []
                if (!cat && items.length === 0) return null
                const col = cat ? catColor(cat.color) : catColor('gray')
                return (
                  <div key={key} className="mb-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase" style={{ color: col.text }}>
                        {cat ? <Icon name={cat.icon} size={15} color={col.text} /> : null}
                        {cat ? catLabel(cat, lang) : t('staff.guideBuilder.uncategorized')}
                        <span className="font-normal text-gray-300">({items.length})</span>
                      </p>
                      <div className="flex shrink-0 items-center gap-3">
                        {items.length >= 2 && (
                          <button
                            onClick={() => autoArrangeCategory(key)}
                            title={t('staff.guideBuilder.autoArrangeHint')}
                            className="text-xs font-semibold text-emerald-600"
                          >
                            📍 {t('staff.guideBuilder.autoArrange')}
                          </button>
                        )}
                        {cat && (
                          <button
                            onClick={() => openNewArticle(cat.id)}
                            className="text-xs font-semibold text-sky-600"
                          >
                            + {t('staff.guideBuilder.addArticle')}
                          </button>
                        )}
                      </div>
                    </div>

                    {items.length === 0 && (
                      <p className="text-sm text-gray-400">{t('staff.guideBuilder.noArticles')}</p>
                    )}

                    <div className="flex flex-col gap-2">
                      {items.map((article, idx) => (
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
                              <p className="truncate font-semibold text-gray-900">
                                {article.is_featured && <span className="mr-1 text-amber-500">★</span>}
                                {article.title}
                              </p>
                              {article.province && (
                                <span className="mt-0.5 inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                                  <Icon name="location" size={9} /> {article.province}
                                </span>
                              )}
                              {article.itinerary_item_id && itineraryItemById[article.itinerary_item_id] && (
                                <p className="truncate text-xs text-sky-600">
                                  {itineraryItemLabel(itineraryItemById[article.itinerary_item_id])}
                                </p>
                              )}
                              {article.maps_url && (
                                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-emerald-600">
                                  <Icon name="navigation" size={12} /> {t('staff.guideBuilder.articleMapsUrl')}
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
                          <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => moveArticle(article, -1)}
                                disabled={idx === 0}
                                className="rounded p-1 text-gray-400 disabled:opacity-30"
                                aria-label={t('staff.guideBuilder.moveUp')}
                              >▲</button>
                              <button
                                onClick={() => moveArticle(article, 1)}
                                disabled={idx === items.length - 1}
                                className="rounded p-1 text-gray-400 disabled:opacity-30"
                                aria-label={t('staff.guideBuilder.moveDown')}
                              >▼</button>
                            </div>
                            <div className="flex gap-3">
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
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                )
              })}
          </>
        )}

        {tab === 'phrasebook' && (
          <>
            {!phraseSelectMode ? (
              <div className="mb-3 flex gap-2">
                <button
                  onClick={() => openNewPhrase()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-accent bg-accent-bg px-4 py-2.5 text-sm font-semibold text-accent-text"
                >
                  <span aria-hidden="true">＋</span> {t('staff.guideBuilder.addPhrase')}
                </button>
                <button
                  onClick={openImportSheet}
                  className="flex flex-1 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:border-gray-300"
                >
                  {t('staff.guideBuilder.importPhrases')}
                </button>
                {phrases.length > 0 && (
                  <button
                    onClick={() => setPhraseSelectMode(true)}
                    className="flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-gray-500 hover:border-gray-300"
                    title={t('staff.guideBuilder.selectToDelete')}
                    aria-label={t('staff.guideBuilder.selectToDelete')}
                  >
                    <Icon name="check" size={18} />
                  </button>
                )}
              </div>
            ) : (
              <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 shadow-sm">
                <span className="text-sm font-semibold text-sky-800">
                  {t('staff.guideBuilder.selectedCount', { count: selectedPhraseIds.size })}
                </span>
                <button
                  onClick={() => setSelectedPhraseIds(new Set(phrases.map((p) => p.id)))}
                  className="ml-auto text-xs font-semibold text-sky-600"
                >
                  {t('staff.guideBuilder.selectAll')}
                </button>
                <button
                  onClick={openAssignPlace}
                  disabled={selectedPhraseIds.size === 0}
                  className="rounded-lg border border-sky-400 px-3 py-1.5 text-xs font-semibold text-sky-700 disabled:opacity-40"
                >
                  📍 {t('staff.guideBuilder.assignPlace')}
                </button>
                <button
                  onClick={bulkDeletePhrases}
                  disabled={selectedPhraseIds.size === 0}
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {t('staff.guideBuilder.deleteSelected')}
                </button>
                <button onClick={exitSelectMode} className="text-xs font-medium text-gray-500">
                  {t('common.cancel')}
                </button>
              </div>
            )}

            {/* ค้นหา + ตัวกรอง */}
            {!phraseSelectMode && phrases.length > 0 && (
              <>
                <input
                  type="text"
                  value={phraseSearch}
                  onChange={(e) => setPhraseSearch(e.target.value)}
                  placeholder={t('staff.guideBuilder.searchPhrases')}
                  className="mb-2.5 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-sky-400 focus:outline-none"
                />
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {[
                    ['all', t('staff.guideBuilder.filterAllPhrases')],
                    ['missing_en', t('staff.guideBuilder.filterMissingEn')],
                    ['unlinked', t('staff.guideBuilder.filterUnlinked')],
                  ].map(([key, labelText]) => (
                    <button
                      key={key}
                      onClick={() => setPhraseFilter(key)}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                        phraseFilter === key
                          ? key === 'all'
                            ? 'bg-sky-600 text-white'
                            : 'bg-amber-100 text-amber-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {labelText}
                    </button>
                  ))}
                </div>
              </>
            )}

            {loadingPhrases && <p className="text-gray-500">{t('common.loading')}</p>}

            {!loadingPhrases && phraseGroups.length === 0 && (
              <p className="text-sm text-gray-400">{t('staff.guideBuilder.noPhrases')}</p>
            )}

            {!loadingPhrases &&
              phraseGroups.map((group) => {
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
                    className={`mb-2.5 overflow-hidden rounded-xl border ${
                      linked ? 'border-sky-200' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 px-2.5 py-2.5">
                      <button
                        type="button"
                        onClick={() => togglePhraseGroup(label)}
                        aria-expanded={isOpen}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                            linked ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          <Icon name={linked ? 'calendar' : 'location'} size={16} color="currentColor" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-gray-800">{label}</span>
                            <span className="shrink-0 text-xs font-normal text-gray-400">({items.length})</span>
                          </span>
                          <span
                            className={`mt-0.5 block text-[11px] font-medium ${
                              linked ? 'text-sky-600' : 'text-amber-600'
                            }`}
                          >
                            {linked ? timeText : t('staff.guideBuilder.notLinkedYet')}
                          </span>
                        </span>
                        <svg
                          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${
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
                      {phraseSelectMode && (
                        <button
                          onClick={() =>
                            setSelectedPhraseIds((prev) => {
                              const next = new Set(prev)
                              const allSel = items.every((p) => next.has(p.id))
                              items.forEach((p) => (allSel ? next.delete(p.id) : next.add(p.id)))
                              return next
                            })
                          }
                          className="shrink-0 text-xs font-semibold text-sky-600"
                        >
                          {t('staff.guideBuilder.selectGroup')}
                        </button>
                      )}
                    </div>

                    {isOpen &&
                      items.map((phrase) => {
                        const selected = selectedPhraseIds.has(phrase.id)
                        const chipText = [phrase.category_l1, phrase.category_l2].filter(Boolean).join(' › ')
                        const chip = chipText ? tagColor(phrase.category_l1 || phrase.category_l2) : null
                        return (
                          <div
                            key={phrase.id}
                            onClick={phraseSelectMode ? () => togglePhraseSelect(phrase.id) : undefined}
                            className={`flex items-start gap-2 border-t border-gray-100 px-3 py-2.5 ${
                              phraseSelectMode ? 'cursor-pointer' : ''
                            } ${selected ? 'bg-sky-50' : ''}`}
                          >
                            {phraseSelectMode && (
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => togglePhraseSelect(phrase.id)}
                                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-sky-600"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900">{phrase.phrase}</p>
                              {phrase.translation_zh && (
                                <p className="mt-0.5 text-xs">
                                  <span className="font-medium text-sky-700">{phrase.translation_zh}</span>
                                  {phrase.pronunciation_zh && (
                                    <span className="text-gray-400"> · {phrase.pronunciation_zh}</span>
                                  )}
                                </p>
                              )}
                              {phrase.translation_en ? (
                                <p className="mt-0.5 text-xs text-gray-600">{phrase.translation_en}</p>
                              ) : (
                                !phraseSelectMode && (
                                  <button
                                    onClick={() => openEditPhrase(phrase)}
                                    className="mt-0.5 text-xs italic text-gray-400 hover:text-sky-600"
                                  >
                                    + {t('staff.guideBuilder.addEnglish')}
                                  </button>
                                )
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              {chip && (
                                <span
                                  className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
                                  style={{ background: chip.tint, color: chip.text }}
                                >
                                  {chipText}
                                </span>
                              )}
                              {!phraseSelectMode && (
                                <span className="flex gap-2.5">
                                  <button onClick={() => openEditPhrase(phrase)} aria-label={t('staff.itineraryBuilder.edit')}>
                                    <Icon name="edit" size={16} color="#0891b2" />
                                  </button>
                                  <button onClick={() => deletePhrase(phrase)} aria-label={t('staff.guideBuilder.deletePhrase')}>
                                    <Icon name="trash" size={16} color="#dc2626" />
                                  </button>
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
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
            options={categories.map((c) => ({ value: c.id, label: catLabel(c, lang) }))}
            value={articleDraft.category_id}
            onChange={(e) => setArticleDraft((prev) => ({ ...prev, category_id: e.target.value }))}
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

          <TextField
            label={t('staff.guideBuilder.articleMapsUrl')}
            type="url"
            placeholder="https://maps.google.com/..."
            value={articleDraft.maps_url}
            onChange={(e) => setArticleDraft((prev) => ({ ...prev, maps_url: e.target.value }))}
          />

          <div>
            <TextField
              label={t('staff.guideBuilder.articleProvince')}
              list="province-options"
              placeholder={t('staff.guideBuilder.articleProvincePlaceholder')}
              value={articleDraft.province}
              onChange={(e) => setArticleDraft((prev) => ({ ...prev, province: e.target.value }))}
            />
            <datalist id="province-options">
              {THAI_PROVINCES.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

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
            onChange={(e) => {
              const val = e.target.value
              setArticleDraft((prev) => {
                if (prev.province) return { ...prev, itinerary_item_id: val }
                const linkedLocation = itineraryItemById[val]?.location_name ?? ''
                const guessed = guessProvinceFromText(`${prev.title} ${linkedLocation}`)
                return { ...prev, itinerary_item_id: val, province: guessed ?? prev.province }
              })
            }}
          />

          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={articleDraft.is_featured}
              onChange={(e) => setArticleDraft((prev) => ({ ...prev, is_featured: e.target.checked }))}
              className="h-5 w-5 rounded border-gray-300 text-brand focus:ring-brand-light"
            />
            <span className="text-sm font-medium text-neutral-text">
              ★ {t('staff.guideBuilder.featuredArticle')}
            </span>
          </label>
          <p className="-mt-1.5 text-xs text-gray-400">{t('staff.guideBuilder.featuredHint')}</p>

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
        open={catSheetOpen}
        onClose={() => setCatSheetOpen(false)}
        title={editingCatId ? t('staff.guideBuilder.editCategory') : t('staff.guideBuilder.addCategory')}
      >
        <div className="flex flex-col gap-3">
          <TextField
            label={t('staff.guideBuilder.catLabelTh')}
            required
            value={catDraft.label_th}
            onChange={(e) => setCatDraft((prev) => ({ ...prev, label_th: e.target.value }))}
          />
          <TextField
            label={t('staff.guideBuilder.catLabelEn')}
            value={catDraft.label_en}
            onChange={(e) => setCatDraft((prev) => ({ ...prev, label_en: e.target.value }))}
          />
          <TextField
            label={t('staff.guideBuilder.catLabelZh')}
            value={catDraft.label_zh}
            onChange={(e) => setCatDraft((prev) => ({ ...prev, label_zh: e.target.value }))}
          />

          <div>
            <p className="mb-1.5 text-sm font-semibold text-neutral-text">{t('staff.guideBuilder.catIcon')}</p>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_ICON_CHOICES.map((ic) => {
                const active = catDraft.icon === ic
                const col = catColor(catDraft.color)
                return (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setCatDraft((prev) => ({ ...prev, icon: ic }))}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
                      active ? 'border-2' : 'border-gray-200'
                    }`}
                    style={active ? { borderColor: col.border, background: col.tint } : {}}
                    aria-label={ic}
                  >
                    <Icon name={ic} size={20} color={active ? col.text : '#6b7280'} />
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-semibold text-neutral-text">{t('staff.guideBuilder.catColor')}</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLOR_KEYS.map((ck) => {
                const col = catColor(ck)
                const active = catDraft.color === ck
                return (
                  <button
                    key={ck}
                    type="button"
                    onClick={() => setCatDraft((prev) => ({ ...prev, color: ck }))}
                    className={`h-8 w-8 rounded-full border-2 ${active ? '' : 'border-transparent'}`}
                    style={{ background: col.border, boxShadow: active ? `0 0 0 2px #fff, 0 0 0 4px ${col.border}` : 'none' }}
                    aria-label={ck}
                  />
                )
              })}
            </div>
          </div>

          <SelectField
            label={t('staff.guideBuilder.catLayout')}
            options={CATEGORY_LAYOUTS.map((l) => ({ value: l, label: t(`staff.guideBuilder.layout.${l}`) }))}
            value={catDraft.layout}
            onChange={(e) => setCatDraft((prev) => ({ ...prev, layout: e.target.value }))}
          />

          {catError && <p className="text-sm text-red-500">{catError}</p>}

          <Button onClick={saveCategory} disabled={savingCat || !catDraft.label_th.trim()}>
            {savingCat ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={() => setCatSheetOpen(false)} disabled={savingCat}>
            {t('common.cancel')}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={assignSheetOpen}
        onClose={() => setAssignSheetOpen(false)}
        title={t('staff.guideBuilder.assignPlace')}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-500">
            {t('staff.guideBuilder.assignPlaceHint', { count: selectedPhraseIds.size })}
          </p>
          <SelectField
            label={t('staff.guideBuilder.phrasePlaceLink')}
            options={[
              { value: '', label: t('staff.guideBuilder.phraseNoPlaceLink') },
              ...itineraryItems.map((it) => ({ value: it.id, label: itineraryItemLabel(it) })),
            ]}
            value={assignItineraryId}
            onChange={(e) => setAssignItineraryId(e.target.value)}
          />
          {!assignItineraryId && (
            <>
              <TextField
                label={t('staff.guideBuilder.phrasePlaceLabel')}
                list="assign-places"
                placeholder={t('staff.guideBuilder.phrasePlacePlaceholder')}
                value={assignPlaceLabel}
                onChange={(e) => setAssignPlaceLabel(e.target.value)}
              />
              <datalist id="assign-places">
                {knownPlaces.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </>
          )}
          <Button onClick={applyAssignPlace} disabled={assigning}>
            {assigning ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={() => setAssignSheetOpen(false)} disabled={assigning}>
            {t('common.cancel')}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={phraseSheetOpen}
        onClose={() => setPhraseSheetOpen(false)}
        title={editingPhraseId ? t('staff.itineraryBuilder.edit') : t('staff.guideBuilder.addPhrase')}
      >
        <div className="flex flex-col gap-3">
          <TextField
            label={t('staff.guideBuilder.phraseText')}
            required
            value={phraseDraft.phrase}
            onChange={(e) => setPhraseDraft((prev) => ({ ...prev, phrase: e.target.value }))}
          />

          <SelectField
            label={t('staff.guideBuilder.phrasePlaceLink')}
            options={[
              { value: '', label: t('staff.guideBuilder.phraseNoPlaceLink') },
              ...itineraryItems.map((it) => ({ value: it.id, label: itineraryItemLabel(it) })),
            ]}
            value={phraseDraft.itinerary_item_id}
            onChange={(e) => setPhraseDraft((prev) => ({ ...prev, itinerary_item_id: e.target.value }))}
          />
          {!phraseDraft.itinerary_item_id && (
            <>
              <TextField
                label={t('staff.guideBuilder.phrasePlaceLabel')}
                list="phrase-places"
                placeholder={t('staff.guideBuilder.phrasePlacePlaceholder')}
                value={phraseDraft.place_label}
                onChange={(e) => setPhraseDraft((prev) => ({ ...prev, place_label: e.target.value }))}
              />
              <datalist id="phrase-places">
                {knownPlaces.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <TextField
                label={t('staff.guideBuilder.phraseCat1')}
                list="phrase-cat1"
                placeholder={t('staff.guideBuilder.phraseCat1Placeholder')}
                value={phraseDraft.category_l1}
                onChange={(e) => setPhraseDraft((prev) => ({ ...prev, category_l1: e.target.value }))}
              />
              <datalist id="phrase-cat1">
                {phraseCat1Options.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <TextField
                label={t('staff.guideBuilder.phraseCat2')}
                list="phrase-cat2"
                placeholder={t('staff.guideBuilder.phraseCat2Placeholder')}
                value={phraseDraft.category_l2}
                onChange={(e) => setPhraseDraft((prev) => ({ ...prev, category_l2: e.target.value }))}
              />
              <datalist id="phrase-cat2">
                {phraseCat2Options.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-gray-400">{t('staff.guideBuilder.lang.zh')}</p>
            <div className="flex flex-col gap-2">
              <TextField
                label={t('staff.guideBuilder.translation')}
                value={phraseDraft.translation_zh}
                onChange={(e) => setPhraseDraft((prev) => ({ ...prev, translation_zh: e.target.value }))}
              />
              <TextField
                label={t('staff.guideBuilder.pronunciation')}
                value={phraseDraft.pronunciation_zh}
                onChange={(e) => setPhraseDraft((prev) => ({ ...prev, pronunciation_zh: e.target.value }))}
              />
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-gray-400">{t('staff.guideBuilder.lang.en')}</p>
            <TextField
              label={t('staff.guideBuilder.translation')}
              value={phraseDraft.translation_en}
              onChange={(e) => setPhraseDraft((prev) => ({ ...prev, translation_en: e.target.value }))}
            />
          </div>

          <p className="text-xs text-gray-400">{t('staff.guideBuilder.phraseTransHint')}</p>

          {phraseError && <p className="text-sm text-red-500">{phraseError}</p>}

          <Button
            onClick={savePhrase}
            disabled={
              savingPhrase ||
              !phraseDraft.phrase.trim() ||
              !(phraseDraft.translation_zh.trim() || phraseDraft.translation_en.trim())
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
          <div className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
            <p className="mb-1 font-semibold text-gray-600">{t('staff.guideBuilder.importColumns')}</p>
            <code className="block whitespace-pre-wrap break-words text-[11px] leading-relaxed text-gray-700">
              สถานที่ ⇥ คำไทย ⇥ จีน ⇥ พินอิน ⇥ อังกฤษ ⇥ หมวด L1 ⇥ หมวด L2
            </code>
          </div>

          <TextAreaField
            label={t('staff.guideBuilder.importTextareaLabel')}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            placeholder={'วัดพระแก้ว\tพระแก้วมรกต\t玉佛\tYùfó\tEmerald Buddha\tสถานที่\tวัด\nวัดพระแก้ว\tพระบรมมหาราชวัง\t大皇宫\tDà Huánggōng\tGrand Palace\tสถานที่\tพระราชวัง/วัง'}
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
