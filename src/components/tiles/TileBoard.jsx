import { useEffect, useMemo, useRef, useState } from 'react'

import {
  clampGrid, tileNumbers, tileStyle, coverStyle, boardAspect, isOpen, justOpened,
} from '../../lib/tileGrid'

// กระดานแผ่นป้าย — ใช้ตัวเดียวกันทั้งจอเวที มือถือคนคุมเกม มือถือลูกทัวร์ และพรีวิวใน Builder
//
// ทำไมต้องเป็น component เดียว ไม่ใช่ก็อปสี่ที่: พรีวิวใน Builder ที่ไม่ตรงกับของจริง
// แย่กว่าไม่มีพรีวิว เพราะคนสร้างข้อจะเชื่อมันแล้วไปเจอของจริงบนเวทีต่อหน้าคน 40 คน
// (บทเรียนเดียวกับ ClueBoard.jsx ของเกมปริศนาใบ้คำ)
//
// สามโหมดที่ต่างกันจริงๆ มีแค่เรื่อง "ใครเห็นภาพจริงบ้าง":
//   • จอเวที      — เห็นภาพใต้แผ่นที่เปิดแล้ว
//   • คนคุมเกม    — เห็นภาพทั้งใบแบบหรี่แสงใต้แผ่นที่ยังปิด (peek) จะได้เลือกเปิดเป็น
//   • ลูกทัวร์     — ไม่มี imageUrl เลย เห็นแค่ภาพตอนปิดกับหมายเลข จนกว่าจะเฉลย
//
// ★ ไม่ตัดภาพเป็นไฟล์ย่อย — ทุกแผ่นใช้ภาพเดียวกันแล้วเลื่อน background (ดู tileGrid.js)

const FLIP_MS = 620
const WAVE_STEP_MS = 55

