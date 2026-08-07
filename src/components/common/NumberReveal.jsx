import { useEffect, useRef, useState } from 'react'

import { REVEAL_DURATION_MS } from '../../lib/useNumberReveal'

// เอฟเฟกต์ "สล็อตหมุนช้าลง" ตอนประกาศเลขบิงโก
//
// สำคัญ: component นี้ถือ state ของตัวเองล้วนๆ และไม่รับ callback ใดๆ ที่จะไป
// setState ของหน้าแม่ระหว่างหมุน — เพราะหน้าบิงโกเพิ่งแก้อาการกระพริบไป ถ้าเลข
// ที่เปลี่ยน ~20 ครั้ง/วินาที ไปกระตุก state ของหน้าแม่ ตาราง 25 ช่องจะ re-render
// ตามทุกเฟรม แล้วอาการเดิมจะกลับมาทันที
//
// เลขจริงถูกตัดสินที่เซิร์ฟเวอร์ไปแล้วตั้งแต่ตอนกด (bingo_call_random) —
// ที่หมุนอยู่นี่คือ "การเฉลย" ไม่ใช่การสุ่มจริง จึงโกงไม่ได้แม้แก้โค้ดฝั่ง client

export default function NumberReveal({ number, spinning, max = 75, className = '' }) {
  const [display, setDisplay] = useState(number)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!spinning) {
      cancelAnimationFrame(rafRef.current)
      setDisplay(number)
      return undefined
    }

    const startedAt = performance.now()
    let nextSwapAt = 0
    let current = null

    const step = (now) => {
      const elapsed = now - startedAt
      const progress = Math.min(elapsed / REVEAL_DURATION_MS, 1)

      if (elapsed >= nextSwapAt) {
        // ยิ่งใกล้จบยิ่งสลับช้า (45ms → ~305ms) ให้ความรู้สึกว่าล้อกำลังหมด
        // แรง — ไม่อัปเดตทุกเฟรมเพราะตาอ่านไม่ทันอยู่แล้ว และเปลืองแบตฟรี
        nextSwapAt = elapsed + 45 + 260 * progress * progress
        let next = 1 + Math.floor(Math.random() * max)
        if (next === current) next = (next % max) + 1
        current = next
        setDisplay(next)
      }

      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [spinning, number, max])

  return (
    <span
      className={`tabular-nums transition-transform ${spinning ? 'scale-95 opacity-70' : 'scale-100'} ${className}`}
      // ระหว่างหมุนอย่าให้ screen reader อ่านเลขมั่วรัวๆ — อ่านเฉพาะตอนเฉลยจบ
      aria-live={spinning ? 'off' : 'polite'}
    >
      {display ?? '—'}
    </span>
  )
}
