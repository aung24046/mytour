-- ═══════════════════════════════════════════════════════════════════════
-- เกม "Word Shuffle" — เรียงตัวอักษรที่สลับกันให้เป็นคำ · 12 ก.ย. 2026
-- ═══════════════════════════════════════════════════════════════════════
-- ต่อจาก 20260911b_what_words.sql
--
-- โจทย์: ตัวอักษรของคำตอบถูกสลับที่ (สระ/วรรณยุกต์ติดไปกับตัวของมัน) + หมวดหมู่เป็นคำใบ้
--   แม่ฮ่องสอน (หมวด: จังหวัด)  →  กองตัวสลับ  ฮ่ ง แ อ ม่ อ น ส
--
-- กติกาที่เจ้าของโปรเจกต์เคาะ:
--   · วิธีเล่นเหมือน What Words ทุกอย่าง (หมวดหมู่ · คนคุมเกมเปิดตัวทีละตัว · วิธีตอบ ·
--     คะแนน · ทีม) ต่างแค่ตอนสร้างข้อ
--   · จอเล่น = แถวช่องคำตอบ (ว่างทุกช่อง) + กองตัวสลับ — เปิดตัวไหน ตัวนั้นลงช่องที่ถูก
--     และตัวในกองจางลง
--   · ตอนสร้างข้อ ระบบสลับให้ + กดสลับใหม่ได้ (ลำดับที่สลับต้องไม่ตรงคำตอบ)
--
-- ── ออกแบบ: เกมใหม่ แต่ "ข้อ" เป็นชนิดเดียวกับ What Words ─────────────
--   quiz_sets / quiz_sessions.game_kind = 'shuffle'   ← แยกหน้าเกม/คลังชุด/ห้อง
--   quiz_questions.kind = 'words'                      ← ใช้เครื่องยนต์เดิมทั้งหมดโดยไม่แก้:
--     quiz_lock · quiz_reveal_internal · quiz_words_key · quiz_words_undo · quiz_puzzle_guess ฯลฯ
--   ต่างจาก What Words แค่ข้อมูลโจทย์:
--     · ช่องที่ไม่ใช่ช่องว่างซ่อนทุกช่อง และซ่อน "ทั้งตัวทั้งเครื่องหมาย"
--       (quiz_words.cells = { c: null, m: '' }) — เครื่องหมายที่ค้างอยู่จะบอกตำแหน่งให้
--     · quiz_words.pool = กองตัวที่สลับแล้ว [{ c, m }] ลูกทัวร์อ่านได้ (นี่คือคำใบ้)
--   ช่องว่างระหว่างคำยังเห็นเป็นช่องว่าง (ไม่เข้ากอง)
--
-- ── ตัวที่เปิดแล้วต้องพกเครื่องหมายไปด้วย ───────────────────────────────
--   hint_payload เดิม = [{ slot, char }] โดย char คือตัวฐานอย่างเดียว เพราะ What Words
--   ให้ลูกทัวร์เห็นเครื่องหมายอยู่แล้ว — Word Shuffle ไม่เห็น จึงเพิ่ม m: [{ slot, char, m }]
--   ฝั่งหน้าจอใช้ m ของ payload ถ้ามี ไม่มีก็ใช้ของโจทย์ (ห้องเก่าที่เปิดค้างไว้ยังเล่นต่อได้)
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. เปิดชนิดเกมใหม่ ─────────────────────────────────────────────
ALTER TABLE public.quiz_sets DROP CONSTRAINT IF EXISTS quiz_sets_game_kind_check;
ALTER TABLE public.quiz_sets ADD CONSTRAINT quiz_sets_game_kind_check
  CHECK (game_kind = ANY (ARRAY['quiz', 'puzzle', 'tiles', 'words', 'shuffle']));

ALTER TABLE public.quiz_sessions DROP CONSTRAINT IF EXISTS quiz_sessions_game_kind_check;
ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_game_kind_check
  CHECK (game_kind = ANY (ARRAY['quiz', 'puzzle', 'tiles', 'words', 'shuffle']));

ALTER TABLE public.quiz_words ADD COLUMN IF NOT EXISTS pool jsonb;
COMMENT ON COLUMN public.quiz_words.pool IS
  'Word Shuffle: กองตัวอักษรที่สลับแล้ว [{c, m}] (คำใบ้ที่ลูกทัวร์เห็น) · What Words = NULL';

