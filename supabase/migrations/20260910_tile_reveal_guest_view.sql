-- ═══════════════════════════════════════════════════════════════════════
-- เกม "เปิดแผ่นป้าย" — แก้จากการเล่นจริงครั้งแรก · 10 ก.ย. 2026
-- ═══════════════════════════════════════════════════════════════════════
-- ต่อจาก 20260901_tile_reveal.sql
--
-- สองเรื่องที่เจอตอนเล่นจริง และทั้งคู่มองไม่เห็นจากการอ่านโค้ด:
--
-- 1. กระดานบนมือถือคนละรูปทรงกับบนโปรเจกเตอร์
--    เดิม TileBoard คิดสัดส่วนกระดานจาก "ภาพจริง" ซึ่งมือถือลูกทัวร์ไม่มี
--    เลยตกไปใช้ คอลัมน์÷แถว (3×4 = 1.33) ขณะที่โปรเจกเตอร์ได้ 16:9 = 1.78
--    ผลคือภาพตอนปิดถูกยืด และแผ่นป้ายผิดสัดส่วน
--    → สัดส่วนภาพเป็นเลขตัวเดียว ไม่ได้บอกอะไรเกี่ยวกับเนื้อภาพ เก็บในตารางเปิดได้
--
-- 2. มือถือลูกทัวร์ไม่เห็นภาพใต้แผ่นที่เปิดแล้ว
--    เดิมตั้งใจไม่ส่งเพราะภาพคือเฉลย ผลคือลูกทัวร์เห็นแต่ตารางตัวเลขเปล่าๆ เล่นไม่รู้เรื่อง
--    เจ้าของโปรเจกต์ตัดสิน (10 ก.ย. 2026): ให้เห็นเสมอ
--    เกมที่ไม่มีใครเห็นแย่กว่าการรั่วที่ไม่มีใครไปแคะ
--
--    ★ แต่ยัง **ห้ามย้าย tile_image_url ไปไว้ในตาราง quiz_tiles** เด็ดขาด
--      นั่นแปลว่าลูกทัวร์ SELECT ทีเดียวได้ภาพทุกข้อในชุด = ได้เฉลยทั้งเกม
--      ทางออกคือ RPC ที่คืนเฉพาะภาพของ "ข้อปัจจุบันที่เปิดแล้ว" ข้อเดียว
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. สัดส่วนภาพเป็นของสาธารณะ ─────────────────────────────────────
ALTER TABLE public.quiz_tiles
  ADD COLUMN IF NOT EXISTS image_aspect real;

COMMENT ON COLUMN public.quiz_tiles.image_aspect IS
  'สัดส่วนกว้าง/สูงของภาพต้นฉบับ เก็บไว้ให้ทุกจอคำนวณรูปทรงกระดานได้ตรงกันโดยไม่ต้องมีตัวภาพ';

-- ข้อเก่าที่สร้างก่อนไมเกรชันนี้จะเป็น NULL — ไม่ต้อง backfill
-- จอจะวัดจากไฟล์เองเป็นแผนสอง และ Builder จะเติมให้ตอนเซฟครั้งถัดไป

