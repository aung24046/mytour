import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Button from '../../components/common/Button'
import Icon from '../../components/common/Icon'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'

const EMPTY_ITEM = {
  day_number: 1,
  scheduled_time: '',
  title: '',
  description: '',
  location_name: '',
  maps_url: '',
}

// scheduled_time in DB is "HH:MM:SS+TZ" — <input type="time"> wants "HH:MM"
function toTimeInputValue(dbTime) {
  if (!dbTime) return ''
  return dbTime.slice(0, 5)
}

export default function ItineraryBuilder() {
  const { t } = useTranslation()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [editingId, setEditingId] = useState(null) // null = not editing, 'new' = creating
  const [draft, setDraft] = useState(EMPTY_ITEM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // แท็บวันที่เลือก + รายการที่กดขยาย (จุดหมายปัจจุบันกางไว้เสมอ)
  const [activeDay, setActiveDay] = useState(null)
  const [expandedItems, setExpandedItems] = useState({})
  const didInitDay = useRef(false)

  const toggleItem = (id) =>
    setExpandedItems((prev) => ({ ...prev, [id]: !prev[id] }))

  async function loadItems() {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('itinerary_items')
      .select('*')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .order('day_number', { ascending: true })
      .order('sort_order', { ascending: true })

    if (fetchError) {
      console.error('[ItineraryBuilder] load failed', fetchError)
      setError(t('staff.itineraryBuilder.loadError'))
    } else {
      setItems(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadItems()
  }, [])

  // แก้บั๊ก "ย้ายรายการขึ้น/ลงไม่ได้" — เดิม reduce แค่จัดกลุ่มตามวัน ไม่ได้เรียงตาม sort_order
  // ตอนกด ↑/↓ โค้ดจะสลับค่า sort_order ของ 2 รายการใน state ถูกต้อง แต่ตำแหน่งใน array เดิมไม่ขยับ
  // เพราะไม่มีการ sort ใหม่ ทำให้หน้าจอไม่เปลี่ยนอะไรเลยจนกว่าจะโหลดหน้าใหม่ ต้อง sort ตาม sort_order
  // ทุกครั้งตอนจัดกลุ่ม เพื่อให้ลำดับที่แสดงตรงกับค่าจริงเสมอ
  const dayGroups = items.reduce((acc, item) => {
    const day = item.day_number ?? 1
    acc[day] = acc[day] ? [...acc[day], item] : [item]
    return acc
  }, {})
  for (const day of Object.keys(dayGroups)) {
    dayGroups[day] = [...dayGroups[day]].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }
  const dayNumbers = Object.keys(dayGroups)
    .map(Number)
    .sort((a, b) => a - b)
  const maxDay = dayNumbers.length > 0 ? Math.max(...dayNumbers) : 1

  // วันที่มีรายการ status current (ใช้เปิดแท็บเริ่มต้น)
  const currentDay = useMemo(() => {
    const cur = items.find((it) => it.status === 'current')
    return cur ? cur.day_number ?? 1 : null
  }, [items])

  // แท็บวันที่แสดง — รวมวันใหม่ที่กำลังสร้างเข้าไปด้วย
  const displayDays = useMemo(() => {
    const set = new Set(dayNumbers)
    if (editingId === 'new') set.add(Number(draft.day_number) || 1)
    return [...set].sort((a, b) => a - b)
  }, [dayNumbers, editingId, draft.day_number])

  const dayItems = activeDay != null ? dayGroups[activeDay] ?? [] : []

  // เปิดแท็บเริ่มต้นที่วันปัจจุบัน (ไม่งั้นวันแรก) — ทำครั้งเดียวตอนโหลดเสร็จ
  useEffect(() => {
    if (loading || didInitDay.current || dayNumbers.length === 0) return
    didInitDay.current = true
    setActiveDay(currentDay ?? dayNumbers[0])
  }, [loading, dayNumbers, currentDay])

  function startCreateOnDay(day) {
    setActiveDay(day)
    startCreate(day)
  }

  function startCreate(day) {
    setDraft({ ...EMPTY_ITEM, day_number: day })
    setEditingId('new')
    setSaveError(null)
  }

  function startEdit(item) {
    setDraft({
      day_number: item.day_number ?? 1,
      scheduled_time: toTimeInputValue(item.scheduled_time),
      title: item.title ?? '',
      description: item.description ?? '',
      location_name: item.location_name ?? '',
      maps_url: item.maps_url ?? '',
    })
    setEditingId(item.id)
    setSaveError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(EMPTY_ITEM)
    setSaveError(null)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!draft.title.trim()) return

    setSaving(true)
    setSaveError(null)

    const payload = {
      tour_id: ACTIVE_TOUR_ID,
      day_number: Number(draft.day_number) || 1,
      scheduled_time: draft.scheduled_time || null,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      location_name: draft.location_name.trim() || null,
      maps_url: draft.maps_url.trim() || null,
    }

    let saveResult
    if (editingId === 'new') {
      const dayItems = dayGroups[payload.day_number] ?? []
      const maxSort = dayItems.reduce((max, it) => Math.max(max, it.sort_order ?? 0), 0)
      saveResult = await supabase
        .from('itinerary_items')
        .insert({ ...payload, sort_order: maxSort + 1, status: 'upcoming' })
    } else {
      saveResult = await supabase.from('itinerary_items').update(payload).eq('id', editingId)
    }

    if (saveResult.error) {
      console.error('[ItineraryBuilder] save failed', saveResult.error)
      setSaveError(saveResult.error.message ?? t('common.error'))
    } else {
      cancelEdit()
      loadItems()
    }
    setSaving(false)
  }

  async function deleteItem(item) {
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    const { error: deleteError } = await supabase
      .from('itinerary_items')
      .delete()
      .eq('id', item.id)
    if (deleteError) {
      console.error('[ItineraryBuilder] delete failed', deleteError)
      loadItems()
    }
  }

  async function moveWithinDay(day, index, direction) {
    const dayItems = dayGroups[day]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= dayItems.length) return

    const a = dayItems[index]
    const b = dayItems[targetIndex]

    setItems((prev) =>
      prev.map((it) => {
        if (it.id === a.id) return { ...it, sort_order: b.sort_order }
        if (it.id === b.id) return { ...it, sort_order: a.sort_order }
        return it
      })
    )

    await Promise.all([
      supabase.from('itinerary_items').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('itinerary_items').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
  }

  async function moveToDay(item, newDay) {
    if (newDay === item.day_number) return
    const targetDayItems = dayGroups[newDay] ?? []
    const maxSort = targetDayItems.reduce((max, it) => Math.max(max, it.sort_order ?? 0), 0)

    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id ? { ...it, day_number: newDay, sort_order: maxSort + 1 } : it
      )
    )

    const { error: moveError } = await supabase
      .from('itinerary_items')
      .update({ day_number: newDay, sort_order: maxSort + 1 })
      .eq('id', item.id)

    if (moveError) {
      console.error('[ItineraryBuilder] move to day failed', moveError)
      loadItems()
    }
  }

  // "เริ่มรายการนี้" — ตั้งเป็น current + auto-complete รายการก่อนหน้าในวันเดียวกัน
  async function startItem(item) {
    const dayItems = dayGroups[item.day_number] ?? []
    const priorIds = dayItems
      .filter((it) => (it.sort_order ?? 0) < (item.sort_order ?? 0) && it.status !== 'completed')
      .map((it) => it.id)

    setItems((prev) =>
      prev.map((it) => {
        if (it.id === item.id) return { ...it, status: 'current' }
        if (priorIds.includes(it.id)) return { ...it, status: 'completed' }
        return it
      })
    )

    await Promise.all([
      supabase.from('itinerary_items').update({ status: 'current' }).eq('id', item.id),
      priorIds.length > 0
        ? supabase.from('itinerary_items').update({ status: 'completed' }).in('id', priorIds)
        : Promise.resolve(),
    ])
  }

  async function markDone(item) {
    // ถ้าจบ "รายการที่กำลังทำ" → เซ็ตรายการถัดไปในวันเดียวกันเป็น current อัตโนมัติ
    const next =
      item.status === 'current'
        ? (dayGroups[item.day_number] ?? [])
            .filter((it) => (it.sort_order ?? 0) > (item.sort_order ?? 0) && it.status !== 'completed')[0] ?? null
        : null

    setItems((prev) =>
      prev.map((it) => {
        if (it.id === item.id) return { ...it, status: 'completed' }
        if (next && it.id === next.id) return { ...it, status: 'current' }
        return it
      })
    )

    const updates = [
      supabase.from('itinerary_items').update({ status: 'completed' }).eq('id', item.id),
    ]
    if (next) {
      updates.push(supabase.from('itinerary_items').update({ status: 'current' }).eq('id', next.id))
    }
    await Promise.all(updates)
  }

  async function resetToUpcoming(item) {
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: 'upcoming' } : it))
    )
    await supabase.from('itinerary_items').update({ status: 'upcoming' }).eq('id', item.id)
  }

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-md">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-ink">
          <Icon name="map" size={24} color="#0e7490" />
          {t('staff.itineraryBuilder.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t('staff.itineraryBuilder.subtitle')}</p>

        {loading && <p className="mt-4 text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-danger">{error}</p>}

        {!loading && !error && (
          <>
            {/* แท็บวัน */}
            <div className="mb-3 mt-4 flex gap-2 overflow-x-auto pb-1">
              {displayDays.map((day) => (
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
              {editingId !== 'new' && (
                <button
                  onClick={() => startCreateOnDay(maxDay + 1)}
                  className="shrink-0 rounded-pill border border-dashed border-brand/40 px-3 py-2 text-sm font-semibold text-brand"
                >
                  + {t('staff.itineraryBuilder.addDay')}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2.5">
              {editingId === 'new' && Number(draft.day_number) === activeDay && (
                <div className="rounded-[12px] border border-brand/30 bg-surface p-3 shadow-card">
                  <ItemForm
                    t={t}
                    draft={draft}
                    setDraft={setDraft}
                    onSubmit={handleSave}
                    onCancel={cancelEdit}
                    saving={saving}
                    saveError={saveError}
                    maxDay={maxDay}
                  />
                </div>
              )}

              {dayItems.map((item, index) => {
                if (editingId === item.id) {
                  return (
                    <div key={item.id} className="rounded-[12px] border border-brand/30 bg-surface p-3 shadow-card">
                      <ItemForm
                        t={t}
                        draft={draft}
                        setDraft={setDraft}
                        onSubmit={handleSave}
                        onCancel={cancelEdit}
                        saving={saving}
                        saveError={saveError}
                        maxDay={maxDay}
                      />
                    </div>
                  )
                }

                const isCurrent = item.status === 'current'
                const isDone = item.status === 'completed'
                const expanded = isCurrent || !!expandedItems[item.id]

                const header = (
                  <div className="flex items-start gap-2.5 p-3">
                    <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                      {isDone && <Icon name="check" size={14} filled color="#5dcaa5" />}
                      {isCurrent && <span className="h-2 w-2 rounded-full bg-success ring-2 ring-success/25" />}
                      <span className={`text-[13px] font-semibold ${isCurrent ? 'text-success-text' : 'text-ink-muted'}`}>
                        {toTimeInputValue(item.scheduled_time) || '—'}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">{item.title}</p>
                      {item.location_name && (
                        <p className="mt-0.5 flex items-start gap-1 text-[11px] text-ink-faint">
                          <Icon name="location" size={12} className="mt-0.5 shrink-0" />
                          <span>{item.location_name}</span>
                        </p>
                      )}
                    </div>
                    {!isCurrent && !isDone && (
                      <span className="shrink-0 rounded-pill bg-warning-bg px-2 py-0.5 text-[10px] font-semibold text-warning-text">
                        {t('staff.itineraryBuilder.status.upcoming')}
                      </span>
                    )}
                    {!isCurrent && (
                      <svg
                        viewBox="0 0 24 24"
                        className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
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
                  </div>
                )

                return (
                  <div
                    key={item.id}
                    className={`overflow-hidden rounded-[12px] border border-l-[3px] shadow-card ${
                      isCurrent
                        ? 'border-success/40 border-l-success bg-success-bg/40'
                        : isDone
                          ? `border-black/[0.06] border-l-[#9fe1cb] bg-surface ${expanded ? '' : 'opacity-60'}`
                          : 'border-black/[0.06] border-l-ink-faint/30 bg-surface'
                    }`}
                  >
                    {isCurrent ? (
                      header
                    ) : (
                      <button type="button" onClick={() => toggleItem(item.id)} className="w-full text-left">
                        {header}
                      </button>
                    )}

                    {expanded && (
                      <div className="px-3 pb-3">
                        <div className="flex gap-2">
                          {item.status !== 'current' && (
                            <button
                              onClick={() => startItem(item)}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-brand py-2 text-sm font-semibold text-white"
                            >
                              <Icon name="play" size={13} /> {t('staff.itineraryBuilder.start')}
                            </button>
                          )}
                          {item.status !== 'completed' && (
                            <button
                              onClick={() => markDone(item)}
                              className={`flex flex-1 items-center justify-center gap-1.5 rounded-control py-2 text-sm font-semibold ${
                                isCurrent ? 'bg-success text-white' : 'bg-success-bg text-success-text'
                              }`}
                            >
                              <Icon name="check" size={15} /> {t('staff.itineraryBuilder.markDone')}
                            </button>
                          )}
                          {item.status !== 'upcoming' && (
                            <button
                              onClick={() => resetToUpcoming(item)}
                              className="flex items-center justify-center rounded-control bg-surface-sunken px-3 py-2 text-ink-muted"
                              title={t('staff.itineraryBuilder.reset')}
                            >
                              <Icon name="rotate" size={15} />
                            </button>
                          )}
                        </div>

                        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-black/[0.05] pt-2.5">
                          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
                            {t('staff.itineraryBuilder.moveToDay')}
                            <select
                              value={item.day_number}
                              onChange={(e) => moveToDay(item, Number(e.target.value))}
                              className="rounded-control border border-black/10 bg-surface px-2 py-1 text-sm text-ink"
                            >
                              {Array.from({ length: maxDay + 1 }, (_, i) => i + 1).map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => moveWithinDay(activeDay, index, -1)}
                              disabled={index === 0}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-surface text-ink-muted disabled:opacity-30"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 rotate-180" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                            </button>
                            <button
                              onClick={() => moveWithinDay(activeDay, index, 1)}
                              disabled={index === dayItems.length - 1}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-surface text-ink-muted disabled:opacity-30"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>
                            </button>
                            <button
                              onClick={() => startEdit(item)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-surface text-brand"
                              title={t('staff.itineraryBuilder.edit')}
                            >
                              <Icon name="edit" size={16} />
                            </button>
                            <button
                              onClick={() => deleteItem(item)}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-danger/20 bg-danger-bg text-danger"
                              title={t('staff.formBuilder.delete')}
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {editingId !== 'new' && activeDay != null && (
                <button
                  onClick={() => startCreate(activeDay)}
                  className="rounded-[12px] border border-dashed border-brand/40 py-3 text-sm font-semibold text-brand"
                >
                  + {t('staff.itineraryBuilder.addItem')}
                </button>
              )}
            </div>

            {dayNumbers.length === 0 && editingId !== 'new' && (
              <button
                onClick={() => startCreateOnDay(1)}
                className="mt-4 w-full rounded-[12px] border border-dashed border-brand/40 py-3 text-sm font-semibold text-brand"
              >
                + {t('staff.itineraryBuilder.addItem')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ItemForm({ t, draft, setDraft, onSubmit, onCancel, saving, saveError, maxDay }) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('guest.itinerary.title')}
          </span>
          <select
            value={draft.day_number}
            onChange={(e) => setDraft((prev) => ({ ...prev, day_number: Number(e.target.value) }))}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base"
          >
            {Array.from({ length: Math.max(maxDay, draft.day_number) + 1 }, (_, i) => i + 1).map(
              (d) => (
                <option key={d} value={d}>
                  {t('guest.itinerary.day', { day: d })}
                </option>
              )
            )}
          </select>
        </label>

        <label className="w-32">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('staff.itineraryBuilder.time')}
          </span>
          <input
            type="time"
            value={draft.scheduled_time}
            onChange={(e) => setDraft((prev) => ({ ...prev, scheduled_time: e.target.value }))}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base"
          />
        </label>
      </div>

      <TextField
        label={t('staff.itineraryBuilder.itemTitle')}
        required
        value={draft.title}
        onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
      />

      <TextField
        label={t('staff.itineraryBuilder.locationName')}
        value={draft.location_name}
        onChange={(e) => setDraft((prev) => ({ ...prev, location_name: e.target.value }))}
      />

      <TextField
        label={t('staff.itineraryBuilder.mapsUrl')}
        value={draft.maps_url}
        onChange={(e) => setDraft((prev) => ({ ...prev, maps_url: e.target.value }))}
        placeholder="https://maps.google.com/..."
      />

      <TextAreaField
        label={t('guest.register.note')}
        value={draft.description}
        onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
      />

      {saveError && <p className="text-sm text-red-500">{saveError}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || !draft.title.trim()}>
          {saving ? t('guest.register.submitting') : t('common.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
