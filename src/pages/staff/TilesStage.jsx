import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { useQuizSession } from '../../lib/useQuizSession'
import { stageChecker } from '../../lib/quizStyle'
import { resolveHostToken } from '../../lib/quizHost'
import { fetchTileImage, fetchTileStats } from '../../lib/tileHost'
import { boardRevealed, openCount, tileCount } from '../../lib/tileGrid'
import TileBoard from '../../components/tiles/TileBoard'

// จอใหญ่ของเกมเปิดแผ่นป้าย — เปิดแท็บแยก ไม่มีปุ่มสั่งงานแม้แต่ปุ่มเดียว
// รับ token ผ่าน #t= เหมือน QuizStage/PuzzleStage เพราะต้องเห็นภาพจริงซึ่งเป็นเฉลย
//
// ใช้สกิน arcade ชุดเดียวกับเกมปริศนาใบ้คำ (quiz_start_session ตั้ง stage_theme = 'arcade'
// ให้เกมนี้ด้วย) เพื่อให้สองเกมดูเป็นชุดเดียวกันเมื่อเล่นต่อกันในทริปเดียว
//
// ★ ไม่มีนาฬิกานับถอยหลังบนจอนี้โดยตั้งใจ — เกมนี้คนคุมเกมกำหนดจังหวะเอง
//   สิ่งที่แสดงแทนคือ "เปิดไปแล้วกี่แผ่น" ซึ่งคือความคืบหน้าที่มีความหมายจริงของเกม


// โปสเตอร์หน้ารอ — ใช้ cover_url ของชุดถ้าตั้งไว้ ไม่งั้นใช้ของแถมมากับแอป
// จะได้เปลี่ยนภาพต่อชุดได้โดยไม่ต้องแก้โค้ด (เกมทายภาพวิวกับทายว่าใครควรมีหน้ารอคนละแบบ)
const DEFAULT_LOBBY_ART = '/games/who-is-who.jpg'

/** ป้ายพิลเหลืองคร่อมขอบบน — ชุดเดียวกับเกมปริศนาใบ้คำ ไม่มีเงา ตัวย่อขยายตามจอ */
function Pill({ children, className = '' }) {
  return (
    <span
      className={`inline-block max-w-full truncate rounded-full border-[5px] border-black bg-[#f2f75f] px-10 py-2 font-black text-black ${className}`}
      style={{ fontSize: 'clamp(1.5rem, 3.4vw, 4rem)' }}
    >
      {children}
    </span>
  )
}

