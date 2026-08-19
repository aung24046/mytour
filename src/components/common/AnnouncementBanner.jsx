import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId } from '../../lib/TourContext'
import { getGuestId } from '../../lib/guestSession'
import { hasMeetPoint, MEET_COLUMNS } from '../../lib/meetPoint'
import Icon from './Icon'
import MeetPointCard from './MeetPointCard'

// แสดงประกาศด่วนล่าสุดที่ยัง is_active=true อยู่ — อัปเดตเองไม่ต้อง refresh หน้า
//
// ทำไมต้องมีหลายชั้น (realtime อย่างเดียวไม่พอในสนามจริง):
//   1) Supabase Realtime — เร็วสุด ได้ทันทีที่ทีมงานกดส่ง
//   2) รีเฟรชตอนกลับมาที่หน้า (visibilitychange) — มือถือปิดจอ/สลับแอป websocket จะถูกตัด
//      แล้ว event ที่พลาดไประหว่างนั้น "ไม่มีการส่งย้อนหลัง" ถ้าไม่ดึงใหม่จะไม่มีวันเห็น
//   3) รีเฟรชตอนเน็ตกลับมา (online) — บนรถบัส/ในถ้ำ เน็ตหลุดบ่อย
//   4) poll ทุก 45 วิ เฉพาะตอนหน้าเปิดอยู่ — กันเคส websocket ต่อไม่ติดเลย (proxy/ไฟร์วอลล์โรงแรม
//      บางที่บล็อก wss) ผู้ใช้ยังได้ประกาศช้าสุด 45 วิ ไม่ใช่ไม่ได้เลย
//
// variant "strip" (ค่าเริ่มต้น) = แถบ sticky บนสุดของหน้า ใช้กับหน้าลูกทัวร์ทั่วไป
// variant "box" = กล่องเด่นแทรกในเนื้อหา — ใช้ที่หน้า Home เหนือปุ่ม QR เพราะ sticky strip เดิมมองข้ามง่าย

const POLL_INTERVAL_MS = 45000

