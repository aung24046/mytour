// ตรรกะของเกมสุ่มรายชื่อ — แยกจากหน้าจอเพราะจอใหญ่ มือถือทีมงาน และมือถือลูกทัวร์
// ต้องคิดเรื่อง "ใครอยู่ในกลุ่มสุ่ม" ให้ตรงกันเป๊ะ ถ้าคำนวณคนละที่จะเพี้ยนกันแน่นอน
//
// ทุกฟังก์ชันในไฟล์นี้เป็น pure — ไม่แตะ supabase ไม่แตะ DOM เทสต์ได้ตรงๆ

/** คนนอกระบบที่ทีมงานพิมพ์เพิ่มเอง (คนขับ ไกด์ท้องถิ่น) เก็บใน draw_rooms.extras */
export function extraToPerson(x) {
  return { id: x.id, name: x.name, nickname: x.name, isExtra: true }
}

/**
 * รวมรายชื่อทั้งหมดของห้อง = ลูกทัวร์ในทริป + คนที่เพิ่มเอง
 * ชื่อเล่นที่ประกาศบนเวทีใช้ nicknames ของห้องก่อน แล้วค่อยตกไปที่ชื่อเล่นจริง
 */
export function roomMembers(room, guests) {
  const nicks = room?.nicknames ?? {}
  const base = (guests ?? []).map((g) => ({
    id: g.id,
    name: g.name ?? '',
    nickname: nicks[g.id] || g.nickname || g.name || '',
    busId: g.bus_id ?? null,
    checkedIn: Boolean(g.check_in_status),
    isExtra: false,
  }))
  const extras = (room?.extras ?? []).map((x) => ({
    ...extraToPerson(x),
    nickname: nicks[x.id] || x.name,
    busId: null,
    checkedIn: true, // คนขับไม่ต้องเช็คอิน แต่ต้องสุ่มถึงได้
  }))
  return [...base, ...extras]
}

/**
 * ตัวกรองเลือกได้ทีละอัน: ทั้งหมด / รถคันหนึ่ง / กลุ่มที่ตั้งเอง
 * คนที่เพิ่มเองไม่ผ่านตัวกรองรถ (ไม่มีที่นั่ง) แต่ต้องไม่หายไปจากกลุ่ม
 */
export function passesFilter(room, p) {
  if (room?.filter_kind === 'custom') return (room.custom_ids ?? []).includes(p.id)
  if (room?.filter_kind === 'bus') return p.isExtra || p.busId === room.filter_bus
  return true
}

/** คนที่จะถูกแสดงในแท็บรายชื่อ (ยังไม่หักคนที่ติ๊กออกหรือถูกสุ่มไปแล้ว) */
export function visibleMembers(room, guests) {
  return roomMembers(room, guests).filter((p) => passesFilter(room, p))
}

/**
 * กลุ่มที่จะถูกสุ่มจริง — ผ่านตัวกรอง ไม่ถูกติ๊กออก เช็คอินแล้ว (ถ้าเปิด)
 * และยังไม่เคยถูกสุ่มในห้องนี้ (ถ้าเปิดกันซ้ำ)
 */
export function drawPool(room, guests, results) {
  const excluded = new Set(room?.excluded_ids ?? [])
  const already = new Set((results ?? []).map((r) => r.guest_id ?? r.display_name))
  return visibleMembers(room, guests).filter((p) => {
    if (excluded.has(p.id)) return false
    if (room?.checkin_only && !p.checkedIn) return false
    if (room?.no_repeat && (already.has(p.id) || (p.isExtra && already.has(p.nickname)))) return false
    return true
  })
}

/** รางวัลที่กำลังสุ่มอยู่ — ที่ทีมงานเลือกไว้ก่อน ถ้าหมดแล้วเลื่อนไปชิ้นถัดไปเอง */
export function currentPrize(room, prizes) {
  if (!room?.use_prizes) return null
  const list = prizes ?? []
  const picked = list.find((p) => p.id === room.current_prize_id && p.qty_left > 0)
  return picked ?? list.find((p) => p.qty_left > 0) ?? null
}

/** สุ่มหลายคนเฉลยทีละชื่อไม่ได้ — สล็อตกับวงล้อจึงใช้ได้เฉพาะตอนสุ่มทีละคน */
export function animationFor(count, wanted) {
  return count > 1 ? 'elim' : wanted
}

/** seed สั้นๆ ไว้โชว์บนจอใหญ่ ให้ตรวจย้อนได้ว่ารอบไหนคือรอบไหน */
export function makeSeed(rand = Math.random) {
  return rand().toString(36).slice(2, 8).toUpperCase()
}

/**
 * หยิบคน n คนแบบไม่ซ้ำภายในรอบเดียวกัน
 * รับ rand เข้ามาเพื่อให้เทสต์กำหนดผลได้
 */
export function pickWinners(pool, n, rand = Math.random) {
  const left = [...(pool ?? [])]
  const out = []
  const want = Math.min(Math.max(1, n | 0), left.length)
  while (out.length < want) {
    out.push(left.splice(Math.floor(rand() * left.length), 1)[0])
  }
  return out
}

/**
 * แปลงผู้ชนะเป็นแถวที่จะบันทึกลง draw_results
 * รางวัลเหลือน้อยกว่าจำนวนคนที่สุ่มได้ — คนที่เกินมาต้องไม่ถูกติดป้ายรางวัลที่ไม่มีจริง
 */
export function buildResultRows(winners, { room, prize, roundNo, seed, isReroll = false }) {
  let left = prize ? prize.qty_left : 0
  return (winners ?? []).map((w, i) => {
    const got = prize && left > 0
    if (got) left -= 1
    return {
      room_id: room?.id ?? null,
      guest_id: w.isExtra ? null : w.id,
      display_name: w.nickname || w.name,
      full_name: w.name || '',
      prize_id: got ? prize.id : null,
      prize_name: got ? prize.name : null,
      round_no: roundNo ?? 0,
      seq: i + 1,
      seed: seed ?? null,
      was_reroll: Boolean(isReroll) && i === 0,
    }
  })
}

/** แก้จำนวนรางวัลระหว่างงาน — ของที่จ่ายไปแล้วต้องไม่ถูกคืนกลับมาให้สุ่มซ้ำ */
export function reconcilePrizeQty(prize, nextQty) {
  const used = Math.max(0, (prize?.qty ?? 0) - (prize?.qty_left ?? 0))
  const qty = Math.max(0, nextQty | 0)
  return { qty, qty_left: Math.max(0, qty - used) }
}
