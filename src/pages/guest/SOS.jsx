import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId, useTourPath } from '../../lib/TourContext'
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
const QUICK_CALL_MAX = 4

// ไอคอน/สีประจำหมวด — ต่างกันที่ "รูปทรง" ด้วย ไม่ได้ต่างแค่สี
// (คนตาบอดสีต้องแยกหมวดออกเหมือนกัน — ดูหลักการเดียวกันใน Icon.jsx)
const CATEGORY_ICON = {
  guide: 'people',
  staff: 'briefcase',
  government: 'lock',
  hospital: 'heart',
  other: 'compass',
}
const CATEGORY_TONE = {
  guide: 'bg-brand',
  staff: 'bg-brand-hover',
  government: 'bg-ink',
  hospital: 'bg-danger',
  other: 'bg-ink-muted',
}

export default function SOS() {
  const tp = useTourPath()
  const tourId = useTourId()
  const { t } = useTranslation()
  const guestId = getGuestId(tourId)

  const [contacts, setContacts] = useState([])
  const [loadingContacts, setLoadingContacts] = useState(true)
  const [usingCache, setUsingCache] = useState(false)

  const [note, setNote] = useState('')
  const [holding, setHolding] = useState(false)
  const [holdProgress, setHoldProgress] = useState(0)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null) // 'sent' | 'queued'
  const [pendingCount, setPendingCount] = useState(0)

  // มุมมองหน้าจอ — 'sos' (ปุ่มใหญ่) หรือ 'contacts' (รายชื่อแยกหมวด)
  // จงใจไม่แยกเป็นคนละ route เพราะตอนฉุกเฉินการกดย้อนกลับควรจบใน 1 แตะ
  const [view, setView] = useState('sos')
  const [query, setQuery] = useState('')

  const [online, setOnline] = useState(() => navigator.onLine)
  const [lastPos, setLastPos] = useState(null)
  const [geoState, setGeoState] = useState('searching') // searching | ready | off

  const holdTimerRef = useRef(null)
  const holdStartRef = useRef(null)
  const rafRef = useRef(null)

  async function loadContacts() {
    setLoadingContacts(true)

    const [contactsRes, guideRes] = await Promise.all([
      supabase
        .from('v_tour_emergency_contacts')
        .select('id, label, phone, category, sort_order, is_quick')
        .eq('tour_id', tourId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('v_tour_staff')
        // เบอร์/ชื่อดึงสดจากลูกทัวร์ที่ลงทะเบียน (guest_id) ถ้าทีมงานคนนั้นถูกเพิ่มด้วยระบบผูกชื่อ
        // ทีมงานเก่าที่ยังไม่มี guest_id จะ fallback ไปใช้ name/phone ที่กรอกไว้ตรง ๆ
        .select('id, name, phone, guest_name, guest_nickname, guest_phone, is_quick')
        .eq('tour_id', tourId)
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
        // v_tour_staff join guests มาให้เป็นคอลัมน์แล้ว (view ทำ embedded resource ไม่ได้)
        const label = s.guest_name
          ? s.guest_nickname
            ? `${s.guest_name} (${s.guest_nickname})`
            : s.guest_name
          : s.name
        return {
          id: `staff-${s.id}`,
          label,
          phone: s.guest_phone ?? s.phone,
          category: 'guide',
          is_quick: s.is_quick ?? false,
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
        tour_id: tourId,
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
      setOnline(true)
      flushQueue()
    }
    function handleOffline() {
      setOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // กันเคสที่ browser ไม่ยิง event online แม่นยำ — ลองส่งซ้ำเป็นระยะ
    const retryInterval = setInterval(() => {
      setOnline(navigator.onLine)
      if (navigator.onLine) flushQueue()
    }, 15000)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(retryInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // อุ่นพิกัดไว้ล่วงหน้าตั้งแต่เปิดหน้า เพื่อให้ป้ายสถานะบอกความจริง และถ้า
  // ตอนกด SOS หา GPS ไม่ทัน ยังมีพิกัดสำรองส่งไปให้ทีมงานได้
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoState('off')
      return
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLastPos(pos)
        setGeoState('ready')
      },
      (err) => {
        console.warn('[SOS] geolocation watch failed', err)
        setGeoState('off')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  useEffect(() => () => cancelHold(), [])

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (c) =>
        (c.label ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').replace(/[\s-]/g, '').includes(q.replace(/[\s-]/g, ''))
    )
  }, [contacts, query])

  const groupedContacts = useMemo(() => {
    const groups = {}
    for (const c of filteredContacts) {
      if (!groups[c.category]) groups[c.category] = []
      groups[c.category].push(c)
    }
    return CATEGORY_ORDER.map((category) => ({ category, items: groups[category] ?? [] })).filter(
      (g) => g.items.length > 0
    )
  }, [filteredContacts])

  // ปุ่มโทรด่วน — ใช้เบอร์ที่ทีมงานปักหมุดไว้ (is_quick) จาก SOSMonitor
  // ถ้าทริปไหนยังไม่ได้ปักเลย ถอยไปใช้ลำดับหมวดแบบเดิม (ไกด์ก่อนเสมอ)
  // เพื่อให้ทริปเก่าและทริปที่เพิ่งสร้างมีปุ่มโทรด่วนใช้ทันทีโดยไม่ต้องตั้งค่า
  const quickContacts = useMemo(() => {
    const ordered = []
    for (const category of CATEGORY_ORDER) {
      for (const c of contacts) if (c.category === category) ordered.push(c)
    }
    const pinned = ordered.filter((c) => c.is_quick)
    return (pinned.length > 0 ? pinned : ordered).slice(0, QUICK_CALL_MAX)
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
      setLastPos(pos)
      setGeoState('ready')
    } catch (err) {
      console.error('[SOS] geolocation failed — falling back to last known position', err)
      pos = lastPos
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
      tour_id: tourId,
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

  const showingContacts = view === 'contacts'

  // แถบหัวสีแดง — บอกว่านี่คือ "โหมดฉุกเฉิน" โดยไม่ต้องย้อมทั้งหน้าจอเป็นสีแดง
  // (จอมือถือกลางแดด พื้นเข้มทั้งจออ่านไม่ออก และปุ่มแดงจะเด่นน้อยลงเพราะมีแดงอื่นมาแข่ง)
  function Header() {
    return (
      <div className="bg-danger px-4 pb-6 pt-4 text-white">
        <div className="mx-auto max-w-md">
          <div className="flex items-center justify-between gap-3">
            <Link to={tp()} className="inline-flex items-center gap-1.5 text-sm font-bold opacity-90">
              <Icon name="home" size={18} className="text-white" />
              {t('guest.nav.home')}
            </Link>
            <span className="inline-flex items-center gap-2 rounded-pill bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-inset ring-white/25">
              <span
                className={`h-2 w-2 rounded-full ${online ? 'bg-success' : 'bg-warning'}`}
                aria-hidden="true"
              />
              {online ? t('guest.sos.statusOnline') : t('guest.sos.statusOffline')}
              {' · '}
              {geoState === 'ready'
                ? t('guest.sos.gpsReady')
                : geoState === 'off'
                  ? t('guest.sos.gpsOff')
                  : t('guest.sos.gpsSearching')}
            </span>
          </div>

          <h1 className="mt-3 flex items-center gap-2 text-xl font-extrabold">
            <Icon name="alert" size={22} filled className="text-white" />
            {showingContacts ? t('guest.sos.contactsTitle') : t('guest.sos.headline')}
          </h1>
          <p className="mt-1 text-sm opacity-90">
            {showingContacts ? t('guest.sos.contactsSubtitle') : t('guest.sos.holdInstruction')}
          </p>
        </div>
      </div>
    )
  }

  if (!guestId) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <AnnouncementBanner />
        <Header />
        <div className="p-4 pb-28">
          <div className="mx-auto max-w-md">
            <Card className="text-center">
              <p className="mb-3 text-ink-muted">{t('guest.sos.noSession')}</p>
              <Link to={tp()}>
                <Button>{t('guest.register.title')}</Button>
              </Link>
            </Card>
          </div>
        </div>
        <GuestNav active="sos" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <AnnouncementBanner />
      <Header />

      <div className="p-4 pb-28">
        <div className="mx-auto flex max-w-md flex-col gap-3">
          {!showingContacts && (
            <>
              {/* ปุ่มกดค้าง — วงแหวนบอกความคืบหน้า ป้องกันการกดพลาดโดยไม่ต้องมี popup ยืนยัน */}
              <div className="flex flex-col items-center pt-1">
                <div className="relative flex h-48 w-48 items-center justify-center">
                  <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
                    <circle cx="50" cy="50" r="45" fill="none" className="stroke-line" strokeWidth="7" />
                    <circle
                      cx="50"
                      cy="50"
                      r="45"
                      fill="none"
                      className="stroke-danger"
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={CIRCUMFERENCE}
                      strokeDashoffset={CIRCUMFERENCE * (1 - holdProgress / 100)}
                      style={{ transition: holding ? 'none' : 'stroke-dashoffset 0.2s' }}
                    />
                  </svg>
                  <button
                    type="button"
                    onPointerDown={startHold}
                    onPointerUp={cancelHold}
                    onPointerLeave={cancelHold}
                    onContextMenu={(e) => e.preventDefault()}
                    disabled={sending}
                    aria-label={t('guest.sos.title')}
                    className="relative flex h-36 w-36 select-none touch-none items-center justify-center rounded-full bg-danger text-white transition active:scale-95 disabled:opacity-60"
                  >
                    <span className="flex flex-col items-center gap-0.5">
                      <span className="text-3xl font-extrabold tracking-wide">SOS</span>
                      <span className="text-[11px] font-bold opacity-90">
                        {t('guest.sos.holdCta')}
                      </span>
                    </span>
                  </button>
                </div>

                <p
                  className={`mt-2 min-h-[1.25rem] text-center text-sm font-semibold ${
                    holding || sending ? 'text-danger-text' : 'text-ink-faint'
                  }`}
                  aria-live="polite"
                >
                  {sending
                    ? t('guest.sos.sending')
                    : holding
                      ? t('guest.sos.holdingPercent', { percent: Math.round(holdProgress) })
                      : t('guest.sos.holdHint')}
                </p>
              </div>

              {sendResult === 'sent' && (
                <div className="rounded-control bg-success-bg px-3.5 py-3 text-sm font-semibold text-success-text">
                  {t('guest.sos.sentBody')}
                </div>
              )}
              {sendResult === 'queued' && (
                <div className="rounded-control bg-warning-bg px-3.5 py-3 text-sm font-semibold text-warning-text">
                  {t('guest.sos.queuedBody')}
                </div>
              )}
              {pendingCount > 0 && (
                <p className="text-xs text-warning-text">
                  {t('guest.sos.pendingSync', { count: pendingCount })}
                </p>
              )}

              {/* โทรด่วน — เผื่อเน็ตหลุดจนส่งสัญญาณไม่ได้ ต้องโทรได้โดยไม่ต้องเลื่อนหน้าจอ */}
              {quickContacts.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {quickContacts.map((contact) => (
                    <a
                      key={`quick-${contact.id}`}
                      href={`tel:${contact.phone}`}
                      className="flex items-center gap-2.5 rounded-control border border-line bg-surface px-3 py-2.5 shadow-card"
                    >
                      <span
                        className={`flex h-8 w-8 flex-none items-center justify-center rounded-[10px] text-white ${
                          CATEGORY_TONE[contact.category] ?? CATEGORY_TONE.other
                        }`}
                      >
                        <Icon name="phone" size={16} className="text-white" filled />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-bold text-ink">{contact.label}</span>
                        <span className="block truncate text-[11px] text-ink-muted">
                          {t(`guest.sos.category.${contact.category}`)}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
              )}

              <Card className="flex flex-col gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-faint">
                    {t('guest.sos.noteLabel')}
                  </span>
                  <textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('guest.sos.notePlaceholder')}
                    className="w-full rounded-control border border-transparent bg-surface-sunken px-3.5 py-3 text-base text-ink shadow-inner transition placeholder:text-ink-faint focus:border-brand focus:bg-surface focus:outline-none focus:ring-4 focus:ring-brand-light/70"
                  />
                </label>
                <p className="flex items-start gap-1.5 text-xs text-ink-muted">
                  <Icon name="location" size={14} className="mt-0.5 text-ink-faint" />
                  {lastPos ? (
                    <span>
                      {t('guest.sos.locationPrefix')}: {lastPos.coords.latitude.toFixed(5)},{' '}
                      {lastPos.coords.longitude.toFixed(5)}
                      {lastPos.coords.accuracy
                        ? ` · ${t('guest.sos.accuracy', { meters: Math.round(lastPos.coords.accuracy) })}`
                        : ''}
                    </span>
                  ) : (
                    <span>{t('guest.sos.locationNone')}</span>
                  )}
                </p>
              </Card>
            </>
          )}

          {showingContacts && (
            <>
              <label className="flex items-center gap-2 rounded-control border border-line bg-surface px-3.5 py-2.5">
                <Icon name="search" size={16} className="text-ink-faint" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('guest.sos.searchPlaceholder')}
                  className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
                />
              </label>

              {usingCache && (
                <p className="rounded-control bg-warning-bg px-3.5 py-2.5 text-xs font-semibold text-warning-text">
                  {t('guest.sos.offlineNotice')}
                </p>
              )}
              {loadingContacts && <p className="text-ink-muted">{t('common.loading')}</p>}
              {!loadingContacts && contacts.length === 0 && (
                <p className="text-sm text-ink-faint">{t('guest.sos.noContacts')}</p>
              )}
              {!loadingContacts && contacts.length > 0 && groupedContacts.length === 0 && (
                <p className="text-sm text-ink-faint">{t('guest.sos.searchEmpty')}</p>
              )}

              {groupedContacts.map((group) => (
                <div
                  key={group.category}
                  className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
                >
                  <div className="flex items-center gap-2 border-b border-line-subtle bg-surface-muted px-3.5 py-2.5">
                    <span
                      className={`flex h-6 w-6 flex-none items-center justify-center rounded-lg text-white ${
                        CATEGORY_TONE[group.category] ?? CATEGORY_TONE.other
                      }`}
                    >
                      <Icon
                        name={CATEGORY_ICON[group.category] ?? CATEGORY_ICON.other}
                        size={14}
                        className="text-white"
                        filled
                      />
                    </span>
                    <span className="text-xs font-extrabold tracking-wide text-ink">
                      {t(`guest.sos.category.${group.category}`)}
                    </span>
                    <span className="ml-auto rounded-pill border border-line-subtle px-2 py-0.5 text-[11px] font-bold text-ink-faint">
                      {group.items.length}
                    </span>
                  </div>

                  {group.items.map((contact) => (
                    <a
                      key={contact.id}
                      href={`tel:${contact.phone}`}
                      className="flex items-center gap-3 border-b border-line-subtle px-3.5 py-3 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-ink">{contact.label}</span>
                        <span className="block truncate text-xs tabular-nums text-ink-muted">
                          {contact.phone}
                        </span>
                      </span>
                      <span
                        className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${
                          group.category === 'hospital'
                            ? 'bg-danger-bg text-danger-text'
                            : 'bg-success-bg text-success-text'
                        }`}
                      >
                        <Icon name="phone" size={16} filled />
                      </span>
                    </a>
                  ))}
                </div>
              ))}
            </>
          )}

          {/* ตัวสลับมุมมอง — อยู่ตำแหน่งเดิมทั้งสองสถานะ กดกลับได้ใน 1 แตะ */}
          <button
            type="button"
            onClick={() => {
              setView(showingContacts ? 'sos' : 'contacts')
              setQuery('')
              window.scrollTo({ top: 0 })
            }}
            className="mt-1 flex w-full items-center gap-2.5 rounded-control border border-line bg-surface px-3.5 py-3 text-sm font-bold text-ink shadow-card transition active:scale-[0.99]"
          >
            <Icon
              name={showingContacts ? 'alert' : 'phone'}
              size={18}
              className={showingContacts ? 'text-danger' : 'text-brand'}
              filled={showingContacts}
            />
            {showingContacts ? t('guest.sos.contactsBack') : t('guest.sos.contactsToggle')}
            <span className="ml-auto flex items-center gap-1.5 text-xs font-bold text-ink-faint">
              {!showingContacts && contacts.length > 0 && contacts.length}
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={showingContacts ? 'rotate-180 transition-transform' : 'transition-transform'}
                aria-hidden="true"
              >
                <path d="M18 15l-6-6-6 6" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      <GuestNav active="sos" />
    </div>
  )
}
