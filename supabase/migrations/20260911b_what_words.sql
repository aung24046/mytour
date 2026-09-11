-- ═══════════════════════════════════════════════════════════════════════
-- เกม "What Words" — ทายคำไทยที่ซ่อนตัวอักษรบางตัว · 11 ก.ย. 2026
-- ═══════════════════════════════════════════════════════════════════════
-- ต่อจาก 20260911_puzzle_team_mode.sql
--
-- โจทย์: คำที่ตัวฐานบางตัวหายไป แต่สระบน/ล่าง/วรรณยุกต์ยังค้างที่เดิม + หมวดหมู่เป็นคำใบ้
--   ปีใหม่ (หมวด: เทศกาล)  →  _ี ใ ห _่
--
-- กติกาที่เจ้าของโปรเจกต์เคาะ:
--   · คนสร้างข้อแตะเลือกเองว่าจะซ่อนตัวไหน
--   · หมวดหมู่ขึ้นพร้อมโจทย์ทันที
--   · ทายไม่ออก → คนคุมเกมเปิดตัวที่ซ่อนทีละตัว
--   · คะแนน/โหมดทีมเหมือนเกมอื่น (1 คะแนน · solve_limit · คะแนนทีมรวม)
--
-- เกมที่สี่บนเครื่องยนต์ควิซ แยกด้วย game_kind = 'words' + quiz_questions.kind = 'words'
-- ยืมของปริศนาใบ้คำมาใช้ตรงๆ โดยไม่แก้: quiz_puzzle_guess (ตอบ + solve_limit + เฉลยเอง) ·
--   quiz_puzzle_my_state · quiz_puzzle_stats · quiz_puzzle_near_misses · quiz_puzzle_accept
--
-- ── ข้อมูลอยู่ไหน ─────────────────────────────────────────────────────
--   quiz_words.cells        โจทย์ที่ "ลูกทัวร์อ่านได้" — ช่องที่ซ่อนมี c = null
--   quiz_keys.words_cells   ช่องครบทุกตัว + ธงซ่อน (ปิดจาก anon เหมือนเฉลยอื่น)
--   ช่อง = { c: ตัวฐาน 1 ตัว, m: เครื่องหมายที่เกาะอยู่, h: ซ่อนไหม }
--   ★ การแยกคำเป็นช่องทำที่เดียวคือ src/lib/wordsMask.js — ฝั่งนี้แค่ตรวจว่าช่องถูกรูป
--
-- ── ตัวที่คนคุมเกมเปิดแล้วอยู่ไหน ─────────────────────────────────────
--   ยืมคอลัมน์ของห้องที่มีอยู่แล้ว ไม่เพิ่มคอลัมน์ใหม่:
--   hint_payload = [{ slot, char }] · hint_level = จำนวนที่เปิด · last_tile_at/last_tile_n = ไว้ย้อนการเปิด
--   ข้อดี: quiz_next ล้างให้เองทุกข้อ และอยู่ใน SESSION_COLS + realtime อยู่แล้ว
--   (ห้องหนึ่งเล่นเกมเดียว ความหมายของคอลัมน์จึงไม่ชนกับปริศนา/แผ่นป้าย)
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. เปิดชนิดเกมใหม่ ─────────────────────────────────────────────
ALTER TABLE public.quiz_sets DROP CONSTRAINT IF EXISTS quiz_sets_game_kind_check;
ALTER TABLE public.quiz_sets ADD CONSTRAINT quiz_sets_game_kind_check
  CHECK (game_kind = ANY (ARRAY['quiz', 'puzzle', 'tiles', 'words']));

ALTER TABLE public.quiz_sessions DROP CONSTRAINT IF EXISTS quiz_sessions_game_kind_check;
ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_game_kind_check
  CHECK (game_kind = ANY (ARRAY['quiz', 'puzzle', 'tiles', 'words']));

ALTER TABLE public.quiz_questions DROP CONSTRAINT IF EXISTS quiz_questions_kind_check;
ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_kind_check
  CHECK (kind = ANY (ARRAY['mcq', 'tf', 'numeric', 'puzzle', 'tiles', 'words']));

