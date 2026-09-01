-- ═══════════════════════════════════════════════════════════════════════
-- ปริศนาใบ้คำ (Word Puzzle) — เฟส 1 · 26 ส.ค. 2026
-- ═══════════════════════════════════════════════════════════════════════
-- อ้างอิงแบบเต็ม: MyTour_WordPuzzle_Design_v1.md (แก้ครั้งที่ 2)
--
-- เกมนี้ "ไม่ใช่เกมใหม่ทั้งใบ" — มันคือชนิดข้อใหม่ที่วิ่งบนเครื่องยนต์ควิซเดิม
--   quiz_sessions / quiz_players / quiz_answers / quiz_session_tokens / นาฬิกา server
--   ถูกใช้ซ้ำทั้งหมด สิ่งที่ไฟล์นี้เพิ่มมีแค่สามอย่าง:
--     1. เนื้อข้อแบบใหม่ (รูปใบ้หลายรูป + จำนวนพยางค์ + คำใบ้เป็นขั้น)
--     2. การตรวจคำตอบที่พิมพ์เป็นภาษาไทย
--     3. การเดาได้ไม่จำกัดครั้ง โดยไม่ทำให้กระดานอันดับเดิมพัง
--
-- ⚠️ ต่างจากควิซตรงที่ **คะแนนขยับตอนตอบถูกทันที ไม่ใช่ตอนเฉลย**
--    ควิซตั้งใจพักคะแนนไว้ใน quiz_answers จนถึง quiz_reveal เพราะถ้าคะแนน
--    ขยับตอนส่ง ลูกทัวร์ poll แถวตัวเองแล้วรู้ว่าตอบถูกก่อนเวลาเฉลย
--    เกมนี้ "ตั้งใจ" บอกทันทีอยู่แล้ว (ไม่งั้นคนจะพิมพ์คำเดิมซ้ำไปเรื่อยๆ)
--    จึงไม่มีอะไรให้รั่วเพิ่ม — และ quiz_reveal ต้องไม่คิดคะแนนซ้ำ (ดูส่วนที่ 8)
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. ขยายค่าที่รับได้ของตารางเดิม ─────────────────────────────────
-- ขยาย ไม่ใช่บีบ — แถวเดิมทุกแถวยังผ่านทั้งหมด
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_questions_kind_check') THEN
    ALTER TABLE public.quiz_questions DROP CONSTRAINT quiz_questions_kind_check;
  END IF;
  ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_kind_check
    CHECK (kind IN ('mcq', 'tf', 'numeric', 'puzzle'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sessions_stage_theme_check') THEN
    ALTER TABLE public.quiz_sessions DROP CONSTRAINT quiz_sessions_stage_theme_check;
  END IF;
  ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_stage_theme_check
    CHECK (stage_theme IN ('day', 'neon', 'arcade'));
END $$;


-- ── 2. คอลัมน์ใหม่บนตารางเดิม ───────────────────────────────────────
-- game_kind ต้อง default 'quiz' เพื่อให้ชุด/ห้องเดิมทั้งหมดถูกต้องเองโดยไม่ต้อง backfill
ALTER TABLE public.quiz_sets
  ADD COLUMN IF NOT EXISTS game_kind          text    NOT NULL DEFAULT 'quiz',
  ADD COLUMN IF NOT EXISTS attempt_limit      integer,                      -- NULL = ตอบไม่จำกัด
  ADD COLUMN IF NOT EXISTS points_per_correct integer NOT NULL DEFAULT 1;

ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS game_kind    text    NOT NULL DEFAULT 'quiz',
  ADD COLUMN IF NOT EXISTS hint_level   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hint_payload jsonb   NOT NULL DEFAULT '[]'::jsonb;

-- เฉลยของเกมนี้ — อยู่ในตารางที่ anon อ่านไม่ได้ (ของเดิม ไม่ต้องแก้ RLS ซ้ำ)
ALTER TABLE public.quiz_keys
  ADD COLUMN IF NOT EXISTS correct_text     text,
  ADD COLUMN IF NOT EXISTS answer_split     text,
  ADD COLUMN IF NOT EXISTS answer_aliases   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS clue_labels      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS answer_image_url text,
  ADD COLUMN IF NOT EXISTS hints            jsonb  NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sets_game_kind_check') THEN
    ALTER TABLE public.quiz_sets ADD CONSTRAINT quiz_sets_game_kind_check
      CHECK (game_kind IN ('quiz', 'puzzle'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sessions_game_kind_check') THEN
    ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_game_kind_check
      CHECK (game_kind IN ('quiz', 'puzzle'));
  END IF;
END $$;

COMMENT ON COLUMN public.quiz_sessions.hint_payload IS
  'คำใบ้ที่คนคุมเกมเปิดแล้วของข้อปัจจุบัน — ต้องถูกล้างเป็น [] ทุกครั้งที่ quiz_next เปิดข้อใหม่';


-- ── 3. ตารางเนื้อข้อ ────────────────────────────────────────────────
-- ไม่มีคอลัมน์ layout โดยตั้งใจ — การจัดเรียงรูปคำนวณตอนเรนเดอร์จาก
-- จำนวนรูป + สัดส่วนรูป + ขนาดจอ (src/lib/puzzleLayout.js) เก็บลง DB ไม่ได้
-- เพราะจอเวทีกับมือถือได้คำตอบคนละแบบจากข้อมูลชุดเดียวกัน
CREATE TABLE IF NOT EXISTS public.quiz_puzzle (
  question_id    uuid PRIMARY KEY REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  syllable_count integer NOT NULL DEFAULT 1,
  hint_count     integer NOT NULL DEFAULT 0
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_puzzle_syllable_check') THEN
    ALTER TABLE public.quiz_puzzle ADD CONSTRAINT quiz_puzzle_syllable_check
      CHECK (syllable_count BETWEEN 1 AND 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_puzzle_hint_count_check') THEN
    ALTER TABLE public.quiz_puzzle ADD CONSTRAINT quiz_puzzle_hint_count_check
      CHECK (hint_count BETWEEN 0 AND 3);
  END IF;
END $$;

-- รูปใบ้ — 1-6 ชิ้นต่อข้อ (บังคับจำนวนที่ RPC ไม่ใช่ที่ตาราง เพราะ constraint
-- ข้ามแถวใน Postgres ต้องใช้ trigger ซึ่งไม่คุ้มกับสิ่งที่ได้)
--
-- ⚠️ ห้ามมีคำกำกับ ("บุหรี่" / "กะละมัง") ในตารางนี้เด็ดขาด — มันคือเฉลย
--    คำกำกับอยู่ที่ quiz_keys.clue_labels และออกมาตอน reveal เท่านั้น
CREATE TABLE IF NOT EXISTS public.quiz_puzzle_clues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  clue_kind   text NOT NULL DEFAULT 'image',
  body        text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS quiz_puzzle_clues_q_idx
  ON public.quiz_puzzle_clues (question_id, sort_order);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_puzzle_clues_kind_check') THEN
    ALTER TABLE public.quiz_puzzle_clues ADD CONSTRAINT quiz_puzzle_clues_kind_check
      CHECK (clue_kind IN ('image', 'emoji', 'text'));
  END IF;
END $$;


-- ── 4. บันทึกการเดา — ปิดสนิท ───────────────────────────────────────
-- ทุกครั้งที่กดส่งลงที่นี่ ส่วน quiz_answers ได้ "แถวสรุป" แถวเดียวต่อคนต่อข้อ
-- (ตอบถูก หรือ หมดเวลา) จึงไม่ต้องถอด UNIQUE ของ quiz_answers และทุกอย่าง
-- ที่อ่านตารางนั้นอยู่ — กระดานอันดับ โหมดทีม รายงาน — ทำงานต่อได้โดยไม่รู้ว่า
-- เกมนี้ตอบได้หลายครั้ง
CREATE TABLE IF NOT EXISTS public.quiz_puzzle_guesses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES public.quiz_players(id) ON DELETE CASCADE,
  raw_text    text NOT NULL,
  norm_text   text NOT NULL,
  is_correct  boolean NOT NULL DEFAULT false,
  elapsed_ms  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_puzzle_guesses_q_idx
  ON public.quiz_puzzle_guesses (session_id, question_id);
CREATE INDEX IF NOT EXISTS quiz_puzzle_guesses_player_idx
  ON public.quiz_puzzle_guesses (session_id, question_id, player_id);

COMMENT ON COLUMN public.quiz_puzzle_guesses.norm_text IS
  'ผลของ quiz_loose_answer() (normalize ชั้นที่ 2) — ใช้จับคำซ้ำและหาคำที่เกือบถูก';


-- ── 5. RLS ──────────────────────────────────────────────────────────
-- เนื้อข้อ: อ่านได้ (ลูกทัวร์ต้องเห็นรูป) เขียนไม่ได้ — เขียนผ่าน RPC ที่ตรวจ PIN
-- ตรงกับที่ 20260819_game_hardening.sql ทำกับ quiz_questions ไว้แล้ว
ALTER TABLE public.quiz_puzzle        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_puzzle_clues  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_puzzle_guesses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_puzzle_read ON public.quiz_puzzle;
CREATE POLICY quiz_puzzle_read ON public.quiz_puzzle FOR SELECT USING (true);
DROP POLICY IF EXISTS quiz_puzzle_clues_read ON public.quiz_puzzle_clues;
CREATE POLICY quiz_puzzle_clues_read ON public.quiz_puzzle_clues FOR SELECT USING (true);

GRANT SELECT ON public.quiz_puzzle       TO anon, authenticated;
GRANT SELECT ON public.quiz_puzzle_clues TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quiz_puzzle       FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quiz_puzzle_clues FROM anon, authenticated;

-- ★ ตารางการเดา: ไม่สร้าง policy ใดๆ + REVOKE = ไม่มีใครอ่านได้ผ่าน REST
--   ถ้าเปิดให้อ่าน ลูกทัวร์จะเห็นคำที่คนอื่นเดาแล้ว "ถูก" = ได้เฉลยฟรี
--   Security Advisor จะเตือน rls_enabled_no_policy เพิ่มอีก 1 รายการ — ตั้งใจ
REVOKE ALL ON public.quiz_puzzle_guesses FROM anon, authenticated;


-- ── 6. ตรวจคำตอบภาษาไทย ─────────────────────────────────────────────
-- ปัญหาจริงที่ต้องแก้: คนตอบถูกแต่พิมพ์ไม่ตรง เกิดได้อย่างน้อย 6 แบบ
--   เว้นวรรค · เติมคำนำหน้า · ตัดการันต์ · ช่องว่างท้าย · เครื่องหมายท้าย ·
--   ลำดับสระ-วรรณยุกต์สลับ
-- และเคสที่พิสูจน์ตัวเองอยู่แล้ว: เอกสารต้นฉบับเขียนเฉลยว่า "กาละแม"
-- แต่พจนานุกรมกับป้ายตามร้านเขียน "กะละแม" — ทั้งสองแบบมีคนใช้จริง

CREATE OR REPLACE FUNCTION public.quiz_norm_answer(p_text text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $fn$
DECLARE x text;
BEGIN
  x := lower(btrim(coalesce(p_text, '')));

  -- อักขระที่มองไม่เห็น — มาจากการ copy-paste และจากคีย์บอร์ดบางตัว
  x := replace(x, chr(8203), '');   -- ZERO WIDTH SPACE
  x := replace(x, chr(8204), '');   -- ZWNJ
  x := replace(x, chr(8205), '');   -- ZWJ
  x := replace(x, chr(65279), '');  -- BOM
  x := replace(x, chr(173), '');    -- SOFT HYPHEN

  -- ตัดคำนำหน้าก่อนตัดเครื่องหมาย ไม่ใช่หลัง
  -- ถ้าตัดจุดทิ้งก่อน "จ." จะเหลือ "จ" แล้วกฎตัดคำนำหน้าจะไปกิน จ ของ "จันทบุรี" ด้วย
  x := regexp_replace(
         x,
         '^[[:space:]]*(จังหวัด|จ\.|อำเภอ|อ\.|ตำบล|ต\.|อุทยานแห่งชาติ|วนอุทยาน|อุทยาน|ขนม|คำว่า|คำตอบคือ|คำตอบ|เฉลยคือ|เฉลย|คือ|ตอบว่า|ตอบ)[[:space:]]*',
         '', 'g');

  x := regexp_replace(x, '[[:space:]]', '', 'g');
  x := replace(x, 'ๆ', '');
  x := replace(x, 'ฯ', '');

  -- ⚠️ ห้ามใช้ [[:punct:]] — Postgres จัด "ทัณฑฆาต" (์) ไว้ในคลาสนั้นด้วย
  --    ผลคือ บุรีรัมย์ → บุรีรัมย ตั้งแต่ชั้นที่ 1 แล้วชั้นที่ 2 ก็ตัดการันต์ไม่ได้อีก
  --    เพราะมันหายไปก่อนแล้ว (เจอตอนรันเทสต์จริงบน Postgres 16 ไม่ใช่ตอนอ่านโค้ด)
  --    translate() ระบุอักขระตรงๆ จึงไม่ขึ้นกับ collation ของเครื่องที่รันด้วย
  x := translate(x, '.,!?;:''"()[]{}<>/\|`~@#$%^&*_+=-' || chr(8211) || chr(8212) || chr(8230), '');

  RETURN x;
END $fn$;

-- ผ่อนผัน: ตัดวรรณยุกต์ และตัดทัณฑฆาตพร้อม "พยัญชนะที่มันสะกดทับ"
--   ย์ = ย + ์  และ ์ ทำหน้าที่บอกว่า ย ไม่ออกเสียง
--   ถ้าลบแต่ ์ จะได้ "บุรีรัมย" ซึ่งยังไม่ตรงกับ "บุรีรัม" ที่คนพิมพ์จริง
--   ต้องลบทั้งคู่ถึงจะตรงกับเสียง (สระที่คร่อมอยู่ตรงกลางก็ต้องลบด้วย เช่น ธิ์ ของ สิทธิ์)
CREATE OR REPLACE FUNCTION public.quiz_loose_answer(p_text text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $fn$
DECLARE x text;
BEGIN
  x := public.quiz_norm_answer(p_text);
  x := regexp_replace(x, '[ก-ฮ][ัิีึืุู็่้๊๋ํ]*์', '', 'g');
  x := regexp_replace(x, '[่้๊๋็]', '', 'g');
  RETURN x;
END $fn$;

-- ระยะแก้คำ (Levenshtein) — เขียนเองด้วย plpgsql โดยตั้งใจ
-- ห้ามเรียก levenshtein() ของ fuzzystrmatch: บน Supabase ส่วนขยายติดตั้งที่ schema
-- "extensions" ไม่ใช่ "public" ฟังก์ชันที่ตั้ง SET search_path = public จะมองไม่เห็น
-- แล้วพังตอนรันจริงโดยที่ทดสอบบนเครื่องตัวเองไม่เจอ
-- (บทเรียนเดียวกับ gen_random_bytes — ข้อ 15 ของ MyTour_Quiz_Design_v1.md)
-- เรียกเฉพาะตอนคนคุมเกมขอดูรายการ "เกือบถูก" ไม่เกินไม่กี่สิบแถว ประสิทธิภาพไม่ใช่ประเด็น
CREATE OR REPLACE FUNCTION public.quiz_edit_distance(p_a text, p_b text)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $fn$
DECLARE
  s text[] := regexp_split_to_array(coalesce(p_a, ''), '');
  t text[] := regexp_split_to_array(coalesce(p_b, ''), '');
  m integer := coalesce(array_length(s, 1), 0);
  n integer := coalesce(array_length(t, 1), 0);
  prev integer[]; cur integer[];
  i integer; j integer; cost integer;
BEGIN
  IF m = 0 THEN RETURN n; END IF;
  IF n = 0 THEN RETURN m; END IF;
  IF m > 60 OR n > 60 THEN RETURN 99; END IF;   -- ไม่มีคำตอบจริงยาวขนาดนี้

  prev := ARRAY(SELECT generate_series(0, n));
  FOR i IN 1..m LOOP
    cur := ARRAY[i];
    FOR j IN 1..n LOOP
      cost := CASE WHEN s[i] = t[j] THEN 0 ELSE 1 END;
      cur := cur || least(cur[j] + 1, prev[j + 1] + 1, prev[j] + cost);
    END LOOP;
    prev := cur;
  END LOOP;
  RETURN prev[n + 1];
END $fn$;

-- ตัวตัดสินว่า "ถูก" หรือไม่ — อ่าน quiz_keys จึงต้องเป็น SECURITY DEFINER
-- และห้ามให้ใครเรียกตรง ไม่งั้นลูกทัวร์ยิงเดาคำรัวๆ ได้ฟรีโดยไม่ผ่านด่านเวลา/rate limit
CREATE OR REPLACE FUNCTION public.quiz_puzzle_is_correct(p_question_id uuid, p_text text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_k public.quiz_keys;
  v_norm  text := public.quiz_norm_answer(p_text);
  v_loose text := public.quiz_loose_answer(p_text);
  v_cand  text;
BEGIN
  IF v_norm = '' THEN RETURN false; END IF;
  SELECT * INTO v_k FROM public.quiz_keys WHERE question_id = p_question_id;
  IF NOT FOUND OR coalesce(v_k.correct_text, '') = '' THEN RETURN false; END IF;

  FOREACH v_cand IN ARRAY (ARRAY[v_k.correct_text] || coalesce(v_k.answer_aliases, '{}')) LOOP
    IF v_cand IS NULL OR btrim(v_cand) = '' THEN CONTINUE; END IF;
    IF public.quiz_norm_answer(v_cand)  = v_norm  THEN RETURN true; END IF;
    IF public.quiz_loose_answer(v_cand) = v_loose THEN RETURN true; END IF;
  END LOOP;

  RETURN false;
END $fn$;

REVOKE ALL ON FUNCTION public.quiz_puzzle_is_correct(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_norm_answer(text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_loose_answer(text)         TO anon, authenticated;


-- ── 7. เล่นเกม ──────────────────────────────────────────────────────

-- ลูกทัวร์: ส่งคำเดา (ได้ไม่จำกัดครั้ง)
--
-- ด่านที่ต้องผ่าน เรียงตามลำดับที่ถูกที่สุดก่อน:
--   1. ข้อที่ส่งมาต้องเป็นข้อปัจจุบัน และต้องอยู่ในช่วงเปิดรับ (+ผ่อนผัน 200ms)
--   2. ตอบถูกไปแล้ว → ไม่ต้องทำอะไร
--   3. rate limit 400ms — คนพิมพ์เร็วที่สุดยังห่างกว่านี้
--   4. ข้อความซ้ำกับครั้งก่อน → ไม่นับ ไม่บันทึก (กดปุ่มรัวเพราะคิดว่าเน็ตค้าง)
--   5. เพดานนิรภัย 40 ครั้ง/คน/ข้อ — ไม่ใช่กติกาของเกม เป็นการกันสคริปต์
--      ผู้เล่นจริงไม่มีวันชน (ถ้าชนแปลว่าไม่ได้กำลังเล่นอยู่)
CREATE OR REPLACE FUNCTION public.quiz_puzzle_guess(
  p_session_id  uuid,
  p_player_id   uuid,
  p_question_id uuid,
  p_text        text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s public.quiz_sessions;
  v_q public.quiz_questions;
  v_raw   text := btrim(coalesce(p_text, ''));
  v_norm  text;
  v_loose text;
  v_last  public.quiz_puzzle_guesses;
  v_used  integer;
  v_limit integer;
  v_points integer;
  v_elapsed integer;
  v_limit_ms integer;
  v_correct boolean := false;
  v_rows integer := 0;
  v_has_last boolean := false;
  v_grace interval := interval '200 milliseconds';
BEGIN
  IF v_raw = '' THEN RETURN jsonb_build_object('status', 'empty'); END IF;
  IF length(v_raw) > 80 THEN RETURN jsonb_build_object('status', 'too_long'); END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_session'); END IF;
  IF v_s.current_question_id IS DISTINCT FROM p_question_id THEN
    RETURN jsonb_build_object('status', 'wrong_question');
  END IF;
  IF v_s.question_started_at IS NULL OR now() < v_s.question_started_at THEN
    RETURN jsonb_build_object('status', 'not_started');
  END IF;
  IF NOT (
    (v_s.state = 'answering' AND now() <= v_s.question_ends_at + v_grace)
    OR (v_s.state = 'locked' AND v_s.locked_at IS NOT NULL AND now() <= v_s.locked_at + v_grace)
  ) THEN
    RETURN jsonb_build_object('status', 'closed');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.quiz_answers
     WHERE session_id = p_session_id AND question_id = p_question_id
       AND player_id = p_player_id AND is_correct
  ) THEN
    RETURN jsonb_build_object('status', 'already', 'correct', true);
  END IF;

  SELECT * INTO v_last
    FROM public.quiz_puzzle_guesses
   WHERE session_id = p_session_id AND question_id = p_question_id AND player_id = p_player_id
   ORDER BY created_at DESC LIMIT 1;
  v_has_last := FOUND;

  IF v_has_last AND now() - v_last.created_at < interval '400 milliseconds' THEN
    RETURN jsonb_build_object('status', 'too_fast');
  END IF;

  v_norm  := public.quiz_norm_answer(v_raw);
  v_loose := public.quiz_loose_answer(v_raw);
  IF v_norm = '' THEN RETURN jsonb_build_object('status', 'empty'); END IF;
  IF v_has_last AND v_last.norm_text = v_loose THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  SELECT count(*) INTO v_used
    FROM public.quiz_puzzle_guesses
   WHERE session_id = p_session_id AND question_id = p_question_id AND player_id = p_player_id;

  SELECT * INTO v_q FROM public.quiz_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'wrong_question'); END IF;
  SELECT s.attempt_limit, s.points_per_correct
    INTO v_limit, v_points
    FROM public.quiz_sets s WHERE s.id = v_q.set_id;

  IF v_limit IS NOT NULL AND v_used >= v_limit THEN
    RETURN jsonb_build_object('status', 'no_attempts', 'attempts_left', 0);
  END IF;
  IF v_used >= 40 THEN
    RETURN jsonb_build_object('status', 'no_attempts', 'attempts_left', 0);
  END IF;

  v_limit_ms := greatest(coalesce(v_q.time_limit_sec, 90), 1) * 1000;
  v_elapsed := least(
    greatest((extract(epoch FROM (now() - v_s.question_started_at)) * 1000)::integer, 0),
    v_limit_ms
  );

  v_correct := public.quiz_puzzle_is_correct(p_question_id, v_raw);

  INSERT INTO public.quiz_puzzle_guesses
    (session_id, question_id, player_id, raw_text, norm_text, is_correct, elapsed_ms)
  VALUES
    (p_session_id, p_question_id, p_player_id, v_raw, v_loose, v_correct, v_elapsed);

  UPDATE public.quiz_players SET last_seen_at = now() WHERE id = p_player_id;

  IF v_correct THEN
    -- แถวสรุปแถวเดียวต่อคนต่อข้อ — ของเดิมที่อ่าน quiz_answers อยู่จึงไม่ต้องรู้
    -- ว่าเกมนี้เดาได้หลายครั้ง (อาจมีแถว 0 คะแนนค้างอยู่ถ้าเพิ่งโดน quiz_lock)
    INSERT INTO public.quiz_answers
      (session_id, question_id, player_id, elapsed_ms, is_correct, points)
    VALUES
      (p_session_id, p_question_id, p_player_id, v_elapsed, true, coalesce(v_points, 1))
    ON CONFLICT (session_id, question_id, player_id) DO UPDATE
       SET is_correct = true, points = excluded.points, elapsed_ms = excluded.elapsed_ms
     WHERE public.quiz_answers.is_correct IS DISTINCT FROM true;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      UPDATE public.quiz_players
         SET score = score + coalesce(v_points, 1),
             correct_count = correct_count + 1
       WHERE id = p_player_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'correct', v_correct,
    'attempts_used', v_used + 1,
    'attempts_left', CASE WHEN v_limit IS NULL THEN NULL ELSE greatest(v_limit - v_used - 1, 0) END
  );
END $fn$;


-- ลูกทัวร์: รีเฟรชแล้วต้องรู้ว่าตัวเองตอบถูกไปแล้วหรือยัง
-- (ไม่บอกเฉลย ไม่บอกว่าคนอื่นเดาอะไร)
CREATE OR REPLACE FUNCTION public.quiz_puzzle_my_state(
  p_session_id uuid, p_player_id uuid, p_question_id uuid
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT jsonb_build_object(
    'solved', EXISTS (
      SELECT 1 FROM public.quiz_answers
       WHERE session_id = p_session_id AND question_id = p_question_id
         AND player_id = p_player_id AND is_correct),
    'guesses', (
      SELECT count(*) FROM public.quiz_puzzle_guesses
       WHERE session_id = p_session_id AND question_id = p_question_id
         AND player_id = p_player_id)
  );
$fn$;


-- คนคุมเกม: เปิดคำใบ้ให้ทั้งห้อง (ทางเดียวที่คำใบ้ออกมาได้)
--
-- คัดลอก "เฉพาะเนื้อของขั้นนั้น" ลง hint_payload — ห้ามคัดทั้งก้อน hints
-- ไม่งั้นขั้น 2-3 รั่วตั้งแต่เปิดขั้น 1 ผ่าน realtime
CREATE OR REPLACE FUNCTION public.quiz_puzzle_hint(
  p_session_id uuid, p_token text, p_step integer
)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s public.quiz_sessions;
  v_body text;
  v_max  integer;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN v_s; END IF;

  -- กดรัวแล้วข้ามขั้นไม่ได้ (optimistic lock แบบเดียวกับ quiz_next)
  IF p_step IS DISTINCT FROM v_s.hint_level + 1 THEN RETURN v_s; END IF;
  IF v_s.state NOT IN ('answering', 'locked') THEN RETURN v_s; END IF;

  SELECT coalesce(hint_count, 0) INTO v_max
    FROM public.quiz_puzzle WHERE question_id = v_s.current_question_id;
  IF coalesce(v_max, 0) < p_step THEN RETURN v_s; END IF;

  SELECT h->>'body' INTO v_body
    FROM public.quiz_keys k, jsonb_array_elements(coalesce(k.hints, '[]'::jsonb)) h
   WHERE k.question_id = v_s.current_question_id
     AND (h->>'step')::integer = p_step
   LIMIT 1;

  IF v_body IS NULL OR btrim(v_body) = '' THEN RETURN v_s; END IF;

  UPDATE public.quiz_sessions
     SET hint_level = p_step,
         hint_payload = coalesce(hint_payload, '[]'::jsonb)
                        || jsonb_build_array(jsonb_build_object('step', p_step, 'body', v_body))
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;


-- คนคุมเกม: ตัวเลขระหว่างเปิดรับ
-- "เดามาแล้ว 74 ครั้ง แต่ถูก 12" = ห้องกำลังตัน  ต่างจาก "เดา 15 ถูก 12" = ข้อง่ายไป
-- ตัวเลขคู่นี้คือสิ่งที่ใช้ตัดสินว่าจะเปิดคำใบ้ขั้นถัดไปหรือปิดรับเลย
CREATE OR REPLACE FUNCTION public.quiz_puzzle_stats(
  p_session_id uuid, p_question_id uuid, p_token text, p_online_window_sec integer DEFAULT 60
)
RETURNS TABLE (solved integer, guesses integer, online integer, total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  RETURN QUERY SELECT
    (SELECT count(*) FROM public.quiz_answers a
      WHERE a.session_id = p_session_id AND a.question_id = p_question_id AND a.is_correct)::integer,
    (SELECT count(*) FROM public.quiz_puzzle_guesses g
      WHERE g.session_id = p_session_id AND g.question_id = p_question_id)::integer,
    (SELECT count(*) FROM public.quiz_players p
      WHERE p.session_id = p_session_id
        AND p.last_seen_at > now() - make_interval(secs => p_online_window_sec))::integer,
    (SELECT count(*) FROM public.quiz_players p WHERE p.session_id = p_session_id)::integer;
END $fn$;


-- คนคุมเกม: คำตอบที่ "เกือบถูก"
-- ไม่มีวันเขียนกฎครอบคลุมภาษาไทยได้หมด — แต่คนถือไมค์ตัดสินได้ในครึ่งวินาที
-- ให้เครื่องเสนอ ให้คนตัดสิน แล้วให้ระบบจำ (quiz_puzzle_accept)
CREATE OR REPLACE FUNCTION public.quiz_puzzle_near_misses(
  p_session_id uuid, p_question_id uuid, p_token text, p_limit integer DEFAULT 6
)
RETURNS TABLE (guess_text text, people integer, distance integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_target text;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT public.quiz_loose_answer(correct_text) INTO v_target
    FROM public.quiz_keys WHERE question_id = p_question_id;
  IF v_target IS NULL OR v_target = '' THEN RETURN; END IF;

  RETURN QUERY
    SELECT t.raw_text, t.people::integer, t.dist
      FROM (
        SELECT min(g.raw_text) AS raw_text,
               count(DISTINCT g.player_id) AS people,
               public.quiz_edit_distance(g.norm_text, v_target) AS dist
          FROM public.quiz_puzzle_guesses g
         WHERE g.session_id = p_session_id
           AND g.question_id = p_question_id
           AND NOT g.is_correct
         GROUP BY g.norm_text
      ) t
     WHERE t.dist BETWEEN 1 AND 2
     ORDER BY t.dist, t.people DESC
     LIMIT p_limit;
END $fn$;


-- คนคุมเกม: รับคำที่เกือบถูกเป็นคำตอบถูก (ย้อนหลัง) + จำไว้ถาวร
--
-- สองข้อที่พลาดง่าย:
--   • คะแนนต้องคิดจาก elapsed_ms ของ "ตอนที่เขาส่งจริง" ไม่ใช่ตอนที่ทีมงานกดรับ
--   • รับได้ก่อน state = 'reveal' เท่านั้น — หลังเฉลยแล้วคะแนนขึ้นจอไปแล้ว
--     แก้ย้อนหลังคือทำลายความน่าเชื่อถือของกระดาน
CREATE OR REPLACE FUNCTION public.quiz_puzzle_accept(
  p_session_id uuid, p_question_id uuid, p_token text, p_text text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s public.quiz_sessions;
  v_target text := public.quiz_loose_answer(p_text);
  v_points integer;
  v_added integer := 0;
  v_rows integer;
  r record;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;
  IF v_target = '' THEN RETURN jsonb_build_object('status', 'empty'); END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id;
  IF v_s.state NOT IN ('answering', 'locked') THEN
    RETURN jsonb_build_object('status', 'too_late');
  END IF;

  SELECT s.points_per_correct INTO v_points
    FROM public.quiz_questions q JOIN public.quiz_sets s ON s.id = q.set_id
   WHERE q.id = p_question_id;

  -- จำไว้ถาวร — ชุดนี้ครั้งหน้าไม่ต้องกดอีก คลังจะฉลาดขึ้นเองทุกครั้งที่เล่น
  UPDATE public.quiz_keys
     SET answer_aliases = (
           SELECT array_agg(DISTINCT x)
             FROM unnest(coalesce(answer_aliases, '{}') || ARRAY[btrim(p_text)]) x
            WHERE btrim(x) <> ''
         )
   WHERE question_id = p_question_id;

  FOR r IN
    SELECT DISTINCT ON (g.player_id) g.player_id, g.elapsed_ms
      FROM public.quiz_puzzle_guesses g
     WHERE g.session_id = p_session_id
       AND g.question_id = p_question_id
       AND g.norm_text = v_target
     ORDER BY g.player_id, g.created_at
  LOOP
    INSERT INTO public.quiz_answers
      (session_id, question_id, player_id, elapsed_ms, is_correct, points)
    VALUES
      (p_session_id, p_question_id, r.player_id, r.elapsed_ms, true, coalesce(v_points, 1))
    ON CONFLICT (session_id, question_id, player_id) DO UPDATE
       SET is_correct = true, points = excluded.points, elapsed_ms = excluded.elapsed_ms
     WHERE public.quiz_answers.is_correct IS DISTINCT FROM true;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      UPDATE public.quiz_players
         SET score = score + coalesce(v_points, 1), correct_count = correct_count + 1
       WHERE id = r.player_id;
      v_added := v_added + 1;
    END IF;
  END LOOP;

  UPDATE public.quiz_puzzle_guesses
     SET is_correct = true
   WHERE session_id = p_session_id AND question_id = p_question_id
     AND norm_text = v_target;

  RETURN jsonb_build_object('status', 'ok', 'players', v_added);
END $fn$;


-- ── 8. แก้ฟังก์ชันเดิม 3 ตัว ────────────────────────────────────────

-- ปิดข้อ: คนที่ยังไม่ตอบถูกต้องได้แถวสรุป 0 คะแนน
-- ไม่งั้น quiz_report / สถิติ "กี่คนตอบข้อนี้" จะนับไม่ครบ
CREATE OR REPLACE FUNCTION public.quiz_puzzle_close(p_session_id uuid, p_question_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  INSERT INTO public.quiz_answers (session_id, question_id, player_id, elapsed_ms, is_correct, points)
  SELECT p_session_id, p_question_id, p.id, 0, false, 0
    FROM public.quiz_players p
   WHERE p.session_id = p_session_id
  ON CONFLICT (session_id, question_id, player_id) DO NOTHING;
$fn$;
REVOKE ALL ON FUNCTION public.quiz_puzzle_close(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- quiz_next: ของเดิมทุกบรรทัด + ล้างคำใบ้ของข้อที่แล้ว
-- ⚠️ ถ้าลืมล้าง hint_payload คำใบ้ข้อเก่าจะค้างบนจอข้อใหม่ ซึ่งอาจเป็นเฉลย
--    ของข้อที่ยังไม่เฉลย — บั๊กที่ไม่มีใครเห็นตอนเทสต์ทีละข้อ
CREATE OR REPLACE FUNCTION public.quiz_next(
  p_session_id uuid,
  p_token      text,
  p_expected_index integer DEFAULT NULL,
  p_lead_ms    integer DEFAULT 3000
)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions; v_q public.quiz_questions; v_next integer;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบห้อง'; END IF;

  IF p_expected_index IS NOT NULL AND v_s.current_index <> p_expected_index THEN
    RETURN v_s;   -- มีคนกดไปก่อนแล้ว
  END IF;

  v_next := v_s.current_index + 1;

  SELECT * INTO v_q
    FROM public.quiz_questions
   WHERE set_id = v_s.set_id
   ORDER BY sort_order, created_at
   OFFSET v_next LIMIT 1;

  IF NOT FOUND THEN
    UPDATE public.quiz_sessions
       SET state = 'finished', ended_at = now(), reveal_payload = '{}'::jsonb,
           hint_level = 0, hint_payload = '[]'::jsonb
     WHERE id = p_session_id
    RETURNING * INTO v_s;
    RETURN v_s;
  END IF;

  UPDATE public.quiz_sessions
     SET state = 'answering',
         current_index = v_next,
         current_question_id = v_q.id,
         question_started_at = now() + make_interval(secs => p_lead_ms / 1000.0),
         question_ends_at = now() + make_interval(secs => p_lead_ms / 1000.0)
                                  + make_interval(secs => v_q.time_limit_sec),
         locked_at = NULL,
         reveal_payload = '{}'::jsonb,
         hint_level = 0,
         hint_payload = '[]'::jsonb
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

-- quiz_lock: ของเดิม + ปิดข้อของเกมปริศนา
CREATE OR REPLACE FUNCTION public.quiz_lock(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions; v_kind text;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  UPDATE public.quiz_sessions
     SET state = 'locked', locked_at = now()
   WHERE id = p_session_id AND state = 'answering'
  RETURNING * INTO v_s;

  IF NOT FOUND THEN
    SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id;
  END IF;

  IF v_s.current_question_id IS NOT NULL THEN
    SELECT kind INTO v_kind FROM public.quiz_questions WHERE id = v_s.current_question_id;
    IF v_kind = 'puzzle' THEN
      PERFORM public.quiz_puzzle_close(p_session_id, v_s.current_question_id);
    END IF;
  END IF;

  RETURN v_s;
END $fn$;

-- quiz_reveal: ของเดิมจาก 20260819_game_hardening.sql ทุกบรรทัด + สาย 'puzzle'
--
-- ⚠️ เกมปริศนา "ไม่คิดคะแนนตรงนี้" เพราะคะแนนลงไปแล้วตอนตอบถูก (ดูหัวไฟล์)
--    ถ้าเผลอเอาไปรวมกับสาย mcq/tf คะแนนจะถูกบวกซ้ำทั้งห้อง
CREATE OR REPLACE FUNCTION public.quiz_reveal(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s public.quiz_sessions;
  v_q public.quiz_questions;
  v_k public.quiz_keys;
  v_payload jsonb;
  v_stats jsonb;
  v_closest jsonb;
  v_clues jsonb;
  v_fastest jsonb;
  v_set_streak boolean;
  r record;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN v_s; END IF;
  -- กดซ้ำ ไม่ให้คิดคะแนนรอบสอง — reveal_payload ถูกล้างทุกครั้งที่ quiz_next เปิดข้อใหม่
  -- จึงใช้เป็นธงว่า "ข้อนี้เฉลยไปแล้วหรือยัง" ได้ตรงกว่า state
  IF (v_s.reveal_payload->>'question_id')::uuid IS NOT DISTINCT FROM v_s.current_question_id THEN
    RETURN v_s;
  END IF;

  SELECT * INTO v_q FROM public.quiz_questions WHERE id = v_s.current_question_id;
  SELECT * INTO v_k FROM public.quiz_keys      WHERE question_id = v_s.current_question_id;
  SELECT streak_bonus INTO v_set_streak FROM public.quiz_sets WHERE id = v_q.set_id;

  IF v_q.kind IN ('mcq', 'tf') THEN
    FOR r IN
      SELECT a.id, a.player_id, a.points, a.is_correct, p.streak
        FROM public.quiz_answers a
        JOIN public.quiz_players p ON p.id = a.player_id
       WHERE a.session_id = p_session_id AND a.question_id = v_q.id
    LOOP
      DECLARE v_new_streak integer; v_bonus integer := 0; v_total integer;
      BEGIN
        v_new_streak := CASE WHEN r.is_correct THEN r.streak + 1 ELSE 0 END;
        IF r.is_correct AND coalesce(v_set_streak, true) THEN
          v_bonus := least(greatest(v_new_streak - 1, 0), 4) * 100;
        END IF;
        v_total := r.points + v_bonus;

        UPDATE public.quiz_answers SET points = v_total WHERE id = r.id;
        UPDATE public.quiz_players
           SET score = score + v_total,
               streak = v_new_streak,
               correct_count = correct_count + CASE WHEN r.is_correct THEN 1 ELSE 0 END
         WHERE id = r.player_id;
      END;
    END LOOP;

    UPDATE public.quiz_players p
       SET streak = 0
     WHERE p.session_id = p_session_id
       AND NOT EXISTS (
         SELECT 1 FROM public.quiz_answers a
          WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.player_id = p.id
       );
  END IF;

  IF v_q.kind = 'numeric' THEN
    FOR r IN
      SELECT a.id, a.player_id, a.number_value,
             row_number() OVER (
               ORDER BY abs(a.number_value - v_k.correct_number), a.created_at
             ) AS rn
        FROM public.quiz_answers a
       WHERE a.session_id = p_session_id
         AND a.question_id = v_q.id
         AND a.number_value IS NOT NULL
    LOOP
      UPDATE public.quiz_answers
         SET points = (CASE r.rn WHEN 1 THEN 1000 WHEN 2 THEN 800 WHEN 3 THEN 600 ELSE 300 END
                       + CASE WHEN r.number_value = v_k.correct_number THEN 200 ELSE 0 END),
             is_correct = (r.rn = 1)
       WHERE id = r.id;

      UPDATE public.quiz_players p
         SET score = p.score + (
               CASE r.rn WHEN 1 THEN 1000 WHEN 2 THEN 800 WHEN 3 THEN 600 ELSE 300 END
               + CASE WHEN r.number_value = v_k.correct_number THEN 200 ELSE 0 END),
             correct_count = p.correct_count + CASE WHEN r.rn = 1 THEN 1 ELSE 0 END,
             streak = CASE WHEN r.rn = 1 THEN p.streak + 1 ELSE 0 END
       WHERE p.id = r.player_id;
    END LOOP;

    UPDATE public.quiz_players p
       SET streak = 0
     WHERE p.session_id = p_session_id
       AND NOT EXISTS (
         SELECT 1 FROM public.quiz_answers a
          WHERE a.session_id = p_session_id
            AND a.question_id = v_q.id
            AND a.player_id = p.id
            AND a.number_value IS NOT NULL
       );

    SELECT jsonb_agg(x) INTO v_closest FROM (
      SELECT jsonb_build_object('name', p.display_name, 'value', a.number_value) AS x
        FROM public.quiz_answers a
        JOIN public.quiz_players p ON p.id = a.player_id
       WHERE a.session_id = p_session_id AND a.question_id = v_q.id
         AND a.number_value IS NOT NULL
       ORDER BY abs(a.number_value - v_k.correct_number), a.created_at
       LIMIT 3
    ) t;

  ELSIF v_q.kind = 'puzzle' THEN
    -- ปิดข้อให้ครบก่อน เผื่อคนคุมเกมกดเฉลยตรงๆ โดยไม่ผ่าน "ปิดรับ"
    PERFORM public.quiz_puzzle_close(p_session_id, v_q.id);

    SELECT jsonb_agg(jsonb_build_object('kind', c.clue_kind, 'body', c.body)
                     ORDER BY c.sort_order)
      INTO v_clues
      FROM public.quiz_puzzle_clues c WHERE c.question_id = v_q.id;

    SELECT jsonb_build_object('name', p.display_name,
                              'seconds', round(a.elapsed_ms / 1000.0, 1))
      INTO v_fastest
      FROM public.quiz_answers a
      JOIN public.quiz_players p ON p.id = a.player_id
     WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.is_correct
     ORDER BY a.elapsed_ms
     LIMIT 1;

  ELSE
    SELECT jsonb_object_agg(choice_index::text, n) INTO v_stats FROM (
      SELECT choice_index, count(*) AS n
        FROM public.quiz_answers
       WHERE session_id = p_session_id AND question_id = v_q.id AND choice_index IS NOT NULL
       GROUP BY choice_index
    ) t;
  END IF;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'question_id',    v_q.id,
    'kind',           v_q.kind,
    'correct_index',  v_k.correct_index,
    'correct_number', v_k.correct_number,
    'explain',        nullif(coalesce(v_k.explain, ''), ''),
    'stats',          v_stats,
    'closest',        v_closest,
    -- ↓ ของเกมปริศนา — ออกจาก quiz_keys ได้ที่นี่ที่เดียวเท่านั้น
    'answer',           CASE WHEN v_q.kind = 'puzzle' THEN v_k.correct_text END,
    'answer_split',     CASE WHEN v_q.kind = 'puzzle' THEN nullif(coalesce(v_k.answer_split, ''), '') END,
    'answer_image_url', CASE WHEN v_q.kind = 'puzzle' THEN v_k.answer_image_url END,
    'clue_labels',      CASE WHEN v_q.kind = 'puzzle' THEN to_jsonb(coalesce(v_k.clue_labels, '{}')) END,
    'clues',            v_clues,
    'fastest',          v_fastest,
    'solved',         (SELECT count(*) FROM public.quiz_answers
                        WHERE session_id = p_session_id AND question_id = v_q.id AND is_correct),
    'answered',       (SELECT count(*) FROM public.quiz_answers
                        WHERE session_id = p_session_id AND question_id = v_q.id)
  ));

  UPDATE public.quiz_sessions
     SET state = 'reveal', reveal_payload = v_payload
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;


-- quiz_start_session: ของเดิม + คัด game_kind จากชุดลงห้อง
--
-- ทำไมต้องคัดฝั่ง DB ไม่ให้แอปส่งมา: game_kind เป็นตัวตัดสินว่าห้องนี้จะไปโผล่
-- ในหน้าควิซหรือหน้าปริศนา ถ้าให้ client ส่ง ก็เท่ากับให้ client เลือกได้ว่าจะไปโผล่ที่ไหน
-- และมีโอกาสไม่ตรงกับชุดที่ห้องใช้จริง — ซึ่งจะเห็นเป็น "กดเข้าห้องแล้วจอว่าง"
CREATE OR REPLACE FUNCTION public.quiz_start_session(
  p_tour_id uuid,
  p_set_id  uuid,
  p_name    text DEFAULT NULL,
  p_bus_id  uuid DEFAULT NULL,
  p_screen_mode text DEFAULT 'projector',
  p_staff_id uuid DEFAULT NULL
)
RETURNS TABLE (session_id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid; v_token text; v_kind text; v_default_name text;
BEGIN
  SELECT coalesce(game_kind, 'quiz') INTO v_kind FROM public.quiz_sets WHERE id = p_set_id;
  v_kind := coalesce(v_kind, 'quiz');
  v_default_name := CASE WHEN v_kind = 'puzzle' THEN 'ห้องปริศนาใบ้คำ' ELSE 'ห้องควิซ' END;

  INSERT INTO public.quiz_sessions
    (tour_id, set_id, name, bus_id, screen_mode, created_by, game_kind, stage_theme)
  VALUES (
    p_tour_id, p_set_id,
    coalesce(nullif(btrim(p_name), ''), v_default_name),
    p_bus_id, coalesce(p_screen_mode, 'projector'), p_staff_id, v_kind,
    CASE WHEN v_kind = 'puzzle' THEN 'arcade' ELSE 'day' END
  )
  RETURNING id INTO v_id;

  -- ต่อ uuid สองก้อน = สุ่ม 256 bit · ห้ามใช้ gen_random_bytes (ดูเหตุผลใน 20260818_quiz.sql)
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.quiz_session_tokens (session_id, token) VALUES (v_id, v_token);

  RETURN QUERY SELECT v_id, v_token;
END $fn$;


-- ── 9. คนสร้างข้อ ───────────────────────────────────────────────────
-- ต้องผ่าน PIN เพราะเฉลยอยู่ใน quiz_keys ที่ปิดสนิท และสตาฟกับลูกทัวร์
-- ใช้ anon key ตัวเดียวกัน ถ้าไม่ตรวจอะไรเลย ลูกทัวร์ก็เรียกดูเฉลยล่วงหน้าได้
CREATE OR REPLACE FUNCTION public.quiz_puzzle_set_for_edit(
  p_set_id uuid, p_staff_id uuid, p_pin text
)
RETURNS TABLE (
  question_id uuid, sort_order integer, question_text text,
  syllable_count integer, time_limit_sec integer, clues jsonb,
  correct_text text, answer_split text, answer_aliases text[],
  clue_labels text[], answer_image_url text, hints jsonb, explain text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  RETURN QUERY
    SELECT q.id, q.sort_order, q.text,
           coalesce(z.syllable_count, 1), q.time_limit_sec,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object('kind', c.clue_kind, 'body', c.body)
                              ORDER BY c.sort_order)
               FROM public.quiz_puzzle_clues c WHERE c.question_id = q.id
           ), '[]'::jsonb),
           coalesce(k.correct_text, ''), coalesce(k.answer_split, ''),
           coalesce(k.answer_aliases, '{}'), coalesce(k.clue_labels, '{}'),
           k.answer_image_url, coalesce(k.hints, '[]'::jsonb), coalesce(k.explain, '')
      FROM public.quiz_questions q
      LEFT JOIN public.quiz_puzzle z ON z.question_id = q.id
      LEFT JOIN public.quiz_keys   k ON k.question_id = q.id
     WHERE q.set_id = p_set_id AND q.kind = 'puzzle'
     ORDER BY q.sort_order, q.created_at;
END $fn$;


-- บันทึกข้อ — คำถาม เนื้อข้อ รูปใบ้ และเฉลย ต้องลงใน transaction เดียว
-- ไม่งั้นมีจังหวะที่ข้อมีอยู่แต่ยังไม่มีเฉลย แล้วทุกคนที่ตอบตอนนั้นจะกลายเป็นผิดหมด
--
-- p_clues  = [{"kind":"image|emoji|text","body":"...","label":"บุหรี่"}, ...]  1-6 ชิ้น
-- p_hints  = ["อยู่ภาคอีสาน", ...]  0-3 ขั้น (เรียงตามลำดับที่จะเปิด)
CREATE OR REPLACE FUNCTION public.quiz_puzzle_upsert(
  p_staff_id uuid,
  p_pin      text,
  p_set_id   uuid,
  p_question_id uuid,
  p_text     text,
  p_syllable_count integer,
  p_time_limit_sec integer,
  p_clues    jsonb,
  p_answer   text,
  p_answer_split text,
  p_aliases  text[],
  p_answer_image_url text,
  p_hints    jsonb,
  p_explain  text,
  p_sort_order integer
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id uuid;
  v_n  integer := coalesce(jsonb_array_length(coalesce(p_clues, '[]'::jsonb)), 0);
  v_hn integer := coalesce(jsonb_array_length(coalesce(p_hints, '[]'::jsonb)), 0);
  v_labels text[];
  v_hints  jsonb;
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;
  IF btrim(coalesce(p_answer, '')) = '' THEN
    RAISE EXCEPTION 'ต้องมีคำตอบ';
  END IF;
  IF v_n < 1 OR v_n > 6 THEN
    RAISE EXCEPTION 'รูปใบ้ต้องมี 1-6 ชิ้น (ส่งมา %)', v_n;
  END IF;
  IF v_hn > 3 THEN
    RAISE EXCEPTION 'คำใบ้ได้สูงสุด 3 ขั้น (ส่งมา %)', v_hn;
  END IF;

  IF p_question_id IS NULL THEN
    INSERT INTO public.quiz_questions
      (set_id, sort_order, kind, text, options, numeric_unit, time_limit_sec, points_factor)
    VALUES
      (p_set_id, coalesce(p_sort_order, 0), 'puzzle', coalesce(p_text, ''),
       '[]'::jsonb, '', coalesce(p_time_limit_sec, 90), 1)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.quiz_questions
       SET sort_order = coalesce(p_sort_order, sort_order),
           kind = 'puzzle',
           text = coalesce(p_text, ''),
           time_limit_sec = coalesce(p_time_limit_sec, 90)
     WHERE id = p_question_id AND set_id = p_set_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อนี้ในชุด'; END IF;
  END IF;

  INSERT INTO public.quiz_puzzle (question_id, syllable_count, hint_count)
  VALUES (v_id, greatest(coalesce(p_syllable_count, 1), 1), v_hn)
  ON CONFLICT (question_id) DO UPDATE
    SET syllable_count = excluded.syllable_count, hint_count = excluded.hint_count;

  -- ลบแล้วใส่ใหม่ทั้งชุด — รูปใบ้ไม่มี FK ชี้เข้ามาและไม่เคยถูกอ้างจากที่อื่น
  -- การพยายาม diff ทีละชิ้นได้ความซับซ้อนโดยไม่ได้อะไรกลับมา
  DELETE FROM public.quiz_puzzle_clues WHERE question_id = v_id;
  INSERT INTO public.quiz_puzzle_clues (question_id, sort_order, clue_kind, body)
  SELECT v_id, (ord - 1),
         coalesce(nullif(c->>'kind', ''), 'image'),
         coalesce(c->>'body', '')
    FROM jsonb_array_elements(p_clues) WITH ORDINALITY AS x(c, ord);

  SELECT array_agg(coalesce(c->>'label', '') ORDER BY ord)
    INTO v_labels
    FROM jsonb_array_elements(p_clues) WITH ORDINALITY AS x(c, ord);

  SELECT coalesce(jsonb_agg(jsonb_build_object('step', ord, 'body', btrim(h #>> '{}'))
                            ORDER BY ord), '[]'::jsonb)
    INTO v_hints
    FROM jsonb_array_elements(coalesce(p_hints, '[]'::jsonb)) WITH ORDINALITY AS y(h, ord);

  INSERT INTO public.quiz_keys
    (question_id, correct_text, answer_split, answer_aliases,
     clue_labels, answer_image_url, hints, explain)
  VALUES
    (v_id, btrim(p_answer), nullif(btrim(coalesce(p_answer_split, '')), ''),
     coalesce(p_aliases, '{}'), coalesce(v_labels, '{}'),
     nullif(btrim(coalesce(p_answer_image_url, '')), ''),
     v_hints, coalesce(p_explain, ''))
  ON CONFLICT (question_id) DO UPDATE
    SET correct_text = excluded.correct_text,
        answer_split = excluded.answer_split,
        answer_aliases = excluded.answer_aliases,
        clue_labels = excluded.clue_labels,
        answer_image_url = excluded.answer_image_url,
        hints = excluded.hints,
        explain = excluded.explain;

  RETURN v_id;
END $fn$;


-- ── 10. สิทธิ์เรียกฟังก์ชัน ─────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.quiz_edit_distance(text, text)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_puzzle_guess(uuid, uuid, uuid, text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_puzzle_my_state(uuid, uuid, uuid)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_puzzle_hint(uuid, text, integer)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_puzzle_stats(uuid, uuid, text, integer)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_puzzle_near_misses(uuid, uuid, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_puzzle_accept(uuid, uuid, text, text)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_puzzle_set_for_edit(uuid, uuid, text)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_puzzle_upsert(
  uuid, text, uuid, uuid, text, integer, integer, jsonb, text, text, text[], text, jsonb, text, integer
) TO anon, authenticated;

COMMIT;

-- ── ตรวจหลังรัน ──────────────────────────────────────────────────────
-- 1) ชุด/ห้องเดิมต้องเป็น 'quiz' ทั้งหมดโดยอัตโนมัติ (ต้องได้ 0 แถว)
--    SELECT count(*) FROM quiz_sets     WHERE game_kind <> 'quiz';
--    SELECT count(*) FROM quiz_sessions WHERE game_kind <> 'quiz';
--
-- 2) ตรวจตัว normalize ด้วยเคสจริงจากเอกสารตัวอย่าง (ต้องได้ true ทุกบรรทัด)
--    SELECT quiz_norm_answer('  จังหวัด ภูกระดึง ')  = quiz_norm_answer('ภูกระดึง');
--    SELECT quiz_loose_answer('บุรีรัม')             = quiz_loose_answer('บุรีรัมย์');
--    SELECT quiz_norm_answer('ขนมกาละแม')            = quiz_norm_answer('กาละแม');
--    SELECT quiz_edit_distance(quiz_loose_answer('ภูกะดึง'), quiz_loose_answer('ภูกระดึง')) = 1;
--
-- 3) ตารางการเดาต้องอ่านผ่าน REST ไม่ได้ (ต้องได้ 0 แถว)
--    SELECT privilege_type FROM information_schema.role_table_grants
--     WHERE grantee IN ('anon','authenticated') AND table_name = 'quiz_puzzle_guesses';
--
-- ── ย้อนกลับ ─────────────────────────────────────────────────────────
-- ถอนได้เฉพาะของใหม่ ส่วน quiz_next / quiz_lock / quiz_reveal ต้องรัน
-- 20260818_quiz.sql + 20260819_game_hardening.sql ทับกลับเพื่อคืนตัวเดิม
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_upsert(uuid,text,uuid,uuid,text,integer,integer,jsonb,text,text,text[],text,jsonb,text,integer);
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_set_for_edit(uuid,uuid,text);
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_accept(uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_near_misses(uuid,uuid,text,integer);
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_stats(uuid,uuid,text,integer);
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_hint(uuid,text,integer);
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_my_state(uuid,uuid,uuid);
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_guess(uuid,uuid,uuid,text);
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_close(uuid,uuid);
--   DROP FUNCTION IF EXISTS public.quiz_puzzle_is_correct(uuid,text);
--   DROP FUNCTION IF EXISTS public.quiz_edit_distance(text,text);
--   DROP FUNCTION IF EXISTS public.quiz_loose_answer(text);
--   DROP FUNCTION IF EXISTS public.quiz_norm_answer(text);
--   DROP TABLE IF EXISTS public.quiz_puzzle_guesses;
--   DROP TABLE IF EXISTS public.quiz_puzzle_clues;
--   DROP TABLE IF EXISTS public.quiz_puzzle;
-- COMMIT;
