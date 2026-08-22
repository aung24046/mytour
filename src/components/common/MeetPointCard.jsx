import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { meetPointOpenUrl, minutesUntilMeet, meetUrgency } from '../../lib/meetPoint'
import Icon from './Icon'

// จุดนัดพบที่แนบมากับประกาศ
//
// ⚠️ ตั้งใจให้ "ปิดไม่ได้" ต่างจากตัวประกาศเอง
//    ประกาศทั่วไปอ่านแล้วจบ กดปิดทิ้งได้ แต่จุดนัดพบต้องกลับมาเปิดดูได้ตลอด 3 ชั่วโมง
//    ที่ปล่อยเดินเล่น — ซึ่งเป็นเหตุผลทั้งหมดที่ฟีเจอร์นี้มีอยู่ (เดิมพูดปากเปล่าครั้งเดียว
//    คนที่จำไม่ได้ไม่กล้าถาม แล้วมาสาย) ถ้าปิดทิ้งได้ก็เท่ากับกลับไปที่ปัญหาเดิม
//
// ปุ่มนำทางคือหัวใจ ไม่ใช่ตัวหนังสือ: พอกดแล้ว Google Maps จะบอกเองว่า "เดิน 14 นาที"
// จากตำแหน่งจริงของเขา ซึ่งเป็นตัวเลขที่ทำให้คนเริ่มเดินกลับ — และเราไม่ต้องรู้ว่าเขาอยู่ไหนเลย

const TICK_MS = 30000

function useCountdown(meetTime) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!meetTime) return undefined
    const tick = () => setNow(new Date())
    tick()
    const timer = setInterval(tick, TICK_MS)
    // กลับมาที่หน้าหลังปิดจอไว้นาน — เบราว์เซอร์หยุด interval ระหว่างนั้น
    // ถ้าไม่ tick ตรงนี้ ตัวเลขจะค้างอยู่ที่ค่าเมื่อตอนปิดจอ ซึ่งหลอกกว่าไม่แสดงเลย
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [meetTime])

  return minutesUntilMeet(meetTime, now)
}

function countdownText(minutesLeft, t) {
  if (minutesLeft == null) return null
  if (minutesLeft < 0) return t('guest.meetPoint.late', { count: -minutesLeft })
  if (minutesLeft === 0) return t('guest.meetPoint.now')
  if (minutesLeft < 60) return t('guest.meetPoint.leftMinutes', { count: minutesLeft })
  return t('guest.meetPoint.leftHours', {
    hours: Math.floor(minutesLeft / 60),
    minutes: minutesLeft % 60,
  })
}

const URGENCY_TEXT = {
  ok: 'text-ink-muted',
  soon: 'text-warning-text',
  past: 'text-danger-text',
}

export default function MeetPointCard({ announcement, compact = false }) {
  const { t } = useTranslation()
  const minutesLeft = useCountdown(announcement?.meet_time)

  // มีพิกัด → ปุ่มพาไปนำทางโหมดเดินเลย / มีแต่ลิงก์ (เช่นลิงก์ย่อจากปุ่มแชร์ของ
  // Google Maps ซึ่งแกะพิกัดไม่ได้) → เปิดลิงก์นั้นตรงๆ แล้วกด "เส้นทาง" ต่อในแอป Maps
  const url = meetPointOpenUrl(announcement)
  if (!url) return null

  const label = announcement.meet_label?.trim() || t('guest.meetPoint.defaultLabel')
  const urgency = meetUrgency(minutesLeft)
  const countdown = countdownText(minutesLeft, t)

  if (compact) {
    return (
      <div className="flex items-center gap-2 border-t border-line-subtle bg-surface px-4 py-2">
        <Icon name="location" size={15} className="shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{label}</span>
        {countdown && (
          <span className={`shrink-0 text-xs font-bold ${URGENCY_TEXT[urgency] ?? 'text-ink-muted'}`}>
            {countdown}
          </span>
        )}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-pill bg-brand px-2.5 py-1 text-[11px] font-bold text-white"
        >
          {t('guest.meetPoint.openMap')}
        </a>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-card bg-surface p-4 shadow-card ring-1 ring-line-subtle">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-lighter">
          <Icon name="location" size={20} className="text-brand" filled />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">
            {t('guest.meetPoint.title')}
          </p>
          <p className="mt-0.5 text-base font-bold leading-snug text-ink">{label}</p>

          {announcement.meet_time && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span className="font-semibold text-ink">
                {t('guest.meetPoint.gatherAt', { time: announcement.meet_time })}
              </span>
              {countdown && (
                <span className={`font-bold ${URGENCY_TEXT[urgency] ?? 'text-ink-muted'}`}>
                  · {countdown}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* ปุ่มเต็มความกว้าง — ต้องกดง่ายด้วยมือเดียวขณะเดิน และสำหรับผู้สูงอายุที่กดพลาดบ่อย */}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-card bg-brand py-3 text-base font-semibold text-white shadow-brand transition active:scale-[0.99]"
      >
        <Icon name="location" size={18} />
        {t('guest.meetPoint.navigate')}
      </a>
    </div>
  )
}
