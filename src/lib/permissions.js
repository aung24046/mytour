// ตารางสิทธิ์ของ MyTour — hardcode ไว้ที่นี่โดยตั้งใจ ไม่เก็บใน DB
//
// เหตุผล: สิทธิ์ที่ config เองได้ = ทดสอบไม่ได้ + เป็นช่องโหว่ + ไม่มีลูกค้าขอ
// ถ้าจะเพิ่ม role หรือ capability ให้แก้ที่ไฟล์นี้ไฟล์เดียว
//
// ⚠️ นี่คือการบังคับสิทธิ์ "ฝั่ง client" เท่านั้น — กันการกดผิด/เห็นเมนูที่ไม่ควรเห็น
//    ไม่ใช่การป้องกันจริง ผู้ใช้ยิง Supabase API ตรงได้อยู่
//    การป้องกันจริงต้องรอ Supabase Auth + RLS (ดู Design v2 §9)

// ---------------------------------------------------------------------
// ลำดับชั้น — เลขมากกว่า = สิทธิ์สูงกว่า
// ---------------------------------------------------------------------
export const ORG_ROLES = ['admin', 'owner']
export const TOUR_ROLES = ['guide', 'driver', 'staff', 'lead']

const RANK = {
  // ระดับทริป
  guide: 10,
  driver: 10,
  staff: 20,
  lead: 30,
  // ระดับบริษัท — สูงกว่าระดับทริปเสมอ
  admin: 40,
  owner: 50,
}

export function rankOf(role) {
  return RANK[role] ?? 0
}

// role ที่มีผลจริงของ session (org_role ชนะ tour_role เสมอ)
export function effectiveRole(session) {
  if (!session) return null
  return session.orgRole ?? session.tourRole ?? null
}

// ---------------------------------------------------------------------
// Capability matrix — role ขั้นต่ำที่ทำสิ่งนั้นได้
// ---------------------------------------------------------------------
export const CAPABILITIES = {
  // ── หน้างาน (ทุกคนในทีมทำได้) ────────────────────────────────
  'checkin.use': 'staff',
  'luggage.use': 'staff',
  'seat.view': 'guide',
  'seat.edit': 'staff',
  'room.view': 'guide',
  'room.edit': 'staff',
  'location.monitor': 'staff',
  'sos.monitor': 'staff',
  'sos.resolve': 'staff',
  'broadcast.send': 'staff',
  'bingo.host': 'staff',
  'guest.view': 'staff',
  'dashboard.view': 'guide',
  'guide.read': 'guide',
  'print.export': 'staff',

  // ── แก้ config ของทริป (หัวหน้าทัวร์ขึ้นไป) ──────────────────
  'guest.edit': 'lead',
  'guest.delete': 'lead',
  'form.assign': 'lead', // เปิด/ปิด/เรียงคำถามในทริปนี้
  'itinerary.edit': 'lead',
  'seat.layout': 'lead',
  'room.layout': 'lead',
  'guide.assign': 'lead', // เลือกบทความ/ศัพท์ที่จะแสดงในทริปนี้
  'emergency.assign': 'lead',
  'expense.edit': 'lead',
  'supplier.assign': 'lead',
  'feedback.view': 'lead',
  'tourstaff.manage': 'lead', // เพิ่ม/ถอดคนในทริปนี้ (จากคลังคนที่มีอยู่)
  'tour.reset': 'lead', // reset_tour_runtime_data ของทริปตัวเอง

  // ── คลังกลาง + ข้ามทริป (แอดมินบริษัท) ───────────────────────
  'tour.create': 'admin',
  'tour.clone': 'admin',
  'tour.archive': 'admin',
  'tour.switch': 'admin', // สลับดูทริปอื่น
  'library.edit': 'admin', // แก้เนื้อหาในคลังกลาง (กระทบทุกทริปที่ใช้)
  'library.fork': 'lead', // แยกสำเนาเฉพาะทริปนี้ — ไม่กระทบคนอื่น จึงให้ lead ได้
  'form.define': 'admin', // สร้าง/แก้ตัวคำถามในคลัง
  'destination.manage': 'admin',
  'supplier.manage': 'admin',
  'person.create': 'admin', // สร้างคนใหม่เข้าคลังทีมงาน
  'orgrole.grant': 'admin', // ตั้ง org_role ให้คนอื่น (ตั้ง owner ไม่ได้ ดู canGrantRole)

  // ── เจ้าของบริษัทเท่านั้น ────────────────────────────────────
  'tour.delete': 'owner',
  'tour.purge': 'owner', // ลบข้อมูลส่วนบุคคล (PDPA) — ย้อนกลับไม่ได้
  'owner.grant': 'owner',
  'billing.manage': 'owner',
}

