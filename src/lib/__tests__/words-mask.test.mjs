// ทดสอบตัวแยกช่องของเกม What Words — node src/lib/__tests__/words-mask.test.mjs
import assert from 'node:assert/strict'
import {
  splitCells, joinCells, resplit, maskCells, hiddenSlots, applyOpened, validateCells, canHide,
  revealCells, hostCells,
  shuffleCells, tilesOf, shuffleTiles, samePoolLetters, fixedPoints, validateShuffle, poolTiles,
} from '../wordsMask.js'

let n = 0
function test(name, fn) {
  fn()
  n++
  console.log(`  ✓ ${name}`)
}

const cellText = (cells) => cells.map((x) => `${x.c}${x.m}`)

test('ปีใหม่ แยกเป็น ปี|ใ|ห|ม่ — สระบนกับวรรณยุกต์เกาะตัวหน้า', () => {
  assert.deepEqual(cellText(splitCells('ปีใหม่')), ['ปี', 'ใ', 'ห', 'ม่'])
})

test('ต่อกลับได้คำเดิมทุกคำ', () => {
  for (const w of ['ปีใหม่', 'น้ำตก', 'ผู้ใหญ่บ้าน', 'กินข้าว แล้วหรือยัง', 'ภูกระดึง', 'สงกรานต์', 'เกี๊ยว', 'ฤๅษี', 'Coffee ร้อน']) {
    assert.equal(joinCells(splitCells(w)), w.replace(/\s+/g, ' ').trim())
  }
})

test('เครื่องหมายซ้อนหลายตัว (ที่ ผู้ เกี๊ยว สงกรานต์)', () => {
  assert.deepEqual(cellText(splitCells('ที่')), ['ที่'])
  assert.deepEqual(cellText(splitCells('ผู้')), ['ผู้'])
  assert.deepEqual(cellText(splitCells('เกี๊ยว')), ['เ', 'กี๊', 'ย', 'ว'])
  assert.deepEqual(cellText(splitCells('สงกรานต์')), ['ส', 'ง', 'ก', 'ร', 'า', 'น', 'ต์'])
})

test('สระอำเกาะตัวหน้า (น้ำตก = น้ำ|ต|ก) — ไม่งั้นซ่อน น แล้วจอวาดเป็น _้า', () => {
  assert.deepEqual(cellText(splitCells('น้ำตก')), ['น้ำ', 'ต', 'ก'])
  assert.deepEqual(cellText(splitCells('ทำ')), ['ทำ'])
})

test('ช่องว่างซ้อน/หัวท้ายถูกยุบ และซ่อนไม่ได้', () => {
  const cells = splitCells('  กิน   ข้าว ')
  assert.deepEqual(cellText(cells), ['กิ', 'น', ' ', 'ข้', 'า', 'ว'])
  assert.equal(canHide(cells[2]), false)
})

test('เครื่องหมายขึ้นต้นคำ (พิมพ์ผิด) ได้ช่องเปล่าที่ซ่อนไม่ได้', () => {
  const cells = splitCells('่กา')
  assert.equal(cells[0].c, '')
  assert.equal(canHide(cells[0]), false)
  assert.equal(joinCells(cells), '่กา')
})

test('maskCells ซ่อนตัวฐานแต่เก็บเครื่องหมาย — โจทย์ในรูปตัวอย่าง', () => {
  const cells = splitCells('ปีใหม่')
  cells[0].h = true
  cells[3].h = true
  assert.deepEqual(maskCells(cells), [
    { c: null, m: 'ี' }, { c: 'ใ', m: '' }, { c: 'ห', m: '' }, { c: null, m: '่' },
  ])
  assert.deepEqual(hiddenSlots(cells), [0, 3])
  // โจทย์ที่ส่งให้ลูกทัวร์ต้องไม่มีตัวที่ซ่อนหลุดไป
  assert.ok(!JSON.stringify(maskCells(cells)).includes('ป'))
  assert.ok(!JSON.stringify(maskCells(cells)).includes('ม'))
})

test('applyOpened ใส่ตัวที่คนคุมเกมเปิดกลับเข้าช่อง', () => {
  const masked = [{ c: null, m: 'ี' }, { c: 'ใ', m: '' }, { c: 'ห', m: '' }, { c: null, m: '่' }]
  const out = applyOpened(masked, [{ slot: 3, char: 'ม' }])
  assert.deepEqual(out.map((x) => x.state), ['hidden', 'shown', 'shown', 'opened'])
  assert.equal(`${out[3].c}${out[3].m}`, 'ม่')
  // ข้อมูลเสียต้องไม่ทำให้พัง
  assert.equal(applyOpened(masked, [null, { slot: '1', char: 'x' }])[0].state, 'hidden')
})

test('resplit จำช่องที่ซ่อนไว้เมื่อพิมพ์เติมท้าย', () => {
  const cells = splitCells('ปีใหม')
  cells[0].h = true
  const next = resplit('ปีใหม่', cells)
  assert.deepEqual(next.map((x) => x.h), [true, false, false, false])
  // ตัวฐานเปลี่ยน = ล้างสถานะช่องนั้น
  assert.equal(resplit('ดีใหม่', cells)[0].h, false)
})

test('validateCells', () => {
  assert.equal(validateCells([]), 'needAnswer')
  assert.equal(validateCells(splitCells('ปีใหม่')), 'needHidden')
  const ok = splitCells('ปีใหม่')
  ok[0].h = true
  assert.equal(validateCells(ok), null)
  assert.equal(validateCells(splitCells('ก'.repeat(31)).map((x) => ({ ...x, h: true }))), 'tooLong')
})