-- ── 2. ภาพของข้อปัจจุบัน สำหรับมือถือที่ไม่มี token ─────────────────
-- จำกัดสามชั้น: เฉพาะ current_question_id · ต้องเปิดข้อแล้ว · ห้องจบแล้วไม่คืน
-- รั่วได้อย่างมากคือภาพของข้อที่กำลังเล่นอยู่ตรงหน้า ซึ่งตั้งใจให้เห็นอยู่แล้ว
CREATE OR REPLACE FUNCTION public.quiz_tiles_current_image(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions; v_url text;
BEGIN
  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN NULL; END IF;
  IF v_s.state = 'finished' THEN RETURN NULL; END IF;
  -- เปิดหน้าค้างไว้ตอน lobby แล้วรอ ไม่ได้ภาพ
  IF v_s.question_started_at IS NULL OR now() < v_s.question_started_at THEN RETURN NULL; END IF;

  SELECT k.tile_image_url INTO v_url
    FROM public.quiz_keys k
    JOIN public.quiz_questions q ON q.id = k.question_id
   WHERE k.question_id = v_s.current_question_id AND q.kind = 'tiles';

  RETURN v_url;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_tiles_current_image(uuid) TO anon, authenticated;

COMMIT;

BEGIN;

-- ── 3. Builder รับ/คืนสัดส่วนภาพ ────────────────────────────────────
-- ⚠️ ทั้งสองตัวเปลี่ยนลายเซ็น/ชนิดที่คืน ต้อง DROP ก่อน CREATE
--    ไม่งั้น Postgres ปฏิเสธ ("cannot change return type of existing function")
--    และถ้าปล่อยตัวเก่าไว้เป็น overload PostgREST จะเลือกไม่ถูกเมื่อส่งพารามิเตอร์แบบมีชื่อ
DROP FUNCTION IF EXISTS public.quiz_tiles_set_for_edit(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.quiz_tiles_upsert(
  uuid, text, uuid, uuid, text, integer, integer, integer, integer, text,
  real, real, real, real, text, text, text[], text, integer);

CREATE OR REPLACE FUNCTION public.quiz_tiles_set_for_edit(
  p_set_id uuid, p_staff_id uuid, p_pin text
)
RETURNS TABLE (
  question_id uuid, sort_order integer, question_text text, time_limit_sec integer,
  grid_rows integer, grid_cols integer, open_step integer, cover_image_url text,
  crop_x real, crop_y real, crop_w real, crop_h real,
  tile_image_url text, correct_text text, answer_aliases text[], explain text,
  image_aspect real
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  RETURN QUERY
    SELECT q.id, q.sort_order, q.text, q.time_limit_sec,
           coalesce(z.grid_rows, 3)::integer, coalesce(z.grid_cols, 4)::integer,
           coalesce(z.open_step, 1)::integer, z.cover_image_url,
           coalesce(z.crop_x, 0)::real, coalesce(z.crop_y, 0)::real,
           coalesce(z.crop_w, 1)::real, coalesce(z.crop_h, 1)::real,
           k.tile_image_url, coalesce(k.correct_text, ''),
           coalesce(k.answer_aliases, '{}'), coalesce(k.explain, ''),
           z.image_aspect
      FROM public.quiz_questions q
      LEFT JOIN public.quiz_tiles z ON z.question_id = q.id
      LEFT JOIN public.quiz_keys  k ON k.question_id = q.id
     WHERE q.set_id = p_set_id AND q.kind = 'tiles'
     ORDER BY q.sort_order, q.created_at;
END $fn$;

CREATE OR REPLACE FUNCTION public.quiz_tiles_upsert(
  p_staff_id uuid, p_pin text, p_set_id uuid, p_question_id uuid,
  p_text text, p_time_limit_sec integer,
  p_grid_rows integer, p_grid_cols integer, p_open_step integer,
  p_cover_image_url text,
  p_crop_x real, p_crop_y real, p_crop_w real, p_crop_h real,
  p_tile_image_url text, p_answer text, p_aliases text[], p_explain text,
  p_sort_order integer, p_image_aspect real DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_qid uuid; v_rows integer; v_cols integer; v_step integer; v_time integer;
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;
  IF btrim(coalesce(p_answer, '')) = '' THEN RAISE EXCEPTION 'ต้องมีคำตอบ'; END IF;
  IF btrim(coalesce(p_tile_image_url, '')) = '' THEN RAISE EXCEPTION 'ต้องมีภาพ'; END IF;

  v_rows := least(greatest(coalesce(p_grid_rows, 3), 2), 6);
  v_cols := least(greatest(coalesce(p_grid_cols, 4), 2), 6);
  v_step := least(greatest(coalesce(p_open_step, 1), 1), 4);
  v_time := least(greatest(coalesce(p_time_limit_sec, 300), 5), 300);

  IF p_question_id IS NULL THEN
    INSERT INTO public.quiz_questions (set_id, sort_order, kind, text, time_limit_sec)
    VALUES (p_set_id, coalesce(p_sort_order, 0), 'tiles', coalesce(p_text, ''), v_time)
    RETURNING id INTO v_qid;
  ELSE
    UPDATE public.quiz_questions
       SET text = coalesce(p_text, ''), time_limit_sec = v_time,
           sort_order = coalesce(p_sort_order, sort_order), kind = 'tiles'
     WHERE id = p_question_id AND set_id = p_set_id
    RETURNING id INTO v_qid;
    IF v_qid IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อนี้ในชุด'; END IF;
  END IF;

  INSERT INTO public.quiz_tiles
    (question_id, grid_rows, grid_cols, open_step, cover_image_url,
     crop_x, crop_y, crop_w, crop_h, image_aspect)
  VALUES
    (v_qid, v_rows, v_cols, v_step, nullif(btrim(coalesce(p_cover_image_url, '')), ''),
     coalesce(p_crop_x, 0), coalesce(p_crop_y, 0), coalesce(p_crop_w, 1), coalesce(p_crop_h, 1),
     CASE WHEN p_image_aspect > 0 THEN p_image_aspect END)
  ON CONFLICT (question_id) DO UPDATE
     SET grid_rows = excluded.grid_rows, grid_cols = excluded.grid_cols,
         open_step = excluded.open_step, cover_image_url = excluded.cover_image_url,
         crop_x = excluded.crop_x, crop_y = excluded.crop_y,
         crop_w = excluded.crop_w, crop_h = excluded.crop_h,
         -- ไม่ส่งมา = เก็บของเดิมไว้ ดีกว่าล้างทิ้งแล้วกระดานเพี้ยน
         image_aspect = coalesce(excluded.image_aspect, public.quiz_tiles.image_aspect);

  INSERT INTO public.quiz_keys
    (question_id, correct_text, answer_aliases, tile_image_url, explain)
  VALUES
    (v_qid, btrim(p_answer),
     coalesce((SELECT array_agg(DISTINCT btrim(x)) FROM unnest(coalesce(p_aliases, '{}')) x
                WHERE btrim(x) <> ''), '{}'),
     btrim(p_tile_image_url), coalesce(p_explain, ''))
  ON CONFLICT (question_id) DO UPDATE
     SET correct_text = excluded.correct_text,
         answer_aliases = excluded.answer_aliases,
         tile_image_url = excluded.tile_image_url,
         explain = excluded.explain;

  RETURN v_qid;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_tiles_set_for_edit(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_tiles_upsert(
  uuid, text, uuid, uuid, text, integer, integer, integer, integer, text,
  real, real, real, real, text, text, text[], text, integer, real) TO anon, authenticated;

-- ── 4. ก็อปชุดต้องพาสัดส่วนไปด้วย ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_clone_set(
  p_staff_id uuid, p_pin text, p_set_id uuid, p_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
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
     game_kind, answer_mode, attempt_limit, points_per_correct)
  VALUES
    (v_src.org_id, v_src.destination_id,
     coalesce(nullif(btrim(p_title), ''), v_src.title || ' (สำเนา)'),
     v_src.description, v_src.lang, v_src.cover_url,
     v_src.default_time_limit, v_src.streak_bonus, p_staff_id,
     v_src.game_kind, v_src.answer_mode, v_src.attempt_limit, v_src.points_per_correct)
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
       tile_image_url)
    SELECT v_new_qid, k.correct_index, k.correct_number, k.explain,
           k.correct_text, k.answer_split, k.answer_aliases, k.clue_labels,
           k.answer_image_url, k.hints, k.tile_image_url
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
  END LOOP;

  RETURN v_new;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_clone_set(uuid, text, uuid, text) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
