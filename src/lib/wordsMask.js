// ตัวแยกคำไทยเป็น "ช่อง" สำหรับเกม What Words
//
// โจทย์ของเกมคือคำที่ตัวอักษรบางตัวหายไป แต่สระบน/สระล่าง/วรรณยุกต์ยังค้างอยู่ที่เดิม
//   ปีใหม่  →  _ี ใ ห _่
// จึงต้องรู้ว่าเครื่องหมายไหน "เกาะ" อยู่กับตัวไหน — หน่วยที่ใช้คือ "ช่อง" (cell)
//   { c: ตัวฐาน 1 ตัว, m: เครื่องหมายที่เกาะอยู่ (0 ตัวขึ้นไป), h: ซ่อนไหม }
//
// ตัวฐาน = อะไรก็ได้ที่กินที่ในบรรทัด: พยัญชนะ · สระหน้า (เ แ โ ใ ไ) · สระหลัง (ะ า) · ๆ · ตัวเลข · อังกฤษ
// เครื่องหมาย = อักขระที่ไม่กินที่ (combining) ของไทย: ั ิ ี ึ ื ุ ู ฺ ็ ่ ้ ๊ ๋ ์ ํ ๎ — และสระอำ (ดูข้างล่าง)
//
// ★ ไฟล์นี้เป็นตัวแยกตัวเดียวของทั้งระบบ — ฝั่ง DB ไม่แยกเอง แค่ตรวจว่า
//   ช่องที่ส่งไปต่อกันแล้วเป็นคำเดิม และเครื่องหมายเป็นเครื่องหมายจริง (quiz_words_upsert)
//   ถ้าแยกสองที่ วันหนึ่งสองที่จะแยกไม่ตรงกัน แล้วช่องที่เปิดจะผิดตัว

const MARKS = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/

const SARA_AM = '\u0E33'

export const MAX_CELLS = 30

export function isMark(ch) {
  return MARKS.test(ch)
}

/** แยกคำเป็นช่อง — ช่องว่างกลายเป็นช่องที่ซ่อนไม่ได้ (เว้นวรรคระหว่างคำ) */
export function splitCells(text) {
  const cells = []
  for (const ch of Array.from((text ?? '').normalize('NFC'))) {
    if (/\s/.test(ch)) {
      // ช่องว่างซ้อนกันยุบเหลือช่องเดียว และไม่เอาช่องว่างหัว/ท้าย
      if (cells.length && cells[cells.length - 1].c !== ' ') cells.push({ c: ' ', m: '', h: false })
      continue
    }
    // ★ สระอำเกาะตัวหน้าเหมือนเครื่องหมาย ทั้งที่ Unicode นับเป็นตัวที่กินที่
    //   เพราะวงกลมนิคหิตของมันต้องวาดคร่อมพยัญชนะตัวหน้า — ถ้าแยกเป็นช่องของตัวเอง
    //   แล้วพยัญชนะหน้าถูกซ่อน "_้ำ" จะวาดออกมาเหลือแค่ "_้า" ซึ่งอ่านเป็นคำอื่น
    //   (เจอจากภาพทดสอบ น้ำตก) ผลคือซ่อนสระอำแยกไม่ได้ ซึ่งแทบไม่มีใครอยากทำอยู่แล้ว
    if (isMark(ch) || ch === SARA_AM) {
      // เครื่องหมายไม่มีตัวฐาน (พิมพ์ผิด) — เกาะช่องก่อนหน้า หรือเปิดช่องเปล่าให้
      const last = cells[cells.length - 1]
      if (last && last.c !== ' ') last.m += ch
      else cells.push({ c: '', m: ch, h: false })
      continue
    }
    cells.push({ c: ch, m: '', h: false })
  }
  while (cells.length && cells[cells.length - 1].c === ' ') cells.pop()
  return cells
}

/** ช่องนี้ซ่อนได้ไหม — ช่องว่างและช่องที่ไม่มีตัวฐานซ่อนไม่ได้ */
export function canHide(cell) {
  return Boolean(cell && cell.c && cell.c !== ' ')
}

/** ต่อช่องกลับเป็นคำ */
export function joinCells(cells) {
  return (cells ?? []).map((x) => `${x.c ?? ''}${x.m ?? ''}`).join('')
}

/**
 * แยกคำใหม่แต่พยายามจำว่าช่องไหนเคยซ่อนไว้ — คนสร้างข้อพิมพ์แก้คำ (เช่น เติมตัวท้าย)
 * แล้วไม่ควรต้องมาไล่แตะซ่อนใหม่ทั้งคำ
 * จับคู่แบบตรงตำแหน่งก่อน ถ้าตัวฐานยังเหมือนเดิมก็คงสถานะซ่อนไว้
 */