test('revealCells / hostCells', () => {
  const full = splitCells('ปีใหม่')
  full[0].h = true
  full[3].h = true
  assert.deepEqual(revealCells(full).map((x) => x.state), ['answer', 'shown', 'shown', 'answer'])
  assert.deepEqual(hostCells(full, [{ slot: 3, char: 'ม' }]).map((x) => x.state), ['peek', 'shown', 'shown', 'opened'])
})

// ── Word Shuffle ─────────────────────────────────────────────────────
const t2s = (tiles) => tiles.map((x) => `${x.c}${x.m}`).join(' ')

// rng แบบกำหนดได้ — ทดสอบซ้ำได้ผลเดิม
function seeded(seed) {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

test('Word Shuffle: แม่ฮ่องสอน = 8 ตัว ซ่อนหมด (ม่ ฮ่ ติดวรรณยุกต์)', () => {
  const cells = shuffleCells('แม่ฮ่องสอน')
  assert.equal(t2s(tilesOf(cells)), 'แ ม่ ฮ่ อ ง ส อ น')
  assert.ok(cells.every((x) => x.h))
})

test('Word Shuffle: ช่องว่างไม่ซ่อน ไม่เข้ากอง', () => {
  const cells = shuffleCells('ภู ชี้ฟ้า')
  assert.equal(cells.find((x) => x.c === ' ').h, false)
  assert.equal(tilesOf(cells).length, cells.length - 1)
})

test('Word Shuffle: สลับแล้วตัวชุดเดิม ลำดับไม่เหมือนคำตอบ (1,000 รอบ ทั้งคำสั้นและคำยาว)', () => {
  const rng = seeded(7)
  for (const w of ['ทะเล', 'แม่ฮ่องสอน', 'กา', 'ภูกระดึง', 'อออก']) {
    const cells = shuffleCells(w)
    for (let i = 0; i < 200; i++) {
      const pool = shuffleTiles(cells, rng)
      assert.ok(samePoolLetters(pool, cells), w)
      assert.equal(validateShuffle(cells, pool), null, `${w}: ${t2s(pool)}`)
    }
  }
})

test('Word Shuffle: เลือกรอบที่ตัวอยู่ที่เดิมน้อยสุด — คำ 8 ตัวไม่ควรมีตัวค้างที่เดิม', () => {
  const cells = shuffleCells('แม่ฮ่องสอน')
  const rng = seeded(42)
  for (let i = 0; i < 50; i++) assert.equal(fixedPoints(shuffleTiles(cells, rng), cells), 0)
})

test('Word Shuffle: rng ที่ไม่ยอมสลับ ยังได้ลำดับที่ต่าง (หมุนหนึ่งตำแหน่ง)', () => {
  const cells = shuffleCells('ทะเล')
  const pool = shuffleTiles(cells, () => 0.9999)
  assert.equal(validateShuffle(cells, pool), null, t2s(pool))
})

test('Word Shuffle: validateShuffle', () => {
  const cells = shuffleCells('แม่ฮ่องสอน')
  assert.equal(validateShuffle([], []), 'needAnswer')
  assert.equal(validateShuffle(shuffleCells('ก'), []), 'needTwo')
  assert.equal(validateShuffle(shuffleCells('กก'), tilesOf(shuffleCells('กก'))), 'needTwo')
  assert.equal(validateShuffle(cells, null), 'needShuffle')
  assert.equal(validateShuffle(cells, tilesOf(cells)), 'notShuffled')
  // พิมพ์คำใหม่แต่ยังถือกองของคำเก่า
  assert.equal(validateShuffle(shuffleCells('เชียงใหม่'), shuffleTiles(cells)), 'needShuffle')
})

test('Word Shuffle: เปิดตัวแล้วตัวในกองจาง — ตัวซ้ำจางทีละตัวจากซ้าย', () => {
  const pool = [
    { c: 'ฮ', m: '่' }, { c: 'ง', m: '' }, { c: 'แ', m: '' }, { c: 'อ', m: '' },
    { c: 'ม', m: '่' }, { c: 'อ', m: '' }, { c: 'น', m: '' }, { c: 'ส', m: '' },
  ]
  const masked = shuffleCells('แม่ฮ่องสอน').map(() => ({ c: null, m: '' }))
  // เปิด ม่ (slot 1) กับ อ ตัวแรก (slot 3)
  const cells = applyOpened(masked, [{ slot: 1, char: 'ม', m: '่' }, { slot: 3, char: 'อ', m: '' }])
  assert.deepEqual(cells.map((x) => x.state), ['hidden', 'opened', 'hidden', 'opened', 'hidden', 'hidden', 'hidden', 'hidden'])
  assert.equal(`${cells[1].c}${cells[1].m}`, 'ม่', 'm มาจาก payload เพราะโจทย์ไม่มี')
  assert.deepEqual(poolTiles(pool, cells).map((x) => x.used), [false, false, false, true, true, false, false, false])
  assert.ok(poolTiles(pool, [], true).every((x) => x.used))
})

test('applyOpened: payload เก่าไม่มี m ใช้เครื่องหมายของโจทย์ (What Words)', () => {
  const masked = [{ c: null, m: 'ี' }, { c: 'ใ', m: '' }]
  assert.equal(`${applyOpened(masked, [{ slot: 0, char: 'ป' }])[0].c}${applyOpened(masked, [{ slot: 0, char: 'ป' }])[0].m}`, 'ปี')
})

console.log(`\nwords-mask: ผ่าน ${n} ข้อ`)
