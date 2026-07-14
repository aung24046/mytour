import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId } from '../../lib/guestSession'
import { saveCache, loadCache } from '../../lib/offlineCache'
import { enqueue, getQueue, removeFromQueue } from '../../lib/offlineQueue'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import GuestNav from '../../components/common/GuestNav'
import Icon from '../../components/common/Icon'

const CACHE_KEY = 'sos_contacts'
const HOLD_MS = 2000
const CATEGORY_ORDER = ['guide', 'staff', 'government', 'hospital', 'other']
const CIRCUMFERENCE = 2 * Math.PI * 45

export default function SOS() {
  const { t } = useTranslation()
  const guestId = getGuestId()

  const [contacts, setContacts] = useState([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [usingCache, setUsingCache] = useState(false)

  const [note, setNote] = useState('')
  const [holding, setHolding] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null) // 'sent' | 'queued'
  const [pendingCount, setPendingCount] = useState(0)

  const holdTimerRef = useRef(null)
  const holdStartRef = useRef(null)
  const rafRef = useRef(null)

  async function loadContacts() {
    setLoadingContacts(true)

    const [contactsRes, guideRes] = await Promise.all([
      supabase
        .from('emergency_contacts')
        .select('id, label, phone, category, sort_order')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('staff')
        // เบอร์/ชื่อดึงสดจากลูกทัวร์ที่ลงทะเบียน (guest_id) ถ้าทีมงานคนนั้นถูกเพิ่มด้วยระบบผูกชื่อ
        // ทีมงานเก่าที่ยังไม่มี guest_id จะ fallback ไปใช้ name/phone ที่กรอกไว้ตรง ๆ
        .select('id, name, phone, guests(name, nickname, phone)')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('show_to_guest', true),
    ])

    if (contactsRes.error && guideRes.error) {
      console.error('[SOS] load contacts failed — falling back to cache', contactsRes.error, guideRes.error)
      const cached = loadCache(CACHE_KEY)
      if (cached) {
        setContacts(cached)
        setUsingCache(true)
      }
      setLoadingContacts(false)
      return
    }

    const guideContacts = (guideRes.data ?? [])
      .map((s) => {
        const g = s.guests
        const label = g ? (g.nickname ? `${g.name} (${g.nickname})` : g.name) : s.name
        return {
          id: `staff-${s.id}`,
          label,
          phone: g?.phone ?? s.phone,
          category: 'guide',
        }
      })
      .filter((c) => c.phone)

    const merged = [...guideContacts, ...(contactsRes.data ?? [])]
    setContacts(merged)
    setUsingCache(false)
    saveCache(CACHE_KEY, merged)
    setLoadingContacts(false)
  }

  function refreshPendingCount() {
    setPendingCount(getQueue().filter((a) => a.type === 'sos').length)
  }

  async function flushQueue() {
    const queue = getQueue().filter((a) => a.type === 'sos')
    for (const action of queue) {
      const { error } = await supabase.from('sos_alerts').insert({
        tour_id: ACTIVE_TOUR_ID,
        guest_id: action.guestId,
        lat: action.lat,
        lng: action.lng,
        accuracy: action.accuracy,
        note: action.note || null,
      })
      if (!error) removeFromQueue(action.id)
    }
    refreshPendingCount()
  }

  useEffect(() => {
    loadContacts()
    refreshPendingCount()
    flushQueue()

    function handleOnline() {
      flushQueue()
    }
    window.addEventListener('online', handleOnline)

    // กันเคสที่ browser ไม่ยิง event online แม่นยำ — ลองส่งซ้ำเป็นระยะ
    const retryInterval = setInterval(() => {
      if (navigator.onLine) flushQueue()
    }, 15000)

    return () => {
      window.removeEventListener('online', handleOnline)
      clearInterval(retryInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => cancelHold(), [])

  const groupedContacts = useMemo(() => {
    const groups = {}
    for (const c of contacts) {
      if (!groups[c.category]) groups[c.category] = []
      groups[c.category].push(c)
    }
    return CATEGORY_ORDER.map((category) => ({ category, items: groups[category] ?? [] })).filter(
      (g) => g.items.length > 0
    )
  }, [contacts])

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('unsupported'))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      })
    })
  }

  async function triggerSOS() {
    if (!guestId || sending) return
    setSending(true)
    setSendResult(null)

    let pos = null
    try {
      pos = await getPosition()
    } catch (err) {
      console.error('[SOS] geolocation failed — sending without coordinates', err)
    }

    const payload = {
      guestId,
      lat: pos?.coords.latitude ?? null,
      lng: pos?.coords.longitude ?? null,
      accuracy: pos?.coords.accuracy ?? null,
      note: note.trim() || null,
    }

    if (!navigator.onLine) {
      enqueue({ type: 'sos', ...payload })
      refreshPendingCount()
      setSendResult('queued')
      setSending(false)
      return
    }

    const { error } = await supabase.from('sos_alerts').insert({
      tour_id: ACTIVE_TOUR_ID,
      guest_id: payload.guestId,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      note: payload.note,
    })

    if (error) {
      console.error('[SOS] send failed — queued for retry', error)
      enqueue({ type: 'sos', ...payload })
      refreshPendingCount()
      setSendResult('queued')
    } else {
      setSendResult('sent')
    }
    setSending(false)
  }

  function startHold() {
    if (sending) return
    setHolding(true)
    holdStartRef.current = Date.now()

    function tick() {
      const elapsed = Date.now() - holdStartRef.current
      setHoldProgress(Math.min(100, (elapsed / HOLD_MS) * 100))
      if (elapsed < HOLD_MS) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    holdTimerRef.current = setTimeout(() => {
      cancelHold()
      triggerSOS()
    }, HOLD_MS)
  }

  function cancelHold() {
    setHolding(false)
    setHoldProgress(0)
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  if (!guestId) {
    return (
      <div className="min-h-screen">
        <AnnouncementBanner />
        <div className="p-4 pb-28">
          <div className="mx-auto max-w-md">
            <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
              <Icon name="alert" size={26} filled color="#dc2626" />
              {t('guest.sos.title')}
            </h1>
            <GuestNav active="sos" />
            <Card className="text-center">
              <p className="mb-3 text-ink-muted">{t('guest.sos.noSession')}</p>
              <Link to="/">
                <Button>{t('guest.register.title')}</Button>
              </Link>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
            <Icon name="alert" size={26} filled color="#dc2626" />
            {t('guest.sos.title')}
          </h1>

          <GuestNav active="sos" />

          <Card className="mb-4 text-center">
            <p className="mb-4 text-sm text-ink-muted">{t('guest.sos.holdInstruction')}</p>

            <div className="relative mx-auto flex h-40 w-40 items-center justify-center">
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="45" fill="none" stroke="#fee2e2" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE * (1 - holdProgress / 100)}
                  style={{ transition: holding ? 'none' : 'stroke-dashoffset 0.2s' }}
                />
              </svg>
              <button
                onPointerDown={startHold}
                onPointerUp={cancelHold}
                onPointerLeave={cancelHold}
                onContextMenu={(e) => e.preventDefault()}
                disabled={sending}
                className="relative flex h-32 w-32 select-none items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition active:scale-95 disabled:opacity-60"
              >
                <span className="flex flex-col items-center gap-1">
                  <Icon name="alert" size={30} color="#fff" filled />
                  <span className="text-lg font-extrabold">SOS</span>
                </span>
              </button>
            </div>

            {holding && <p className="mt-3 text-sm font-semibold text-red-600">{t('guest.sos.holding')}</p>}
            {sending && <p className="mt-3 text-sm font-semibold text-ink-muted">{t('guest.sos.sending')}</p>}

            <label className="mt-4 block text-left">
              <span className="mb-1 block text-sm font-medium text-ink-muted">{t('guest.sos.noteLabel')}</span>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('guest.sos.notePlaceholder')}
                className="w-full rounded-control border border-transparent bg-surface-sunken px-3.5 py-3 text-base text-ink shadow-inner placeholder:text-ink-faint focus:border-brand focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-light/70 transition"
              />
            </label>

            {sendResult === 'sent' && (
              <div className="mt-4 rounded-xl bg-green-50 px-3 py-2.5 text-sm font-semibold text-green-700">
                {t('guest.sos.sentBody')}
              </div>
            )}
            {sendResult === 'queued' && (
              <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800">
                {t('guest.sos.queuedBody')}
              </div>
            )}
            {pendingCount > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                {t('guest.sos.pendingSync', { count: pendingCount })}
              </p>
            )}
          </Card>

          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            {t('guest.sos.contactsTitle')}
          </h2>

          {usingCache && <p className="mb-2 text-xs text-amber-700">{t('guest.sos.offlineNotice')}</p>}
          {loadingContacts && <p className="text-ink-muted">{t('common.loading')}</p>}
          {!loadingContacts && groupedContacts.length === 0 && (
            <p className="text-sm text-ink-faint">{t('guest.sos.noContacts')}</p>
          )}

          <div className="flex flex-col gap-3">
            {groupedContacts.map((group) => (
              <div key={group.category}>
                <p className="mb-1.5 text-xs font-semibold text-ink-faint">
                  {t(`guest.sos.category.${group.category}`)}
                </p>
                <div className="flex flex-col gap-1.5">
                  {group.items.map((contact) => (
                    <a
                      key={contact.id}
                      href={`tel:${contact.phone}`}
                      className="flex items-center justify-between rounded-control bg-surface px-3.5 py-3 shadow-card ring-1 ring-black/[0.02]"
                    >
                      <span className="font-semibold text-ink">{contact.label}</span>
                      <span className="rounded-pill bg-brand-lighter px-3 py-1 text-sm font-bold text-brand">
                        {contact.phone}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
