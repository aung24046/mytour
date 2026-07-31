import RequireRole from './RequireRole'

// เหลือไว้เพื่อ backward compat — เท่ากับ RequireRole ที่ไม่ระบุ capability
// (เช็คแค่ว่ามี session) โค้ดใหม่ให้ใช้ <RequireRole capability="..."> แทน
//
// @deprecated
export default function StaffAuthGuard({ children }) {
  return <RequireRole>{children}</RequireRole>
}
