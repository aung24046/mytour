import { useEffect, useState } from 'react'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'

// แสดงประกาศด่วนล่าสุดที่ยัง is_active=true อยู่บนสุดของหน้าลูกทัวร์ทุกหน้า
// อัปเดตแบบ real-time ผ่าน Supabase Realtime — ไม่ต้อง refresh หน้า
export default function AnnouncementBanner() {
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

  return (
    <div className="sticky top-0 z-10 flex items-start gap-2 bg-amber-400 px-4 py-3 text-sm font-medium text-amber-950 shadow-sm">
      <span className="flex-1">{announcement.message}</span>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-full px-2 font-bold text-amber-900"
        aria-label="close"
      >
        ×
      </button>
    </div>
  )
}