-- ── 2. บันทึกข้อ — รับกองตัวสลับเพิ่ม ─────────────────────────────────
-- เปลี่ยนรายการพารามิเตอร์ → ต้อง DROP ตัวเก่า ไม่งั้นมีสองตัวชื่อเดียวกัน
-- แล้ว PostgREST เลือกไม่ถูก ("Could not choose the best candidate function")
DROP FUNCTION IF EXISTS public.quiz_words_upsert(uuid, text, uuid, uuid, text, integer, text, jsonb, text[], text, integer);

CREATE OR REPLACE FUNCTION public.quiz_words_upsert(
  p_staff_id uuid, p_pin text, p_set_id uuid, p_question_id uuid,
  p_text text, p_time_limit_sec integer, p_category text, p_cells jsonb,
  p_aliases text[], p_explain text, p_sort_order integer,
  p_pool jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id       uuid;
  v_kind     text;
  v_n        integer;
  v_bad      integer;
  v_hidden   integer;
  v_answer   text;
  v_full     jsonb;
  v_masked   jsonb;
  v_cells    jsonb;
  v_pool     jsonb;
  v_pool_n   integer;
  v_tiles    text[];
  v_pool_seq text[];
  -- เครื่องหมายไทยที่เกาะตัวหน้าได้: ั ำ ิ-ฺ ็-๎ — ระบุด้วย chr() ตรงๆ
  -- (บทเรียน: คลาสอักขระ POSIX ของ Postgres กับภาษาไทยเคยกินทัณฑฆาตมาแล้ว)
  v_marks    text := '^[' || chr(3633) || chr(3635) || chr(3636) || '-' || chr(3642)
                          || chr(3655) || '-' || chr(3662) || ']*$';
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  SELECT game_kind INTO v_kind FROM public.quiz_sets WHERE id = p_set_id;
  IF v_kind IS NULL OR v_kind NOT IN ('words', 'shuffle') THEN
    RAISE EXCEPTION 'ชุดนี้ไม่ใช่เกม What Words / Word Shuffle';
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

  -- Word Shuffle: ซ่อนทุกช่องที่มีตัวฐาน ไม่สนธงที่ส่งมา — ความหมายของเกมคือเรียงทั้งคำ
  IF v_kind = 'shuffle' THEN
    SELECT jsonb_agg(
             CASE WHEN jsonb_typeof(e) = 'object' THEN
               e || jsonb_build_object('h', coalesce(e->>'c', '') NOT IN ('', ' '))
             ELSE e END
             ORDER BY ord)
      INTO v_cells
      FROM jsonb_array_elements(p_cells) WITH ORDINALITY AS x(e, ord);
  ELSE
    v_cells := p_cells;
  END IF;

  -- ช่องที่ผิดรูป: ตัวฐานเกิน 1 ตัว · เครื่องหมายปลอม · ซ่อนช่องว่าง/ช่องเปล่า · ช่องว่างมีเครื่องหมาย
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(v_cells) AS x(e)
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
                     -- Word Shuffle ซ่อนเครื่องหมายด้วย — ไม่งั้น "ช่องที่มีไม้เอก" บอกตำแหน่งให้
                     'm', CASE WHEN v_kind = 'shuffle' AND e->'h' = 'true'::jsonb THEN ''
                               ELSE coalesce(e->>'m', '') END) ORDER BY ord),
         array_agg(coalesce(e->>'c', '') || coalesce(e->>'m', '') ORDER BY ord)
           FILTER (WHERE e->'h' = 'true'::jsonb)
    INTO v_answer, v_hidden, v_full, v_masked, v_tiles
    FROM jsonb_array_elements(v_cells) WITH ORDINALITY AS x(e, ord);

  IF btrim(coalesce(v_answer, '')) = '' THEN
    RAISE EXCEPTION 'ต้องมีคำตอบ';
  END IF;
  IF v_hidden < 1 THEN
    RAISE EXCEPTION 'ต้องซ่อนอย่างน้อย 1 ตัว';
  END IF;

  -- ── กองตัวสลับ (Word Shuffle เท่านั้น) ──
  IF v_kind = 'shuffle' THEN
    IF v_hidden < 2 THEN
      RAISE EXCEPTION 'คำตอบต้องมีอย่างน้อย 2 ตัวถึงจะสลับได้';
    END IF;
    IF p_pool IS NULL OR jsonb_typeof(p_pool) <> 'array' THEN
      RAISE EXCEPTION 'ต้องมีกองตัวอักษรที่สลับแล้ว';
    END IF;
    v_pool_n := jsonb_array_length(p_pool);
    IF v_pool_n <> v_hidden THEN
      RAISE EXCEPTION 'กองตัวสลับต้องมี % ตัวเท่าคำตอบ (ส่งมา %)', v_hidden, v_pool_n;
    END IF;

    SELECT count(*) INTO v_bad
      FROM jsonb_array_elements(p_pool) AS x(e)
     WHERE jsonb_typeof(e) <> 'object'
        OR char_length(coalesce(e->>'c', '')) <> 1
        OR coalesce(e->>'c', '') = ' '
        OR coalesce(e->>'m', '') !~ v_marks;
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'กองตัวสลับมีตัวที่ผิดรูป % ตัว', v_bad;
    END IF;

    SELECT array_agg(coalesce(e->>'c', '') || coalesce(e->>'m', '') ORDER BY ord),
           jsonb_agg(jsonb_build_object('c', e->>'c', 'm', coalesce(e->>'m', '')) ORDER BY ord)
      INTO v_pool_seq, v_pool
      FROM jsonb_array_elements(p_pool) WITH ORDINALITY AS x(e, ord);

    -- ต้องเป็นตัวชุดเดียวกับคำตอบพอดี (นับซ้ำด้วย เช่น อ สองตัวของ แม่ฮ่องสอน)
    IF (SELECT array_agg(t ORDER BY t) FROM unnest(v_pool_seq) AS t)
       IS DISTINCT FROM (SELECT array_agg(t ORDER BY t) FROM unnest(v_tiles) AS t) THEN
      RAISE EXCEPTION 'กองตัวสลับไม่ตรงกับตัวอักษรของคำตอบ';
    END IF;
    -- ลำดับเดียวกับคำตอบ = ไม่ได้สลับ (ยกเว้นทุกตัวเหมือนกันหมด ซึ่งสลับยังไงก็เหมือนเดิม)
    IF v_pool_seq = v_tiles AND (SELECT count(DISTINCT t) FROM unnest(v_tiles) AS t) > 1 THEN
      RAISE EXCEPTION 'ลำดับที่สลับยังตรงกับคำตอบ — กดสลับใหม่';
    END IF;
  ELSE
    v_pool := NULL;
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

  INSERT INTO public.quiz_words (question_id, category, cells, hidden_count, pool)
  VALUES (v_id, btrim(p_category), v_masked, v_hidden, v_pool)
  ON CONFLICT (question_id) DO UPDATE
    SET category = excluded.category, cells = excluded.cells,
        hidden_count = excluded.hidden_count, pool = excluded.pool;

  INSERT INTO public.quiz_keys (question_id, correct_text, answer_aliases, explain, words_cells)
  VALUES (v_id, v_answer, coalesce(p_aliases, '{}'), coalesce(p_explain, ''), v_full)
  ON CONFLICT (question_id) DO UPDATE
    SET correct_text = excluded.correct_text,
        answer_aliases = excluded.answer_aliases,
        explain = excluded.explain,
        words_cells = excluded.words_cells;

  RETURN v_id;