// ---------------------------------------------------------------------
// API หลัก
// ---------------------------------------------------------------------

/**
 * session = { staff, orgRole, activeTourId, tourRole }
 * orgRole  : 'owner' | 'admin' | null
 * tourRole : 'lead' | 'staff' | 'driver' | 'guide' | null  (ของ activeTourId)
 */
export function can(session, capability) {
  const required = CAPABILITIES[capability]
  if (!required) {
    // capability ที่ไม่มีในตาราง = ปฏิเสธไว้ก่อน (fail closed)
    console.warn(`[permissions] ไม่รู้จัก capability: ${capability}`)
    return false
  }

  const role = effectiveRole(session)
  if (!role) return false

  return rankOf(role) >= rankOf(required)
}

/** ใช้ตอนอยากเช็คหลายสิทธิ์พร้อมกัน */
export function canAll(session, capabilities) {
  return capabilities.every((c) => can(session, c))
}

export function canAny(session, capabilities) {
  return capabilities.some((c) => can(session, c))
}

/** โยน error — ใช้ก่อนเรียก mutation ที่อันตราย */
export function assertCan(session, capability) {
  if (!can(session, capability)) {
    throw new Error(`ไม่มีสิทธิ์: ${capability}`)
  }
}

// ---------------------------------------------------------------------
// กฎกันสิทธิ์บานปลาย (privilege escalation)
// ---------------------------------------------------------------------

/** มอบ role สูงกว่าหรือเท่ากับตัวเองไม่ได้ (ยกเว้น owner ตั้ง owner ได้) */
export function canGrantRole(session, targetRole) {
  const myRole = effectiveRole(session)
  if (!myRole) return false

  if (targetRole === 'owner') return myRole === 'owner'
  if (ORG_ROLES.includes(targetRole) && !can(session, 'orgrole.grant')) return false

  return rankOf(myRole) > rankOf(targetRole)
}

/** ห้ามแก้/ถอดคนที่สิทธิ์สูงกว่าหรือเท่ากับตัวเอง และห้ามแก้ตัวเอง */
export function canModifyMember(session, member) {
  const myRole = effectiveRole(session)
  if (!myRole) return false
  if (member.staff_id && member.staff_id === session.staff?.id) return false // ห้ามแก้ตัวเอง

  const theirRole = member.org_role ?? member.role
  return rankOf(myRole) > rankOf(theirRole)
}

/**
 * ห้ามถอด owner คนสุดท้าย
 * ownerCount = จำนวน owner ที่เหลืออยู่ใน org
 */
export function canRemoveOwner(ownerCount) {
  return ownerCount > 1
}

// ---------------------------------------------------------------------
// Helper สำหรับ tour scope
// ---------------------------------------------------------------------

/** เข้าถึงทริปนี้ได้ไหม — org role เข้าได้ทุกทริป, tour role เฉพาะที่ถูกมอบหมาย */
export function canAccessTour(session, tourId) {
  if (!session || !tourId) return false
  if (session.orgRole) return true
  return session.activeTourId === tourId
}

/** รายชื่อเมนูที่ควรแสดงบน Dashboard */
export function visibleMenus(session, menus) {
  return menus.filter((m) => !m.capability || can(session, m.capability))
}
