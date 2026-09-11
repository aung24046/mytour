// เกมตระกูล "คำ" ที่ใช้หน้าจอชุดเดียวกัน — What Words กับ Word Shuffle
//
// สองเกมนี้เล่นเหมือนกันทุกอย่าง (หมวดหมู่ · คนคุมเกมเปิดตัวทีละตัว · วิธีตอบ · คะแนน · ทีม)
// ต่างกันแค่หน้าตาโจทย์กับวิธีสร้างข้อ — เจ้าของโปรเจกต์ขอไว้แบบนั้น (12 ก.ย. 2026)
// จึงใช้หน้า Words*.jsx ชุดเดียว แล้วส่ง game เข้าไป แทนการคัดลอกหกไฟล์ที่วันหนึ่งจะแก้ไม่ครบ
//
//   kind    = quiz_sets.game_kind / quiz_sessions.game_kind (ข้อยังเป็น quiz_questions.kind = 'words' ทั้งคู่)
//   ns      = namespace ของข้อความ — มีเฉพาะคำที่ต่างจาก What Words ที่เหลือยืม words.* (ดู useGameT)
//   shuffle = true → โจทย์เป็นกองตัวสลับ (quiz_words.pool) แทนการซ่อนบางตัว
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

export const WORD_GAMES = {
  words: {
    kind: 'words',
    ns: 'words',
    base: '/staff/words',
    guestPath: 'words',
    perm: 'words',
    icon: 'language',
    shuffle: false,
    // จอใหญ่เป็นภาษาไทยตายตัว (ขึ้นต่อหน้าลูกทัวร์ไทยทั้งห้อง) — เหมือนเกมอื่นในตระกูล arcade
    stageTitle: 'What Words',
    stageRule: 'ทายคำที่ตัวอักษรหายไป ดูหมวดหมู่เป็นคำใบ้',
    answerPlaceholder: 'ปีใหม่',
    aliasesPlaceholder: 'ปีใหม่สากล, วันปีใหม่',
  },
  shuffle: {
    kind: 'shuffle',
    ns: 'shuffle',
    base: '/staff/shuffle',
    guestPath: 'shuffle',
    perm: 'shuffle',
    icon: 'shuffle',
    shuffle: true,
    stageTitle: 'Word Shuffle',
    stageRule: 'เรียงตัวอักษรที่สลับกันให้เป็นคำ ดูหมวดหมู่เป็นคำใบ้',
    answerPlaceholder: 'แม่ฮ่องสอน',
    aliasesPlaceholder: 'จังหวัดแม่ฮ่องสอน',
  },
}

export function wordGame(key) {
  return WORD_GAMES[key] ?? WORD_GAMES.words
}

/**
 * t() ของเกม — ใช้ `${ns}.key` ถ้ามี ไม่มีก็ยืม `words.key`
 * Word Shuffle จึงแปลเฉพาะคำที่ต่าง (ชื่อเกม · กติกา · ฟอร์มสร้างข้อ) ไม่ต้องคัดลอกทั้ง namespace
 */
export function useGameT(game) {
  const { t, i18n } = useTranslation()
  const ns = game?.ns ?? 'words'
  return useCallback(
    (key, opts) => {
      const own = `${ns}.${key}`
      return t(ns !== 'words' && i18n.exists(own) ? own : `words.${key}`, opts)
    },
    [t, i18n, ns]
  )
}
