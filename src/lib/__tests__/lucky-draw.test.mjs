import {
  roomMembers, passesFilter, visibleMembers, drawPool, currentPrize,
  animationFor, pickWinners, buildResultRows, reconcilePrizeQty,
} from '../luckyDraw.js'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — ได้ ${JSON.stringify(a)}`)

const BUS1 = 'bus-1', BUS2 = 'bus-2'
const GUESTS = [
  { id: 'g1', name: 'สมชาย ใจดี', nickname: 'ชาย', bus_id: BUS1, check_in_status: true },
  { id: 'g2', name: 'ปิยะดา ศรีสุข', nickname: 'ปิ๊ก', bus_id: BUS1, check_in_status: true },
  { id: 'g3', name: 'อนุชา รัตนากร', nickname: 'ตั้ม', bus_id: BUS1, check_in_status: false },
  { id: 'g4', name: 'ชัยวัฒน์ อินทรีย์', nickname: 'วัฒน์', bus_id: BUS2, check_in_status: true },
  { id: 'g5', name: 'พรทิพย์ มณีรัตน์', nickname: '', bus_id: BUS2, check_in_status: true },
]
const room = (over = {}) => ({
  id: 'r1', filter_kind: 'all', filter_bus: null, custom_ids: [], excluded_ids: [],
  nicknames: {}, extras: [], checkin_only: true, no_repeat: true, use_prizes: true,
  current_prize_id: null, ...over,
})

console.log('── รวมรายชื่อ')
eq(roomMembers(room(), GUESTS).length, 5, 'ลูกทัวร์ 5 คน')
eq(roomMembers(room(), GUESTS).find((p) => p.id === 'g5').nickname, 'พรทิพย์ มณีรัตน์',
  'ไม่มีชื่อเล่น → ตกไปใช้ชื่อจริง (จอใหญ่ต้องไม่ว่าง)')
eq(roomMembers(room({ nicknames: { g1: 'พี่ใหญ่' } }), GUESTS).find((p) => p.id === 'g1').nickname,
  'พี่ใหญ่', 'ชื่อเล่นที่ทีมงานแก้เฉพาะห้องนี้ ชนะชื่อเล่นจริง')

const withDriver = room({ extras: [{ id: 'x1', name: 'พี่คนขับ' }] })
eq(roomMembers(withDriver, GUESTS).length, 6, 'คนนอกระบบถูกนับรวม')
ok(roomMembers(withDriver, GUESTS).find((p) => p.id === 'x1').checkedIn,
  'คนนอกระบบถือว่าเช็คอินแล้วเสมอ ไม่งั้นสุ่มไม่ถึง')

console.log('── ตัวกรองเลือกทีละอัน')
eq(visibleMembers(room(), GUESTS).length, 5, 'ทั้งหมด')
eq(visibleMembers(room({ filter_kind: 'bus', filter_bus: BUS1 }), GUESTS).map((p) => p.id),
  ['g1', 'g2', 'g3'], 'เฉพาะรถคัน 1')
eq(visibleMembers(room({ filter_kind: 'custom', custom_ids: ['g2', 'g4'] }), GUESTS).map((p) => p.id),
  ['g2', 'g4'], 'กลุ่มที่ตั้งเอง')
eq(visibleMembers(room({ filter_kind: 'custom', custom_ids: [] }), GUESTS).length, 0,
  'กลุ่มที่ตั้งเองเริ่มจากว่าง ไม่ใช่เลือกทุกคนให้')
ok(passesFilter({ filter_kind: 'bus', filter_bus: BUS1 }, { id: 'x1', isExtra: true, busId: null }),
  'คนนอกระบบไม่มีรถ แต่ต้องไม่หลุดจากตัวกรองรถ')

console.log('── กลุ่มที่จะถูกสุ่มจริง')
eq(drawPool(room(), GUESTS, []).map((p) => p.id), ['g1', 'g2', 'g4', 'g5'],
  'เปิดสวิตช์เช็คอิน → ตัดคนที่ยังไม่ขึ้นรถ (ตั้ม)')
eq(drawPool(room({ checkin_only: false }), GUESTS, []).length, 5, 'ปิดสวิตช์ → ครบ 5 คน')
eq(drawPool(room({ excluded_ids: ['g1'] }), GUESTS, []).map((p) => p.id), ['g2', 'g4', 'g5'],
  'ติ๊กออกรายคน')
eq(drawPool(room(), GUESTS, [{ guest_id: 'g2' }]).map((p) => p.id), ['g1', 'g4', 'g5'],
  'กันซ้ำ — คนที่ถูกสุ่มไปแล้วหลุดจากกลุ่ม')
eq(drawPool(room({ no_repeat: false }), GUESTS, [{ guest_id: 'g2' }]).length, 4,
  'ปิดกันซ้ำ → คนเดิมกลับเข้ากลุ่ม')
eq(drawPool(withDriver, GUESTS, [{ guest_id: null, display_name: 'พี่คนขับ' }]).map((p) => p.id),
  ['g1', 'g2', 'g4', 'g5'], 'คนนอกระบบไม่มี guest_id — กันซ้ำต้องจับจากชื่อที่ประกาศแทน')

console.log('── รางวัลที่กำลังสุ่ม')
const PZ = [
  { id: 'p1', name: 'รางวัลที่ 3', qty: 3, qty_left: 0 },
  { id: 'p2', name: 'รางวัลที่ 2', qty: 2, qty_left: 2 },
  { id: 'p3', name: 'รางวัลที่ 1', qty: 1, qty_left: 1 },
]
eq(currentPrize(room(), PZ).id, 'p2', 'ไม่ได้เลือกไว้ → ชิ้นแรกที่ยังไม่หมด')
eq(currentPrize(room({ current_prize_id: 'p3' }), PZ).id, 'p3', 'เลือกไว้แล้วใช้ตามนั้น')
eq(currentPrize(room({ current_prize_id: 'p1' }), PZ).id, 'p2', 'เลือกชิ้นที่หมดแล้ว → ข้ามไปชิ้นถัดไป')
eq(currentPrize(room({ use_prizes: false }), PZ), null, 'ปิดโหมดรางวัล → ไม่ผูกของ')
eq(currentPrize(room(), []), null, 'ไม่มีรางวัลเลย')

console.log('── สุ่มหลายคนต้องใช้แบบคัดออก')
eq(animationFor(1, 'wheel'), 'wheel', 'ทีละคนเลือกได้อิสระ')
eq(animationFor(3, 'wheel'), 'elim', 'หลายคนถูกบังคับเป็นคัดออก')
eq(animationFor(3, 'slot'), 'elim', 'สล็อตก็เช่นกัน')

console.log('── หยิบผู้ชนะ')
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length] }
const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
eq(pickWinners(pool, 2, seq(0, 0)).map((p) => p.id), ['a', 'b'], 'ไม่ซ้ำภายในรอบเดียว')
eq(pickWinners(pool, 99, seq(0, 0, 0)).length, 3, 'ขอเกินจำนวนคน → ได้เท่าที่มี')
eq(pickWinners(pool, 0, seq(0)).length, 1, 'อย่างน้อยหนึ่งคนเสมอ')
eq(pickWinners([], 3).length, 0, 'กลุ่มว่าง → ไม่พัง')

console.log('── แถวที่จะบันทึก')
const winners = [
  { id: 'g1', name: 'สมชาย ใจดี', nickname: 'ชาย', isExtra: false },
  { id: 'g2', name: 'ปิยะดา ศรีสุข', nickname: 'ปิ๊ก', isExtra: false },
  { id: 'x1', name: 'พี่คนขับ', nickname: 'พี่คนขับ', isExtra: true },
]
const rows = buildResultRows(winners, {
  room: { id: 'r1' }, prize: { id: 'p2', name: 'รางวัลที่ 2', qty_left: 1 },
  roundNo: 4, seed: 'AB12',
})
eq(rows.map((r) => r.prize_name), ['รางวัลที่ 2', null, null],
  'รางวัลเหลือ 1 ชิ้นแต่สุ่ม 3 คน → คนที่เกินมาไม่ผูกรางวัล')
eq(rows.map((r) => r.guest_id), ['g1', 'g2', null], 'คนนอกระบบไม่มี guest_id')
eq(rows.map((r) => r.display_name), ['ชาย', 'ปิ๊ก', 'พี่คนขับ'], 'ชื่อที่ประกาศคือชื่อเล่น')
eq(rows.map((r) => r.full_name), ['สมชาย ใจดี', 'ปิยะดา ศรีสุข', 'พี่คนขับ'], 'เก็บชื่อจริงคู่ไว้ด้วย')
eq(rows.map((r) => r.seq), [1, 2, 3], 'ลำดับในรอบ')
ok(rows.every((r) => r.seed === 'AB12' && r.round_no === 4), 'seed กับเลขรอบติดไปทุกแถว')
eq(buildResultRows(winners.slice(0, 1), { room: { id: 'r1' }, prize: null, roundNo: 1 })[0].prize_id,
  null, 'ปิดโหมดรางวัล → prize_id ว่าง')
eq(buildResultRows(winners.slice(0, 2), { room: { id: 'r1' }, prize: null, roundNo: 1, isReroll: true })
  .map((r) => r.was_reroll), [true, false], 'ป้ายสุ่มแทนติดเฉพาะคนแรก')

console.log('── แก้จำนวนรางวัลระหว่างงาน')
eq(reconcilePrizeQty({ qty: 3, qty_left: 3 }, 5), { qty: 5, qty_left: 5 }, 'ยังไม่จ่าย → เพิ่มได้เต็ม')
eq(reconcilePrizeQty({ qty: 3, qty_left: 1 }, 5), { qty: 5, qty_left: 3 }, 'จ่ายไป 2 แล้ว → เหลือ 3 ไม่ใช่ 5')
eq(reconcilePrizeQty({ qty: 3, qty_left: 1 }, 2), { qty: 2, qty_left: 0 }, 'ลดจนน้อยกว่าที่จ่ายไป → เหลือ 0')
eq(reconcilePrizeQty({ qty: 3, qty_left: 0 }, 1), { qty: 1, qty_left: 0 }, 'จ่ายหมดแล้วลดจำนวน')

console.log(fail === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${fail} ข้อ`)
process.exit(fail === 0 ? 0 : 1)
