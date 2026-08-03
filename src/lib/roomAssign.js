// ตรรกะจัดห้องพัก — แยกจาก component เพื่อทดสอบได้โดยไม่ต้อง render
//
// ครอบคลุม 2 เรื่อง:
//   1. ป้ายชื่อห้องตอนที่โรงแรมยังไม่ส่งเลขห้องจริงมาให้
//   2. จับคู่ผู้เข้าพักอัตโนมัติ (นามสกุลก่อน แล้วค่อยเพศ)

/** ตัวย่อประเภทห้องที่ใช้บนกล่องในผัง — สั้นพอให้อยู่ในกล่องเล็กได้ */
export const ROOM_TYPE_SHORT = {
  single: 'SGL',
  twin: 'TWN',
  double: 'DBL',
  triple: 'TRP',
  quad: 'QUAD',
  family: 'FAM',
}

export function roomTypeShort(roomType) {
  return ROOM_TYPE_SHORT[roomType] ?? String(roomType ?? '').toUpperCase().slice(0, 4)
}

/**
 * ป้ายชื่อห้องสำหรับแสดงในผัง
 * โรงแรมมักส่งเลขห้องจริงให้ตอนเช็คอิน ทีมงานจึงสร้างห้องเป็นชุดไว้ก่อนโดยยังไม่มีเลข
 * ระหว่างนั้นต้องมีชื่อเรียกที่ไม่ซ้ำกัน ไม่งั้นจัดคนลงห้องแล้วแยกไม่ออกว่าห้องไหนคือห้องไหน
 * → ใช้เลขชั่วคราวตามประเภท เช่น TWN-1, TWN-2 โดยนับเฉพาะห้องที่ยังไม่มีเลขจริง
 *
 * @returns {{ label: string, isTemporary: boolean }}
 */
export function roomLabel(room, roomsInSameHotel) {
  const actual = (room.room_number ?? '').trim()
  if (actual) return { label: actual, isTemporary: false }

  const sameTypeUnnumbered = roomsInSameHotel.filter(
    (r) => r.room_type === room.room_type && !(r.room_number ?? '').trim()
  )
  const index = sameTypeUnnumbered.findIndex((r) => r.id === room.id)
  return {
    label: `${roomTypeShort(room.room_type)}-${index < 0 ? 1 : index + 1}`,
    isTemporary: true,
  }
}

/**
 * เทียบเลขห้องแบบธรรมชาติ — '2' ต้องมาก่อน '10' ไม่ใช่หลัง
 * localeCompare ธรรมดาเทียบทีละตัวอักษร '10' จึงมาก่อน '2' เพราะ '1' < '2'
 * ต้องใช้ numeric: true ให้มันอ่านตัวเลขเป็นจำนวน และยังรองรับเลขปนตัวอักษรอย่าง '201A'
 * ห้องที่ยังไม่มีเลขถูกดันไปท้ายเสมอ
 */
