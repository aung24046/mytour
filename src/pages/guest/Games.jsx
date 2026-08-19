import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId, useTourPath } from '../../lib/TourContext'
import { getGuestId } from '../../lib/guestSession'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Icon from '../../components/common/Icon'
import GuestNav from '../../components/common/GuestNav'
import BackButton from '../../components/common/BackButton'

// หน้ารวมเกมฝั่งลูกทัวร์ — คู่กับ /staff/games
//
// เดิมเมนูลัดหน้าแรกยิงตรงเข้าบิงโก พอมีเกมที่สองก็ไม่มีที่วางแล้ว
// (แถวเมนูลัดเป็น grid 4 ช่องพอดี) รวมไว้ที่นี่แล้วเพิ่มเกมใหม่ได้เรื่อยๆ
//
// การ์ดบอกสถานะจริงว่ามีอะไรให้เล่นอยู่ตอนนี้ ลูกทัวร์จะได้ไม่กดเข้าไปเจอหน้าว่าง

function GameCard({ icon, tint, title, desc, status, live, onClick, soonTag }) {
  const clickable = Boolean(onClick)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`flex w-full items-center gap-3.5 rounded-card border-[1.5px] p-4 text-left shadow-card transition ${
        clickable
          ? 'border-brand-light bg-surface active:scale-[0.98]'
          : 'border-line bg-surface opacity-70'
      }`}
    >
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[15px] text-white"
        style={{ background: tint }}
      >
        <Icon name={icon} size={25} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-bold leading-tight text-ink">{title}</span>
          {soonTag && (
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-bold text-ink-faint">
              {soonTag}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{desc}</span>
        {status && (
          <span
            className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-bold ${
              live ? 'text-success-text' : 'text-ink-faint'
            }`}
          >
            <span
              className={`block h-1.5 w-1.5 rounded-full ${
                live ? 'animate-pulse bg-success' : 'bg-line-strong'
              }`}
            />
            {status}
          </span>
        )}
      </span>

      {clickable && <Icon name="chevronRight" size={18} className="shrink-0 text-ink-faint" />}
    </button>
  )
}

export default function Games() {
  const tourId = useTourId()
  const tp = useTourPath()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const guestId = getGuestId(tourId)

  // มีห้องบิงโกเปิดอยู่ไหม และเรามีการ์ดของตัวเองแล้วหรือยัง
  const [bingo, setBingo] = useState({ open: 0, myCard: false })
  const [draw, setDraw] = useState({ open: 0 })
  const [quiz, setQuiz] = useState({ open: 0 })

  useEffect(() => {
    if (!tourId) return
    let cancelled = false

    async function load() {
      const [{ data: games }, { data: drawRooms }, { data: quizRooms }] = await Promise.all([
        supabase
          .from('bingo_games')
          .select('id')
          .eq('tour_id', tourId)
          .in('status', ['waiting', 'playing']),
        supabase.from('draw_rooms').select('id').eq('tour_id', tourId).eq('status', 'open'),
        supabase
          .from('quiz_sessions')
          .select('id, bus_id')
          .eq('tour_id', tourId)
          .neq('state', 'finished'),
      ])

      if (cancelled) return
      setDraw({ open: (drawRooms ?? []).length })

      // ห้องที่ผูกกับรถคันหนึ่งต้องไม่ถูกนับให้คนบนรถคันอื่น — ใช้เกณฑ์เดียวกับ
      // guest/Quiz.jsx ไม่งั้นการ์ดขึ้นว่า "มีห้องเปิด" แต่กดเข้าไปเจอ "ไม่มีห้อง"
      let myBusId = null
      if (guestId) {
        const { data: g } = await supabase
          .from('guests')
          .select('bus_id')
          .eq('id', guestId)
          .maybeSingle()
        myBusId = g?.bus_id ?? null
      }
      if (cancelled) return
      setQuiz({ open: (quizRooms ?? []).filter((r) => !r.bus_id || r.bus_id === myBusId).length })
      const ids = (games ?? []).map((g) => g.id)
      if (ids.length === 0 || !guestId) {
        setBingo({ open: ids.length, myCard: false })
        return
      }

      const { count } = await supabase
        .from('bingo_cards')
        .select('id', { count: 'exact', head: true })
        .eq('guest_id', guestId)
        .in('game_id', ids)

      if (!cancelled) setBingo({ open: ids.length, myCard: (count ?? 0) > 0 })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId, guestId])

  const bingoStatus = bingo.open
    ? bingo.myCard
      ? t('guest.games.bingoHasCard')
      : t('guest.games.bingoOpen')
    : t('guest.games.bingoClosed')

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <AnnouncementBanner />

      <div className="flex items-center gap-2">
        <BackButton to={tp()} />
        <h1 className="text-2xl font-extrabold text-ink">{t('guest.games.title')}</h1>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{t('guest.games.subtitle')}</p>

      <div className="mt-4 space-y-2.5">
        <GameCard
          icon="target"
          tint="#c2410c"
          title={t('guest.nav.bingo')}
          desc={t('guest.games.bingoDesc')}
          status={bingoStatus}
          live={bingo.open > 0}
          onClick={() => navigate(tp('bingo'))}
        />

        <GameCard
          icon="bolt"
          tint="#1d4ed8"
          title={t('guest.games.drawTitle')}
          desc={t('guest.games.drawDesc')}
          status={draw.open ? t('guest.games.drawOpen') : t('guest.games.drawClosed')}
          live={draw.open > 0}
          onClick={() => navigate(tp('lucky-draw'))}
        />

        <GameCard
          icon="bolt"
          tint="#7c3aed"
          title={t('quiz.title')}
          desc={t('guest.games.quizDesc')}
          status={quiz.open ? t('guest.games.quizOpen') : t('guest.games.quizClosed')}
          live={quiz.open > 0}
          onClick={() => navigate(tp('quiz'))}
        />
      </div>

      <GuestNav active="games" />
    </div>
  )
}
