import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession, useActiveTourId } from '../../lib/staffSession'
import { can } from '../../lib/permissions'
import Icon from '../../components/common/Icon'
import StaffHeader from '../../components/common/StaffHeader'

// หน้ารวมเกม — ประตูเดียวก่อนเข้าบิงโกหรือเกมอื่น
//
// ทำไมต้องมี: เดิมบิงโกเป็นปุ่มเดี่ยวในหมวด "ระหว่างทริป" ของแดชบอร์ด
// พอจะเพิ่มเกมที่สอง (สุ่มรายชื่อ) เมนูหน้าหลักจะยาวขึ้นเรื่อยๆ จนหาของไม่เจอ
// รวมไว้ที่นี่แล้วเพิ่มเกมใหม่ได้โดยไม่กระทบเมนูหลัก
//
// การ์ดแต่ละใบบอกสถานะสด (กำลังเล่นกี่ห้อง กี่ใบ) เพราะหน้างานสตาฟต้องรู้ว่า
// มีอะไรค้างอยู่ก่อนกดเข้าไป ไม่ใช่กดเข้าไปดูทีละหน้า

const CARD_BASE =
  'flex items-center gap-3.5 rounded-2xl border border-line bg-surface p-4 text-left shadow-card'

function GameCard({ icon, tint, title, desc, status, statusLive, to, soonTag }) {
  const inner = (
    <>
      <span
        className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] text-white"
        style={{ background: tint }}
      >
        <Icon name={icon} size={24} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-base font-extrabold leading-tight text-ink">{title}</span>
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
              statusLive ? 'text-success-text' : 'text-ink-faint'
            }`}
          >
            <span
              className={`block h-1.5 w-1.5 rounded-full ${
                statusLive ? 'animate-pulse bg-success' : 'bg-line-strong'
              }`}
            />
            {status}
          </span>
        )}
      </span>

      {to && <Icon name="chevronRight" size={18} className="flex-none text-ink-faint" />}
    </>
  )

  if (!to) return <div className={`${CARD_BASE} opacity-70`}>{inner}</div>

  return (
    <Link to={to} className={`${CARD_BASE} transition active:border-brand`}>
      {inner}
    </Link>
  )
}

export default function Games() {
  const tourId = useActiveTourId()
  const session = getStaffSession()
  const { t } = useTranslation()

  const [tour, setTour] = useState(null)
  const [bingo, setBingo] = useState({ rooms: 0, cards: 0 })
  const [draw, setDraw] = useState({ rooms: 0, drawn: 0 })
  const [quiz, setQuiz] = useState({ rooms: 0, players: 0 })
  const [puzzle, setPuzzle] = useState({ rooms: 0, players: 0 })
  const [tiles, setTiles] = useState({ rooms: 0, players: 0 })
  const [words, setWords] = useState({ rooms: 0, players: 0 })
  const [shuffle, setShuffle] = useState({ rooms: 0, players: 0 })

  useEffect(() => {
    if (!tourId) return
    let cancelled = false

    async function load() {
      const [tourRes, gamesRes, drawRes, quizRes] = await Promise.all([
        supabase.from('tours').select('name').eq('id', tourId).maybeSingle(),
        supabase
          .from('bingo_games')
          .select('id')
          .eq('tour_id', tourId)
          .in('status', ['waiting', 'playing']),
        supabase.from('draw_rooms').select('id').eq('tour_id', tourId).eq('status', 'open'),
        // ควิซกับปริศนาใบ้คำใช้ตารางเดียวกัน — แยกด้วย game_kind
        supabase
          .from('quiz_sessions')
          .select('id, game_kind')
          .eq('tour_id', tourId)
          .neq('state', 'finished'),
      ])
      if (cancelled) return

      setTour(tourRes.data ?? null)

      const countPlayers = async (ids) => {
        if (ids.length === 0) return 0
        const { count } = await supabase
          .from('quiz_players')
          .select('id', { count: 'exact', head: true })
          .in('session_id', ids)
        return count ?? 0
      }

      const rows = quizRes.data ?? []
      const quizIds = rows.filter((r) => (r.game_kind ?? 'quiz') === 'quiz').map((r) => r.id)
      const puzzleIds = rows.filter((r) => r.game_kind === 'puzzle').map((r) => r.id)
      const tilesIds = rows.filter((r) => r.game_kind === 'tiles').map((r) => r.id)
      const wordsIds = rows.filter((r) => r.game_kind === 'words').map((r) => r.id)
      const shuffleIds = rows.filter((r) => r.game_kind === 'shuffle').map((r) => r.id)

      const [quizPlayers, puzzlePlayers, tilesPlayers, wordsPlayers, shufflePlayers] = await Promise.all([
        countPlayers(quizIds),
        countPlayers(puzzleIds),
        countPlayers(tilesIds),
        countPlayers(wordsIds),
        countPlayers(shuffleIds),
      ])
      if (!cancelled) {
        setQuiz({ rooms: quizIds.length, players: quizPlayers })
        setPuzzle({ rooms: puzzleIds.length, players: puzzlePlayers })
        setTiles({ rooms: tilesIds.length, players: tilesPlayers })
        setWords({ rooms: wordsIds.length, players: wordsPlayers })
        setShuffle({ rooms: shuffleIds.length, players: shufflePlayers })
      }

      const drawIds = (drawRes.data ?? []).map((r) => r.id)
      if (drawIds.length === 0) {
        setDraw({ rooms: 0, drawn: 0 })
      } else {
        const { count } = await supabase
          .from('draw_results')
          .select('id', { count: 'exact', head: true })
          .in('room_id', drawIds)
        if (!cancelled) setDraw({ rooms: drawIds.length, drawn: count ?? 0 })
      }

      const ids = (gamesRes.data ?? []).map((g) => g.id)
      if (ids.length === 0) {
        setBingo({ rooms: 0, cards: 0 })
        return
      }

      // นับจำนวนใบอย่างเดียว ไม่ดึงข้อมูลการ์ดมาทั้งก้อน — หน้านี้แค่โชว์ตัวเลข
      const { count } = await supabase
        .from('bingo_cards')
        .select('id', { count: 'exact', head: true })
        .in('game_id', ids)

      if (!cancelled) setBingo({ rooms: ids.length, cards: count ?? 0 })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  // ตอนนี้ route ทั้งหน้าใช้สิทธิ์ bingo.host อยู่แล้ว เช็คซ้ำตรงนี้ดูเกินจำเป็น
  // แต่พอสุ่มรายชื่อเปิดใช้จริงจะมีสิทธิ์ของตัวเอง แล้ว route จะต้องคลายลง
  // ถึงตอนนั้นการ์ดบิงโกต้องยังซ่อนเองได้โดยไม่ต้องกลับมาแก้ตรงนี้
  const canHost = can(session, 'bingo.host')

  return (
    <div className="min-h-screen bg-surface-muted">
      <StaffHeader
        icon="game"
        title={t('staff.games.title')}
        subtitle={tour?.name ?? t('common.loading')}
      />

      <div className="mx-auto max-w-md space-y-2.5 p-4">
        <GameCard
          icon="target"
          tint="#c2410c"
          title={t('staff.bingoHost.title')}
          desc={t('staff.games.bingoDesc')}
          status={
            bingo.rooms > 0
              ? t('staff.games.bingoLive', { rooms: bingo.rooms, cards: bingo.cards })
              : t('staff.games.bingoIdle')
          }
          statusLive={bingo.rooms > 0}
          to={canHost ? '/staff/bingo-host' : null}
        />

        <GameCard
          icon="bolt"
          tint="#1d4ed8"
          title={t('staff.games.drawTitle')}
          desc={t('staff.games.drawDesc')}
          status={
            draw.rooms > 0
              ? t('staff.games.drawLive', { rooms: draw.rooms, drawn: draw.drawn })
              : t('staff.games.drawIdle')
          }
          statusLive={draw.drawn > 0}
          to={canHost ? '/staff/lucky-draw' : null}
        />

        <GameCard
          icon="bolt"
          tint="#7c3aed"
          title={t('staff.quiz.title')}
          desc={t('staff.games.quizDesc')}
          status={
            quiz.rooms > 0
              ? t('staff.games.quizLive', { rooms: quiz.rooms, players: quiz.players })
              : t('staff.games.quizIdle')
          }
          statusLive={quiz.rooms > 0}
          to={can(session, 'quiz.host') ? '/staff/quiz' : null}
        />

        <GameCard
          icon="eye"
          tint="#0f8a4a"
          title={t('puzzle.title')}
          desc={t('staff.games.puzzleDesc')}
          status={
            puzzle.rooms > 0
              ? t('staff.games.puzzleLive', { rooms: puzzle.rooms, players: puzzle.players })
              : t('staff.games.puzzleIdle')
          }
          statusLive={puzzle.rooms > 0}
          to={can(session, 'puzzle.host') ? '/staff/puzzle' : null}
        />

        <GameCard
          icon="expand"
          tint="#b45309"
          title={t('tiles.title')}
          desc={t('staff.games.tilesDesc')}
          status={
            tiles.rooms > 0
              ? t('staff.games.tilesLive', { rooms: tiles.rooms, players: tiles.players })
              : t('staff.games.tilesIdle')
          }
          statusLive={tiles.rooms > 0}
          to={can(session, 'tiles.host') ? '/staff/tiles' : null}
        />

        <GameCard
          icon="language"
          tint="#be185d"
          title={t('words.title')}
          desc={t('staff.games.wordsDesc')}
          status={
            words.rooms > 0
              ? t('staff.games.wordsLive', { rooms: words.rooms, players: words.players })
              : t('staff.games.wordsIdle')
          }
          statusLive={words.rooms > 0}
          to={can(session, 'words.host') ? '/staff/words' : null}
        />

        <GameCard
          icon="shuffle"
          tint="#0e7490"
          title={t('shuffle.title')}
          desc={t('staff.games.shuffleDesc')}
          status={
            shuffle.rooms > 0
              ? t('staff.games.shuffleLive', { rooms: shuffle.rooms, players: shuffle.players })
              : t('staff.games.shuffleIdle')
          }
          statusLive={shuffle.rooms > 0}
          to={can(session, 'shuffle.host') ? '/staff/shuffle' : null}
        />

        <div className="flex items-center gap-3.5 rounded-2xl border border-dashed border-line-strong p-4">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-[14px] bg-surface-sunken text-ink-faint">
            <Icon name="plus" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-extrabold leading-tight text-ink-muted">
              {t('staff.games.moreTitle')}
            </span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-faint">
              {t('staff.games.moreDesc')}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
