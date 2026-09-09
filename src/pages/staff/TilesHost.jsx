import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useQuizSession, serverNow } from '../../lib/useQuizSession'
import {
  nextQuestion, lockAndReveal, setSessionState, resolveHostToken, stageUrl,
} from '../../lib/quizHost'
import {
  openTile, undoTile, fetchTileImage, fetchTileStats, fetchTileFeed, acceptTileAnswer,
} from '../../lib/tileHost'
import { openCount, tileCount } from '../../lib/tileGrid'
import TileBoard from '../../components/tiles/TileBoard'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// มือถือคนคุมเกม — จอสั่งงานอย่างเดียว
//
// สามอย่างที่หน้านี้มีแล้วเกมอื่นไม่มี:
//
//   1. ★ เห็นภาพเต็มแบบหรี่แสงใต้กระดาน
//      ถ้าเห็นแค่กระดานที่ปิดอยู่เหมือนลูกทัวร์ เขาก็เป็นแค่คนกดปุ่มสุ่ม แล้วเกมจะพัง
//      ด้วยอุบัติเหตุ: บังเอิญเปิดแผ่นที่มีใบหน้าอยู่พอดีตั้งแต่แผ่นที่สอง จบเกมทันที
//      เห็นภาพก่อน = เลือกเปิดมุมท้องฟ้าก่อน เก็บใบหน้าไว้ท้ายสุด = คุมจังหวะได้จริง
//
//   2. feed คำตอบเรียงตามเวลา พร้อมค่าความใกล้เคียง
//      แถบความใกล้เคียงโผล่เฉพาะเมื่อ >= 60 — คำตอบของเกมนี้มักสั้นและแคบ
//      ("ส้ม" กับ "มะม่วง" ห่างกัน 100% ทั้งที่ทั้งคู่คือคนเดามั่ว) ถ้าโชว์ทุกแถว
//      คนคุมเกมจะเห็นแถบ 8% เต็มจอจนเลิกมอง แถบที่โผล่มาต้องแปลว่า "คนนี้น่าสนใจ" ทุกครั้ง
//
//   3. ปุ่มยกเลิกแผ่นล่าสุด — นิ้วลั่นครั้งเดียวต่อหน้าคน 40 คนแล้วแก้ไม่ได้ = ข้อนั้นจบ
//
// feed ใช้ poll ทุก 1.5 วินาที ไม่ใช่ realtime — 40 คนเดารัวๆ = event ท่วมทุกเครื่องในห้อง
// (กติกาเดิมของ useQuizSession: ห้าม subscribe quiz_players / quiz_answers)

const CLOSENESS_SHOW = 60
const UNDO_WINDOW_MS = 5000

