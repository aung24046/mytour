import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useActiveTourId, useActiveOrgId, getStaffSession } from '../../lib/staffSession'
import Icon from '../../components/common/Icon'
import StaffHeader from '../../components/common/StaffHeader'

/** "12 นาทีที่แล้ว" — เวลาสัมบูรณ์ไม่ช่วยอะไรตอนยืนอยู่หน้ารถ ต้องรู้ว่าผ่านมานานแค่ไหน */
function timeAgo(iso, t) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.max(0, Math.round(diffMs / 60000))
  if (mins < 1) return t('staff.broadcast.justNow')
  if (mins < 60) return t('staff.broadcast.minutesAgo', { count: mins })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('staff.broadcast.hoursAgo', { count: hours })
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
}

// ประกาศด่วน — หน้าเดียวจบ: ที่ออกอากาศอยู่ / ใครอ่านแล้ว / ส่งอันใหม่
//
// ⚠️ ข้อตกลงสำคัญ: ฝั่งลูกทัวร์ (AnnouncementBanner) แสดงประกาศ is_active ล่าสุด
//    "แค่อันเดียว" แต่โค้ดเดิมปล่อยให้มี active ค้างได้หลายอัน ทีมงานจึงเห็นประวัติว่า
//    เปิดอยู่ 3 อันทั้งที่ลูกทัวร์เห็นอันเดียว และไม่มีทางรู้ว่าบนจอลูกทัวร์เขียนว่าอะไร
//    → ที่นี่บังคับให้มี active ได้ทีละอัน: ส่งอันใหม่ = ปิดอันเก่าทั้งหมด
export default function Broadcast() {
  const tourId = useActiveTourId()
  const orgId = useActiveOrgId()
  const { t } = useTranslation()
  const me = getStaffSession()?.staff ?? null

  const [history, setHistory] = useState([])
  const [reads, setReads] = useState([]) // [{ announcement_id, guest_id }]
  const [guests, setGuests] = useState([])
  const [staffById, setStaffById] = useState({})
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)

  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(null)

  const [editingLive, setEditingLive] = useState(false)
  const [editText, setEditText] = useState('')
  const [showAllPending, setShowAllPending] = useState(false)
  const composerRef = useRef(null)

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true)

      const [annRes, guestRes, staffRes, tplRes] = await Promise.all([
        supabase
          .from('announcements')
          .select('id, message, is_active, created_at, staff_id')
          .eq('tour_id', tourId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('guests').select('id, name, nickname, phone').eq('tour_id', tourId),
        supabase.from('v_tour_staff').select('id, name').eq('tour_id', tourId),
        supabase
          .from('announcement_templates')
          .select('id, text, sort_order')
          .eq('org_id', orgId)
          .order('sort_order'),
      ])

      if (annRes.error) {
        console.error('[Broadcast] load failed', annRes.error)
        setLoading(false)
        return
      }

      const rows = annRes.data ?? []
      setHistory(rows)
      setGuests(guestRes.data ?? [])
      setTemplates(tplRes.data ?? [])
      if (!staffRes.error) {
        setStaffById(Object.fromEntries((staffRes.data ?? []).map((s) => [s.id, s])))
      }

      // ยอดคนอ่านดึงเฉพาะประกาศที่อยู่บนหน้านี้ ไม่ใช่ทั้งตาราง
      if (rows.length > 0) {
        const { data: readRows, error: readError } = await supabase
          .from('announcement_reads')
          .select('announcement_id, guest_id')
          .in('announcement_id', rows.map((a) => a.id))
        if (readError) console.warn('[Broadcast] load reads failed', readError)
        else setReads(readRows ?? [])
      } else {
        setReads([])
      }

      setLoading(false)
    },
    [tourId, orgId]
  )

  useEffect(() => {
    load()

    // เหตุผลเดียวกับฝั่งลูกทัวร์: websocket หลุดตอนสลับแอป/เน็ตหาย แล้ว event ที่พลาดไม่ถูกส่งย้อนหลัง
    // ทีมงานมักเปิดหน้านี้ค้างไว้ทั้งวัน ถ้าไม่ดึงใหม่ ยอดคนอ่านจะค้างอยู่ที่ตัวเลขเก่า
    const channel = supabase
      .channel(`broadcast-staff-${tourId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements', filter: `tour_id=eq.${tourId}` },
        () => load({ silent: true })
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'announcement_reads' },
        (payload) => {
          setReads((prev) =>
            prev.some(
              (r) =>
                r.announcement_id === payload.new.announcement_id &&
                r.guest_id === payload.new.guest_id
            )
              ? prev
              : [...prev, payload.new]
          )
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') load({ silent: true })
      })

    function handleVisibility() {
      if (document.visibilityState === 'visible') load({ silent: true })
    }
    function handleOnline() {
      load({ silent: true })
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', handleOnline)

    return () => {
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', handleOnline)
    }
  }, [load, tourId])

  const live = useMemo(() => history.find((a) => a.is_active) ?? null, [history])

  const readCountByAnnouncement = useMemo(() => {
    const counts = {}
    for (const r of reads) counts[r.announcement_id] = (counts[r.announcement_id] ?? 0) + 1
    return counts
  }, [reads])

  /** ลูกทัวร์ที่ยังไม่เปิดอ่านประกาศที่ออกอากาศอยู่ */
  const pendingGuests = useMemo(() => {
    if (!live) return []
    const seen = new Set(reads.filter((r) => r.announcement_id === live.id).map((r) => r.guest_id))
    return guests.filter((g) => !seen.has(g.id))
  }, [live, reads, guests])

  const liveReadCount = live ? (readCountByAnnouncement[live.id] ?? 0) : 0
  const readPercent = guests.length > 0 ? Math.round((liveReadCount / guests.length) * 100) : 0

  async function handleSend(e) {
    e.preventDefault()
    const text = message.trim()
    if (!text) return

    setSending(true)
    setSendError(null)

    // ปิดของเดิมก่อนเสมอ — ฝั่งลูกทัวร์แสดงได้ทีละอันอยู่แล้ว การมี active ค้างหลายอัน
    // ทำให้ทีมงานเข้าใจผิดว่าประกาศเก่ายังถูกเห็นอยู่
    const { error: closeError } = await supabase
      .from('announcements')
      .update({ is_active: false })
      .eq('tour_id', tourId)
      .eq('is_active', true)
    if (closeError) console.warn('[Broadcast] close previous failed', closeError)

    const { error: insertError } = await supabase.from('announcements').insert({
      tour_id: tourId,
      message: text,
      is_active: true,
      staff_id: me?.id ?? null,
    })

    if (insertError) {
      console.error('[Broadcast] send failed', insertError)
      setSendError(insertError.message ?? t('common.error'))
    } else {
      setMessage('')
      load({ silent: true })
    }
    setSending(false)
  }

  async function saveEdit() {
    const text = editText.trim()
    if (!live || !text) return
    setHistory((prev) => prev.map((a) => (a.id === live.id ? { ...a, message: text } : a)))
    setEditingLive(false)
    const { error: updateError } = await supabase
      .from('announcements')
      .update({ message: text })
      .eq('id', live.id)
    if (updateError) {
      console.error('[Broadcast] edit failed', updateError)
      load({ silent: true })
    }
  }

  async function closeLive() {
    if (!live) return
    setHistory((prev) => prev.map((a) => (a.id === live.id ? { ...a, is_active: false } : a)))
    const { error: closeError } = await supabase
      .from('announcements')
      .update({ is_active: false })
      .eq('id', live.id)
    if (closeError) {
      console.error('[Broadcast] close failed', closeError)
      load({ silent: true })
    }
  }

  /** แตะชิป = เติมข้อความลงช่องพิมพ์ ไม่ส่งทันที — กันกดพลาดแล้วประกาศออกไปทั้งทริป */
  function useTemplate(text) {
    setMessage((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
    composerRef.current?.focus()
  }

  const visiblePending = showAllPending ? pendingGuests : pendingGuests.slice(0, 3)

  return (
    <div className="min-h-screen bg-surface-muted">
      <StaffHeader
        icon="megaphone"
        title={t('staff.broadcast.title')}
        actions={
          <Link
            to="/staff/broadcast/shortcuts"
            className="flex items-center gap-1.5 rounded-pill px-2 py-1.5 text-sm font-semibold text-ink-muted"
          >
            <Icon name="settings" size={16} />
            {t('staff.broadcast.shortcuts')}
          </Link>
        }
      />
      <div className="mx-auto max-w-md px-4 pb-16">
        {loading && <p className="text-ink-muted">{t('common.loading')}</p>}

        {!loading && (
          <>
            {/* ── ประกาศที่ออกอากาศอยู่ — หน้าตาเดียวกับที่ลูกทัวร์เห็น ── */}
            {live ? (
              <>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs text-ink-faint">
                  <span className="h-1.5 w-1.5 rounded-full bg-success-text" />
                  {t('staff.broadcast.liveLabel')}
                </p>

                <div className="rounded-card bg-warning-bg p-3 text-warning-ink">
                  {editingLive ? (
                    <>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        className="w-full rounded-control bg-surface p-2.5 text-[15px] text-ink focus:outline-none"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={saveEdit}
                          disabled={!editText.trim()}
                          className="flex-1 rounded-control bg-surface py-2 text-sm font-semibold text-ink disabled:opacity-50"
                        >
                          {t('staff.broadcast.saveEdit')}
                        </button>
                        <button
                          onClick={() => setEditingLive(false)}
                          className="flex-1 rounded-control py-2 text-sm font-semibold text-warning-ink/80"
                        >
                          {t('staff.broadcast.cancelEdit')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start gap-2.5">
                      <Icon name="megaphone" size={19} filled className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-semibold leading-relaxed">{live.message}</p>
                        <p className="mt-1.5 text-[11px] opacity-80">
                          {t('staff.broadcast.sentAgo', { time: timeAgo(live.created_at, t) })}
                          {staffById[live.staff_id]?.name &&
                            ` · ${t('staff.broadcast.sentBy', { name: staffById[live.staff_id].name })}`}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {!editingLive && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => {
                        setEditText(live.message)
                        setEditingLive(true)
                      }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-surface-sunken py-2 text-sm font-semibold text-ink-muted"
                    >
                      <Icon name="edit" size={15} />
                      {t('staff.broadcast.editMessage')}
                    </button>
                    <button
                      onClick={closeLive}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-control bg-surface-sunken py-2 text-sm font-semibold text-danger"
                    >
                      ×{t('staff.broadcast.closeAnnouncement')}
                    </button>
                  </div>
                )}

                {/* ── ยอดคนเปิดอ่าน — บล็อกแยกจากตัวประกาศ ── */}
                <div className="mt-3 rounded-card bg-surface p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-ink-muted">{t('staff.broadcast.readLabel')}</span>
                    <span className="text-[15px] text-ink-muted">
                      <span className="font-bold text-ink">{liveReadCount}</span> /{' '}
                      {guests.length} คน
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-sunken">
                    <div
                      className="h-full rounded-pill bg-success-text transition-all"
                      style={{ width: `${readPercent}%` }}
                    />
                  </div>

                  {guests.length === 0 ? (
                    <p className="mt-2.5 text-xs text-ink-faint">{t('staff.broadcast.noGuests')}</p>
                  ) : (
                    pendingGuests.length > 0 && (
                      <>
                        <p className="mt-2.5 text-[11px] text-ink-faint">
                          {t('staff.broadcast.notSeenHint')}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {visiblePending.map((g) => (
                            <a
                              key={g.id}
                              href={g.phone ? `tel:${g.phone}` : undefined}
                              className={`flex items-center gap-1.5 rounded-pill bg-surface-sunken px-2.5 py-1.5 text-xs text-ink ${
                                g.phone ? '' : 'pointer-events-none opacity-60'
                              }`}
                            >
                              {g.nickname || g.name}
                              {g.phone && <Icon name="phone" size={13} className="text-brand" />}
                            </a>
                          ))}
                          {!showAllPending && pendingGuests.length > 3 && (
                            <button
                              onClick={() => setShowAllPending(true)}
                              className="rounded-pill bg-surface-sunken px-2.5 py-1.5 text-xs text-ink-muted"
                            >
                              {t('staff.broadcast.andMore', { count: pendingGuests.length - 3 })}
                            </button>
                          )}
                        </div>
                      </>
                    )
                  )}
                </div>
              </>
            ) : (
              <p className="rounded-card bg-surface p-3 text-sm text-ink-faint">
                {t('staff.broadcast.noneLive')}
              </p>
            )}

            {/* ── ส่งประกาศใหม่ ── */}
            <form onSubmit={handleSend} className="mt-4">
              <p className="mb-1.5 text-xs text-ink-faint">
                {live ? t('staff.broadcast.newAnnouncement') : t('staff.broadcast.title')}
              </p>

              {templates.length > 0 && (
                <div className="-mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => useTemplate(tpl.text)}
                      className="shrink-0 whitespace-nowrap rounded-pill bg-surface-sunken px-3 py-1.5 text-xs font-medium text-ink-muted"
                    >
                      {tpl.text}
                    </button>
                  ))}
                  <Link
                    to="/staff/broadcast/shortcuts"
                    className="shrink-0 rounded-pill bg-surface-sunken px-3 py-1.5 text-xs text-ink-faint"
                  >
                    ›
                  </Link>
                </div>
              )}

              <textarea
                ref={composerRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder={t('staff.broadcast.placeholder')}
                className="w-full rounded-card border border-transparent bg-surface p-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
              />

              {sendError && <p className="mt-1 text-sm text-danger">{sendError}</p>}

              <button
                type="submit"
                disabled={sending || !message.trim()}
                className="mt-2 w-full rounded-card bg-brand-gradient py-3.5 text-base font-semibold text-white shadow-brand transition active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
              >
                {sending ? t('common.loading') : t('staff.broadcast.send')}
              </button>
            </form>

            {/* ── ที่ส่งไปแล้ว ── */}
            <p className="mb-1 mt-5 text-xs text-ink-faint">{t('staff.broadcast.sentToday')}</p>
            {history.length === 0 && (
              <p className="text-sm text-ink-faint">{t('staff.broadcast.noHistory')}</p>
            )}
            <div>
              {history.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 border-b border-line-subtle py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                    {a.message}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {readCountByAnnouncement[a.id] ?? 0}/{guests.length} ·{' '}
                    {new Date(a.created_at).toLocaleTimeString('th-TH', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
