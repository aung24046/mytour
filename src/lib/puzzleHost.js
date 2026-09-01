// คำสั่งของเกมปริศนาใบ้คำ — รวมไว้ที่เดียวเพื่อไม่ให้ลืมแนบ token
//
// เกมนี้วิ่งบนเครื่องยนต์เดียวกับควิซ ห้อง/ผู้เล่น/นาฬิกา/ปุ่มคุมเกมพื้นฐาน
// (เปิดข้อ ปิดรับ เฉลย จบเกม) จึงใช้ของ quizHost.js ตรงๆ ไม่ทำซ้ำ
// ไฟล์นี้มีเฉพาะสิ่งที่เกมนี้มีแต่ควิซไม่มี: เดาคำ · คำใบ้ · คำที่เกือบถูก · Builder
import { supabase } from './supabase'
import { getHostToken } from './quizHost'

// ── ฝั่งลูกทัวร์ ─────────────────────────────────────────────────────

/**
 * ส่งคำเดา — ตอบได้ไม่จำกัดครั้ง
 * คืน { status, correct, attempts_used, attempts_left }
 *   status: ok | already | duplicate | too_fast | closed | not_started
 *           wrong_question | no_attempts | empty | too_long | no_session
 * ทุกด่านตัดสินฝั่ง server — ที่นี่ไม่ตรวจอะไรเลยนอกจากช่องว่าง
 */
export async function submitGuess({ sessionId, playerId, questionId, text }) {
  const { data, error } = await supabase.rpc('quiz_puzzle_guess', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_question_id: questionId,
    p_text: text,
  })
  if (error) throw error
  return data ?? { status: 'unknown' }
}

/** รีเฟรชกลางข้อแล้วต้องรู้ว่าตัวเองตอบถูกไปหรือยัง */
export async function fetchMyState({ sessionId, playerId, questionId }) {
  const { data, error } = await supabase.rpc('quiz_puzzle_my_state', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_question_id: questionId,
  })
  if (error) throw error
  return data ?? { solved: false, guesses: 0 }
}

// ── ฝั่งคนคุมเกม ─────────────────────────────────────────────────────

/** เปิดคำใบ้ขั้นถัดไปให้ทั้งห้อง — ผู้เล่นไม่มีปุ่มขอเอง (ดูข้อ 4.3 ของเอกสารออกแบบ) */
export async function openHint(sessionId, step) {
  const { data, error } = await supabase.rpc('quiz_puzzle_hint', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
    p_step: step,
  })
  if (error) throw error
  return data
}

export async function fetchPuzzleStats(sessionId, questionId) {
  const { data, error } = await supabase.rpc('quiz_puzzle_stats', {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_token: getHostToken(sessionId),
    p_online_window_sec: 60,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ?? { solved: 0, guesses: 0, online: 0, total: 0 }
}

export async function fetchNearMisses(sessionId, questionId) {
  const { data, error } = await supabase.rpc('quiz_puzzle_near_misses', {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_token: getHostToken(sessionId),
    p_limit: 6,
  })
  if (error) throw error
  return data ?? []
}

/** รับคำที่เกือบถูกเป็นคำตอบถูก — คิดคะแนนจากเวลาที่เขาส่งจริง และจำไว้ถาวร */
export async function acceptAnswer(sessionId, questionId, text) {
  const { data, error } = await supabase.rpc('quiz_puzzle_accept', {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_token: getHostToken(sessionId),
    p_text: text,
  })
  if (error) throw error
  return data
}

// ── ฝั่งคนสร้างข้อ (ต้องใช้ PIN — เฉลยอยู่ในตารางที่ปิดจาก anon) ─────

export async function fetchPuzzleSet({ setId, staffId, pin }) {
  const { data, error } = await supabase.rpc('quiz_puzzle_set_for_edit', {
    p_set_id: setId,
    p_staff_id: staffId,
    p_pin: pin,
  })
  if (error) throw error
  return data ?? []
}

export async function savePuzzle({
  staffId, pin, setId, questionId, text, syllableCount, timeLimitSec,
  clues, answer, answerSplit, aliases, answerImageUrl, hints, explain, sortOrder,
}) {
  const { data, error } = await supabase.rpc('quiz_puzzle_upsert', {
    p_staff_id: staffId,
    p_pin: pin,
    p_set_id: setId,
    p_question_id: questionId ?? null,
    p_text: text ?? '',
    p_syllable_count: syllableCount ?? 1,
    p_time_limit_sec: timeLimitSec ?? 90,
    p_clues: clues ?? [],
    p_answer: answer,
    p_answer_split: answerSplit ?? null,
    p_aliases: aliases ?? [],
    p_answer_image_url: answerImageUrl ?? null,
    p_hints: hints ?? [],
    p_explain: explain ?? '',
    p_sort_order: sortOrder ?? 0,
  })
  if (error) throw error
  return data
}

/**
 * ลองตรวจคำตอบโดยไม่ต้องขึ้นเวที
 * เป็นวิธีเดียวที่คนสร้างข้อ "กาละแม" จะรู้ตัวก่อนว่า "กะละแม" ที่ลูกทัวร์พิมพ์ยังไม่ผ่าน
 * เทียบฝั่ง client ด้วย normalize ของ server (quiz_norm_answer / quiz_loose_answer)
 * จึงได้ผลตรงกับตอนเล่นจริงเสมอ โดยไม่ต้องเปิดเฉลยให้ใครเห็น
 */
export async function tryAnswer(answer, aliases, typed) {
  const candidates = [answer, ...(aliases ?? [])]
    .map((x) => (x ?? '').trim())
    .filter(Boolean)
  if (candidates.length === 0 || !(typed ?? '').trim()) return false

  const norm = async (text) => {
    const [{ data: a }, { data: b }] = await Promise.all([
      supabase.rpc('quiz_norm_answer', { p_text: text }),
      supabase.rpc('quiz_loose_answer', { p_text: text }),
    ])
    return { strict: a ?? '', loose: b ?? '' }
  }

  const [mine, ...theirs] = await Promise.all([norm(typed), ...candidates.map(norm)])
  if (!mine.strict) return false
  return theirs.some((c) => c.strict === mine.strict || (c.loose && c.loose === mine.loose))
}
