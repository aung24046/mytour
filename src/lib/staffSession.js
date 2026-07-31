// Staff ล็อกอินด้วย PIN (ไม่ใช่ Supabase Auth จริง) — เก็บ session ใน localStorage
// นี่คือ "screen gate" ระดับ UI เท่านั้น ไม่ใช่การป้องกันระดับฐานข้อมูล
//
// multi-tour: session เก็บว่าตอนนี้ทำงานอยู่ทริปไหน + บทบาทอะไร
//   {
//     staff: { id, name, phone, staff_code },
//     orgRole: 'owner' | 'admin' | null,   ← ระดับบริษัท
//     activeTourId: '<uuid>' | null,
//     tourRole: 'lead' | 'staff' | 'driver' | 'guide' | null,  ← ระดับทริป
//     assignments: [{ tourId, role }]      ← ทริปที่คนนี้ถูกมอบหมาย
//   }
//
// กติกา: ไม่มี orgRole → สลับทริปไม่ได้ ล็อกอยู่ที่ทริปที่ถูกมอบหมายเท่านั้น
// และตรวจซ้ำทุกครั้งที่อ่าน session ไม่ใช่แค่ตอน login

import { LEGACY_TOUR_ID, LEGACY_ORG_ID } from './constants'

const STORAGE_KEY = 'mytour_staff_session'

/** role เดิมในตาราง staff → role ใหม่ระดับทริป (ตรงกับ migration) */
export function mapLegacyRole(role) {
  switch (String(role || '').toLowerCase()) {
    case 'admin':
    case 'lead_guide':
    case 'lead':
      return 'lead'
    case 'driver':
      return 'driver'
    case 'guide':
      return 'guide'
    default:
      return 'staff'
  }
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null

  // session รูปแบบเก่า: เก็บ staff row ตรงๆ { id, name, role }
  if (!('staff' in raw) && 'id' in raw && 'name' in raw) {
    const tourId = raw.tour_id ?? LEGACY_TOUR_ID
    const role = mapLegacyRole(raw.role)
    return {
      staff: { id: raw.id, name: raw.name, phone: raw.phone ?? null },
      orgRole: null,
      activeTourId: tourId,
      tourRole: role,
      assignments: [{ tourId, role }],
    }
  }

  const session = {
    staff: raw.staff ?? null,
    orgRole: raw.orgRole ?? null,
    activeTourId: raw.activeTourId ?? null,
    tourRole: raw.tourRole ?? null,
    assignments: Array.isArray(raw.assignments) ? raw.assignments : [],
  }
  if (!session.staff?.id) return null

  // กันสิทธิ์บานปลาย: ไม่มี orgRole → activeTourId ต้องอยู่ในรายการที่ถูกมอบหมาย
  if (!session.orgRole) {
    const assigned = session.assignments.find((a) => a.tourId === session.activeTourId)
    if (assigned) {
      session.tourRole = assigned.role
    } else {
      const first = session.assignments[0]
      if (!first) return null
      session.activeTourId = first.tourId
      session.tourRole = first.role
    }
  }

  return session
}

export function saveStaffSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // localStorage อาจถูกบล็อก (private mode) — ผู้ใช้แค่ต้อง login ใหม่
  }
}

export function getStaffSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function clearStaffSession() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}

/**
 * สลับทริปที่กำลังทำงานอยู่ — ทำได้เฉพาะคนที่มี orgRole
 * คืน session ใหม่ หรือ null ถ้าไม่มีสิทธิ์
 */
export function switchActiveTour(tourId) {
  const session = getStaffSession()
  if (!session) return null

  if (!session.orgRole) {
    const assigned = session.assignments.find((a) => a.tourId === tourId)
    if (!assigned) {
      console.warn('[staffSession] ไม่มีสิทธิ์เข้าทริปนี้')
      return null
    }
    session.tourRole = assigned.role
  }

  session.activeTourId = tourId
  saveStaffSession(session)
  return session
}

/** tour_id ที่ทีมงานกำลังทำงานอยู่ — แทน ACTIVE_TOUR_ID ฝั่ง staff */
export function getActiveTourId() {
  return getStaffSession()?.activeTourId ?? null
}

/** org ของทีมงานที่ล็อกอินอยู่ — แทน ACTIVE_ORG_ID */
export function getActiveOrgId() {
  return getStaffSession()?.staff?.org_id ?? LEGACY_ORG_ID
}

/**
 * ใช้ในหน้า staff แทน ACTIVE_TOUR_ID
 * (ไม่ใช่ React hook จริง แต่ตั้งชื่อให้อ่านเข้าคู่กับ useTourId ฝั่ง guest)
 */
export function useActiveTourId() {
  return getActiveTourId() ?? LEGACY_TOUR_ID
}

/** ใช้ในหน้า staff แทน ACTIVE_ORG_ID */
export function useActiveOrgId() {
  return getActiveOrgId()
}
