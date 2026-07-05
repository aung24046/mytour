import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Custom scrolling-wheel date picker — แทนที่ input type="date" ของเบราว์เซอร์
// เหตุผล: input type="date" ของ Android/Chrome เป็นปฏิทินแบบตาราง ต้องกดเปลี่ยนปีทีละปี
// ผู้สูงอายุที่ไม่ถนัดใช้สมาร์ทโฟนมักงงและใช้ไม่เป็น (ต่างจาก iOS Safari ที่มี wheel ให้อยู่แล้ว)
// จึงสร้าง wheel picker เองแบบเดียวกันทุกเครื่อง ใช้วิธี "เลื่อนนิ้วสัมผัส" ล้วนๆ ไม่มีปุ่มกดเปลี่ยนปี
//
// เก็บ/ส่งค่าเป็น string "YYYY-MM-DD" เหมือนเดิม (เข้ากับ contract ของ DynamicField และข้อมูลเดิมที่เคยบันทึกไว้)

const ITEM_HEIGHT = 40
const VISIBLE_ROWS = 3
const PAD_ROWS = Math.floor(VISIBLE_ROWS / 2)

const CURRENT_YEAR = new Date().getFullYear()
const MIN_YEAR = CURRENT_YEAR - 100
const MAX_YEAR = CURRENT_YEAR
// ปีเริ่มต้น (ตอนยังไม่มีค่า) เดาไว้กลางๆ ให้ผู้ใหญ่ส่วนมากเลื่อนน้อยที่สุด ไม่ผูกมัดว่าตอบแล้ว
const DEFAULT_YEAR = CURRENT_YEAR - 35

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function parseValue(value) {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

function formatValue({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function WheelColumn({ items, index, onSettle }) {
  const scrollRef = useRef(null)
  const skipNextScroll = useRef(false)
  const settleTimer = useRef(null)

  // sync scroll position เมื่อ index เปลี่ยนจากภายนอก (เช่น โหลดค่าที่เคยบันทึกไว้ หรือวันถูก clamp เพราะเปลี่ยนเดือน)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const targetTop = index * ITEM_HEIGHT
    if (Math.abs(el.scrollTop - targetTop) > 1) {
      skipNextScroll.current = true
      el.scrollTop = targetTop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length])

  function handleScroll() {
    if (skipNextScroll.current) {
      skipNextScroll.current = false
      return
    }
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => {
      const el = scrollRef.current
      if (!el) return
      const nextIndex = Math.max(
        0,
        Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_HEIGHT))
      )
      onSettle(nextIndex)
    }, 120)
  }

  return (
    <div className="relative flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="snap-y snap-mandatory overflow-y-scroll scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: ITEM_HEIGHT * VISIBLE_ROWS }}
      >
        <div style={{ height: ITEM_HEIGHT * PAD_ROWS }} />
        {items.map((label, i) => (
          <div
            key={i}
            className={`flex snap-center items-center justify-center text-base transition-colors ${
              i === index ? 'font-bold text-ink' : 'text-ink-faint'
            }`}
            style={{ height: ITEM_HEIGHT }}
          >
            {label}
          </div>
        ))}
        <div style={{ height: ITEM_HEIGHT * PAD_ROWS }} />
      </div>
    </div>
  )
}

export default function DateWheelField({ label, required = false, value, onChange, className = '' }) {
  const { t } = useTranslation()
  const monthLabels = t('common.monthsShort', { returnObjects: true })

  const parsed = parseValue(value)
  const [year, setYear] = useState(parsed?.year ?? DEFAULT_YEAR)
  const [month, setMonth] = useState(parsed?.month ?? 1)
  const [day, setDay] = useState(parsed?.day ?? 1)

  // ยังไม่ถือว่า "ตอบแล้ว" จนกว่าผู้ใช้จะเลื่อนวงล้อจริงอย่างน้อย 1 ครั้ง — กันไม่ให้ค่า default
  // ถูกบันทึกทั้งที่ผู้ใช้ไม่ได้ตั้งใจตอบ (ฟิลด์นี้ไม่บังคับตอบ)
  const touchedRef = useRef(Boolean(parsed))

  // sync จากภายนอก เช่น หน้าจัดการลูกทัวร์โหลดค่าที่เคยบันทึกมาทีหลัง (async)
  useEffect(() => {
    const next = parseValue(value)
    if (next) {
      setYear(next.year)
      setMonth(next.month)
      setDay(next.day)
      touchedRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const maxDay = daysInMonth(year, month)
  const clampedDay = Math.min(day, maxDay)

  function commit(nextYear, nextMonth, nextDay) {
    touchedRef.current = true
    const safeDay = Math.min(nextDay, daysInMonth(nextYear, nextMonth))
    onChange(formatValue({ year: nextYear, month: nextMonth, day: safeDay }))
  }

  function handleDaySettle(idx) {
    const nextDay = idx + 1
    setDay(nextDay)
    commit(year, month, nextDay)
  }

  function handleMonthSettle(idx) {
    const nextMonth = idx + 1
    setMonth(nextMonth)
    commit(year, nextMonth, clampedDay)
  }

  function handleYearSettle(idx) {
    const nextYear = MIN_YEAR + idx
    setYear(nextYear)
    commit(nextYear, month, clampedDay)
  }

  const dayItems = Array.from({ length: maxDay }, (_, i) => String(i + 1))
  const yearItems = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => String(MIN_YEAR + i))

  return (
    <div className={className}>
      {label && (
        <span className="mb-1.5 block text-sm font-semibold text-neutral-text">
          {label}
          {required && <span className="text-accent"> *</span>}
        </span>
      )}
      <div className="relative rounded-control border border-transparent bg-surface-sunken px-2 shadow-inner">
        {/* แถบไฮไลต์แถวกลาง บอกว่ากำลังเลือกอะไรอยู่ */}
        <div
          className="pointer-events-none absolute inset-x-2 top-1/2 -translate-y-1/2 rounded-lg border-y-2 border-brand-light bg-white/40"
          style={{ height: ITEM_HEIGHT }}
        />
        <div className="relative flex gap-1">
          <WheelColumn items={dayItems} index={clampedDay - 1} onSettle={handleDaySettle} />
          <WheelColumn items={monthLabels} index={month - 1} onSettle={handleMonthSettle} />
          <WheelColumn items={yearItems} index={year - MIN_YEAR} onSettle={handleYearSettle} />
        </div>
      </div>
    </div>
  )
}
