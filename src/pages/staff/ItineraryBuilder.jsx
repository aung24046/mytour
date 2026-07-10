import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
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
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: 'completed' } : it))
    )
    await supabase.from('itinerary_items').update({ status: 'completed' }).eq('id', item.id)
  }

  async function resetToUpcoming(item) {
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: 'upcoming' } : it))
    )
    await supabase.from('itinerary_items').update({ status: 'upcoming' }).eq('id', item.id)
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">
          {t('staff.itineraryBuilder.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {t('staff.itineraryBuilder.subtitle')}
        </p>

        {loading && <p className="mt-4 text-gray-500">{t('common.loading')}</p>}
        {error && <p className="mt-4 text-red-500">{error}</p>}

        {!loading &&
          !error &&
          dayNumbers.map((day) => (
            <div key={day} className="mt-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {t('guest.itinerary.day', { day })}
              </h2>

              <div className="flex flex-col gap-2">
                {dayGroups[day].map((item, index) => (
                  <Card
                    key={item.id}
                    className={
                      item.status === 'current'
                        ? 'border-l-4 border-l-sky-500 bg-sky-50'
                        : item.status === 'completed'
                          ? 'opacity-50'
                          : ''
                    }
                  >
                    {editingId === item.id ? (
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
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            {item.scheduled_time && (
                              <p className="text-sm font-medium text-sky-600">
                                {toTimeInputValue(item.scheduled_time)}
                              </p>
                            )}
                            <p className="font-semibold text-gray-900">{item.title}</p>
                            {item.location_name && (
                              <p className="text-sm text-gray-500">{item.location_name}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => moveWithinDay(day, index, -1)}
                              disabled={index === 0}
                              className="rounded-lg bg-gray-100 px-2 py-1 text-sm disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveWithinDay(day, index, 1)}
                              disabled={index === dayGroups[day].length - 1}
                              className="rounded-lg bg-gray-100 px-2 py-1 text-sm disabled:opacity-30"
                            >
                              ↓
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              item.status === 'current'
                                ? 'bg-sky-500 text-white'
                                : item.status === 'completed'
                                  ? 'bg-gray-300 text-gray-700'
                                  : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {t(`staff.itineraryBuilder.status.${item.status}`)}
                          </span>

                          {item.status !== 'current' && (
                            <button
                              onClick={() => startItem(item)}
                              className="text-sm font-medium text-sky-600"
                            >
                              {t('staff.itineraryBuilder.start')}
                            </button>
                          )}
                          {item.status !== 'completed' && (
                            <button
                              onClick={() => markDone(item)}
                              className="text-sm font-medium text-green-600"
                            >
                              {t('staff.itineraryBuilder.markDone')}
                            </button>
                          )}
                          {item.status !== 'upcoming' && (
                            <button
                              onClick={() => resetToUpcoming(item)}
                              className="text-sm font-medium text-gray-500"
                            >
                              {t('staff.itineraryBuilder.reset')}
                            </button>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2">
                          <div className="flex items-center gap-1 text-sm text-gray-500">
                            <span>{t('staff.itineraryBuilder.moveToDay')}</span>
                            <select
                              value={item.day_number}
                              onChange={(e) => moveToDay(item, Number(e.target.value))}
                              className="rounded-lg border border-gray-300 px-1.5 py-0.5 text-sm"
                            >
                              {Array.from({ length: maxDay + 1 }, (_, i) => i + 1).map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex gap-3">
                            <button
                              onClick={() => startEdit(item)}
                              className="text-sm font-medium text-sky-600"
                            >
                              {t('staff.itineraryBuilder.edit')}
                            </button>
                            <button
                              onClick={() => deleteItem(item)}
                              className="text-sm font-medium text-red-500"
                            >
                              {t('staff.formBuilder.delete')}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </Card>
                ))}

                {editingId === 'new' && draft.day_number === day && (
                  <Card>
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
                  </Card>
                )}
              </div>

              {editingId !== 'new' && (
                <button
                  onClick={() => startCreate(day)}
                  className="mt-2 w-full rounded-xl border border-dashed border-gray-300 py-2 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
                >
                  + {t('staff.itineraryBuilder.addItem')} ({t('guest.itinerary.day', { day })})
                </button>
              )}
            </div>
          ))}

        {!loading && !error && editingId !== 'new' && (
          <button
            onClick={() => startCreate(maxDay + 1)}
            className="mt-6 w-full rounded-xl border border-dashed border-gray-300 py-2 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
          >
            + {t('staff.itineraryBuilder.addDay')}
          </button>
        )}

        {!loading && !error && items.length === 0 && editingId !== 'new' && (
          <div className="mt-4">
            <Button onClick={() => startCreate(1)}>
              {t('staff.itineraryBuilder.addItem')}
            </Button>
          </div>
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
