import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { getStaffSession, getActiveTourId, switchActiveTour } from '../../lib/staffSession'
import { clearTourCache } from '../../lib/TourContext'
import Icon from './Icon'

// แถบบอกว่า "ตอนนี้ทำงานอยู่ทริปไหน" + ปุ่มสลับ
//
// - ทีมงานทั่วไป (ไม่มี orgRole) → แสดงชื่อทริปเฉยๆ สลับไม่ได้
// - แอดมิน/เจ้าของ → กดสลับได้ + มีทางเข้าหน้าจัดการทริป
export default function TourSwitcher() {
  const navigate = useNavigate()
  const session = getStaffSession()
  const activeTourId = getActiveTourId()

  const [tours, setTours] = useState([])
  const [open, setOpen] = useState(false)

  const isAdmin = Boolean(session?.orgRole)

  useEffect(() => {
    if (!session) return
    let alive = true

    async function load() {
      // แอดมินเห็นทุกทริปที่เปิดอยู่ · ทีมงานเห็นเฉพาะที่ถูกมอบหมาย
      // แอดมินต้องเห็นทริปร่างด้วย จะได้เข้าไปเตรียมข้อมูลก่อนเปิดใช้งาน
      const { data, error } = isAdmin
        ? await supabase.rpc('list_active_tours', { p_include_draft: true })
        : await supabase.rpc('get_staff_assignments', { p_staff_id: session.staff.id })

      if (!alive) return
      if (error) {
        console.error('[TourSwitcher] โหลดรายชื่อทริปไม่สำเร็จ', error)
        return
      }

      setTours(
        (data ?? []).map((t) => ({
          id: t.id ?? t.tour_id,
          name: t.name ?? t.tour_name,
          join_code: t.join_code ?? null,
          status: t.status ?? null,
        }))
      )
    }

    load()
    return () => {
      alive = false
    }
  }, [session, isAdmin])

  if (!session) return null

  const current = tours.find((t) => t.id === activeTourId)
  const canSwitch = isAdmin || tours.length > 1

  function pick(tourId) {
    if (tourId === activeTourId) {
      setOpen(false)
      return
    }
    if (!switchActiveTour(tourId)) {
      window.alert('สลับไปทริปนี้ไม่ได้')
      return
    }
    clearTourCache()
    setOpen(false)
    // reload เพื่อให้ทุกหน้าอ่าน tour_id ใหม่ (หลายหน้าอ่านตอน mount)
    window.location.reload()
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => canSwitch && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-control bg-surface-sunken px-3 py-2 text-left ${
          canSwitch ? 'transition active:scale-[0.99]' : 'cursor-default'
        }`}
      >
        <Icon name="compass" size={16} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {current?.name ?? 'ยังไม่ได้เลือกทริป'}
          </span>
          {current?.join_code && (
            <span className="block font-mono text-[11px] text-ink-faint">
              {current.join_code}
              {current.status === 'draft' && ' · ร่าง (ลูกทัวร์ยังเข้าไม่ได้)'}
            </span>
          )}
        </span>
        {canSwitch && <span className="shrink-0 text-xs text-ink-muted">เปลี่ยน ›</span>}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-control bg-surface shadow-card-hover ring-1 ring-line-subtle">
            {tours.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm transition hover:bg-brand-lighter ${
                  t.id === activeTourId ? 'bg-brand-light font-semibold text-brand-hover' : 'text-ink'
                }`}
              >
                <span className="truncate">
                  {t.name}
                  {t.status === 'draft' && (
                    <span className="ml-1.5 rounded-full bg-warning-bg px-1.5 py-px text-[10px] font-semibold text-warning-text">
                      ร่าง
                    </span>
                  )}
                </span>
                {t.join_code && (
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                    {t.join_code}
                  </span>
                )}
              </button>
            ))}

            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate('/staff/admin')
                }}
                className="w-full border-t border-line-subtle px-3 py-2.5 text-left text-sm font-semibold text-brand transition hover:bg-brand-lighter"
              >
                จัดการทริปทั้งหมด ›
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