export function compareRoomNumber(a, b) {
  const x = String(a ?? '').trim()
  const y = String(b ?? '').trim()
  if (!x && !y) return 0
  if (!x) return 1
  if (!y) return -1
  return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * เรียงห้องสำหรับ "แสดงผล" เท่านั้น
 *
 * สำคัญ: ต้องส่ง allRooms ที่เป็นลำดับดั้งเดิม (ตามตอนโหลด) เข้ามาด้วย
 * เพราะเลขชั่วคราว TWN-1 / TWN-2 คำนวณจากตำแหน่งในลิสต์นั้น
 * ถ้าเอาลิสต์ที่เรียงแล้วไปคำนวณซ้ำ เลขชั่วคราวจะสลับกันเองทุกครั้งที่เรียง
 *
 * ลำดับ: ห้องที่มีเลขจริงก่อน (เรียงตามเลข) → ห้องที่ยังไม่มีเลข (เรียงตามเลขชั่วคราว)
 */
export function sortRoomsForDisplay(rooms, allRooms = rooms) {
  return [...rooms].sort((a, b) => {
    const an = String(a.room_number ?? '').trim()
    const bn = String(b.room_number ?? '').trim()
    if (an && bn) return compareRoomNumber(an, bn)
    if (an) return -1
    if (bn) return 1
    return roomLabel(a, allRooms).label.localeCompare(roomLabel(b, allRooms).label, undefined, {
      numeric: true,
    })
  })
}

/** นามสกุล = คำสุดท้ายของชื่อเต็ม (คืน '' ถ้ามีคำเดียว — ชื่อเดี่ยวไม่ควรถูกจับคู่กับใคร) */
export function surnameOf(guest) {
  const parts = String(guest?.name ?? '').trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

/**
 * จัดกลุ่มผู้เข้าพักที่ยังไม่มีห้อง ตามลำดับความน่าจะอยู่ห้องเดียวกัน
 * 1) นามสกุลเดียวกัน — ครอบครัว/คู่สมรส แทบไม่มีทางผิด จึงมาก่อนเสมอ
 * 2) เพศเดียวกัน — เกณฑ์สำรองเมื่อไม่มีนามสกุลตรงกัน
 * คนที่เพศไม่ระบุจะถูกจัดไว้กลุ่มท้ายสุด ไม่ปนกับกลุ่มชาย/หญิง
 */
export function groupForPairing(guests) {
  const bySurname = new Map()
  const loose = []

  for (const guest of guests) {
    const surname = surnameOf(guest)
    if (!surname) {
      loose.push(guest)
      continue
    }
    if (!bySurname.has(surname)) bySurname.set(surname, [])
    bySurname.get(surname).push(guest)
  }

  const groups = []
  for (const [, members] of bySurname) {
    if (members.length > 1) groups.push({ reason: 'surname', members })
    else loose.push(members[0])
  }

  const byGender = new Map()
  for (const guest of loose) {
    const gender = guest.gender || '__unknown'
    if (!byGender.has(gender)) byGender.set(gender, [])
    byGender.get(gender).push(guest)
  }
  // เพศที่ระบุแล้วมาก่อน กลุ่มไม่ระบุไปท้ายสุด
  const genderKeys = [...byGender.keys()].sort((a, b) => {
    if (a === '__unknown') return 1
    if (b === '__unknown') return -1
    return 0
  })
  for (const key of genderKeys) {
    groups.push({ reason: key === '__unknown' ? 'none' : 'gender', members: byGender.get(key) })
  }

  return groups
}

/**
 * เสนอการจัดห้องอัตโนมัติ — คืน "ร่าง" ให้ทีมงานตรวจก่อน ไม่บันทึกเอง
 *
 * ตั้งใจไม่แตะห้องที่มีคนอยู่แล้ว เพราะการจัดมือก่อนหน้ามักมีเหตุผลที่ระบบไม่รู้
 * (ลูกค้าขอห้องติดกัน, ผู้สูงอายุขอชั้นล่าง) การไปสลับให้จะพังงานที่ทำไว้
 *
 * @returns {Array<{ roomId: string, guestIds: string[], reason: string }>}
 */
export function autoPair({ rooms, unassignedGuests, capacityLeftOf }) {
  const groups = groupForPairing(unassignedGuests)
  const openRooms = rooms
    .filter((room) => capacityLeftOf(room) > 0)
    .map((room) => ({ room, left: capacityLeftOf(room), touched: false }))

  const plan = []
  let roomIndex = 0

  for (const group of groups) {
    const queue = [...group.members]

    // ห้ามเอากลุ่มใหม่ไปเติมห้องที่กลุ่มก่อนหน้าใช้ค้างไว้
    // ไม่งั้นเตียงที่เหลือของห้องผู้ชายจะถูกเติมด้วยคนจากกลุ่มผู้หญิง ซึ่งผิดวัตถุประสงค์ทั้งหมด
    // ยอมให้เหลือเตียงว่างดีกว่าจับคนละเพศ/คนละครอบครัวไว้ห้องเดียวกัน
    while (roomIndex < openRooms.length && openRooms[roomIndex].touched) roomIndex += 1

    while (queue.length > 0 && roomIndex < openRooms.length) {
      const slot = openRooms[roomIndex]
      if (slot.left <= 0) {
        roomIndex += 1
        continue
      }

      const take = queue.splice(0, slot.left)
      slot.left -= take.length
      slot.touched = true

      const existing = plan.find((p) => p.roomId === slot.room.id)
      if (existing) {
        existing.guestIds.push(...take.map((g) => g.id))
      } else {
        plan.push({
          roomId: slot.room.id,
          guestIds: take.map((g) => g.id),
          reason: group.reason,
        })
      }

      if (slot.left === 0) roomIndex += 1
    }
  }

  return plan
}