-- ── 2. ตาราง ────────────────────────────────────────────────────────
ALTER TABLE public.quiz_keys ADD COLUMN IF NOT EXISTS words_cells jsonb;
COMMENT ON COLUMN public.quiz_keys.words_cells IS
  'What Words: ช่องครบทุกตัว [{c, m, h}] — ปิดจาก anon เพราะมีตัวที่ซ่อน';

CREATE TABLE IF NOT EXISTS public.quiz_words (
  question_id  uuid PRIMARY KEY REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  category     text NOT NULL DEFAULT '',
  cells        jsonb NOT NULL DEFAULT '[]'::jsonb,
  hidden_count smallint NOT NULL DEFAULT 0 CHECK (hidden_count BETWEEN 0 AND 30)
);
COMMENT ON TABLE public.quiz_words IS
  'What Words: โจทย์ที่ลูกทัวร์อ่านได้ — cells ช่องที่ซ่อนมี c = null (ตัวจริงอยู่ quiz_keys.words_cells)';

ALTER TABLE public.quiz_words ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quiz_words_read ON public.quiz_words;
CREATE POLICY quiz_words_read ON public.quiz_words FOR SELECT USING (true);
-- เขียนผ่าน quiz_words_upsert (SECURITY DEFINER) ทางเดียว
REVOKE ALL ON public.quiz_words FROM anon, authenticated;
GRANT SELECT ON public.quiz_words TO anon, authenticated;