END $fn$;

REVOKE ALL ON FUNCTION public.quiz_words_upsert(uuid, text, uuid, uuid, text, integer, text, jsonb, text[], text, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_words_upsert(uuid, text, uuid, uuid, text, integer, text, jsonb, text[], text, integer, jsonb)
  TO anon, authenticated;

-- ── 3. อ่านชุดมาแก้ — คืนกองตัวสลับด้วย (เปลี่ยนชนิดผลลัพธ์ → DROP ก่อน) ──
DROP FUNCTION IF EXISTS public.quiz_words_set_for_edit(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.quiz_words_set_for_edit(p_set_id uuid, p_staff_id uuid, p_pin text)
RETURNS TABLE (
  question_id uuid, sort_order integer, question_text text, time_limit_sec integer,
  category text, cells jsonb, correct_text text, answer_aliases text[], explain text,
  pool jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  RETURN QUERY
    SELECT q.id, q.sort_order, q.text, q.time_limit_sec,
           coalesce(w.category, ''), coalesce(k.words_cells, '[]'::jsonb),
           coalesce(k.correct_text, ''), coalesce(k.answer_aliases, '{}'), coalesce(k.explain, ''),
           w.pool
      FROM public.quiz_questions q
      LEFT JOIN public.quiz_words w ON w.question_id = q.id
      LEFT JOIN public.quiz_keys  k ON k.question_id = q.id
     WHERE q.set_id = p_set_id AND q.kind = 'words'
     ORDER BY q.sort_order, q.created_at;
END $fn$;

REVOKE ALL ON FUNCTION public.quiz_words_set_for_edit(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_words_set_for_edit(uuid, uuid, text) TO anon, authenticated;

-- ── 4. เปิดตัว — พกเครื่องหมายไปด้วย (payload: slot · char · m) ─────────
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
                        || jsonb_build_array(jsonb_build_object(
                             'slot', v_slot, 'char', v_cell->>'c', 'm', coalesce(v_cell->>'m', ''))),
         hint_level   = coalesce(hint_level, 0) + 1,
         last_tile_at = now(),
         last_tile_n  = 1
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_words_open(uuid, text, integer) TO anon, authenticated;

-- ── 5. เปิดห้อง — ชื่อห้องตั้งต้น + สกิน arcade ─────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_start_session(
  p_tour_id uuid, p_set_id uuid, p_name text DEFAULT NULL::text, p_bus_id uuid DEFAULT NULL::uuid,
  p_screen_mode text DEFAULT 'projector'::text, p_staff_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(session_id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid; v_token text; v_kind text; v_default_name text;
BEGIN
  SELECT coalesce(game_kind, 'quiz') INTO v_kind FROM public.quiz_sets WHERE id = p_set_id;
  v_kind := coalesce(v_kind, 'quiz');
  v_default_name := CASE v_kind
                      WHEN 'puzzle'  THEN 'ห้องปริศนาใบ้คำ'
                      WHEN 'tiles'   THEN 'ห้องเปิดแผ่นป้าย'
                      WHEN 'words'   THEN 'ห้อง What Words'
                      WHEN 'shuffle' THEN 'ห้อง Word Shuffle'
                      ELSE 'ห้องควิซ' END;

  INSERT INTO public.quiz_sessions
    (tour_id, set_id, name, bus_id, screen_mode, created_by, game_kind, stage_theme)
  VALUES (
    p_tour_id, p_set_id,
    coalesce(nullif(btrim(p_name), ''), v_default_name),
    p_bus_id, coalesce(p_screen_mode, 'projector'), p_staff_id, v_kind,
    CASE WHEN v_kind IN ('puzzle', 'tiles', 'words', 'shuffle') THEN 'arcade' ELSE 'day' END
  )
  RETURNING id INTO v_id;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.quiz_session_tokens (session_id, token) VALUES (v_id, v_token);

  RETURN QUERY SELECT v_id, v_token;
END $function$;

-- ── 6. คะแนนทีม = คะแนนรวม (เหมือนเกมตอบคำอื่น) ──────────────────────
CREATE OR REPLACE FUNCTION public.quiz_team_leaderboard(p_session_id uuid)
RETURNS TABLE(id uuid, name text, color_index integer, member_count integer, total_score integer, avg_score integer, rank integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH mode AS (
    SELECT coalesce(bool_or(s.game_kind IN ('puzzle', 'tiles', 'words', 'shuffle')), false) AS by_total
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

-- ── 7. คัดลอกชุด — พกกองตัวสลับไปด้วย ───────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_clone_set(p_staff_id uuid, p_pin text, p_set_id uuid, p_title text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

    INSERT INTO public.quiz_words (question_id, category, cells, hidden_count, pool)
    SELECT v_new_qid, w.category, w.cells, w.hidden_count, w.pool
      FROM public.quiz_words w WHERE w.question_id = v_q.id;
  END LOOP;

  RETURN v_new;
END $function$;

COMMIT;
