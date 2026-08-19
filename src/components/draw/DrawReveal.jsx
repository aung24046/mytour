import { useEffect, useMemo, useRef, useState } from 'react'

import { ANIM_MS, SLOT_ROW, getTheme, slotStrip, wheelAngles } from '../../lib/drawStage'
import { playDrumroll, playTick } from '../../lib/drawSound'

// อนิเมชันเฉลยผู้ชนะ — ตัวเดียวกันนี้ถูกใช้ทั้งบนจอโปรเจกเตอร์และในมือถือลูกทัวร์
// ต่างกันแค่ prop `mini` เพื่อให้ทั้งห้องลุ้นพร้อมกันจริงๆ ไม่ใช่คนละจังหวะ
//
// ทุกแบบเล่นสองช่วง: พุ่งเร็ว → เกือบหยุดที่คนอื่น → คืบต่อช้าๆ เข้าคนจริง
// ช่วงที่สองคือหัวใจ ถ้าตัดออกจะรู้สึกเหมือน "เฉลยเลย" ไม่มีอะไรให้ลุ้น

const label = (p) => p?.nickname || p?.name || '—'

/* ── 1 · สล็อต — ชื่อวิ่งแนวตั้ง ─────────────────────────────── */
function Slot({ pool, winner, ms, mini, theme, onDone, fx }) {
  const reelRef = useRef(null)
  const strip = useMemo(() => slotStrip(pool, winner), [pool, winner])
  const H = mini ? SLOT_ROW.mini : SLOT_ROW.full

  useEffect(() => {
    const el = reelRef.current
    if (!el) return undefined
    el.style.transition = 'none'
    el.style.transform = 'translateY(0)'
    // อ่านค่าเพื่อบังคับ reflow ไม่งั้นเบราว์เซอร์ยุบสองบรรทัดนี้รวมกันแล้วไม่มีอนิเมชัน
    void el.getBoundingClientRect()

    const ticker = fx && !mini ? setInterval(() => playTick(1750), 90) : null
    el.style.transition = `transform ${ms * 0.72}ms cubic-bezier(.02,.72,.10,1)`
    el.style.transform = `translateY(-${(strip.length - 2) * H}px)`

    const t1 = setTimeout(() => {
      if (ticker) clearInterval(ticker)
      el.style.transition = `transform ${ms * 0.28}ms cubic-bezier(.32,.02,.18,1)`
      el.style.transform = `translateY(-${(strip.length - 1) * H}px)`
    }, ms * 0.72 + 30)

    const t2 = setTimeout(() => onDone?.(), ms + 60)
    return () => {
      if (ticker) clearInterval(ticker)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [strip, ms, H, mini, onDone, fx])

  return (
    <div
      style={{
        height: H,
        overflow: 'hidden',
        width: '100%',
        WebkitMaskImage: 'linear-gradient(transparent,#000 26%,#000 74%,transparent)',
        maskImage: 'linear-gradient(transparent,#000 26%,#000 74%,transparent)',
      }}
    >
      <div ref={reelRef}>
        {strip.map((p, i) => (
          <div
            key={`${p?.id ?? i}-${i}`}
            style={{
              height: H,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              whiteSpace: 'nowrap',
              opacity: i === strip.length - 1 ? 1 : 0.28,
            }}
          >
            <b
              style={{
                fontFamily: theme.disp,
                fontSize: mini ? 21 : 'clamp(34px,6vw,60px)',
                fontWeight: 800,
                lineHeight: 1.62,
              }}
            >
              {label(p)}
            </b>
            <span style={{ fontSize: mini ? 9.5 : 15, opacity: 0.55 }}>{p?.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── 2 · วงล้อ — เห็นทุกชื่อพร้อมกัน เข็มชี้ด้านบน ────────────
   วาดทุกอย่างในระบบพิกัดของ SVG เดียว (viewBox 360×360) กรอบจึงเป็นจัตุรัสเสมอ
   และย่อลงมือถือได้โดยสัดส่วนไม่เพี้ยน
   โครงหมุนเฉพาะแผ่นชื่อ ส่วนขอบทอง หลอดไฟ เข็ม และดุมอยู่นิ่ง — เหมือนวงล้อจริง */
const WHEEL_VB = 360
const WHEEL_C = 180
const WHEEL_R = 142

function Wheel({ pool, winner, ms, mini, theme, onDone, fx }) {
  const gRef = useRef(null)
  const [landed, setLanded] = useState(false)

  const segs = useMemo(() => {
    const others = pool.filter((p) => p.id !== winner.id)
    for (let i = others.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[others[i], others[j]] = [others[j], others[i]]
    }
    // ช่องยิ่งเยอะยิ่งได้อารมณ์วงล้อจับรางวัลจริง — จอใหญ่ 16 ช่อง มือถือ 10 ช่อง
    // เกินกว่านี้ชื่อไทยจะบางจนอ่านไม่ทันตอนหมุน
    return [winner, ...others.slice(0, mini ? 9 : 15)]
  }, [pool, winner, mini])

  const { first, final, segAngle } = wheelAngles(segs.length)
  // ช่องแคบลงเมื่อจำนวนช่องมากขึ้น ตัวอักษรต้องเล็กตามไม่ให้ล้นออกนอกช่อง
  const fontSize = mini ? (segs.length > 8 ? 11.5 : 14) : segs.length > 12 ? 15 : 17
  const maxChars = mini ? 7 : 9

  useEffect(() => {
    const el = gRef.current
    if (!el) return undefined
    setLanded(false)
    el.style.transition = 'none'
    el.style.transform = 'rotate(0deg)'
    void el.getBoundingClientRect()

    const ticker = fx && !mini ? setInterval(() => playTick(1500, 0.05), 110) : null
    el.style.transition = `transform ${ms * 0.74}ms cubic-bezier(.04,.72,.06,1)`
    el.style.transform = `rotate(${first}deg)`

    const t1 = setTimeout(() => {
      if (ticker) clearInterval(ticker)
      el.style.transition = `transform ${ms * 0.26}ms cubic-bezier(.3,.02,.2,1)`
      el.style.transform = `rotate(${final}deg)`
    }, ms * 0.74 + 30)

    // ไฮไลต์ช่องผู้ชนะหลังหยุดเท่านั้น — ถ้าทาสีต่างไว้ตั้งแต่แรกคนดูเดาผลได้ก่อนวงล้อหยุด
    const t2 = setTimeout(() => setLanded(true), ms + 20)
    const t3 = setTimeout(() => onDone?.(), ms + 60)
    return () => {
      if (ticker) clearInterval(ticker)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [segs, ms, first, final, mini, onDone, fx])

  const bulbs = Array.from({ length: segs.length * 2 }, (_, i) => (i * 360) / (segs.length * 2))
  const size = mini ? 'min(196px, 88%)' : 'min(min(58vh, 520px), 84vw)'

  return (
    <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
      <div
        style={{
          position: 'relative',
          width: size,
          aspectRatio: '1 / 1',
          filter: mini ? 'none' : 'drop-shadow(0 14px 30px rgba(0,0,0,.35))',
        }}
      >
        <svg viewBox={`0 0 ${WHEEL_VB} ${WHEEL_VB}`} style={{ width: '100%', height: '100%', display: 'block' }}>
          {/* ขอบทองอยู่นิ่ง ไม่หมุนตามแผ่น */}
          <circle cx={WHEEL_C} cy={WHEEL_C} r={WHEEL_R + 12} fill={theme.wheel.seg[1]} />
          <circle
            cx={WHEEL_C}
            cy={WHEEL_C}
            r={WHEEL_R + 12}
            fill="none"
            stroke={theme.gold}
            strokeWidth="7"
            opacity="0.9"
          />
          {bulbs.map((deg) => {
            const rad = ((deg - 90) * Math.PI) / 180
            return (
              <circle
                key={deg}
                cx={WHEEL_C + (WHEEL_R + 12) * Math.cos(rad)}
                cy={WHEEL_C + (WHEEL_R + 12) * Math.sin(rad)}
                r={mini ? 3 : 4}
                fill={theme.gold}
                opacity={landed ? 1 : 0.55}
              />
            )
          })}

          <g ref={gRef} style={{ transformOrigin: '50% 50%' }}>
            {segs.map((p, i) => {
              const s = ((i * segAngle - 90) * Math.PI) / 180
              const e = (((i + 1) * segAngle - 90) * Math.PI) / 180
              const mid = i * segAngle + segAngle / 2 - 90
              const txt =
                label(p).length > maxChars + 1 ? `${label(p).slice(0, maxChars)}…` : label(p)
              const win = landed && i === 0
              return (
                <g key={`${p.id}-${i}`}>
                  <path
                    d={`M${WHEEL_C},${WHEEL_C} L${WHEEL_C + WHEEL_R * Math.cos(s)},${
                      WHEEL_C + WHEEL_R * Math.sin(s)
                    } A${WHEEL_R},${WHEEL_R} 0 0,1 ${WHEEL_C + WHEEL_R * Math.cos(e)},${
                      WHEEL_C + WHEEL_R * Math.sin(e)
                    } Z`}
                    fill={win ? theme.gold : theme.wheel.seg[i % 2]}
                    stroke={theme.wheel.stroke}
                    strokeWidth="1"
                    style={{ transition: 'fill .25s' }}
                  />
                  {/* ชื่อวางตามแนวรัศมี ยึดปลายไว้ชิดขอบวง แล้ววิ่งเข้าหาดุม
                      ยึดที่ขอบ (textAnchor end) ไม่ใช่ที่ดุม ชื่อสั้นยาวไม่เท่ากันจะได้
                      เรียงชิดขอบเป็นวงเดียวกันหมด ไม่กระเซิงออกมาคนละระยะ */}
                  <text
                    x={WHEEL_C + WHEEL_R * 0.93}
                    y={WHEEL_C}
                    fill={win ? '#2b1c00' : theme.wheel.text}
                    fontSize={fontSize}
                    fontWeight={win ? 800 : 600}
                    fontFamily={theme.disp}
                    textAnchor="end"
                    dominantBaseline="middle"
                    transform={`rotate(${mid} ${WHEEL_C} ${WHEEL_C})`}
                    style={{ transition: 'fill .25s' }}
                  >
                    {txt}
                  </text>
                </g>
              )
            })}
          </g>

          {/* ดุมกลาง ปิดรอยต่อของทุกช่อง */}
          <circle cx={WHEEL_C} cy={WHEEL_C} r={mini ? 24 : 30} fill={theme.wheel.seg[1]} stroke={theme.gold} strokeWidth="3" />
          <circle cx={WHEEL_C} cy={WHEEL_C} r={mini ? 8 : 10} fill={theme.gold} />

          {/* เข็มชี้ — อยู่ใน SVG จะได้ย่อขยายตามกันเสมอ */}
          <path
            d={`M${WHEEL_C} ${WHEEL_C - WHEEL_R + 16} L${WHEEL_C - 15} ${WHEEL_C - WHEEL_R - 24} L${
              WHEEL_C + 15
            } ${WHEEL_C - WHEEL_R - 24} Z`}
            fill={theme.gold}
            stroke={theme.light ? 'rgba(0,0,0,.25)' : 'rgba(0,0,0,.45)'}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}

/* ── 3 · คัดออก — หรี่ชื่อทิ้งจนเหลือตามจำนวนที่ตั้งไว้ ──────── */
function Elim({ pool, winners, ms, mini, theme, onDone, fx }) {
  const [out, setOut] = useState(() => new Set())
  const [hot, setHot] = useState(null)
  const [duel, setDuel] = useState(null)
  const [done, setDone] = useState(false)
  const winIds = useMemo(() => new Set(winners.map((w) => w.id)), [winners])

  useEffect(() => {
    setOut(new Set())
    setDone(false)
    const others = pool.filter((p) => !winIds.has(p.id))
    for (let i = others.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[others[i], others[j]] = [others[j], others[i]]
    }
    const timers = []
    // เสียงชนะให้หน้าที่เรียกใช้เป็นคนเล่น ไม่ใช่ที่นี่ ไม่งั้นจอใหญ่จะได้ยินซ้อนสองครั้ง
    const finish = () => {
      setDone(true)
      onDone?.()
    }
    if (others.length === 0) {
      timers.push(setTimeout(finish, 400))
      return () => timers.forEach(clearTimeout)
    }

    const T1 = ms * 0.72
    const rival = others[others.length - 1]
    const scan = setInterval(() => {
      const alive = pool.filter((p) => !winIds.has(p.id))
      setHot(alive[Math.floor(Math.random() * alive.length)]?.id ?? null)
    }, 110)

    others.slice(0, -1).forEach((p, i, arr) => {
      const at = T1 * ((i + 1) / arr.length) ** 2.1
      timers.push(
        setTimeout(() => {
          setOut((prev) => new Set(prev).add(p.id))
          if (fx && !mini) playTick(880 + i * 38, 0.05)
        }, at)
      )
    })

    // ช่วงดวล — เหลือผู้ชนะ N คน + คู่แข่งคนสุดท้าย ไล่ไฟวนให้ลุ้นว่าใครจะร่วง
    timers.push(
      setTimeout(() => {
        clearInterval(scan)
        setHot(null)
        const ring = [...winners.map((w) => w.id), rival.id]
        let f = 0
        const duelTimer = setInterval(() => {
          setDuel(ring[f % ring.length])
          if (fx && !mini) playTick(1000 + (f % 2) * 260, 0.08)
          f += 1
        }, Math.max(190, 300 - ring.length * 18))
        timers.push(
          setTimeout(() => {
            clearInterval(duelTimer)
            setDuel(null)
            setOut((prev) => new Set(prev).add(rival.id))
            timers.push(setTimeout(finish, 420))
          }, Math.max(600, ms - T1 - 420))
        )
      }, T1 + 120)
    )

    return () => {
      clearInterval(scan)
      timers.forEach(clearTimeout)
    }
  }, [pool, winners, winIds, ms, mini, onDone, fx])

  const cell = (p) => {
    const isOut = out.has(p.id)
    const isWin = done && winIds.has(p.id)
    const isDuel = duel === p.id
    const isHot = hot === p.id && !isOut
    let bg = 'transparent'
    let fg = 'inherit'
    if (isWin || isDuel) {
      bg = theme.gold
      fg = theme.light ? '#2b1c00' : '#2b1c00'
    } else if (isHot) {
      bg = theme.accent
      fg = theme.light ? '#fff' : '#04181f'
    }
    return (
      <div
        key={p.id}
        style={{
          fontFamily: theme.disp,
          fontWeight: isWin ? 800 : 700,
          fontSize: mini ? (isWin ? 12.5 : 10.5) : `clamp(${isWin ? 19 : 16}px,${isWin ? 2.4 : 2}vw,${isWin ? 30 : 26}px)`,
          lineHeight: 1.6,
          padding: mini ? '4px 5px' : '10px 12px',
          border: `1px solid ${isWin || isDuel || isHot ? 'transparent' : theme.light ? 'rgba(0,0,0,.13)' : 'rgba(255,255,255,.18)'}`,
          background: bg === 'transparent' && theme.light ? 'rgba(255,255,255,.5)' : bg,
          color: fg === 'inherit' ? undefined : fg,
          borderRadius: theme.radius,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: isOut ? 0.1 : 1,
          transform: isOut ? 'scale(.88)' : 'none',
          filter: isOut ? 'blur(.7px)' : 'none',
          transition: 'opacity .4s, transform .4s, filter .4s, background .2s',
        }}
      >
        {label(p)}
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit,minmax(${mini ? 52 : 152}px,1fr))`,
        gap: mini ? 4 : 9,
        width: '100%',
      }}
    >
      {pool.map(cell)}
    </div>
  )
}

/* ── ตัวห่อ ─────────────────────────────────────────────────── */
export default function DrawReveal({ anim, pool, winners, themeKey, mini = false, fx = true, onDone }) {
  const theme = getTheme(themeKey)
  const ms = ANIM_MS[anim] ?? ANIM_MS.slot

  // ⚠️ กลุ่มรายชื่อต้องนิ่งตลอดรอบ ห้ามคำนวณสดระหว่างเล่น
  //
  // บั๊กที่เคยเจอ: สุ่มหลายคนแล้วทีมงานบันทึกผลทันที (ไม่ต้องยืนยัน)
  // แถวใหม่เข้า draw_results ระหว่างอนิเมชันยังวิ่งอยู่ → กติกา "ไม่สุ่มซ้ำ"
  // ตัดผู้ชนะออกจาก pool → คอมโพเนนต์คัดออกมองไม่เห็นผู้ชนะเลย
  // เลยไล่หรี่ทุกชื่อจนเหลือคนเดียวแบบสุ่มมั่ว ทั้งที่ผลจริงมีหลายคน
  //
  // แก้ด้วยการหยุดภาพ pool ไว้ตอน mount (คอมโพเนนต์ถูก key ด้วยเลขรอบอยู่แล้ว
  // จึง mount ใหม่ทุกรอบ) และการันตีว่าผู้ชนะอยู่ในกลุ่มเสมอ
  const [frozenPool] = useState(() => {
    const base = pool?.length ? pool : (winners ?? [])
    const byId = new Map(base.map((p) => [p.id, p]))
    ;(winners ?? []).forEach((w) => {
      if (!byId.has(w.id)) byId.set(w.id, w)
    })
    return [...byId.values()]
  })

  useEffect(() => {
    if (fx && !mini) playDrumroll(ms / 1000)
  }, [ms, mini, fx, anim])

  if (!winners?.length) return null
  if (anim === 'wheel') {
    return (
      <Wheel pool={frozenPool} winner={winners[0]} ms={ms} mini={mini} theme={theme} onDone={onDone} fx={fx} />
    )
  }
  if (anim === 'elim') {
    return <Elim pool={frozenPool} winners={winners} ms={ms} mini={mini} theme={theme} onDone={onDone} fx={fx} />
  }
  return (
    <Slot pool={frozenPool} winner={winners[0]} ms={ms} mini={mini} theme={theme} onDone={onDone} fx={fx} />
  )
}
