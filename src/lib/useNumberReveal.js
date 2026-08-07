import { useEffect, useRef, useState } from 'react'

export const REVEAL_DURATION_MS = 2000

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * ตรรกะล้วนๆ ว่า "ควรหมุนไหม" — แยกออกมาจาก hook เพื่อให้เทสต์ได้โดยไม่ต้อง render
 *
 * @param {{length:number,last:number|null}|null} prev สถานะครั้งก่อน (null = เห็นครั้งแรก)
 * @param {{length:number,last:number|null}} next สถานะปัจจุบัน
 * @param {boolean} enabled สวิตช์เอฟเฟกต์
 * @param {boolean} reducedMotion ผู้ใช้ตั้งค่าลดการเคลื่อนไหว
 */
export function shouldReveal(prev, next, enabled, reducedMotion) {
  if (prev === null) return false // โหลดครั้งแรก เลขที่มีอยู่แล้วไม่ใช่ของใหม่
  if (next.last === null || next.last === prev.last) return false
  // ได้เลขมาทีเดียวหลายตัว (สัญญาณหลุดแล้วกลับมา) → กระโดดไปเลขล่าสุดเลย
  // ไม่หมุนไล่ทีละตัวให้เสียเวลา
  if (next.length !== prev.length + 1) return false
  if (!enabled || reducedMotion) return false
  return true
}

/**
 * ตัดสินว่า "ตอนนี้ควรหมุนเลขอยู่ไหม" จากรายการเลขที่ประกาศแล้ว
 *
 * ทั้งเครื่อง staff และมือถือลูกทัวร์ใช้ hook ตัวเดียวกัน จึงลุ้นพร้อมกัน
 * โดยไม่ต้องยิง query เพิ่มแม้แต่ครั้งเดียว — อาศัย realtime event ของ
 * bingo_games ที่หน้าทั้งสอง subscribe อยู่แล้ว
 *
 * @param {number[]} calledNumbers เลขที่ประกาศแล้ว (เรียงตามเวลา)
 * @param {boolean}  enabled       สวิตช์เอฟเฟกต์ระดับห้อง
 * @param {string}   resetKey      id ห้องเกม — เปลี่ยนห้องแล้วเริ่มนับใหม่
 * @returns {{ revealing: number|null, isRevealing: boolean }}
 */
export function useNumberReveal(calledNumbers, enabled, resetKey) {
  const called = calledNumbers ?? []
  const length = called.length
  const last = length > 0 ? called[length - 1] : null

  const [revealing, setRevealing] = useState(null)
  const prevRef = useRef(null) // null = ยังไม่เคยเห็นข้อมูลชุดนี้
  const keyRef = useRef(resetKey)
  const timerRef = useRef(0)

  useEffect(() => {
    // สลับห้อง / เพิ่งเข้าห้อง → ถือว่าเป็นการเห็นครั้งแรก ไม่ต้องหมุน
    if (keyRef.current !== resetKey) {
      keyRef.current = resetKey
      prevRef.current = null
      clearTimeout(timerRef.current)
      setRevealing(null)
    }

    const prev = prevRef.current
    prevRef.current = { length, last }

    if (!shouldReveal(prev, { length, last }, enabled, prefersReducedMotion())) return

    setRevealing(last)
    clearTimeout(timerRef.current)
    // ตั้งเวลาปิดไว้ตรงนี้ = กันเคส animation ค้าง (สลับแท็บ/หน้าถูกซ่อน แล้ว
    // requestAnimationFrame หยุดเดิน) เลขจะไม่ถูกกักจนกดติ๊กไม่ได้ถาวร
    timerRef.current = setTimeout(() => setRevealing(null), REVEAL_DURATION_MS)
  }, [length, last, enabled, resetKey])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return { revealing, isRevealing: revealing !== null }
}