export default function TileBoard({
  rows = 3,
  cols = 4,
  crop = null,
  imageUrl = null,          // ภาพจริง — อาจยังโหลดไม่เสร็จหรือยังไม่ได้รับ
  imageAspect = null,       // กว้าง/สูง ของภาพต้นฉบับ จาก quiz_tiles.image_aspect
  coverImageUrl = null,     // ภาพตอนปิด · ไม่มี = ช่องสีตามธีม
  revealed = [],
  peek = false,             // โหมดคนคุมเกม: เห็นภาพหรี่แสงใต้แผ่นที่ยังปิด
  showNumbers = true,
  onTileClick = null,
  animate = true,
  className = '',
}) {
  const g = clampGrid(rows, cols)
  const numbers = useMemo(() => tileNumbers(g.rows, g.cols), [g.rows, g.cols])

  // ★ สัดส่วนกระดานต้อง "ไม่ขึ้นกับว่ามีตัวภาพอยู่ในมือหรือยัง"
  //   ไม่งั้นจอที่มีภาพกับจอที่ยังไม่มีจะได้รูปทรงคนละแบบ แล้วภาพตอนปิดจะถูกยืด
  //   (เจอตอนเล่นจริง: มือถือได้ 3x4 = 1.33 ส่วนโปรเจกเตอร์ได้ 16:9 = 1.78)
  //   ค่าที่เก็บไว้ตอนสร้างข้อมาก่อนเสมอ · วัดจากไฟล์เป็นแผนสอง · กริดเป็นแผนสาม
  const measured = useImageAspect(imageUrl)
  const srcAspect = Number(imageAspect) > 0 ? Number(imageAspect) : measured
  const aspect = srcAspect ? boardAspect(srcAspect, crop) : g.cols / g.rows

  const fresh = useFreshlyOpened(revealed, animate)

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl bg-slate-900/60 ${className}`}
      style={{ aspectRatio: aspect || undefined }}
    >
      {/* ภาพเต็มใบสำหรับคนคุมเกม — อยู่ใต้ทุกแผ่น หรี่แสงไว้ให้ต่างจากของจริงชัดเจน */}
      {peek && imageUrl && (
        <div
          aria-hidden
          className="absolute inset-0 opacity-30"
          style={fullImageStyle(imageUrl, crop)}
        />
      )}

      <div
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: `repeat(${g.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${g.rows}, minmax(0, 1fr))`,
          gap: '2px',
        }}
      >
        {numbers.map((n) => {
          const open = isOpen(n, revealed)
          const face = tileStyle(n, { rows: g.rows, cols: g.cols, crop, imageUrl })
          const back = coverStyle(n, { rows: g.rows, cols: g.cols, imageUrl: coverImageUrl })
          const delay = fresh.order.get(n)
          const clickable = Boolean(onTileClick) && !open

          return (
            <Tile
              key={n}
              n={n}
              open={open}
              face={face}
              back={back}
              showNumber={showNumbers}
              justFlipped={fresh.set.has(n)}
              delayMs={delay ? delay * WAVE_STEP_MS : 0}
              clickable={clickable}
              onClick={clickable ? () => onTileClick(n) : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}

function Tile({ n, open, face, back, showNumber, justFlipped, delayMs, clickable, onClick }) {
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      aria-label={`แผ่นป้ายหมายเลข ${n}`}
      className={[
        'relative block h-full w-full overflow-hidden',
        clickable ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/70' : 'cursor-default',
      ].join(' ')}
      style={{
        // ทั้งด้านหน้าและด้านหลังซ้อนกันอยู่ ใช้ opacity สลับ ไม่ใช่ถอด DOM ออก
        // เพื่อไม่ให้ภาพกระพริบตอนเบราว์เซอร์ต้องโหลด background ใหม่
        transitionDelay: `${delayMs}ms`,
      }}
    >
      {/* ด้านหน้า: ส่วนของภาพจริง */}
      <span
        aria-hidden
        className="absolute inset-0 transition-opacity"
        style={{
          ...(face ?? {}),
          backgroundColor: face ? undefined : 'rgb(15 23 42)',
          opacity: open ? 1 : 0,
          transitionDuration: `${FLIP_MS}ms`,
          transitionDelay: `${delayMs}ms`,
        }}
      />

      {/* ด้านหลัง: แผ่นป้ายที่ปิดอยู่ */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center transition-opacity"
        style={{
          ...(back ?? {}),
          backgroundColor: back ? undefined : 'rgb(30 41 59)',
          boxShadow: open ? 'none' : 'inset 0 0 0 1px rgba(255,255,255,.10)',
          opacity: open ? 0 : 1,
          transitionDuration: `${FLIP_MS}ms`,
          transitionDelay: `${delayMs}ms`,
        }}
      >
        {showNumber && (
          // ตัวเลขวาดเป็น SVG ไม่ใช่ข้อความ เพราะต้องอ่านออกทั้งบนมือถือ 4 นิ้ว
          // และบนโปรเจกเตอร์ที่คนดูห่าง 10 เมตร โดยใช้โค้ดชุดเดียวกัน
          // SVG ย่อขยายตามกล่องเองโดยไม่ต้องพึ่ง container query ซึ่งทีวีบนรถบางรุ่นไม่รองรับ
          // วงกลมทึบเป็นฉากหลังของตัวเอง — text-shadow เอาไม่อยู่บนภาพตอนปิดที่มีลายละเอียด
          <svg
            viewBox="0 0 100 100"
            className="w-[52%] max-w-[5rem]"
            role="presentation"
          >
            <circle cx="50" cy="50" r="46" fill="rgba(0,0,0,.45)" />
            <text
              x="50"
              y="50"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={String(n).length > 1 ? 50 : 60}
              fontWeight="800"
              fill="#fff"
            >
              {n}
            </text>
          </svg>
        )}
      </span>

      {justFlipped && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white/80 transition-opacity"
          style={{ opacity: 0, transitionDuration: `${FLIP_MS}ms`, transitionDelay: `${delayMs}ms` }}
        />
      )}
    </button>
  )
}

/** ภาพเต็มใบตามกรอบครอป — ใช้กับพื้นหลังหรี่แสงของคนคุมเกม */
function fullImageStyle(imageUrl, crop) {
  const c = {
    x: Number(crop?.x ?? crop?.crop_x ?? 0),
    y: Number(crop?.y ?? crop?.crop_y ?? 0),
    w: Number(crop?.w ?? crop?.crop_w ?? 1),
    h: Number(crop?.h ?? crop?.crop_h ?? 1),
  }
  const sw = c.w > 0 ? 1 / c.w : 1
  const sh = c.h > 0 ? 1 / c.h : 1
  const px = sw > 1 ? (c.x / (c.w * (sw - 1))) * 100 : 0
  const py = sh > 1 ? (c.y / (c.h * (sh - 1))) * 100 : 0
  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: `${sw * 100}% ${sh * 100}%`,
    backgroundPosition: `${px}% ${py}%`,
    backgroundRepeat: 'no-repeat',
  }
}

/** สัดส่วนภาพจริง — โหลดครั้งเดียวต่อ URL */
function useImageAspect(url) {
  const [aspect, setAspect] = useState(null)

  useEffect(() => {
    if (!url) {
      setAspect(null)
      return undefined
    }
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (alive && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight)
    }
    img.src = url
    return () => {
      alive = false
    }
  }, [url])

  return aspect
}

/**
 * แผ่นที่เพิ่งเปิดในรอบนี้ — คำนวณจาก diff ของ revealed_tiles ไม่ต้องมี event แยก
 *
 * ตอนมีคนตอบถูก แผ่นทั้งหมดเปิดพร้อมกันทีเดียว ถ้าปล่อยให้ขึ้นพรวดจะไม่มีจังหวะ
 * จึงไล่หน่วงทีละแผ่นเป็นคลื่น — นี่คือจังหวะพีคของข้อ อย่าทิ้ง
 */
function useFreshlyOpened(revealed, animate) {
  const prevRef = useRef(null)
  const [state, setState] = useState({ set: new Set(), order: new Map() })

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = Array.isArray(revealed) ? [...revealed] : []
    if (!animate || prev === null) return undefined   // รอบแรกไม่ต้องเล่นอนิเมชัน

    const opened = justOpened(prev, revealed)
    if (opened.length === 0) return undefined

    const order = new Map()
    opened.forEach((n, i) => order.set(n, opened.length > 3 ? i : 0))
    setState({ set: new Set(opened), order })

    const timer = setTimeout(
      () => setState({ set: new Set(), order: new Map() }),
      FLIP_MS + opened.length * WAVE_STEP_MS + 200
    )
    return () => clearTimeout(timer)
  }, [revealed, animate])

  return state
}
