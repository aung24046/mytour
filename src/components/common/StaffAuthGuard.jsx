import { Navigate } from 'react-router-dom'

import { getStaffSession } from '../../lib/staffSession'

// Gate หน้าจอฝั่ง staff — เช็ค session ที่เก็บใน localStorage หลัง login ด้วย PIN
// หมายเหตุ: นี่คือการกันหน้าจอระดับ UI เท่านั้น ไม่ใช่การป้องกันระดับฐานข้อมูล (ดู staffSession.js)
export default function StaffAuthGuard({ children }) {
  const session = getStaffSession()

  if (!session) {
    return <Navigate to="/staff/login" replace />
  }

  return children
}
