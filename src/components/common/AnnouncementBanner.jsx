import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Icon from './Icon'

// แสดงประกาศด่วนล่าสุดที่ยัง is_active=true อยู่ — อัปเดตแบบ real-time ผ่าน Supabase Realtime ไม่ต้อง refresh หน้า
// variant "strip" (ค่าเริ่มต้น) = แถบ sticky บนสุดของหน้า ใช้กับหน้าลูกทัวร์ทั่วไป
// variant "box" = กล่องเด่นแทรกในเนื้อหา — ใช้ที่หน้า Home เหนือปุ่ม QR เพราะ sticky strip เดิมมองข้ามง่าย
export default function AnnouncementBanner({ variant = 'strip' }) {
  const { t } = useTranslation()
  const [announcement, setAnnouncement] = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadLatest() {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, message, is_active, created_at')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!isMounted) return
      if (!error && data) {
        setAnnouncement(data)
        setDismissed(false)
      }
    }

    loadLatest()

    const channel = supabase
      .channel(`broadcast-guest-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'announcements',
          filter: `tour_id=eq.${ACTIVE_TOUR_ID}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') return
          if (payload.new?.is_active) {
            setAnnouncement(payload.new)
            setDismissed(false)
          } else if (announcement && payload.new?.id === announcement.id) {
            setAnnouncement(null)
          }
        }
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!announcement || dismissed) return null

  if (variant === 'box') {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-card bg-[#FFF3CF] p-4 text-amber-950 shadow-card ring-1 ring-black/[0.02]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-900/10">
          <Icon name="megaphone" size={20} filled />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-900/70">
            {t('guest.home.announcementLabel')}
          </p>
          <p className="mt-0.5 text-sm font-semibold leading-snug">{announcement.message}</p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-full px-1.5 text-lg leading-none font-bold text-amber-900/80 transition hover:bg-white/30"
          aria-label="close"
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div className="sticky top-0 z-10 flex items-start gap-2.5 bg-[#FFF3CF] px-4 py-3 text-sm font-semibold text-amber-950 shadow-md">
      <Icon name="megaphone" size={17} filled className="mt-px shrink-0" />
      <span className="flex-1 leading-snug">{announcement.message}</span>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-full px-1.5 text-lg leading-none font-bold text-amber-900/80 transition hover:bg-white/30"
        aria-label="close"
      >
        ×
      </button>
    </div>
  )
}
