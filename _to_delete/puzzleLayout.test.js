import { describe, expect, it } from 'vitest'

import { clueGrid, splitSyllables, validateClues } from '../puzzleLayout'

const sq = (n) => Array(n).fill(1)          // รูปจัตุรัส
const tall = (n) => Array(n).fill(0.6)      // กว้าง/สูง = 0.6 → แนวตั้ง
const wide = (n) => Array(n).fill(3)        // พาโนรามา

describe('clueGrid', () => {
  it('รูปเดียวได้ช่องเดียว ไม่ใช่แถวที่มีที่ว่างสองช่อง', () => {
    expect(clueGrid(1, { aspects: sq(1) }).columns).toBe(1)
  })

  it('สามรูปจัตุรัสบนจอเวที = แถวเดียวสามช่อง (ตรงกับเอกสารตัวอย่าง)', () => {
    const g = clueGrid(3, { surface: 'stage', aspects: sq(3) })
    expect(g).toMatchObject({ columns: 3, rows: 1, centerLastRow: false })
  })

  it('สี่รูปเป็น 2×2 ไม่ใช่ 3+1', () => {
    expect(clueGrid(4, { aspects: sq(4) })).toMatchObject({ columns: 2, rows: 2 })
  })

  it('ห้ารูปต้องจัดแถวล่างกึ่งกลาง ไม่ปล่อยชิดซ้าย', () => {
    const g = clueGrid(5, { surface: 'stage', aspects: sq(5) })
    expect(g).toMatchObject({ columns: 3, rows: 2, lastRowCount: 2, centerLastRow: true })
  })

  it('หกรูปเต็มพอดี ไม่ต้องจัดกึ่งกลาง', () => {
    expect(clueGrid(6, { surface: 'stage', aspects: sq(6) })).toMatchObject({
      columns: 3,
      centerLastRow: false,
    })
  })

  it('รูปแนวตั้งส่วนใหญ่ → ลดคอลัมน์ กันภาพสูงจนล้นจอ', () => {
    expect(clueGrid(3, { surface: 'stage', aspects: tall(3) }).columns).toBe(2)
  })

  it('รูปแนวตั้งไม่ลดต่ำกว่า 2 คอลัมน์', () => {
    expect(clueGrid(4, { surface: 'stage', aspects: tall(4) }).columns).toBe(2)
  })

  it('รูปพาโนรามา ≤3 ใบ เรียงแถวเดียว', () => {
    expect(clueGrid(2, { surface: 'stage', aspects: wide(2) }).columns).toBe(2)
    expect(clueGrid(3, { surface: 'stage', aspects: wide(3) }).columns).toBe(3)
  })

  it('มือถือแนวตั้งไม่เกิน 2 คอลัมน์ แม้จะมี 6 รูป', () => {
    expect(clueGrid(6, { surface: 'phone', aspects: sq(6) }).columns).toBe(2)
  })

  it('ไม่รู้สัดส่วนรูปเลยก็ต้องได้กริดที่ใช้ได้', () => {
    expect(clueGrid(3, { surface: 'stage', aspects: [] }).columns).toBe(3)
    expect(clueGrid(3, { surface: 'stage' }).columns).toBe(3)
  })

  it('จำนวนนอกช่วงถูกบีบเข้าช่วง ไม่ระเบิด', () => {
    expect(clueGrid(0).columns).toBe(1)
    expect(clueGrid(99).columns).toBe(3)
  })
})

describe('splitSyllables', () => {
  it('แยกด้วยขีดกลาง', () => {
    expect(splitSyllables('ภู-กระ-ดึง')).toEqual(['ภู', 'กระ', 'ดึง'])
  })
  it('เว้นวรรคเกินและขีดซ้ำไม่ทำให้ได้พยางค์ว่าง', () => {
    expect(splitSyllables(' กา - ละ--แม ')).toEqual(['กา', 'ละ', 'แม'])
  })
  it('ว่างได้ ไม่พัง', () => {
    expect(splitSyllables('')).toEqual([])
    expect(splitSyllables(null)).toEqual([])
  })
})

describe('validateClues', () => {
  it('ต้องมีอย่างน้อยหนึ่งชิ้น', () => {
    expect(validateClues([])).toMatch(/อย่างน้อย/)
    expect(validateClues([{ body: '  ' }])).toMatch(/อย่างน้อย/)
  })
  it('เกินหกชิ้นไม่ได้', () => {
    expect(validateClues(Array(7).fill({ body: 'x' }))).toMatch(/สูงสุด/)
  })
  it('หนึ่งถึงหกชิ้นผ่าน', () => {
    expect(validateClues([{ body: 'x' }])).toBeNull()
    expect(validateClues(Array(6).fill({ body: 'x' }))).toBeNull()
  })
})