export default function TilesHost() {
  const { sessionId } = useParams()
  const { t } = useTranslation()

  const [ready, setReady] = useState(false)
  const [stats, setStats] = useState({ solved: 0, guesses: 0, online: 0, total: 0, still_in: 0 })
  const [feed, setFeed] = useState([])
  const [sortBy, setSortBy] = useState('time')   // time | closeness
  const [imageUrl, setImageUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  const cursorRef = useRef(null)
  const { session, question, phase } = useQuizSession(sessionId)

  useEffect(() => {
    setReady(Boolean(resolveHostToken(sessionId)))
  }, [sessionId])

  const questionId = session?.current_question_id ?? null
  const live = phase === 'answering' || phase === 'countdown' || phase === 'locked'
  const grid = question?.tiles ?? { grid_rows: 3, grid_cols: 4 }
  const total = tileCount(grid.grid_rows, grid.grid_cols)
  const opened = openCount(session?.revealed_tiles, grid.grid_rows, grid.grid_cols)

  // ภาพจริงของข้อปัจจุบัน — ออกได้ทาง RPC ที่ตรวจ token เท่านั้น
  useEffect(() => {
    let alive = true
    cursorRef.current = null
    setFeed([])
    setImageUrl(null)
    if (!sessionId || !questionId) return undefined
    fetchTileImage(sessionId, questionId)
      .then((url) => { if (alive) setImageUrl(url) })
      .catch(() => {})
    return () => { alive = false }
  }, [sessionId, questionId])

  const pull = useCallback(async () => {
    if (!sessionId || !questionId) return
    try {
      const [s, rows] = await Promise.all([
        fetchTileStats(sessionId, questionId),
        fetchTileFeed(sessionId, questionId, cursorRef.current, 40),
      ])
      setStats(s)
      if (rows.length) {
        const last = rows[rows.length - 1]
        cursorRef.current = { created_at: last.created_at, guess_id: last.guess_id }
        setFeed((prev) => {
          const seen = new Set(prev.map((r) => r.guess_id))
          const merged = [...prev, ...rows.filter((r) => !seen.has(r.guess_id))]
          return merged.slice(-120)   // จอมือถือไม่มีใครเลื่อนย้อนเกินนี้
        })
      }
    } catch {
      // เน็ตสะดุดบนรถเป็นเรื่องปกติ — รอบหน้าค่อยว่ากัน ไม่ต้องขึ้น error ให้ตกใจ
    }
  }, [sessionId, questionId])

  useEffect(() => {
    if (!questionId) return undefined
    pull()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') pull()
    }, 1500)
    return () => clearInterval(timer)
  }, [questionId, pull])

  // เดินนาฬิกาช้าๆ เพื่อให้ปุ่มยกเลิกหายไปเองเมื่อพ้น 5 วินาที
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [])

  const canUndo = useMemo(() => {
    if (!session?.last_tile_at || !live) return false
    return serverNow() - new Date(session.last_tile_at).getTime() < UNDO_WINDOW_MS
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.last_tile_at, live, tick])

  const shown = useMemo(() => {
    const rows = [...feed]
    if (sortBy === 'closeness') rows.sort((a, b) => (b.closeness ?? 0) - (a.closeness ?? 0))
    else rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    return rows.slice(-60).reverse()   // ใหม่สุดอยู่บน มือถือจะได้ไม่ต้องเลื่อน
  }, [feed, sortBy])

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      pull()
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="font-bold text-ink">{t('staff.quiz.noToken')}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-muted pb-8">
      <StaffHeader icon="game" title={t('tiles.title')} subtitle={session?.name ?? ''} />

      <div className="mx-auto max-w-md space-y-4 p-4">
        {error && <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>}

        <a
          href={stageUrl(sessionId, 'tiles')}
          target="_blank" rel="noreferrer"
          className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-bold text-ink"
        >
          <Icon name="expand" size={16} />
          {t('tiles.host.openStage')}
        </a>

        {/* ── กระดาน: นิ้วต้องถึง จึงอยู่บนสุด ─────────────── */}
        {questionId && (
          <section className="space-y-2">
            <TileBoard
              rows={grid.grid_rows}
              cols={grid.grid_cols}
              crop={{ x: grid.crop_x, y: grid.crop_y, w: grid.crop_w, h: grid.crop_h }}
              imageUrl={imageUrl}
              coverImageUrl={grid.cover_image_url}
              revealed={session?.revealed_tiles ?? []}
              peek
              onTileClick={live && !busy ? (n) => run(() => openTile(sessionId, n)) : null}
            />
            <p className="text-center text-xs text-ink-faint">{t('tiles.host.tapHint')}</p>

            <div className="flex gap-2">
              <Button disabled={busy || !live || opened >= total}
                      onClick={() => run(() => openTile(sessionId, null))}>
                {t('tiles.host.openRandom')}
              </Button>
              {canUndo && (
                <Button variant="ghost" fullWidth={false} className="px-3 py-2 text-sm"
                        disabled={busy} onClick={() => run(() => undoTile(sessionId))}>
                  {t('tiles.host.undo')}
                </Button>
              )}
            </div>
          </section>
        )}

        {/* ── ตัวเลข ────────────────────────────────────────── */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <p className="text-sm font-bold text-ink">
            {t('tiles.host.progress', {
              index: (session?.current_index ?? -1) + 1,
              state: t(`tiles.state.${phase}`, { defaultValue: phase }),
            })}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {t('tiles.host.openedOf', { opened, total })}
          </p>
          {/* ★ "ยังตอบได้กี่คน" คือตัวเลขที่บอกว่าควรเปิดต่อหรือเฉลยเลย
              เหลือ 3 จาก 40 = การเปิดแผ่นต่อไปไม่มีความหมายแล้ว */}
          <p className="mt-0.5 text-sm text-ink-muted">
            {t('tiles.host.stats', {
              stillIn: stats.still_in,
              online: stats.online,
              guesses: stats.guesses,
            })}
          </p>
        </section>

        {/* ── feed คำตอบ ────────────────────────────────────── */}
        {feed.length > 0 && (
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-ink">{t('tiles.host.feedTitle')}</p>
              <div className="flex gap-1">
                {['time', 'closeness'].map((m) => (
                  <button key={m} type="button" onClick={() => setSortBy(m)}
                          className={[
                            'rounded-full px-2.5 py-1 text-xs font-semibold',
                            sortBy === m ? 'bg-ink text-white' : 'bg-neutral-bg text-ink-muted',
                          ].join(' ')}>
                    {t(`tiles.host.sort.${m}`)}
                  </button>
                ))}
              </div>
            </div>

            <ul className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
              {shown.map((r) => (
                <li key={r.guess_id} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 truncate text-xs text-ink-faint">{r.player_name}</span>
                  <span className={[
                    'min-w-0 flex-1 truncate text-sm',
                    r.is_correct ? 'font-bold text-success-text' : 'text-ink',
                  ].join(' ')}>
                    {r.guess_text}
                  </span>

                  {/* แถบโผล่เฉพาะเมื่อใกล้จริง ไม่งั้นเป็นของประดับที่คนเลิกมอง */}
                  {!r.is_correct && r.closeness >= CLOSENESS_SHOW && (
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-neutral-bg">
                        <span className="block h-full rounded-full bg-warning-text"
                              style={{ width: `${r.closeness}%` }} />
                      </span>
                      <span className="w-7 text-right text-[10px] text-ink-faint">{r.closeness}%</span>
                    </span>
                  )}

                  {!r.is_correct && live && stats.solved === 0 && (
                    <button type="button" disabled={busy}
                            onClick={() => run(() => acceptTileAnswer(sessionId, questionId, r.guess_text))}
                            className="shrink-0 rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
                      {t('tiles.host.accept')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── ปุ่มคุมเกม ────────────────────────────────────── */}
        <section className="space-y-2">
          {phase === 'lobby' || phase === 'scoreboard' || phase === 'reveal' ? (
            <Button disabled={busy}
                    onClick={() => run(() => nextQuestion(sessionId, session?.current_index ?? -1))}>
              {phase === 'lobby' ? t('tiles.host.start') : t('tiles.host.next')}
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => run(() => lockAndReveal(sessionId))}>
              {t('tiles.host.lockReveal')}
            </Button>
          )}

          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy}
                    onClick={() => run(() => setSessionState(sessionId, 'scoreboard'))}>
              {t('tiles.host.scoreboard')}
            </Button>
            <Button variant="ghost" disabled={busy}
                    onClick={() => run(() => setSessionState(sessionId, 'finished'))}>
              {t('tiles.host.finish')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