export default function TilesStage() {
  const { sessionId } = useParams()
  const { session, question, phase } = useQuizSession(sessionId)
  const [stats, setStats] = useState({ solved: 0, online: 0, still_in: 0, winner_name: null })
  // ★ เก็บภาพคู่กับ "ข้อที่มันเป็นของ" เสมอ — ถ้าเก็บ url เดี่ยวๆ จะมีเสี้ยวหนึ่งที่
  //   ข้อเปลี่ยนไปแล้วแต่ url ยังเป็นของข้อเก่า (หรือกลับกัน) แล้วภาพโผล่ใต้แผ่นที่ยังเปิดค้าง
  const [image, setImage] = useState({ qid: null, url: null })
  const [leaderboard, setLeaderboard] = useState([])
  const [setCover, setSetCover] = useState(null)
  const preloadRef = useRef(new Set())

  useEffect(() => {
    resolveHostToken(sessionId)
  }, [sessionId])

  const questionId = session?.current_question_id ?? null
  const grid = question?.tiles ?? { grid_rows: 3, grid_cols: 4 }
  const total = tileCount(grid.grid_rows, grid.grid_cols)
  const opened = openCount(session?.revealed_tiles, grid.grid_rows, grid.grid_cols)

  const reveal = session?.reveal_payload ?? {}
  const revealing = phase === 'reveal' && reveal.kind === 'tiles'
  const busTv = session?.screen_mode === 'bus_tv'

  // ★ ตอนเฉลยต้องเปิดครบทุกแผ่นเสมอ — ไม่รอว่า revealed_tiles ในฐานข้อมูลจะครบไหม
  //   (ห้องที่เปิดค้างอยู่ก่อนดีพลอย หรือกดเฉลยทั้งที่ไม่มีใครตอบถูก)
  const shown = useMemo(
    () => boardRevealed(session?.revealed_tiles, grid.grid_rows, grid.grid_cols, revealing),
    [session?.revealed_tiles, grid.grid_rows, grid.grid_cols, revealing]
  )

  // ภาพจริงของข้อปัจจุบัน
  useEffect(() => {
    let alive = true
    setImage({ qid: null, url: null })
    if (!sessionId || !questionId) return undefined
    fetchTileImage(sessionId, questionId)
      .then((url) => { if (alive) setImage({ qid: questionId, url }) })
      .catch(() => {})
    return () => { alive = false }
  }, [sessionId, questionId])

  const imageUrl = image.qid === questionId ? image.url : null

  /**
   * ★ โหลดภาพข้อถัดไปไว้ล่วงหน้า
   *
   * เกมนี้ทั้งเกมแขวนอยู่กับภาพเดียว ถ้าจอขึ้นวงกลมหมุนตอนกดเปิดข้อ จังหวะพังทันที
   * และรถบัส 40 คนแชร์เสา 4G เดียวกันคือสภาพปกติ ไม่ใช่กรณีเลวร้าย
   *
   * จอนี้จึงรู้เฉลยข้อถัดไปล่วงหน้า — ยอมรับได้เพราะเป็นเครื่องของทีมงานและถือ token อยู่แล้ว
   * **แต่ห้ามเรนเดอร์ลง DOM** เก็บไว้ในแคชเบราว์เซอร์เฉยๆ
   */
  useEffect(() => {
    const setId = session?.set_id
    const index = session?.current_index ?? -1
    if (!setId || index < 0 || !sessionId) return undefined
    let alive = true

    ;(async () => {
      const { data } = await supabase
        .from('quiz_questions')
        .select('id')
        .eq('set_id', setId)
        .order('sort_order')
        .order('created_at')
        .range(index + 1, index + 1)
      const nextId = data?.[0]?.id
      if (!alive || !nextId || preloadRef.current.has(nextId)) return
      preloadRef.current.add(nextId)
      try {
        const url = await fetchTileImage(sessionId, nextId)
        if (url) new Image().src = url
      } catch {
        /* โหลดล่วงหน้าไม่สำเร็จไม่ใช่เรื่องที่ต้องบอกใคร ข้อถัดไปก็แค่โหลดช้าลงหน่อย */
      }
    })()

    return () => { alive = false }
  }, [sessionId, session?.set_id, session?.current_index])

  // ★ poll ต่อระหว่าง reveal ด้วย — stats เป็นทางเดียวที่จอรู้ "ทีม" ของผู้ชนะ
  //   (reveal_payload มีแค่ชื่อ) และรู้ทันทีที่มีคนตอบถูกโดยไม่ต้องรอคนคุมเกมกดเฉลย
  useEffect(() => {
    if (!questionId || phase === 'lobby') return undefined
    let alive = true
    const tick = async () => {
      try {
        const s = await fetchTileStats(sessionId, questionId)
        if (alive) setStats(s)
      } catch {
        /* จอเวทีห้ามขึ้น error ต่อหน้าคนทั้งห้อง */
      }
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [sessionId, questionId, phase])

  // ภาพหน้ารอของชุดนี้ (ถ้าตั้งไว้)
  useEffect(() => {
    if (!session?.set_id) return
    supabase.from('quiz_sets').select('cover_url').eq('id', session.set_id).maybeSingle()
      .then(({ data }) => setSetCover(data?.cover_url ?? null))
  }, [session?.set_id])

  // เล่นเป็นทีมก็ให้กระดานเป็นของทีม ไม่ใช่รายคน
  // คะแนนทีม = คะแนนรวมของสมาชิก (เจ้าของโปรเจกต์เปลี่ยน 11 ก.ย. 2026)
  // เดิมเป็นค่าเฉลี่ยปัดเศษ ซึ่งบนสเกล 1 คะแนน ทีม 3 คนที่ชนะ 1 ข้อ = 0.33 → ขึ้นจอเป็น 0
  // quiz_team_leaderboard เรียงด้วย total_score ให้เองเมื่อเป็นเกม puzzle/tiles
  useEffect(() => {
    if (phase !== 'scoreboard' && phase !== 'finished') return
    const rpc = session?.team_mode
      ? supabase.rpc('quiz_team_leaderboard', { p_session_id: sessionId })
      : supabase.rpc('quiz_leaderboard', { p_session_id: sessionId, p_limit: busTv ? 3 : 10 })
    rpc.then(({ data }) => setLeaderboard((data ?? []).slice(0, busTv ? 3 : 10)))
  }, [phase, sessionId, busTv, session?.team_mode, session?.current_index])

  const heading = useMemo(() => {
    if (revealing) return reveal.answer ?? ''
    if (question?.text) return question.text
    return session?.name ?? ''
  }, [revealing, reveal.answer, question?.text, session?.name])

  const showBoard = questionId && phase !== 'scoreboard' && phase !== 'finished'

  // ★ มีคนตอบถูกแล้วหรือยัง — ข้อจะล็อกทันทีที่มีคนตอบถูก แต่ชื่อผู้ชนะเดิม
  //   โผล่ตอนกด "เฉลย" เท่านั้น ระหว่างนั้นจอเลยขึ้น "ยังตอบได้ 0 คน"
  //   ซึ่งอ่านแล้วเหมือนไม่มีใครตอบได้ ทั้งที่เพิ่งมีคนตอบถูกไปเมื่อกี้
  const winner = stats.winner_name
    ? { name: stats.winner_name, team: stats.winner_team, sec: stats.winner_seconds }
    : (revealing && reveal.fastest
        ? { name: reveal.fastest.name, team: reveal.fastest.team ?? null, sec: reveal.fastest.seconds }
        : null)

  return (
    <div
      // ★ h-[100dvh] + min-h-0 ทุกชั้น = จอโปรเจกเตอร์ 16:9 ไม่ต้องเลื่อน
      //   (เจ้าของโปรเจกต์เจอ 12 ก.ย. 2026: ต่อ HDMI แล้วเห็นเลขไม่ครบ ต้องเลื่อนขึ้นลง)
      //   ของเดิมใช้ min-h-screen แล้วปล่อยกระดานสูงตาม aspect ซึ่งล้นจอเตี้ยเสมอ
      className="flex h-[100dvh] w-full flex-col items-center overflow-hidden p-2 sm:p-4"
      style={{ background: stageChecker(sessionId) }}
    >
      <div className="relative flex min-h-0 w-full max-w-[1800px] flex-1 flex-col rounded-[32px] border-[7px] border-black bg-white px-4 pb-4 pt-14 sm:px-8 sm:pb-6 sm:pt-20">
        <div className="pointer-events-none absolute inset-x-0 -top-1 flex items-start justify-center px-4">
          <Pill>{heading}</Pill>
        </div>

        {showBoard && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3">
            {/* ความคืบหน้าที่มีความหมายของเกมนี้คือจำนวนแผ่น ไม่ใช่วินาที */}
            {!revealing && (
              <div
                className="flex shrink-0 items-center justify-between font-black text-black"
                style={{ fontSize: 'clamp(1rem, 1.9vw, 2.25rem)' }}
              >
                <span>เปิดแล้ว {opened}/{total}</span>
                {winner
                  ? <span className="text-[#0f8a4a]">🎉 {winner.name} ตอบถูกแล้ว</span>
                  : <span>ยังไม่มีใครตอบถูก</span>}
              </div>
            )}

            {/* กระดานกินที่ที่เหลือทั้งหมด แล้วบีบตัวเองให้พอดีทั้งกว้างและสูง */}
            <div className="flex min-h-0 w-full flex-1 items-center justify-center">
              <TileBoard
                rows={grid.grid_rows}
                cols={grid.grid_cols}
                crop={{ x: grid.crop_x, y: grid.crop_y, w: grid.crop_w, h: grid.crop_h }}
                imageUrl={imageUrl}
                imageAspect={grid.image_aspect}
                coverImageUrl={grid.cover_image_url}
                revealed={shown}
                showNumbers={!revealing}
                fit
              />
            </div>

            {/* ผู้ชนะ — จังหวะพีคของข้อ ตัวใหญ่กว่าทุกอย่างบนจอ */}
            {revealing && winner && (
              <div className="shrink-0 text-center">
                <p className="font-black leading-tight text-black" style={{ fontSize: 'clamp(1.5rem, 3.4vw, 3.75rem)' }}>
                  🎉 {winner.name}
                  {winner.team ? <span className="text-black/60"> · ทีม {winner.team}</span> : null}
                </p>
                {reveal.explain && (
                  <p className="font-bold text-black/70" style={{ fontSize: 'clamp(1rem, 1.9vw, 2rem)' }}>
                    {reveal.explain}
                  </p>
                )}
              </div>
            )}
            {revealing && !winner && (
              <p
                className="shrink-0 text-center font-black text-black/60"
                style={{ fontSize: 'clamp(1.25rem, 2.8vw, 3rem)' }}
              >
                ไม่มีใครตอบถูก
              </p>
            )}
          </div>
        )}

        {(phase === 'scoreboard' || phase === 'finished') && (
          <ol className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col justify-center gap-2 overflow-hidden">
            {leaderboard.map((row, i) => (
              <li
                key={row.id ?? i}
                className="flex items-center gap-4 rounded-2xl border-[4px] border-black bg-[#f2f75f] px-5 py-2 font-black text-black"
                style={{ fontSize: 'clamp(1.25rem, 2.4vw, 2.75rem)' }}
              >
                <span className="w-10 text-center">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">
                  {/* กระดานทีมคืนคอลัมน์ name ส่วนกระดานรายคนคืน display_name */}
                  {row.display_name ?? row.name}
                  {row.member_count ? (
                    <span className="text-black/50"> ({row.member_count})</span>
                  ) : null}
                </span>
                <span className="tabular-nums">{row.score ?? row.total_score}</span>
              </li>
            ))}
          </ol>
        )}

        {phase === 'lobby' && (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
            <img
              src={setCover || DEFAULT_LOBBY_ART}
              alt=""
              className="max-h-full min-h-0 max-w-full rounded-2xl border-[4px] border-black object-contain"
            />
            <p className="shrink-0 font-black text-black/60" style={{ fontSize: 'clamp(1.25rem, 2.4vw, 2.75rem)' }}>
              รอเริ่มเกม
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
