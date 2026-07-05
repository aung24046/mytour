import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import BottomSheet from '../../components/common/BottomSheet'
import QrScanner from '../../components/common/QrScanner'
import StatusBadge from '../../components/common/StatusBadge'

const MODES = ['generate', 'assign', 'loading', 'list']
const STATUS_FILTERS = ['all', 'unassigned', 'tagged', 'loaded', 'delivered', 'returned']

// สุ่ม tag_code สั้นๆ อ่านง่าย ไม่มีตัวที่สับสน (0/O, 1/I)
const TAG_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateTagCode() {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += TAG_CHARS[Math.floor(Math.random() * TAG_CHARS.length)]
  }
  return code
}

// บีบอัดรูปฝั่ง client ก่อนอัปโหลด — ย่อเหลือ ~800px และ quality 0.7 ตามที่ระบุในแผนงาน
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

export default function LuggageManager() {
  const { t } = useTranslation()

  const [luggage, setLuggage] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [mode, setMode] = useState('assign')

  // Tag Generator
  const [genCount, setGenCount] = useState(10)
  const [generating, setGenerating] = useState(false)

  // Assign mode
  const [assignScannerOpen, setAssignScannerOpen] = useState(false)
  const [assignTag, setAssignTag] = useState(null) // luggage row currently being assigned
  const [assignSearch, setAssignSearch] = useState('')
  const [assignGuestId, setAssignGuestId] = useState('')
  const [assignPhotoFile, setAssignPhotoFile] = useState(null)
  const [assignPhotoPreview, setAssignPhotoPreview] = useState(null)
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignError, setAssignError] = useState(null)
  const [assignFeedback, setAssignFeedback] = useState(null)
  const fileInputRef = useRef(null)

  // Loading checklist mode
  const [loadingScannerOpen, setLoadingScannerOpen] = useState(false)
  const [loadingFeedback, setLoadingFeedback] = useState(null)

  // List mode
  const [listSearch, setListSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [luggageRes, guestsRes] = await Promise.all([
      supabase
        .from('luggage')
        .select('id, tag_code, guest_id, photo_url, status, last_scanned_at, last_location_note, created_at')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('created_at', { ascending: true }),
      supabase
        .from('guests')
        .select('id, name, nickname')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('name'),
    ])

    if (luggageRes.error || guestsRes.error) {
      console.error('[LuggageManager] load failed', luggageRes.error, guestsRes.error)
      setError(t('common.error'))
      setLoading(false)
      return
    }

    setLuggage(luggageRes.data ?? [])
    setGuests(guestsRes.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()

    const channel = supabase
      .channel(`luggage-manager-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'luggage', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadAll()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const counts = useMemo(() => {
    const total = luggage.length
    const loaded = luggage.filter((l) => l.status === 'loaded' || l.status === 'delivered').length
    const unassigned = luggage.filter((l) => l.status === 'unassigned').length
    return { total, loaded, unassigned }
  }, [luggage])

  // ----- Tag Generator -----
  async function generateTags() {
    const count = Math.max(1, Math.min(500, Number(genCount) || 0))
    setGenerating(true)
    setError(null)

    try {
      const rows = []
      const usedCodes = new Set(luggage.map((l) => l.tag_code))
      for (let i = 0; i < count; i++) {
        let code = generateTagCode()
        while (usedCodes.has(code)) code = generateTagCode()
        usedCodes.add(code)
        rows.push({ tour_id: ACTIVE_TOUR_ID, tag_code: code, status: 'unassigned' })
      }

      const { error: insertError } = await supabase.from('luggage').insert(rows)
      if (insertError) throw insertError

      await loadAll()
    } catch (err) {
      console.error('[LuggageManager] generate tags failed', err)
      setError(t('common.error'))
    } finally {
      setGenerating(false)
    }
  }

  // ----- Assign mode -----
  function openAssignForTag(tagRow) {
    setAssignTag(tagRow)
    setAssignSearch('')
    setAssignGuestId(tagRow.guest_id ?? '')
    setAssignPhotoFile(null)
    setAssignPhotoPreview(null)
    setAssignError(null)
  }

  function handleAssignScan(decodedText) {
    setAssignScannerOpen(false)
    const found = luggage.find((l) => l.tag_code === decodedText)
    if (!found) {
      setAssignFeedback({ type: 'not_found' })
      return
    }
    openAssignForTag(found)
  }

  function handleAssignScanError() {
    setAssignScannerOpen(false)
    setAssignFeedback({ type: 'camera_error' })
  }

  function handlePhotoChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setAssignPhotoFile(file)
    setAssignPhotoPreview(URL.createObjectURL(file))
  }

  async function saveAssign() {
    if (!assignTag || !assignGuestId) return
    setAssignSaving(true)
    setAssignError(null)

    try {
      let photoUrl = assignTag.photo_url ?? null

      if (assignPhotoFile) {
        const compressed = await compressImage(assignPhotoFile)
        const path = `${ACTIVE_TOUR_ID}/${assignTag.tag_code}-${Date.now()}.jpg`
        const { error: uploadError } = await supabase.storage
          .from('luggage-photos')
          .upload(path, compressed, { contentType: 'image/jpeg', upsert: true })

        if (uploadError) throw uploadError

        const { data: publicUrlData } = supabase.storage.from('luggage-photos').getPublicUrl(path)
        photoUrl = publicUrlData.publicUrl
      }

      const { error: updateError } = await supabase
        .from('luggage')
        .update({
          guest_id: assignGuestId,
          photo_url: photoUrl,
          status: 'tagged',
        })
        .eq('id', assignTag.id)

      if (updateError) throw updateError

      await loadAll()
      setAssignTag(null)
    } catch (err) {
      console.error('[LuggageManager] save assign failed', err)
      setAssignError(err.message ?? t('common.error'))
    } finally {
      setAssignSaving(false)
    }
  }

  async function unassignTag(tagRow) {
    const confirmed = window.confirm(t('staff.luggageManager.confirmUnassign', { code: tagRow.tag_code }))
    if (!confirmed) return

    const { error: updateError } = await supabase
      .from('luggage')
      .update({ guest_id: null, photo_url: null, status: 'unassigned' })
      .eq('id', tagRow.id)

    if (updateError) {
      console.error('[LuggageManager] unassign failed', updateError)
      return
    }
    await loadAll()
  }

  async function deleteTag(tagRow) {
    const confirmed = window.confirm(t('staff.luggageManager.confirmDeleteTag', { code: tagRow.tag_code }))
    if (!confirmed) return

    const { error: deleteError } = await supabase.from('luggage').delete().eq('id', tagRow.id)
    if (deleteError) {
      console.error('[LuggageManager] delete tag failed', deleteError)
      return
    }
    setLuggage((prev) => prev.filter((l) => l.id !== tagRow.id))
  }

  const filteredGuestOptions = useMemo(() => {
    const q = assignSearch.trim().toLowerCase()
    if (!q) return guests
    return guests.filter(
      (g) => g.name?.toLowerCase().includes(q) || g.nickname?.toLowerCase().includes(q)
    )
  }, [guests, assignSearch])

  const unassignedTags = useMemo(() => luggage.filter((l) => l.status === 'unassigned'), [luggage])

  // ----- Loading checklist mode -----
  async function handleLoadingScan(decodedText) {
    setLoadingScannerOpen(false)
    const found = luggage.find((l) => l.tag_code === decodedText)

    if (!found) {
      setLoadingFeedback({ type: 'not_found' })
      return
    }
    if (found.status === 'unassigned') {
      setLoadingFeedback({ type: 'unassigned', code: found.tag_code })
      return
    }
    if (found.status === 'loaded' || found.status === 'delivered') {
      setLoadingFeedback({
        type: 'duplicate',
        name: guestById[found.guest_id]?.nickname || guestById[found.guest_id]?.name,
      })
      return
    }

    const { error: updateError } = await supabase
      .from('luggage')
      .update({ status: 'loaded', last_scanned_at: new Date().toISOString() })
      .eq('id', found.id)

    if (updateError) {
      console.error('[LuggageManager] loading scan update failed', updateError)
      setLoadingFeedback({ type: 'error' })
      return
    }

    setLoadingFeedback({
      type: 'success',
      name: guestById[found.guest_id]?.nickname || guestById[found.guest_id]?.name,
    })
  }

  function handleLoadingScanError() {
    setLoadingScannerOpen(false)
    setLoadingFeedback({ type: 'camera_error' })
  }

  // ----- List mode -----
  const filteredList = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    return luggage.filter((l) => {
      const guest = guestById[l.guest_id]
      const matchesSearch =
        !q ||
        l.tag_code.toLowerCase().includes(q) ||
        guest?.name?.toLowerCase().includes(q) ||
        guest?.nickname?.toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || l.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [luggage, listSearch, statusFilter, guestById])

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold text-gray-900">{t('staff.luggageManager.title')}</h1>
        <p className="mb-3 text-sm text-gray-500">
          {t('staff.luggageManager.summary', {
            total: counts.total,
            loaded: counts.loaded,
            unassigned: counts.unassigned,
          })}
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                mode === m ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {t(`staff.luggageManager.mode.${m}`)}
            </button>
          ))}
        </div>

        {loading && <p className="text-gray-500">{t('common.loading')}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && mode === 'generate' && (
          <Card>
            <p className="mb-2 text-sm font-medium text-gray-700">{t('staff.luggageManager.genLabel')}</p>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                max="500"
                value={genCount}
                onChange={(e) => setGenCount(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
              <Button onClick={generateTags} disabled={generating} className="w-auto shrink-0 px-4">
                {generating ? t('common.loading') : t('staff.luggageManager.generateButton')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-400">{t('staff.luggageManager.genHint')}</p>
          </Card>
        )}

        {!loading && !error && mode === 'assign' && (
          <div>
            <Button onClick={() => setAssignScannerOpen(true)} className="mb-3">
              {t('staff.luggageManager.scanTag')}
            </Button>

            {assignFeedback && (
              <div
                className={`mb-3 rounded-xl px-3 py-2 text-sm font-medium ${
                  assignFeedback.type === 'not_found' || assignFeedback.type === 'camera_error'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-green-100 text-green-800'
                }`}
              >
                {assignFeedback.type === 'not_found' && t('staff.luggageManager.tagNotFound')}
                {assignFeedback.type === 'camera_error' && t('staff.checkIn.scanCameraError')}
                <button onClick={() => setAssignFeedback(null)} className="ml-2 font-bold underline">
                  {t('common.close')}
                </button>
              </div>
            )}

            <p className="mb-2 text-sm font-medium text-gray-700">
              {t('staff.luggageManager.unassignedList', { count: unassignedTags.length })}
            </p>
            <div className="flex flex-col gap-2">
              {unassignedTags.length === 0 && (
                <p className="text-sm text-gray-400">{t('staff.luggageManager.noUnassigned')}</p>
              )}
              {unassignedTags.map((tag) => (
                <Card
                  key={tag.id}
                  className="flex cursor-pointer items-center justify-between"
                  onClick={() => openAssignForTag(tag)}
                >
                  <span className="font-mono text-lg font-semibold text-gray-900">{tag.tag_code}</span>
                  <span className="text-sm text-sky-600">{t('staff.luggageManager.assignThis')}</span>
                </Card>
              ))}
            </div>
          </div>
        )}

        {!loading && !error && mode === 'loading' && (
          <div>
            <Card className="mb-3 text-center">
              <p className="text-sm text-gray-500">{t('staff.luggageManager.loadingProgress')}</p>
              <p className="mt-1 text-3xl font-bold text-gray-900">
                {counts.loaded}
                <span className="text-lg font-medium text-gray-400"> / {counts.total}</span>
              </p>
              {counts.total - counts.loaded > 0 && (
                <p className="mt-1 text-sm text-amber-600">
                  {t('staff.luggageManager.missingCount', { count: counts.total - counts.loaded })}
                </p>
              )}
            </Card>

            <Button onClick={() => setLoadingScannerOpen(true)} className="mb-3">
              {t('staff.luggageManager.scanToLoad')}
            </Button>

            {loadingFeedback && (
              <div
                className={`mb-3 rounded-xl px-3 py-2 text-sm font-medium ${
                  loadingFeedback.type === 'success'
                    ? 'bg-green-100 text-green-800'
                    : loadingFeedback.type === 'duplicate' || loadingFeedback.type === 'unassigned'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-700'
                }`}
              >
                {loadingFeedback.type === 'success' &&
                  t('staff.luggageManager.loadSuccess', { name: loadingFeedback.name || '-' })}
                {loadingFeedback.type === 'duplicate' &&
                  t('staff.luggageManager.loadDuplicate', { name: loadingFeedback.name || '-' })}
                {loadingFeedback.type === 'unassigned' &&
                  t('staff.luggageManager.loadUnassigned', { code: loadingFeedback.code })}
                {loadingFeedback.type === 'not_found' && t('staff.luggageManager.tagNotFound')}
                {loadingFeedback.type === 'error' && t('common.error')}
                {loadingFeedback.type === 'camera_error' && t('staff.checkIn.scanCameraError')}
                <button onClick={() => setLoadingFeedback(null)} className="ml-2 font-bold underline">
                  {t('common.close')}
                </button>
              </div>
            )}

            {/* รายชื่อกระเป๋าที่ยังไม่โหลด แยกตามเจ้าของ ให้เช็คได้ก่อนรถออก */}
            <p className="mb-2 text-sm font-medium text-gray-700">{t('staff.luggageManager.notLoadedYet')}</p>
            <div className="flex flex-col gap-2">
              {luggage
                .filter((l) => l.status !== 'loaded' && l.status !== 'delivered' && l.status !== 'unassigned')
                .map((tag) => (
                  <Card key={tag.id} className="flex items-center justify-between">
                    <span className="font-mono text-sm text-gray-900">{tag.tag_code}</span>
                    <span className="text-sm text-gray-600">
                      {guestById[tag.guest_id]?.nickname || guestById[tag.guest_id]?.name || '-'}
                    </span>
                  </Card>
                ))}
            </div>
          </div>
        )}

        {!loading && !error && mode === 'list' && (
          <div>
            <input
              type="text"
              placeholder={t('staff.luggageManager.searchPlaceholder')}
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              className="mb-3 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />

            <div className="mb-3 flex flex-wrap gap-2">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    statusFilter === s ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {t(`staff.luggageManager.status.${s}`)}
                </button>
              ))}
            </div>

            {filteredList.length === 0 && (
              <p className="text-sm text-gray-400">{t('staff.luggageManager.noResults')}</p>
            )}

            <div className="flex flex-col gap-2">
              {filteredList.map((tag) => {
                const guest = guestById[tag.guest_id]
                return (
                  <Card key={tag.id} className="p-3">
                    <div className="flex items-center gap-3">
                      {tag.photo_url ? (
                        <img
                          src={tag.photo_url}
                          alt={tag.tag_code}
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300">
                          🧳
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold text-gray-900">{tag.tag_code}</p>
                        <p className="truncate text-xs text-gray-500">
                          {guest ? guest.nickname || guest.name : t('staff.luggageManager.status.unassigned')}
                        </p>
                      </div>
                      <StatusBadge
                        tone={
                          tag.status === 'unassigned'
                            ? 'neutral'
                            : tag.status === 'loaded' || tag.status === 'delivered'
                              ? 'success'
                              : 'warning'
                        }
                        className="shrink-0"
                      >
                        {t(`staff.luggageManager.status.${tag.status}`)}
                      </StatusBadge>
                    </div>

                    <div className="mt-2 flex gap-2">
                      {tag.guest_id && (
                        <button
                          onClick={() => unassignTag(tag)}
                          className="flex-1 rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700"
                        >
                          {t('staff.luggageManager.unassignTag')}
                        </button>
                      )}
                      <button
                        onClick={() => deleteTag(tag)}
                        className="flex-1 rounded-xl bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600"
                      >
                        {t('staff.luggageManager.deleteTag')}
                      </button>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Scanner sheet: assign mode */}
      <BottomSheet
        open={assignScannerOpen}
        onClose={() => setAssignScannerOpen(false)}
        title={t('staff.luggageManager.scanTag')}
      >
        <QrScanner onScan={handleAssignScan} onError={handleAssignScanError} />
        <p className="mt-3 text-center text-sm text-gray-500">{t('staff.luggageManager.scanTagHint')}</p>
        <Button variant="secondary" className="mt-3" onClick={() => setAssignScannerOpen(false)}>
          {t('common.cancel')}
        </Button>
      </BottomSheet>

      {/* Scanner sheet: loading checklist mode */}
      <BottomSheet
        open={loadingScannerOpen}
        onClose={() => setLoadingScannerOpen(false)}
        title={t('staff.luggageManager.scanToLoad')}
      >
        <QrScanner onScan={handleLoadingScan} onError={handleLoadingScanError} />
        <p className="mt-3 text-center text-sm text-gray-500">{t('staff.luggageManager.scanToLoadHint')}</p>
        <Button variant="secondary" className="mt-3" onClick={() => setLoadingScannerOpen(false)}>
          {t('common.cancel')}
        </Button>
      </BottomSheet>

      {/* Assign form sheet */}
      <BottomSheet
        open={!!assignTag}
        onClose={() => setAssignTag(null)}
        title={assignTag ? t('staff.luggageManager.assignTitle', { code: assignTag.tag_code }) : ''}
      >
        {assignTag && (
          <div className="flex flex-col gap-3">
            <input
              type="text"
              placeholder={t('staff.luggageManager.searchGuestPlaceholder')}
              value={assignSearch}
              onChange={(e) => setAssignSearch(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />

            <div className="max-h-48 overflow-y-auto rounded-xl border border-gray-100">
              {filteredGuestOptions.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setAssignGuestId(g.id)}
                  className={`block w-full border-b border-gray-50 px-3 py-2 text-left text-sm last:border-b-0 ${
                    assignGuestId === g.id ? 'bg-sky-50 font-semibold text-sky-700' : 'text-gray-900'
                  }`}
                >
                  {g.nickname || g.name}
                  {g.nickname && <span className="ml-1 text-gray-400">({g.name})</span>}
                </button>
              ))}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-gray-400">
                {t('staff.luggageManager.photoLabel')}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl bg-gray-100 px-3 py-2.5 text-sm font-semibold text-gray-700"
              >
                {t('staff.luggageManager.takePhoto')}
              </button>
              {(assignPhotoPreview || assignTag.photo_url) && (
                <img
                  src={assignPhotoPreview || assignTag.photo_url}
                  alt="preview"
                  className="mt-2 h-32 w-full rounded-xl object-cover"
                />
              )}
            </div>

            {assignError && <p className="text-sm text-red-500">{assignError}</p>}

            <Button onClick={saveAssign} disabled={assignSaving || !assignGuestId}>
              {assignSaving ? t('common.loading') : t('common.save')}
            </Button>
            <Button variant="secondary" onClick={() => setAssignTag(null)} disabled={assignSaving}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
