import { Navigate } from 'react-router-dom'

import { getStaffSession } from '../../lib/staffSession'
import { can } from '../../lib/permissions'

// Gate หน้าจอฝั่ง staff ตาม capability — แทน StaffAuthGuard เปล่าๆ
//
// <RequireRole capability="form.define"><FormBuilder /></RequireRole>
//
// ⚠️ นี่คือการกันระดับ UI เท่านั้น (กันกดผิด / ไม่เห็นเมนูที่ไม่ควรเห็น)
//    ไม่ใช่การป้องกันจริง — ยิง Supabase API ตรงยังทะลุได้
//    การป้องกันจริงต้องรอ Supabase Auth + RLS (ดู Design v2 §9)
export default function RequireRole({ capability, children, fallback = null }) {
  const session = getStaffSession()

  if (!session) {
    return <Navigate to="/staff/login" replace />
  }

  if (capability && !can(session, capability)) {
    if (fallback) return fallback
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold text-ink">ไม่มีสิทธิ์เข้าหน้านี้</p>
        <p className="mt-2 text-sm text-ink-muted">
          บทบาทของคุณ ({session.orgRole ?? session.tourRole ?? '—'}) เข้าถึงหน้านี้ไม่ได้
          <br />
          ติดต่อหัวหน้าทัวร์หรือแอดมินหากคิดว่าไม่ถูกต้อง
        </p>
        <a
          href="/staff"
          className="mt-6 inline-block rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white"
        >
          กลับหน้าหลัก
        </a>
      </div>
    )
  }

  return children
}
