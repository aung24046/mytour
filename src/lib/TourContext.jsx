// TourContext — บอกว่า "ตอนนี้อยู่ทริปไหน" แทน ACTIVE_TOUR_ID ที่ hardcode ไว้เดิม
//
// ฝั่งลูกทัวร์: อ่าน join_code จาก URL (/t/:code/...) แล้ว resolve เป็น tour_id
// ฝั่งทีมงาน:  อ่านจาก staffSession.activeTourId (ไม่มี :code ใน URL)
//
// ทุกหน้าเรียก useTourId() แทนการ import ACTIVE_TOUR_ID

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

import { supabase } from './supabase'
import { LEGACY_TOUR_ID } from './constants'
import { tourPath } from './tourPath'

const TourContext = createContext(null)

// cache ข้าม component — กันยิง query ซ้ำตอนสลับหน้า
const tourCache = new Map() // code(upper) -> tour object

export const TOUR_STATUS = {
  LOADING: 'loading',
  READY: 'ready',
  NOT_FOUND: 'not_found',
  ERROR: 'error',
}

export function TourProvider({ children, tourId: fixedTourId = null }) {
  const { code } = useParams()

  const [tour, setTour] = useState(null)
  const [status, setStatus] = useState(
    fixedTourId ? TOUR_STATUS.LOADING : code ? TOUR_STATUS.LOADING : TOUR_STATUS.NOT_FOUND
  )

  useEffect(() => {
    let alive = true

    async function load() {
      // โหมดทีมงาน — รู้ tour_id อยู่แล้ว ดึงรายละเอียดมาแสดงชื่อ/สถานะ
      if (fixedTourId) {
        const { data, error } = await supabase
          .from('tours')
          .select('id, org_id, name, join_code, status, start_date, end_date')
          .eq('id', fixedTourId)
          .maybeSingle()

        if (!alive) return
        if (error || !data) {
          console.error('[TourContext] โหลดทริปไม่สำเร็จ', error)
          setStatus(TOUR_STATUS.ERROR)
          return
        }
        setTour(data)
        setStatus(TOUR_STATUS.READY)
        return
      }

      if (!code) {
        setStatus(TOUR_STATUS.NOT_FOUND)
        return
      }

      const key = code.trim().toUpperCase()
      if (tourCache.has(key)) {
        setTour(tourCache.get(key))
        setStatus(TOUR_STATUS.READY)
        return
      }

      const { data, error } = await supabase
        .from('tours')
        .select('id, org_id, name, join_code, status, start_date, end_date')
        .ilike('join_code', key)
        .eq('is_template', false)
        .maybeSingle()

      if (!alive) return

      if (error) {
        console.error('[TourContext] resolve join_code ไม่สำเร็จ', error)
        setStatus(TOUR_STATUS.ERROR)
        return
      }
      if (!data) {
        setStatus(TOUR_STATUS.NOT_FOUND)
        return
      }

      tourCache.set(key, data)
      setTour(data)
      setStatus(TOUR_STATUS.READY)
    }

    load()
    return () => {
      alive = false
    }
  }, [code, fixedTourId])

  const value = useMemo(
    () => ({
      tour,
      tourId: tour?.id ?? null,
      orgId: tour?.org_id ?? null,
      code: tour?.join_code ?? code ?? null,
      status,
      isArchived: tour?.status === 'archived',
      isDraft: tour?.status === 'draft',
      // ทริปที่ archive แล้วให้ดูได้อย่างเดียว — ห้ามลงทะเบียน/แก้ข้อมูล
      readOnly: tour?.status === 'archived',
    }),
    [tour, code, status]
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) {
    // ยังมีหน้าที่ไม่ได้อยู่ใต้ TourProvider ระหว่าง migrate — ไม่ให้แอปพัง
    console.warn('[TourContext] useTour() ถูกเรียกนอก TourProvider — fallback ไปทริปเดิม')
    return {
      tour: null,
      tourId: LEGACY_TOUR_ID,
      orgId: null,
      code: null,
      status: TOUR_STATUS.READY,
      isArchived: false,
      isDraft: false,
      readOnly: false,
    }
  }
  return ctx
}

/** shorthand ที่ใช้บ่อยสุด — แทน ACTIVE_TOUR_ID */
export function useTourId() {
  return useTour().tourId
}

/**
 * สร้าง path ที่มี prefix ทริปเสมอ — ใช้แทนลิงก์ตรงๆ ในหน้า guest
 *   const tp = useTourPath()
 *   navigate(tp('itinerary'))   → /t/JPN102/itinerary
 */
export function useTourPath() {
  const { code } = useTour()
  return (sub = '') => tourPath(code, sub)
}

/** ล้าง cache — เรียกหลังแก้ชื่อ/สถานะทริปจากหน้าแอดมิน */
export function clearTourCache() {
  tourCache.clear()
}