-- ── 3. บันทึกข้อ (ต้องใช้ PIN) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_words_upsert(
  p_staff_id uuid, p_pin text, p_set_id uuid, p_question_id uuid,
  p_text text, p_time_limit_sec integer, p_category text, p_cells jsonb,
  p_aliases text[], p_explain text, p_sort_order integer
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id     uuid;
  v_kind   text;
  v_n      integer;
  v_bad    integer;
  v_hidden integer;
  v_answer text;
  v_full   jsonb;
  v_masked jsonb;
  -- เครื่องหมายไทยที่เกาะตัวหน้าได้: ั ำ ิ-ฺ ็-๎ — ระบุด้วย chr() ตรงๆ
  -- (บทเรียน: คลาสอักขระ POSIX ของ Postgres กับภาษาไทยเคยกินทัณฑฆาตมาแล้ว)
  v_marks  text := '^[' || chr(3633) || chr(3635) || chr(3636) || '-' || chr(3642)
                        || chr(3655) || '-' || chr(3662) || ']*$';
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  SELECT game_kind INTO v_kind FROM public.quiz_sets WHERE id = p_set_id;
  IF v_kind IS DISTINCT FROM 'words' THEN
    RAISE EXCEPTION 'ชุดนี้ไม่ใช่เกม What Words';
  END IF;

  IF p_cells IS NULL OR jsonb_typeof(p_cells) <> 'array' THEN
    RAISE EXCEPTION 'ต้องมีคำตอบ';
  END IF;
  v_n := jsonb_array_length(p_cells);
  IF v_n < 1 OR v_n > 30 THEN
    RAISE EXCEPTION 'คำตอบต้องยาว 1-30 ช่อง (ส่งมา %)', v_n;
  END IF;
  IF btrim(coalesce(p_category, '')) = '' THEN
    RAISE EXCEPTION 'ต้องมีหมวดหมู่';
  END IF;

  -- ช่องที่ผิดรูป: ตัวฐานเกิน 1 ตัว · เครื่องหมายปลอม · ซ่อนช่องว่าง/ช่องเปล่า · ช่องว่างมีเครื่องหมาย
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_cells) AS x(e)
   WHERE jsonb_typeof(e) <> 'object'
      OR char_length(coalesce(e->>'c', '')) > 1
      OR coalesce(e->>'m', '') !~ v_marks
      OR (e->'h' = 'true'::jsonb AND coalesce(e->>'c', '') IN ('', ' '))
      OR (coalesce(e->>'c', '') = ' ' AND coalesce(e->>'m', '') <> '')
      OR (coalesce(e->>'c', '') = '' AND coalesce(e->>'m', '') = '');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ช่องของคำตอบไม่ถูกต้อง % ช่อง', v_bad;
  END IF;

  SELECT string_agg(coalesce(e->>'c', '') || coalesce(e->>'m', ''), '' ORDER BY ord),
         count(*) FILTER (WHERE e->'h' = 'true'::jsonb),
         jsonb_agg(jsonb_build_object(
                     'c', coalesce(e->>'c', ''),
                     'm', coalesce(e->>'m', ''),
                     'h', coalesce(e->'h' = 'true'::jsonb, false)) ORDER BY ord),
         jsonb_agg(jsonb_build_object(
                     'c', CASE WHEN e->'h' = 'true'::jsonb THEN NULL ELSE coalesce(e->>'c', '') END,
                     'm', coalesce(e->>'m', '')) ORDER BY ord)
    INTO v_answer, v_hidden, v_full, v_masked
    FROM jsonb_array_elements(p_cells) WITH ORDINALITY AS x(e, ord);

  IF btrim(coalesce(v_answer, '')) = '' THEN
    RAISE EXCEPTION 'ต้องมีคำตอบ';
  END IF;
  IF v_hidden < 1 THEN
    RAISE EXCEPTION 'ต้องซ่อนอย่างน้อย 1 ตัว';
  END IF;

  IF p_question_id IS NULL THEN
    INSERT INTO public.quiz_questions
      (set_id, sort_order, kind, text, options, numeric_unit, time_limit_sec, points_factor)
    VALUES
      (p_set_id, coalesce(p_sort_order, 0), 'words', coalesce(p_text, ''), '[]'::jsonb, '',
       least(greatest(coalesce(p_time_limit_sec, 90), 5), 300), 1)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.quiz_questions
       SET sort_order = coalesce(p_sort_order, sort_order),
           kind = 'words',
           text = coalesce(p_text, ''),
           time_limit_sec = least(greatest(coalesce(p_time_limit_sec, 90), 5), 300)
     WHERE id = p_question_id AND set_id = p_set_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อนี้ในชุด'; END IF;
  END IF;

  INSERT INTO public.quiz_words (question_id, category, cells, hidden_count)
  VALUES (v_id, btrim(p_category), v_masked, v_hidden)
  ON CONFLICT (question_id) DO UPDATE
    SET category = excluded.category, cells = excluded.cells, hidden_count = excluded.hidden_count;

  INSERT INTO public.quiz_keys (question_id, correct_text, answer_aliases, explain, words_cells)
  VALUES (v_id, v_answer, coalesce(p_aliases, '{}'), coalesce(p_explain, ''), v_full)
  ON CONFLICT (question_id) DO UPDATE
    SET correct_text = excluded.correct_text,
        answer_aliases = excluded.answer_aliases,
        explain = excluded.explain,
        words_cells = excluded.words_cells;

  RETURN v_id;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_words_upsert(uuid, text, uuid, uuid, text, integer, text, jsonb, text[], text, integer)
  TO anon, authenticated;