export function resplit(text, previous = []) {
  const next = splitCells(text)
  return next.map((cell, i) => {
    const old = previous[i]
    const keep = old && old.c === cell.c && canHide(cell) ? Boolean(old.h) : false
    return { ...cell, h: keep }
  })
}

/** โจทย์ที่ลูกทัวร์เห็น — ช่องที่ซ่อนไม่มีตัวฐาน (แต่เครื่องหมายยังอยู่) */
export function maskCells(cells) {
  return (cells ?? []).map((x) => ({ c: x.h ? null : x.c, m: x.m ?? '' }))
}

export function hiddenSlots(cells) {
  const out = []
  ;(cells ?? []).forEach((x, i) => {
    if (x.h || x.c === null) out.push(i)
  })
  return out
}

/**
 * รวมตัวที่คนคุมเกมเปิดแล้ว (session.hint_payload = [{ slot, char, m }]) เข้ากับโจทย์
 * คืนช่องพร้อมสถานะ: 'shown' (เห็นอยู่แล้ว) · 'hidden' · 'opened' (เพิ่งเปิด)
 * m ของ payload มาก่อน — Word Shuffle ซ่อนเครื่องหมายด้วย โจทย์จึงไม่มี m ให้ใช้
 *   (ห้อง What Words ที่เปิดก่อน 12 ก.ย. 2026 payload ไม่มี m → ใช้ของโจทย์เหมือนเดิม)
 */
export function applyOpened(maskedCells, opened = []) {
  const bySlot = new Map()
  for (const o of opened ?? []) {
    if (o && Number.isInteger(o.slot) && typeof o.char === 'string') bySlot.set(o.slot, o)
  }
  return (maskedCells ?? []).map((x, i) => {
    if (x.c !== null && x.c !== undefined) return { c: x.c, m: x.m ?? '', state: 'shown' }
    const o = bySlot.get(i)
    if (o) return { c: o.char, m: typeof o.m === 'string' ? o.m : x.m ?? '', state: 'opened' }
    return { c: null, m: x.m ?? '', state: 'hidden' }
  })
}

/** ตรวจก่อนบันทึก — คืนรหัส error (ไว้แปลเป็นข้อความ) หรือ null */
export function validateCells(cells) {
  if (!cells || cells.length === 0) return 'needAnswer'
  if (cells.length > MAX_CELLS) return 'tooLong'
  if (!cells.some((x) => x.h && canHide(x))) return 'needHidden'
  return null
}

/** จอเฉลย — ตัวที่เคยซ่อนเป็นกล่องสีเขียว ให้เห็นว่าคำตอบคือตัวไหน */
export function revealCells(fullCells) {
  return (fullCells ?? []).map((x) => ({ c: x.c, m: x.m ?? '', state: x.h ? 'answer' : 'shown' }))
}

/** จอคนคุมเกม — ตัวที่ซ่อนและยังไม่เปิดเห็นจางๆ (peek) แตะเพื่อเปิดได้ */
export function hostCells(fullCells, opened = []) {
  const openedSlots = new Set((opened ?? []).map((o) => o?.slot))
  return (fullCells ?? []).map((x, i) => ({
    c: x.c,
    m: x.m ?? '',
    state: !x.h ? 'shown' : openedSlots.has(i) ? 'opened' : 'peek',
  }))
}

// ═══════════════════════════════════════════════════════════════════════
// Word Shuffle — เกมพี่น้องของ What Words (ใช้ช่องชุดเดียวกัน)
// ═══════════════════════════════════════════════════════════════════════
// โจทย์ = ตัวอักษรของคำตอบที่สลับที่แล้ว (เครื่องหมายติดไปกับตัวของมัน) · ช่องคำตอบว่างทุกช่อง
//   แม่ฮ่องสอน  →  กอง: ฮ่ ง แ อ ม่ อ น ส
// ช่องที่ไม่ใช่ช่องว่างซ่อนทุกช่อง — ช่องว่างระหว่างคำยังเห็นเป็นช่องว่าง และไม่เข้ากอง

const tileText = (x) => `${x?.c ?? ''}${x?.m ?? ''}`

/** แยกคำตอบเป็นช่องของ Word Shuffle — ซ่อนทุกช่องที่มีตัวฐาน */
export function shuffleCells(text) {
  return splitCells(text).map((x) => ({ ...x, h: canHide(x) }))
}

/** โจทย์ที่ลูกทัวร์เห็น (Word Shuffle) — ช่องที่ซ่อนว่างทั้งตัวทั้งเครื่องหมาย เหมือนที่ DB เก็บ */
export function maskShuffle(cells) {
  return (cells ?? []).map((x) => (x.h ? { c: null, m: '' } : { c: x.c, m: x.m ?? '' }))
}