export default function AnnouncementBanner({ variant = 'strip' }) {
  const tourId = useTourId()
  const { t } = useTranslation()
  const [announcement, setAnnouncement] = useState(null)
  // เก็บเป็น "id ที่ปิดไปแล้ว" ไม่ใช่ boolean — ไม่งั้นทุกครั้งที่ poll/refetch
  // ประกาศเดิมที่ผู้ใช้กดปิดไปแล้วจะเด้งกลับมาใหม่
  const [dismissedId, setDismissedId] = useState(null)

  useEffect(() => {
    if (!tourId) return

    let isMounted = true

    async function loadLatest() {
      const { data, error } = await supabase
        .from('announcements')
        .select(`id, message, is_active, created_at, ${MEET_COLUMNS}`)
        .eq('tour_id', tourId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!isMounted) return
      if (error) {
        console.error('[AnnouncementBanner] โหลดประกาศไม่สำเร็จ', error)
        return
      }
      // data = null แปลว่าทีมงานปิดประกาศไปแล้ว → ต้องเอาแบนเนอร์ออกด้วย
      setAnnouncement(data ?? null)
    }

    loadLatest()

    // ชื่อ channel ต้องไม่ซ้ำต่อ instance — บางหน้า (Register / SOS) render แบนเนอร์ 2 จุด
    // ถ้าใช้ topic เดียวกันบน client เดียว ตัวที่สองจะ subscribe ไม่ติด
    const topic = `announcements-${tourId}-${Math.random().toString(36).slice(2, 9)}`

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcements',
          filter: `tour_id=eq.${tourId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            // replica identity เป็น default → payload.old มีแค่ id ตัดสินใจเองไม่ได้ ดึงใหม่ชัวร์กว่า
            loadLatest()
            return
          }
          const row = payload.new
          if (row?.is_active) {
            setAnnouncement(row)
          } else {
            // ประกาศถูกปิด — ถ้าเป็นตัวที่โชว์อยู่ให้เอาออก แล้วดึงตัวถัดไป (ถ้ามี)
            setAnnouncement((prev) => (prev && prev.id === row?.id ? null : prev))
            loadLatest()
          }
        }
      )
      .subscribe((status) => {
        // ต่อติด/ต่อใหม่สำเร็จ → sync สถานะปัจจุบันทันที กันช่วงที่หลุดไปแล้วพลาด event
        if (status === 'SUBSCRIBED') loadLatest()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[AnnouncementBanner] realtime ต่อไม่ติด — ใช้ polling แทน', status)
        }
      })

    function handleVisibility() {
      if (document.visibilityState === 'visible') loadLatest()
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('online', loadLatest)

    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') loadLatest()
    }, POLL_INTERVAL_MS)

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('online', loadLatest)
      clearInterval(poll)
    }
  }, [tourId])

  // บันทึกว่า "คนนี้เห็นประกาศนี้แล้ว" — ทีมงานใช้ตัวเลขนี้ตัดสินใจว่าต้องตามใครต่อ
  //
  // นับตอนแบนเนอร์ถูกเรนเดอร์จริง ไม่ใช่ตอนโหลดข้อมูล — ถ้านับตอนโหลด คนที่กดปิด
  // ประกาศไปแล้วหรือเปิดหน้าที่ไม่มีแบนเนอร์ก็จะถูกนับว่าเห็น ทั้งที่ยังไม่เห็น
  //
  // ยิงแบบ fire-and-forget: ล้มเหลวก็ปล่อย (ออฟไลน์ / ยังไม่ลงทะเบียน) ห้ามให้ประกาศ
  // ที่ต้องรีบสื่อสารพังเพราะการเก็บสถิติ
  useEffect(() => {
    if (!announcement || !tourId) return
    const guestId = getGuestId(tourId)
    if (!guestId) return

    let cancelled = false
    async function markRead() {
      const { error } = await supabase
        .from('announcement_reads')
        .upsert(
          { announcement_id: announcement.id, guest_id: guestId },
          { onConflict: 'announcement_id,guest_id', ignoreDuplicates: true }
        )
      if (error && !cancelled) {
        console.warn('[AnnouncementBanner] บันทึกการอ่านไม่สำเร็จ', error)
      }
    }
    markRead()

    return () => {
      cancelled = true
    }
  }, [announcement, tourId])

  if (!announcement) return null

  // ⚠️ หมุดจุดนัดพบต้องรอดจากการกดปิด ส่วนตัวข้อความปิดได้ตามเดิม
  //    ลูกทัวร์กด × เพราะอ่านประกาศจบแล้ว ไม่ได้แปลว่าไม่ต้องการจุดนัดพบอีก
  //    ซึ่งเขาจะกลับมาเปิดดูอีกหลายรอบตลอดช่วงที่เดินเล่น
  const meet = hasMeetPoint(announcement) ? announcement : null
  const messageHidden = announcement.id === dismissedId

  if (messageHidden && !meet) return null

  if (variant === 'box') {
    return (
      <>
        {!messageHidden && (
          <div className="mt-4 flex items-start gap-3 rounded-card bg-warning-bg p-4 text-warning-ink shadow-card ring-1 ring-line-subtle">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-warning-ink/10">
              <Icon name="megaphone" size={20} filled />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wide text-warning-ink/70">
                {t('guest.home.announcementLabel')}
              </p>
              <p className="mt-0.5 text-sm font-semibold leading-snug">{announcement.message}</p>
            </div>
            <button
              onClick={() => setDismissedId(announcement.id)}
              className="shrink-0 rounded-full px-1.5 text-lg leading-none font-bold text-warning-ink/80 transition hover:bg-warning-ink/10"
              aria-label="close"
            >
              ×
            </button>
          </div>
        )}
        {meet && <MeetPointCard announcement={meet} />}
      </>
    )
  }

  return (
    <div className="sticky top-0 z-10 shadow-md">
      {!messageHidden && (
        <div className="flex items-start gap-2.5 bg-warning-bg px-4 py-3 text-sm font-semibold text-warning-ink">
          <Icon name="megaphone" size={17} filled className="mt-px shrink-0" />
          <span className="flex-1 leading-snug">{announcement.message}</span>
          <button
            onClick={() => setDismissedId(announcement.id)}
            className="shrink-0 rounded-full px-1.5 text-lg leading-none font-bold text-warning-ink/80 transition hover:bg-warning-ink/10"
            aria-label="close"
          >
            ×
          </button>
        </div>
      )}
      {meet && <MeetPointCard announcement={meet} compact />}
    </div>
  )
}