-- ── 4. อ่านชุดมาแก้ (ต้องใช้ PIN) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_words_set_for_edit(p_set_id uuid, p_staff_id uuid, p_pin text)
RETURNS TABLE (
  question_id uuid, sort_order integer, question_text text, time_limit_sec integer,
  category text, cells jsonb, correct_text text, answer_aliases text[], explain text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  RETURN QUERY
    SELECT q.id, q.sort_order, q.text, q.time_limit_sec,
           coalesce(w.category, ''), coalesce(k.words_cells, '[]'::jsonb),
           coalesce(k.correct_text, ''), coalesce(k.answer_aliases, '{}'), coalesce(k.explain, '')
      FROM public.quiz_questions q
      LEFT JOIN public.quiz_words w ON w.question_id = q.id
      LEFT JOIN public.quiz_keys  k ON k.question_id = q.id
     WHERE q.set_id = p_set_id AND q.kind = 'words'
     ORDER BY q.sort_order, q.created_at;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_words_set_for_edit(uuid, uuid, text) TO anon, authenticated;

-- ── 5. คำตอบของข้อปัจจุบัน — ให้คนคุมเกมเห็นว่ากำลังจะเปิดตัวอะไร (ต้องมี token) ──
CREATE OR REPLACE FUNCTION public.quiz_words_key(p_session_id uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_qid uuid;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT s.current_question_id INTO v_qid FROM public.quiz_sessions s WHERE s.id = p_session_id;
  IF v_qid IS NULL THEN RETURN NULL; END IF;

  RETURN (
    SELECT jsonb_build_object('question_id', q.id, 'answer', k.correct_text, 'cells', k.words_cells)
      FROM public.quiz_questions q
      JOIN public.quiz_keys k ON k.question_id = q.id
     WHERE q.id = v_qid AND q.kind = 'words'
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_words_key(uuid, text) TO anon, authenticated;

-- ── 6. เปิดตัวที่ซ่อน / ย้อนการเปิด (ต้องมี token) ─────────────────
-- p_slot = ลำดับช่อง (เริ่ม 0) · NULL = ตัวที่ซ่อนตัวแรกที่ยังไม่เปิด
CREATE OR REPLACE FUNCTION public.quiz_words_open(p_session_id uuid, p_token text, p_slot integer DEFAULT NULL)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s      public.quiz_sessions;
  v_kind   text;
  v_cells  jsonb;
  v_opened integer[];
  v_slot   integer;
  v_cell   jsonb;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN v_s; END IF;
  IF v_s.state NOT IN ('answering', 'locked') THEN RETURN v_s; END IF;

  SELECT q.kind, k.words_cells INTO v_kind, v_cells
    FROM public.quiz_questions q
    LEFT JOIN public.quiz_keys k ON k.question_id = q.id
   WHERE q.id = v_s.current_question_id;
  IF v_kind IS DISTINCT FROM 'words' OR v_cells IS NULL THEN RETURN v_s; END IF;

  v_opened := ARRAY(
    SELECT (x->>'slot')::integer
      FROM jsonb_array_elements(coalesce(v_s.hint_payload, '[]'::jsonb)) AS o(x)
     WHERE x ? 'slot'
  );

  IF p_slot IS NULL THEN
    SELECT (ord - 1)::integer INTO v_slot
      FROM jsonb_array_elements(v_cells) WITH ORDINALITY AS y(e, ord)
     WHERE e->'h' = 'true'::jsonb AND NOT ((ord - 1)::integer = ANY (v_opened))
     ORDER BY ord
     LIMIT 1;
  ELSE
    v_slot := p_slot;
  END IF;

  IF v_slot IS NULL OR v_slot < 0 OR v_slot = ANY (v_opened) THEN RETURN v_s; END IF;
  v_cell := v_cells -> v_slot;
  IF v_cell IS NULL OR (v_cell->'h') IS DISTINCT FROM 'true'::jsonb THEN RETURN v_s; END IF;

  UPDATE public.quiz_sessions
     SET hint_payload = coalesce(hint_payload, '[]'::jsonb)
                        || jsonb_build_array(jsonb_build_object('slot', v_slot, 'char', v_cell->>'c')),
         hint_level   = coalesce(hint_level, 0) + 1,
         last_tile_at = now(),
         last_tile_n  = 1
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_words_open(uuid, text, integer) TO anon, authenticated;

-- ย้อนได้เฉพาะตัวล่าสุด ภายใน 5 วินาที — กันกดพลาด ไม่ใช่ให้ซ่อนตัวที่ทั้งห้องเห็นไปนานแล้ว
-- (กติกาเดียวกับ quiz_tiles_undo)
CREATE OR REPLACE FUNCTION public.quiz_words_undo(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions; v_kind text; v_len integer;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN v_s; END IF;
  IF v_s.state NOT IN ('answering', 'locked') THEN RETURN v_s; END IF;
  IF v_s.last_tile_at IS NULL OR now() - v_s.last_tile_at > interval '5 seconds' THEN
    RETURN v_s;
  END IF;

  SELECT kind INTO v_kind FROM public.quiz_questions WHERE id = v_s.current_question_id;
  IF v_kind IS DISTINCT FROM 'words' THEN RETURN v_s; END IF;

  v_len := jsonb_array_length(coalesce(v_s.hint_payload, '[]'::jsonb));
  IF v_len = 0 THEN RETURN v_s; END IF;

  UPDATE public.quiz_sessions
     SET hint_payload = hint_payload - (v_len - 1),
         hint_level   = greatest(coalesce(hint_level, 0) - 1, 0),
         last_tile_at = NULL,
         last_tile_n  = 0
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_words_undo(uuid, text) TO anon, authenticated;

-- ── 7. quiz_lock — ปิดรับแล้วต้องปิดข้อให้ครบเหมือนอีกสองเกม ─────────
CREATE OR REPLACE FUNCTION public.quiz_lock(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    IF v_kind IN ('puzzle', 'tiles', 'words') THEN
      PERFORM public.quiz_puzzle_close(p_session_id, v_s.current_question_id);
    END IF;
  END IF;

  RETURN v_s;
END $function$;

-- ── 8. quiz_start_session — ชื่อห้องเริ่มต้น + สกินจอ ─────────────────
CREATE OR REPLACE FUNCTION public.quiz_start_session(
  p_tour_id uuid, p_set_id uuid, p_name text DEFAULT NULL::text, p_bus_id uuid DEFAULT NULL::uuid,
  p_screen_mode text DEFAULT 'projector'::text, p_staff_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(session_id uuid, token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_token text; v_kind text; v_default_name text;
BEGIN
  SELECT coalesce(game_kind, 'quiz') INTO v_kind FROM public.quiz_sets WHERE id = p_set_id;
  v_kind := coalesce(v_kind, 'quiz');
  v_default_name := CASE v_kind
                      WHEN 'puzzle' THEN 'ห้องปริศนาใบ้คำ'
                      WHEN 'tiles'  THEN 'ห้องเปิดแผ่นป้าย'
                      WHEN 'words'  THEN 'ห้อง What Words'
                      ELSE 'ห้องควิซ' END;

  INSERT INTO public.quiz_sessions
    (tour_id, set_id, name, bus_id, screen_mode, created_by, game_kind, stage_theme)
  VALUES (
    p_tour_id, p_set_id,
    coalesce(nullif(btrim(p_name), ''), v_default_name),
    p_bus_id, coalesce(p_screen_mode, 'projector'), p_staff_id, v_kind,
    CASE WHEN v_kind IN ('puzzle', 'tiles', 'words') THEN 'arcade' ELSE 'day' END
  )
  RETURNING id INTO v_id;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.quiz_session_tokens (session_id, token) VALUES (v_id, v_token);

  RETURN QUERY SELECT v_id, v_token;
END $function$;

-- ── 9. quiz_reveal_internal — สาย words ────────────────────────────
-- เนื้อเดิมจาก 20260911_puzzle_team_mode.sql ทุกบรรทัด เพิ่มแค่
--   · สาขา ELSIF kind = 'words' (ปิดข้อ + ผู้ตอบถูกคนแรกพร้อมทีม + หมวดหมู่)
--   · 'answer' รวม words · 'words_cells' + 'category' ใน payload
CREATE OR REPLACE FUNCTION public.quiz_reveal_internal(p_session_id uuid)
RETURNS public.quiz_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_wcat text;
  r record;
BEGIN
  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN v_s; END IF;
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
    PERFORM public.quiz_puzzle_close(p_session_id, v_q.id);

    SELECT jsonb_agg(jsonb_build_object('kind', c.clue_kind, 'body', c.body)
                     ORDER BY c.sort_order)
      INTO v_clues
      FROM public.quiz_puzzle_clues c WHERE c.question_id = v_q.id;

    SELECT jsonb_build_object('name', p.display_name,
                              'seconds', round(a.elapsed_ms / 1000.0, 1),
                              'team', tm.name)
      INTO v_fastest
      FROM public.quiz_answers a
      JOIN public.quiz_players p ON p.id = a.player_id
      LEFT JOIN public.quiz_teams tm ON tm.id = p.team_id
     WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.is_correct
     ORDER BY a.elapsed_ms
     LIMIT 1;

  ELSIF v_q.kind = 'words' THEN
    -- What Words: ปิดข้อ + ผู้ตอบถูกคนแรก (พร้อมทีม) แบบเดียวกับอีกสองเกม
    PERFORM public.quiz_puzzle_close(p_session_id, v_q.id);

    SELECT w.category INTO v_wcat FROM public.quiz_words w WHERE w.question_id = v_q.id;

    SELECT jsonb_build_object('name', p.display_name,
                              'seconds', round(a.elapsed_ms / 1000.0, 1),
                              'team', tm.name)
      INTO v_fastest
      FROM public.quiz_answers a
      JOIN public.quiz_players p ON p.id = a.player_id
      LEFT JOIN public.quiz_teams tm ON tm.id = p.team_id
     WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.is_correct
     ORDER BY a.elapsed_ms
     LIMIT 1;

  ELSIF v_q.kind = 'tiles' THEN
    -- ปิดข้อให้ครบก่อน เผื่อคนคุมเกมกดเฉลยตรงๆ โดยไม่มีใครตอบถูกและไม่ผ่าน "ปิดรับ"
    PERFORM public.quiz_puzzle_close(p_session_id, v_q.id);

    -- ผู้ชนะ — มีได้คนเดียวตามกติกา แต่ ORDER BY ไว้กันเหนียวเผื่อข้อมูลเก่า
    SELECT jsonb_build_object('name', p.display_name,
                              'seconds', round(a.elapsed_ms / 1000.0, 1),
                              'team', tm.name)
      INTO v_fastest
      FROM public.quiz_answers a
      JOIN public.quiz_players p ON p.id = a.player_id
      LEFT JOIN public.quiz_teams tm ON tm.id = p.team_id
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
    'answer',           CASE WHEN v_q.kind IN ('puzzle', 'tiles', 'words') THEN v_k.correct_text END,
    'words_cells',      CASE WHEN v_q.kind = 'words' THEN v_k.words_cells END,
    'category',         CASE WHEN v_q.kind = 'words' THEN nullif(v_wcat, '') END,
    'answer_split',     CASE WHEN v_q.kind = 'puzzle' THEN nullif(coalesce(v_k.answer_split, ''), '') END,
    'answer_image_url', CASE WHEN v_q.kind = 'puzzle' THEN v_k.answer_image_url END,
    'clue_labels',      CASE WHEN v_q.kind = 'puzzle' THEN to_jsonb(coalesce(v_k.clue_labels, '{}')) END,
    'clues',            v_clues,
    'tile_image_url',   CASE WHEN v_q.kind = 'tiles' THEN v_k.tile_image_url END,
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
END $function$;

REVOKE ALL ON FUNCTION public.quiz_reveal_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quiz_reveal_internal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.quiz_reveal_internal(uuid) FROM authenticated;

-- ── 10. quiz_team_leaderboard — What Words ใช้คะแนนรวมเหมือนปริศนา/แผ่นป้าย ──
CREATE OR REPLACE FUNCTION public.quiz_team_leaderboard(p_session_id uuid)
RETURNS TABLE(id uuid, name text, color_index integer, member_count integer,
              total_score integer, avg_score integer, rank integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH mode AS (
    SELECT coalesce(bool_or(s.game_kind IN ('puzzle', 'tiles', 'words')), false) AS by_total
      FROM public.quiz_sessions s WHERE s.id = p_session_id
  ),
  agg AS (
    SELECT t.id, t.name, t.color_index,
           count(p.id)::integer AS member_count,
           coalesce(sum(p.score), 0)::integer AS total_score,
           coalesce(round(avg(p.score)), 0)::integer AS avg_score
      FROM public.quiz_teams t
      LEFT JOIN public.quiz_players p ON p.team_id = t.id
     WHERE t.session_id = p_session_id
     GROUP BY t.id, t.name, t.color_index
  ),
  ranked AS (
    SELECT a.*,
           CASE WHEN m.by_total THEN a.total_score ELSE a.avg_score END AS k1,
           CASE WHEN m.by_total THEN a.avg_score ELSE a.total_score END AS k2
      FROM agg a CROSS JOIN mode m
  )
  SELECT r.id, r.name, r.color_index, r.member_count, r.total_score, r.avg_score,
         (row_number() OVER (ORDER BY r.k1 DESC, r.k2 DESC, r.name))::integer
    FROM ranked r
   ORDER BY r.k1 DESC, r.k2 DESC, r.name;
$function$;

GRANT EXECUTE ON FUNCTION public.quiz_team_leaderboard(uuid) TO anon, authenticated;

-- ── 11. quiz_clone_set — คัดลอกชุดต้องพาโจทย์ What Words ไปด้วย ──────
CREATE OR REPLACE FUNCTION public.quiz_clone_set(p_staff_id uuid, p_pin text, p_set_id uuid, p_title text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_src public.quiz_sets; v_q public.quiz_questions; v_new uuid; v_new_qid uuid;
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  SELECT * INTO v_src FROM public.quiz_sets WHERE id = p_set_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบชุดคำถาม'; END IF;

  INSERT INTO public.quiz_sets
    (org_id, destination_id, title, description, lang, cover_url,
     default_time_limit, streak_bonus, created_by,
     game_kind, answer_mode, attempt_limit, points_per_correct, solve_limit)
  VALUES
    (v_src.org_id, v_src.destination_id,
     coalesce(nullif(btrim(p_title), ''), v_src.title || ' (สำเนา)'),
     v_src.description, v_src.lang, v_src.cover_url,
     v_src.default_time_limit, v_src.streak_bonus, p_staff_id,
     v_src.game_kind, v_src.answer_mode, v_src.attempt_limit, v_src.points_per_correct,
     v_src.solve_limit)
  RETURNING id INTO v_new;

  FOR v_q IN
    SELECT * FROM public.quiz_questions WHERE set_id = p_set_id ORDER BY sort_order, created_at
  LOOP
    INSERT INTO public.quiz_questions
      (set_id, sort_order, kind, text, media_url, media_kind, options,
       numeric_unit, time_limit_sec, points_factor)
    VALUES
      (v_new, v_q.sort_order, v_q.kind, v_q.text, v_q.media_url, v_q.media_kind,
       v_q.options, v_q.numeric_unit, v_q.time_limit_sec, v_q.points_factor)
    RETURNING id INTO v_new_qid;

    INSERT INTO public.quiz_keys
      (question_id, correct_index, correct_number, explain,
       correct_text, answer_split, answer_aliases, clue_labels, answer_image_url, hints,
       tile_image_url, words_cells)
    SELECT v_new_qid, k.correct_index, k.correct_number, k.explain,
           k.correct_text, k.answer_split, k.answer_aliases, k.clue_labels,
           k.answer_image_url, k.hints, k.tile_image_url, k.words_cells
      FROM public.quiz_keys k WHERE k.question_id = v_q.id;

    INSERT INTO public.quiz_puzzle (question_id, syllable_count, hint_count)
    SELECT v_new_qid, z.syllable_count, z.hint_count
      FROM public.quiz_puzzle z WHERE z.question_id = v_q.id;

    INSERT INTO public.quiz_puzzle_clues (question_id, sort_order, clue_kind, body)
    SELECT v_new_qid, c.sort_order, c.clue_kind, c.body
      FROM public.quiz_puzzle_clues c WHERE c.question_id = v_q.id;

    INSERT INTO public.quiz_tiles
      (question_id, grid_rows, grid_cols, open_step, cover_image_url,
       crop_x, crop_y, crop_w, crop_h, image_aspect)
    SELECT v_new_qid, t.grid_rows, t.grid_cols, t.open_step, t.cover_image_url,
           t.crop_x, t.crop_y, t.crop_w, t.crop_h, t.image_aspect
      FROM public.quiz_tiles t WHERE t.question_id = v_q.id;

    INSERT INTO public.quiz_words (question_id, category, cells, hidden_count)
    SELECT v_new_qid, w.category, w.cells, w.hidden_count
      FROM public.quiz_words w WHERE w.question_id = v_q.id;
  END LOOP;

  RETURN v_new;
END $function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