/** ตัวในกอง (ยังไม่สลับ) = ช่องที่ซ่อน เรียงตามคำตอบ */
export function tilesOf(cells) {
  return (cells ?? []).filter((x) => x.h).map((x) => ({ c: x.c, m: x.m ?? '' }))
}

/** กองนี้เป็นตัวชุดเดียวกับคำตอบไหม (นับตัวซ้ำด้วย) */
export function samePoolLetters(pool, cells) {
  const a = (pool ?? []).map(tileText).sort()
  const b = tilesOf(cells).map(tileText).sort()
  return a.length === b.length && a.every((t, i) => t === b[i])
}

/** จำนวนตำแหน่งที่กองยังตรงกับคำตอบ — 0 = สลับหมดทุกตัว */
export function fixedPoints(pool, cells) {
  const tiles = tilesOf(cells)
  return (pool ?? []).filter((x, i) => tiles[i] && tileText(x) === tileText(tiles[i])).length
}

function allSame(tiles) {
  return tiles.every((x) => tileText(x) === tileText(tiles[0]))
}

/**
 * สลับตัวอักษร — สุ่มหลายรอบแล้วเลือกรอบที่ "ตัวอยู่ที่เดิม" น้อยที่สุด
 * ★ ไม่ใช่สุ่มครั้งเดียว: คำสั้นอย่าง ทะเล (4 ตัว) สุ่มครั้งเดียวมีโอกาสได้ลำดับเดิมหรือเกือบเดิม
 *   สูงพอจะเจอในข้อจริง — ลำดับที่ตรงคำตอบ DB ไม่รับอยู่แล้ว (quiz_words_upsert)
 * rng รับเข้ามาเพื่อให้ทดสอบได้แน่นอน
 */
export function shuffleTiles(cells, rng = Math.random) {
  const tiles = tilesOf(cells)
  if (tiles.length < 2 || allSame(tiles)) return tiles
  let best = null
  let bestFixed = Infinity
  for (let round = 0; round < 24 && bestFixed > 0; round++) {
    const next = tiles.slice()
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[next[i], next[j]] = [next[j], next[i]]
    }
    const fixed = fixedPoints(next, cells)
    const same = next.every((x, i) => tileText(x) === tileText(tiles[i]))
    if (!same && fixed < bestFixed) {
      best = next
      bestFixed = fixed
    }
  }
  // สุ่มไม่หลุดจากลำดับเดิมเลย (โชคร้ายมาก) — หมุนไปหนึ่งตำแหน่ง ได้ลำดับต่างแน่นอน
  return best ?? [...tiles.slice(1), tiles[0]]
}

/** ตรวจก่อนบันทึก (Word Shuffle) — คืนรหัส error หรือ null */
export function validateShuffle(cells, pool) {
  if (!cells || cells.length === 0) return 'needAnswer'
  if (cells.length > MAX_CELLS) return 'tooLong'
  const tiles = tilesOf(cells)
  if (tiles.length < 2 || allSame(tiles)) return 'needTwo'
  if (!pool || !samePoolLetters(pool, cells)) return 'needShuffle'
  if (pool.every((x, i) => tileText(x) === tileText(tiles[i]))) return 'notShuffled'
  return null
}

/**
 * กองตัวสลับบนจอเล่น — ตัวที่ถูกเปิดลงช่องแล้วจางลง
 * จับคู่ด้วยตัวอักษร (ตัว+เครื่องหมาย) ไม่ใช่ตำแหน่ง: เปิด อ ตัวแรกของคำตอบ = จางตัว อ ตัวแรกในกอง
 *   ผู้เล่นไม่รู้ว่า อ ไหนเป็นของช่องไหนอยู่แล้ว จางตัวซ้ายสุดคือสิ่งที่คาดไว้
 * openedCells = ช่องที่ผ่าน applyOpened()/hostCells() แล้ว · allUsed = ตอนเฉลย (จางทั้งกอง)
 */
export function poolTiles(pool, openedCells = [], allUsed = false) {
  const need = new Map()
  for (const x of openedCells ?? []) {
    if (x.state === 'opened') need.set(tileText(x), (need.get(tileText(x)) ?? 0) + 1)
  }
  return (pool ?? []).map((x) => {
    const key = tileText(x)
    const left = need.get(key) ?? 0
    if (allUsed) return { c: x.c, m: x.m ?? '', used: true }
    if (left > 0) {
      need.set(key, left - 1)
      return { c: x.c, m: x.m ?? '', used: true }
    }
    return { c: x.c, m: x.m ?? '', used: false }
  })
}

