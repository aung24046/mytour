import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { LEGACY_TOUR_ID } from '../../lib/constants'
import { tourPath } from '../../lib/tourPath'

// QR และลิงก์ที่แจกลูกทัวร์ไปแล้วชี้ไปที่ path เดิม (/itinerary, /my-qr, ...)
// ซึ่งไม่มี /t/:code — ตัวนี้แปลงให้อัตโนมัติโดยหา join_code ของทริปแรก
//
// ห้ามลบ route เดิมออกจาก App.jsx จนกว่าจะแน่ใจว่าไม่มี QR เก่าหมุนเวียนอยู่แล้ว

let cachedCode = null

export default function LegacyTourRedirect({ to = '' }) {
  const location = useLocation()
  const [code, setCode] = useState(cachedCode)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (cachedCode) return
    let alive = true

    supabase
      .from('tours')
      .select('join_code')
      .eq('id', LEGACY_TOUR_ID)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error || !data?.join_code) {
          console.error('[LegacyTourRedirect] หา join_code ของทริปเดิมไม่เจอ', error)
          setFailed(true)
          return
        }
        cachedCode = data.join_code
        setCode(data.join_code)
      })

    return () => {
      alive = false
    }
  }, [])

  if (failed) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold text-slate-800">เปิดลิงก์นี้ไม่ได้</p>
        <p className="mt-2 text-sm text-slate-500">
          ลิงก์นี้เป็นรูปแบบเก่า กรุณาสแกน QR ล่าสุดจากทีมงาน
        </p>
        <a
          href="/join"
          className="mt-6 inline-block rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-medium text-white"
        >
          กรอกรหัสทริป
        </a>
      </div>
    )
  }

  if (!code) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      </div>
    )
  }

  // คง query string เดิมไว้ (บางหน้าใช้ ?guest=... )
  return <Navigate to={tourPath(code, to) + location.search} replace />
}
