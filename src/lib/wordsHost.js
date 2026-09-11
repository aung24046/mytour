// คำสั่งของเกม What Words — รวมไว้ที่เดียวเพื่อไม่ให้ลืมแนบ token/PIN
//
// เกมนี้วิ่งบนเครื่องยนต์ควิซเหมือนปริศนาใบ้คำ ส่วนที่ "เหมือนกันทุกอย่าง" ยืมมาใช้ตรงๆ:
//   ส่งคำตอบ / สถานะของฉัน / ตัวเลขสด / คำที่เกือบถูก / กดรับคำ  → puzzleHost.js
//   เปิดข้อ / ปิดรับ / เฉลย / จบเกม / ทีม                        → quizHost.js
// ไฟล์นี้มีเฉพาะสิ่งที่เกมนี้มีแต่เกมอื่นไม่มี: คำตอบของข้อปัจจุบัน · เปิดตัวที่ซ่อน · Builder
import { useEffect, useState } from 'react'

import { supabase } from './supabase'
import { getHostToken } from './quizHost'

export {
  submitGuess, fetchMyState, fetchPuzzleStats as fetchWordsStats,
  fetchNearMisses, acceptAnswer, tryAnswer, setRoomSolveLimit, effectiveSolveLimit,
} from './puzzleHost'

// ── ฝั่งคนคุมเกม (ต้องมี token) ────────────────────────────────────────

/**
 * คำตอบเต็มของข้อที่กำลังเล่น — คนคุมเกมต้องเห็นว่าจะเปิดตัวอะไรก่อนกด
 * คืน { question_id, answer, cells: [{c, m, h}] } หรือ null ถ้ายังไม่เปิดข้อ
 */
export async function fetchWordsKey(sessionId) {
  const { data, error } = await supabase.rpc('quiz_words_key', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
  })
  if (error) throw error
  return data ?? null
}

/** เปิดตัวที่ซ่อนให้ทั้งห้อง — slot = ลำดับช่อง (เริ่ม 0) · null = ตัวถัดไปที่ยังไม่เปิด */
export async function openLetter(sessionId, slot = null) {
  const { data, error } = await supabase.rpc('quiz_words_open', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
    p_slot: slot,
  })
  if (error) throw error
  return data
}

/** ย้อนตัวที่เพิ่งเปิด — ได้เฉพาะตัวล่าสุดภายใน 5 วินาที (กันกดพลาด) */
export async function undoLetter(sessionId) {
  const { data, error } = await supabase.rpc('quiz_words_undo', {
    p_session_id: sessionId,
    p_token: getHostToken(sessionId),
  })
  if (error) throw error
  return data
}

// ── ฝั่งคนสร้างข้อ (ต้องใช้ PIN — เฉลยอยู่ในตารางที่ปิดจาก anon) ─────────

export async function fetchWordsSet({ setId, staffId, pin }) {
  const { data, error } = await supabase.rpc('quiz_words_set_for_edit', {
    p_set_id: setId,
    p_staff_id: staffId,
    p_pin: pin,
  })
  if (error) throw error
  return data ?? []
}

/**
 * cells = [{ c, m, h }] จาก wordsMask.js — DB สร้างคำตอบและโจทย์ที่ซ่อนแล้วจากตัวนี้เอง
 * pool = กองตัวสลับ [{ c, m }] ของ Word Shuffle เท่านั้น (What Words ไม่ส่ง)
 */
export async function saveWordsQuestion({
  staffId, pin, setId, questionId, text, timeLimitSec, category, cells, aliases, explain, sortOrder, pool,
}) {
  const extra = pool ? { p_pool: pool.map((x) => ({ c: x.c ?? '', m: x.m ?? '' })) } : {}
  const { data, error } = await supabase.rpc('quiz_words_upsert', {
    p_staff_id: staffId,
    p_pin: pin,
    p_set_id: setId,
    p_question_id: questionId ?? null,
    p_text: text ?? '',
    p_time_limit_sec: timeLimitSec ?? 90,
    p_category: category ?? '',
    p_cells: (cells ?? []).map((x) => ({ c: x.c ?? '', m: x.m ?? '', h: Boolean(x.h) })),
    p_aliases: aliases ?? [],
    p_explain: explain ?? '',
    p_sort_order: sortOrder ?? 0,
    ...extra,
  })
  if (error) throw error
  return data
}

export async function deleteWordsQuestion({ staffId, pin, questionId }) {
  const { error } = await supabase.rpc('quiz_delete_question', {
    p_staff_id: staffId,
    p_pin: pin,
    p_question_id: questionId,
  })
  if (error) throw error
}

// ── วิธีตอบของชุด (เหมือนเกมเปิดแผ่นป้าย) ─────────────────────────────
//   'type' = พิมพ์ตอบในมือถือ นับคะแนน (ค่าเริ่มต้น)
//   'none' = ไม่ต้องตอบ เปิดให้ดูเฉยๆ — ทายกันปากเปล่า ไม่มีช่องพิมพ์ ไม่มีคะแนน/ทีม
// เก็บที่ quiz_sets.answer_mode (คอลัมน์เดียวกับแผ่นป้าย) ไม่ใช่ที่ห้อง — ตั้งครั้งเดียวใน Builder
// ทุกหน้าของห้อง (มือถือลูกทัวร์ · คนคุมเกม · จอใหญ่) ต้องรู้ค่านี้ จึงรวมไว้ที่เดียว
export const WORDS_ANSWER_MODES = ['type', 'none']

/** คืน 'type' | 'none' — ระหว่างโหลดคืน null (หน้าจอควรรอ ไม่ใช่เดาว่าพิมพ์ได้แล้วช่องพิมพ์หายไปทีหลัง) */
export function useWordsAnswerMode(setId) {
  const [mode, setMode] = useState(null)
  useEffect(() => {
    if (!setId) return undefined
    let alive = true
    supabase
      .from('quiz_sets')
      .select('answer_mode')
      .eq('id', setId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setMode(data?.answer_mode === 'none' ? 'none' : 'type')
      })
      .catch(() => alive && setMode('type'))
    return () => {
      alive = false
    }
  }, [setId])
  return mode
}
