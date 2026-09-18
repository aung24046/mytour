import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { teamStyle } from '../../lib/quizStyle'
import Icon from '../common/Icon'

// รายชื่อคนในห้องบนมือถือคนคุมเกม — ใช้ร่วมกันทั้ง 5 เกม (ควิซ · ปริศนาใบ้คำ ·
// เปิดแผ่นป้าย · What Words · Word Shuffle)
//
// ★ ทำไมต้องมี (เจ้าของโปรเจกต์ขอ 17 ก.ย. 2026 "เหมือนเกมบิงโก")
//   ตัวเลข "เข้าห้องแล้ว 38 คน" บอกไม่ได้ว่าจะไปตามใคร — คนคุมเกมยืนอยู่หน้ารถ
//   มองหน้าคนได้ครบอยู่แล้ว สิ่งที่เขาต้องการคือ "ชื่อที่ยังไม่อยู่ในนี้"
//
// สามอย่างที่รายชื่อนี้ต้องตอบให้ได้ภายในครึ่งวินาที:
//   1. ใครเพิ่งเข้ามา — ไฮไลต์เขียวประมาณ 12 วิ แล้วดับเอง (fresh จาก useRoomPlayers)
//   2. ใครหลุดไปแล้ว — จุดสีจาง + ชื่อจาง (หัวใจไม่เต้นเกิน 60 วิ)
//   3. ใครอยู่ทีมไหน — จุดสีทีม + ชื่อทีม เพราะห้องที่เล่นเป็นทีมต้องเกลี่ยคนก่อนเริ่ม
//
// พับเก็บได้และ "เปิดค้างไว้ตอนห้องรอ" โดยตั้งใจ — ช่วงที่ต้องดูรายชื่อจริงๆ คือก่อนเริ่มเกม
// พอเกมเดินแล้วพื้นที่จอควรเป็นของปุ่มคุมเกม ไม่ใช่รายชื่อ 40 บรรทัด
export default function PlayerRoster({
  players = [],
  joined = 0,
  online = 0,
  loaded = false,
  defaultOpen = false,
  onKick = null,          // (player) => void · ไม่ส่งมา = ไม่มีปุ่มเอาออก
  className = '',
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)

  // ★ defaultOpen มาจาก phase ซึ่งยังเป็น null ตอน mount (session ยังโหลดไม่เสร็จ)
  //   ถ้าใช้แค่ค่าเริ่มต้นของ useState รายชื่อจะพับอยู่ตลอดในห้องรอ ซึ่งคือช่วงที่ต้องดูมันที่สุด
  //   sync เฉพาะ "ตอนค่าเปลี่ยน" เพื่อไม่ไปทับตอนคนคุมเกมกดพับเอง
  const prevDefault = useRef(defaultOpen)
  useEffect(() => {
    if (prevDefault.current !== defaultOpen) {
      prevDefault.current = defaultOpen
      setOpen(defaultOpen)
    }
  }, [defaultOpen])

  return (
    <section className={`rounded-2xl border border-line bg-surface p-4 shadow-card ${className}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2">
        <Icon name="people" size={18} className="text-ink-muted" />
        <span className="flex-1 text-left text-sm font-extrabold text-ink">
          {t('quizRoster.title', { joined, online })}
        </span>
        <Icon
          name="chevronRight"
          size={16}
          className={`text-ink-faint transition ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <>
          {players.length === 0 ? (
            <p className="mt-2 text-sm text-ink-faint">
              {loaded ? t('quizRoster.empty') : t('quizRoster.loading')}
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {players.map((p) => {
                const st = p.team_color_index != null ? teamStyle(p.team_color_index) : null
                return (
                  <li
                    key={p.id}
                    className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors ${
                      p.fresh ? 'bg-success-bg' : ''
                    }`}
                  >
                    {/* จุดสี = ทีม (ถ้ามี) ส่วนความทึบ = ออนไลน์อยู่ไหม — สองความหมายในจุดเดียว
                        เพราะบรรทัดบนมือถือกว้างไม่พอให้มีทั้งจุดทีมและจุดออนไลน์ */}
                    <span
                      aria-hidden
                      className={`h-2.5 w-2.5 flex-none rounded-full ${p.online ? '' : 'opacity-25'}`}
                      style={{ background: st ? st.color : 'currentColor' }}
                    />
                    <span className={`min-w-0 flex-1 truncate font-medium ${p.online ? 'text-ink' : 'text-ink-faint'}`}>
                      {p.display_name}
                    </span>

                    {p.fresh && (
                      <span className="flex-none rounded-full bg-success-text/10 px-2 py-0.5 text-[10px] font-bold text-success-text">
                        {t('quizRoster.justJoined')}
                      </span>
                    )}
                    {p.team && (
                      <span className="max-w-[7rem] flex-none truncate text-xs text-ink-muted">{p.team}</span>
                    )}
                    {p.kind === 'visitor' && (
                      <span className="flex-none rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-bold text-ink-faint">
                        {t('quizRoster.visitor')}
                      </span>
                    )}

                    {onKick && (
                      // visitor พิมพ์ชื่อเองได้ และชื่อนั้นขึ้นจอใหญ่ต่อหน้าทุกคน — ต้องเตะออกได้
                      <button
                        type="button"
                        aria-label={t('quizRoster.kick', { name: p.display_name })}
                        onClick={() => onKick(p)}
                        className="flex-none rounded-lg p-1 text-ink-faint hover:text-danger-text"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
