-- ปริศนาใบ้คำ: เฉลยอัตโนมัติเมื่อมีคนตอบถูกครบตามที่ตั้งไว้
--
-- ปัญหาเดิม: คนแรกตอบถูกตั้งแต่วินาทีที่ 8 แล้วทั้งห้องนั่งรอจนหมดเวลา 90 วินาที
-- เพราะเฉลยขึ้นต่อเมื่อคนคุมเกมกดปุ่ม ซึ่งคนคุมเกมกำลังถือไมค์อยู่
--
-- กติกาใหม่: ตั้งค่าที่ "ชุด" ว่ายอมให้ตอบถูกได้กี่คน (quiz_sets.solve_limit)
--   1        = ใครตอบถูกก่อนได้คนเดียว แล้วเฉลยทันที (ค่าเริ่มต้นของเกมนี้)
--   N        = เปิดให้ตอบถูกได้ N คน คนที่ N ตอบถูกปุ๊บเฉลยปั๊บ
--   NULL     = ไม่จำกัด — เฉลยเมื่อคนคุมเกมกดเท่านั้น (พฤติกรรมเดิม)
--
-- ทำไมต้องแตก quiz_reveal ออกเป็นสองชั้น: ตัวเดิมบังคับให้ส่ง token ของคนคุมเกมมาด้วย
-- ซึ่ง quiz_puzzle_guess (ลูกทัวร์เรียก) ไม่มีและต้องไม่มี — ถ้าให้ token หลุดไปฝั่งมือถือ
-- ลูกทัวร์คนเดียวสั่งข้ามข้อทั้งห้องได้ จึงย้ายเนื้อในไป quiz_reveal_internal
-- ที่ไม่เปิดให้ anon เรียกตรงๆ แล้วให้ทั้งสองทางเรียกผ่านตัวนั้น

-- ── 1. คอลัมน์ตั้งค่า ───────────────────────────────────────────────
ALTER TABLE public.quiz_sets
  ADD COLUMN IF NOT EXISTS solve_limit integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sets_solve_limit_check'
  ) THEN
    ALTER TABLE public.quiz_sets
      ADD CONSTRAINT quiz_sets_solve_limit_check
      CHECK (solve_limit IS NULL OR (solve_limit BETWEEN 1 AND 100));
  END IF;
END $$;

COMMENT ON COLUMN public.quiz_sets.solve_limit IS
  'ปริศนาใบ้คำ: จำนวนคนที่ตอบถูกได้ก่อนระบบเฉลยเอง — NULL = ไม่จำกัด (คนคุมเกมกดเฉลยเอง)';

-- ชุดปริศนาที่มีอยู่แล้วให้เป็น "คนแรกที่ตอบถูก = เฉลยเลย" ตามที่เจ้าของงานสั่ง
-- (ชุดควิซ/เปิดแผ่นป้ายไม่แตะ — เกมเปิดแผ่นป้ายจบข้อเองอยู่แล้วตั้งแต่คนแรกตอบถูก)
UPDATE public.quiz_sets SET solve_limit = 1
 WHERE game_kind = 'puzzle' AND solve_limit IS NULL;

-- ── 2. quiz_reveal_internal — เนื้อในของ quiz_reveal ที่ไม่ตรวจ token ──
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
                              'seconds', round(a.elapsed_ms / 1000.0, 1))
      INTO v_fastest
      FROM public.quiz_answers a
      JOIN public.quiz_players p ON p.id = a.player_id
     WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.is_correct
     ORDER BY a.elapsed_ms
     LIMIT 1;

  ELSIF v_q.kind = 'tiles' THEN
    -- ปิดข้อให้ครบก่อน เผื่อคนคุมเกมกดเฉลยตรงๆ โดยไม่มีใครตอบถูกและไม่ผ่าน "ปิดรับ"
    PERFORM public.quiz_puzzle_close(p_session_id, v_q.id);

    -- ผู้ชนะ — มีได้คนเดียวตามกติกา แต่ ORDER BY ไว้กันเหนียวเผื่อข้อมูลเก่า
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
    'answer',           CASE WHEN v_q.kind IN ('puzzle', 'tiles') THEN v_k.correct_text END,
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

-- ห้ามเรียกตรงจากฝั่งมือถือ — ประตูเดียวที่เปิดคือ quiz_reveal (ต้องมี token)
-- และ quiz_puzzle_guess (ตัดสินเองจาก solve_limit)
REVOKE ALL ON FUNCTION public.quiz_reveal_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quiz_reveal_internal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.quiz_reveal_internal(uuid) FROM authenticated;

-- ── 3. quiz_reveal — เหลือแค่ด่านตรวจ token แล้วส่งต่อ ────────────
CREATE OR REPLACE FUNCTION public.quiz_reveal(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;
  RETURN public.quiz_reveal_internal(p_session_id);
END $function$;

-- ── 4. quiz_puzzle_guess — นับคนตอบถูกแล้วเฉลยเองเมื่อครบ ─────────
CREATE OR REPLACE FUNCTION public.quiz_puzzle_guess(p_session_id uuid, p_player_id uuid, p_question_id uuid, p_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_solve_limit integer;
  v_solved integer;
  v_elapsed integer;
  v_limit_ms integer;
  v_correct boolean := false;
  v_rows integer := 0;
  v_has_last boolean := false;
  v_revealed boolean := false;
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
  SELECT s.attempt_limit, s.points_per_correct, s.solve_limit
    INTO v_limit, v_points, v_solve_limit
    FROM public.quiz_sets s WHERE s.id = v_q.set_id;

  IF v_limit IS NOT NULL AND v_used >= v_limit THEN
    RETURN jsonb_build_object('status', 'no_attempts', 'attempts_left', 0);
  END IF;
  IF v_used >= 40 THEN
    RETURN jsonb_build_object('status', 'no_attempts', 'attempts_left', 0);
  END IF;

  -- โควตา "ตอบถูกได้กี่คน" เต็มแล้ว = ปิดข้อไปแล้วในทางปฏิบัติ
  -- ต้องกันตรงนี้ด้วย ไม่ใช่พึ่ง state อย่างเดียว เพราะคนที่กดส่งพร้อมกัน
  -- ในเสี้ยววินาทีเดียวกันจะเข้ามาก่อน UPDATE state ของคนก่อนหน้าจะ commit
  IF v_solve_limit IS NOT NULL THEN
    SELECT count(*) INTO v_solved
      FROM public.quiz_answers
     WHERE session_id = p_session_id AND question_id = p_question_id AND is_correct;
    IF v_solved >= v_solve_limit THEN
      RETURN jsonb_build_object('status', 'closed', 'solve_limit_reached', true);
    END IF;
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

    -- ครบโควตาแล้วเฉลยเลย ไม่ต้องรอคนคุมเกม
    IF v_solve_limit IS NOT NULL THEN
      SELECT count(*) INTO v_solved
        FROM public.quiz_answers
       WHERE session_id = p_session_id AND question_id = p_question_id AND is_correct;

      IF v_solved >= v_solve_limit THEN
        UPDATE public.quiz_sessions
           SET state = 'locked', locked_at = now()
         WHERE id = p_session_id AND state = 'answering';

        PERFORM public.quiz_reveal_internal(p_session_id);
        v_revealed := true;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'correct', v_correct,
    'revealed', v_revealed,
    'attempts_used', v_used + 1,
    'attempts_left', CASE WHEN v_limit IS NULL THEN NULL ELSE greatest(v_limit - v_used - 1, 0) END
  );
END $function$;

-- ── 5. คัดลอกชุดต้องพา solve_limit ไปด้วย ─────────────────────────
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
END $function$;
