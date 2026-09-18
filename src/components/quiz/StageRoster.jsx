import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { teamStyle } from '../../lib/quizStyle'

// รายชื่อคนที่เข้าห้องแล้ว บนจอใหญ่ตอนห้องรอ — ใช้ร่วมกันทั้ง 5 เกม
//
// ★ จอใหญ่คือเครื่องมือเรียกคนที่ดีที่สุดที่เรามี (เจ้าของโปรเจกต์ขอ 17 ก.ย. 2026)
//   ตัวเลข "38 คน" ไม่ทำให้ใครหยิบมือถือ แต่ชื่อเพื่อนที่โผล่ขึ้นจอทีละคนทำ
//   คนที่ยังไม่เข้าจะเห็นว่าตัวเองไม่อยู่บนจอ แล้วเข้าเองโดยไม่ต้องประกาศซ้ำ
//
// กติกาที่ทำให้มันใช้ได้จริงบนรถ/บนเวที:
//   · เรียงตามเวลาเข้าห้อง และ "ห้ามสลับที่" — ถ้าเรียงคนใหม่ขึ้นก่อน ทุกครั้งที่มีคนเข้า
//     ชื่อทั้งจอจะขยับ คนที่กำลังไล่หาชื่อตัวเองต้องเริ่มหาใหม่ทุก 3 วินาที
//   · คนเข้าใหม่เรืองแสง แล้วกลับเป็นปกติเอง — และ "ไม่มีวันถูกตัดทิ้ง" แม้ชื่อจะล้นจอ
//     (คนเพิ่งสแกนเข้ามาต้องเห็นชื่อตัวเองบนจอ ไม่งั้นจะนึกว่าเข้าไม่สำเร็จแล้วสแกนซ้ำ)
//   · ห้ามล้นจอ และห้ามตัดชื่อครึ่งบรรทัด — จอโปรเจกเตอร์เลื่อนไม่ได้ และ overflow: hidden
//     เฉยๆ จะได้แถวล่างสุดถูกเฉือนครึ่งตัวอักษร ซึ่งดูเหมือนจอเสียมากกว่าดูเหมือนรายชื่อ
//     จึงวัดของจริงแล้ว "ตัดเป็นคนๆ" จนพอดี ที่เหลือยุบเป็น +N
export default function StageRoster({
  players = [],
  tone = 'dark',            // 'dark' = สกินควิซพื้นเข้ม · 'light' = กล่องขาวสกิน arcade
  max = 60,
  className = '',
}) {
  const { t } = useTranslation()
  const boxRef = useRef(null)
  const ordered = players
  const limit = useFitCount(boxRef, Math.min(ordered.length, max), [ordered.length])

  // เต็มจอแล้วแต่มีคนเพิ่งเข้า: ดันคนใหม่เข้าไปแทนที่คนกลางๆ ที่ถูกยุบเป็น +N อยู่แล้ว
  const freshOnes = ordered.filter((p) => p.fresh)
  const head = ordered.slice(0, Math.max(limit - freshOnes.filter((p) => ordered.indexOf(p) >= limit).length, 0))
  const shown = [...head, ...freshOnes.filter((p) => !head.includes(p))].slice(0, Math.max(limit, 1))
  const rest = ordered.length - shown.length

  if (players.length === 0) return null
  const light = tone === 'light'
  const chipFont = { fontSize: 'clamp(0.95rem, 1.6vw, 1.9rem)', padding: '0.3em 0.85em' }

  return (
    <div
      ref={boxRef}
      className={`flex w-full min-h-0 flex-wrap content-start items-start justify-center gap-2 overflow-hidden ${className}`}
    >
      {shown.map((p) => {
        const st = p.team_color_index != null ? teamStyle(p.team_color_index) : null
        return (
          <span
            key={p.id}
            className={[
              'inline-flex max-w-full items-center gap-2 rounded-full font-black',
              light ? 'border-[3px] border-black' : '',
              p.fresh
                ? (light ? 'bg-[#f2f75f] text-black' : 'bg-white text-black')
                : (light ? 'bg-white text-black' : 'bg-white/10 text-current'),
            ].join(' ')}
            style={{
              ...chipFont,
              // เรืองแสงตอนเพิ่งเข้า แล้วจางกลับเองเมื่อ fresh หมดอายุ (useRoomPlayers)
              transition: 'background-color .4s ease, box-shadow .4s ease',
              boxShadow: p.fresh && !light ? '0 0 0 4px rgba(255,255,255,.35)' : undefined,
            }}
          >
            {st && (
              <span aria-hidden className="h-[0.55em] w-[0.55em] flex-none rounded-full" style={{ background: st.color }} />
            )}
            <span className="truncate">{p.display_name}</span>
          </span>
        )
      })}

      {rest > 0 && (
        <span
          className={`inline-flex items-center rounded-full font-black ${
            light ? 'border-[3px] border-black bg-white text-black' : 'bg-white/10'
          }`}
          style={chipFont}
        >
          {t('quizRoster.more', { n: rest })}
        </span>
      )}
    </div>
  )
}

/**
 * จำนวนชื่อที่ใส่ลงกล่องได้โดยไม่ล้น — วัดของจริง ไม่เดาจากจำนวนตัวอักษร
 *
 * ชื่อไทยยาวไม่เท่ากัน ("ก้อย" กับ "ผู้โดยสารคนที่ 37") และจอก็มีตั้งแต่ทีวี 15 นิ้วบนรถ
 * ถึงโปรเจกเตอร์ 1920 — สูตรคำนวณล่วงหน้าพลาดแน่ ลดทีละคนจนไม่ล้นแทน
 * (ลดแล้วความสูงลดลงเสมอ จึงหยุดแน่นอน ใส่เพดานรอบไว้กันพลาดอยู่ดี)
 */
function useFitCount(ref, total, deps) {
  const [limit, setLimit] = useState(total)
  const rounds = useRef(0)

  // ค่าใหม่ทุกครั้งที่จำนวนคนเปลี่ยน — คนเข้าเพิ่มต้องได้ลองใส่ใหม่
  useEffect(() => {
    rounds.current = 0
    setLimit(total)
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || limit <= 1) return
    if (el.scrollHeight <= el.clientHeight + 1) return
    if (rounds.current > 80) return
    rounds.current += 1
    setLimit((n) => Math.max(n - 1, 1))
  })

  return Math.min(limit, total)
}