// ── โหมดเรียงตัวอักษร (18 ก.ย. 2026) ────────────────────────────────────
// เจ้าของโปรเจกต์ขอ: Word Shuffle ไม่ต้องพิมพ์ตอบแล้ว — แตะตัวในกองให้ลงช่องเหมือน Scrabble
//   เหตุผล: ตัวอักษรครบอยู่ในกองแล้ว การให้พิมพ์ซ้ำคือการบังคับให้สะกดถูก ซึ่งเป็นคนละเกม
// ★ ตรรกะทั้งหมดอยู่ที่นี่ (ทดสอบได้) หน้าจอแค่เรียก — อย่าเขียนซ้ำใน Words.jsx
//
// placed = { [slot]: tileIndex } — slot คือลำดับช่องในคำตอบ · tileIndex คือลำดับตัวในกอง (pool)
//   ยึด "ลำดับตัวในกอง" ไม่ใช่ตัวอักษร เพราะกองมีตัวซ้ำได้ (อ สองตัวใน แม่ฮ่องสอน)
//   ถ้ายึดตัวอักษร จะบอกไม่ได้ว่าป้ายไหนในกองถูกหยิบไปแล้ว

/** ใส่ตัวที่ผู้เล่นวางลงในช่อง — คืน cells สำหรับ WordBoard (state ใหม่: 'filled') */
export function applyPlaced(cells, placed = {}, tiles = []) {
  return (cells ?? []).map((x, i) => {
    if (x.state !== 'hidden') return x
    const ti = placed?.[i]
    const tile = Number.isInteger(ti) ? tiles[ti] : null
    if (!tile || tile.used) return x
    return { c: tile.c, m: tile.m ?? '', state: 'filled' }
  })
}

/** ช่องว่างถัดไปที่รับตัวได้ (วนกลับหัวคำ) — null = เต็มหมดแล้ว */
export function nextEmptySlot(cells, from = 0) {
  const n = (cells ?? []).length
  if (!n) return null
  const start = ((from % n) + n) % n
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n
    if (cells[i].state === 'hidden') return i
  }
  return null
}

/** เรียงครบทุกช่องหรือยัง (ช่องที่คนคุมเกมเปิดให้นับว่าครบแล้ว) */
export function isArranged(cells) {
  const boxes = (cells ?? []).filter((x) => x.state !== 'shown')
  return boxes.length > 0 && boxes.every((x) => x.state !== 'hidden')
}

/** เหลืออีกกี่ช่องที่ยังว่าง */
export function slotsLeft(cells) {
  return (cells ?? []).filter((x) => x.state === 'hidden').length
}

/**
 * ปรับตัวที่วางไว้ให้ยังใช้ได้ หลังกระดาน/กองเปลี่ยน — ต้องเรียกทุกครั้งที่คนคุมเกมเปิดตัวใหม่
 *   · ช่องที่ถูกเปิดให้แล้ว (opened) → ถอดตัวที่ผู้เล่นวางไว้ออก ตัวนั้นกลับเข้ากอง
 *   · ตัวที่คนคุมเกมใช้ไปแล้ว (used) → ย้ายไปใช้ป้ายหน้าตาเหมือนกันที่ยังว่าง ไม่มีก็ถอดออก
 * ★ ไม่ทำแบบนี้ ผู้เล่นจะเห็นตัวเดียวกันอยู่สองที่ หรือช่องค้างตัวที่กองไม่มีแล้ว
 */
export function reconcilePlaced(placed = {}, cells = [], tiles = []) {
  const entries = Object.entries(placed ?? {})
    .map(([s, ti]) => [Number(s), ti])
    .filter(([s, ti]) => cells[s]?.state === 'hidden' && tiles[ti])
    .sort((a, b) => a[0] - b[0])

  const next = {}
  const taken = new Set()
  const moved = []
  for (const [slot, ti] of entries) {
    if (!tiles[ti].used && !taken.has(ti)) {
      next[slot] = ti
      taken.add(ti)
    } else {
      moved.push([slot, tileText(tiles[ti])])
    }
  }
  for (const [slot, text] of moved) {
    const alt = tiles.findIndex((t, i) => !t.used && !taken.has(i) && tileText(t) === text)
    if (alt >= 0) {
      next[slot] = alt
      taken.add(alt)
    }
  }
  return next
}

/** ป้ายในกองที่ผู้เล่นหยิบไปวางแล้ว — ใส่ธง picked ให้ ShufflePool ทำให้จาง */
export function markPicked(tiles = [], placed = {}) {
  const used = new Set(Object.values(placed ?? {}))
  return (tiles ?? []).map((x, i) => (used.has(i) ? { ...x, picked: true } : x))
}
