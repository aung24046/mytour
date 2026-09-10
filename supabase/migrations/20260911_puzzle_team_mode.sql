-- ═══════════════════════════════════════════════════════════════════════
-- ปริศนาใบ้คำ: โหมดทีม + คะแนนทีมแบบรวม · 11 ก.ย. 2026
-- ═══════════════════════════════════════════════════════════════════════
-- ต่อจาก 20260910c_puzzle_auto_reveal.sql
--
-- ของกลางเรื่องทีม (quiz_teams / quiz_create_team / quiz_join_team) มีครบตั้งแต่
-- 20260818_quiz_teams.sql แล้ว — ไฟล์นี้แก้เฉพาะสิ่งที่ปริศนาใบ้คำกับเปิดแผ่นป้ายต่างจากควิซ
--
-- ── ปัญหาคะแนนทีมเดิม ──────────────────────────────────────────────
-- quiz_team_leaderboard จัดอันดับด้วย avg_score = round(avg(score)) เป็นจำนวนเต็ม
-- ควิซคะแนนหลักพันจึงไม่เห็นปัญหา แต่ปริศนา/แผ่นป้ายตอบถูกได้ 1 คะแนน
-- ทีม 3 คนที่ชนะ 1 ข้อ = 0.33 → ปัดเป็น 0 เท่ากับทีมที่ไม่เคยตอบได้เลย
--
-- เจ้าของโปรเจกต์ตัดสิน (11 ก.ย. 2026): สองเกมนี้ใช้ "คะแนนรวมทั้งทีม"
--   เพราะคนแรก/ทีมแรกที่ตอบถูกจบข้อ → คะแนนรวม = จำนวนข้อที่ทีมชนะ
--   ควิซยังใช้ค่าเฉลี่ยต่อคนเหมือนเดิม (ไม่แตะ)
--
-- ── จำนวนคนตอบถูกก่อนเฉลย ระดับห้อง ────────────────────────────────
-- เดิมตั้งได้ที่ชุดอย่างเดียว (quiz_sets.solve_limit) แต่เล่นเป็นทีมต้องเป็น
-- "ทีมแรกที่ตอบถูกได้คะแนนแล้วเฉลย" ไม่งั้นคนในทีมเดียวกันบอกคำตอบกันแล้วเก็บคะแนนซ้อน
-- เจ้าของโปรเจกต์สั่ง: ห้องแบบทีมให้ค่าเริ่มต้นเป็น 1 คน แต่เปลี่ยนได้ตอนสร้างห้อง
--   quiz_sessions.solve_limit  NULL = ใช้ค่าของชุด · 0 = ไม่จำกัด · N = ครบ N คนแล้วเฉลย
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. คอลัมน์ระดับห้อง ────────────────────────────────────────────
ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS solve_limit integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sessions_solve_limit_check'
  ) THEN
    ALTER TABLE public.quiz_sessions
      ADD CONSTRAINT quiz_sessions_solve_limit_check
      CHECK (solve_limit IS NULL OR (solve_limit BETWEEN 0 AND 100));
  END IF;
END $$;

COMMENT ON COLUMN public.quiz_sessions.solve_limit IS
  'ทับ quiz_sets.solve_limit ของห้องนี้ — NULL = ใช้ค่าของชุด · 0 = ไม่จำกัด · N = ครบ N คนแล้วเฉลย';

-- ── 2. ตั้งค่าจำนวนคนตอบถูกของห้อง (ต้องมี token · ก่อนเริ่มเกมเท่านั้น) ──
-- แยกเป็นฟังก์ชันใหม่แทนการเติมพารามิเตอร์ให้ quiz_set_options
-- เพราะนั่นต้อง DROP/CREATE ตัวที่ควิซใช้อยู่ทั้งตัว
CREATE OR REPLACE FUNCTION public.quiz_set_solve_limit(
  p_session_id uuid, p_token text, p_limit integer
)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบห้อง'; END IF;
  IF v_s.state <> 'lobby' THEN
    RAISE EXCEPTION 'เกมเริ่มแล้ว เปลี่ยนจำนวนคนตอบถูกไม่ได้';
  END IF;
  IF p_limit IS NOT NULL AND (p_limit < 0 OR p_limit > 100) THEN
    RAISE EXCEPTION 'จำนวนคนตอบถูกไม่ถูกต้อง';
  END IF;

  UPDATE public.quiz_sessions SET solve_limit = p_limit
   WHERE id = p_session_id
  RETURNING * INTO v_s;
  RETURN v_s;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_set_solve_limit(uuid, text, integer) TO anon, authenticated;

-- ── 3. quiz_puzzle_guess — ใช้ค่าของห้องถ้าตั้งไว้ ───────────────────
-- เนื้อเดิมจาก 20260910c ทุกบรรทัด เพิ่มแค่บล็อก "ห้องตั้งเองได้ทับค่าของชุด"
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

  -- ★ ห้องตั้งเองได้ทับค่าของชุด (ใช้กับโหมดทีม — ค่าเริ่มต้น 1 = ทีมแรกที่ตอบถูกได้คะแนนแล้วเฉลย)
  --   NULL = ใช้ค่าของชุด · 0 = ไม่จำกัด · N = ครบ N คนแล้วเฉลย
  IF v_s.solve_limit IS NOT NULL THEN
    v_solve_limit := nullif(v_s.solve_limit, 0);
  END IF;

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

-- ── 4. quiz_reveal_internal — ผู้ตอบถูกคนแรกพาชื่อทีมมาด้วย ───────────
-- มือถือลูกทัวร์ไม่มี token จึงเรียก stats ไม่ได้ ชื่อทีมที่ชนะต้องมากับ reveal_payload
-- เนื้อเดิมจาก 20260910c ทุกบรรทัด เปลี่ยนแค่ fastest ของ puzzle กับ tiles
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

REVOKE ALL ON FUNCTION public.quiz_reveal_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.quiz_reveal_internal(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.quiz_reveal_internal(uuid) FROM authenticated;

-- ── 5. quiz_puzzle_stats — คืนผู้ชนะ + ทีม เหมือน quiz_tiles_stats ────
-- ⚠️ เปลี่ยนชนิดที่คืน ต้อง DROP ก่อน — DROP กับ CREATE อยู่ก้อนเดียวกันเสมอ
DROP FUNCTION IF EXISTS public.quiz_puzzle_stats(uuid, uuid, text, integer);

CREATE OR REPLACE FUNCTION public.quiz_puzzle_stats(
  p_session_id uuid, p_question_id uuid, p_token text, p_online_window_sec integer DEFAULT 60
)
RETURNS TABLE (
  solved integer, guesses integer, online integer, total integer,
  winner_name text, winner_team text, winner_seconds numeric
)
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
    (SELECT count(*) FROM public.quiz_players p WHERE p.session_id = p_session_id)::integer,
    -- คนแรกที่ตอบถูก (ตั้งให้ตอบได้หลายคน = คนที่เร็วที่สุด)
    (SELECT p.display_name FROM public.quiz_answers a
       JOIN public.quiz_players p ON p.id = a.player_id
      WHERE a.session_id = p_session_id AND a.question_id = p_question_id AND a.is_correct
      ORDER BY a.elapsed_ms LIMIT 1),
    -- ทีมของคนนั้น — NULL เมื่อไม่ได้เล่นเป็นทีม
    (SELECT tm.name FROM public.quiz_answers a
       JOIN public.quiz_players p ON p.id = a.player_id
       JOIN public.quiz_teams tm ON tm.id = p.team_id
      WHERE a.session_id = p_session_id AND a.question_id = p_question_id AND a.is_correct
      ORDER BY a.elapsed_ms LIMIT 1),
    (SELECT round(a.elapsed_ms / 1000.0, 1) FROM public.quiz_answers a
      WHERE a.session_id = p_session_id AND a.question_id = p_question_id AND a.is_correct
      ORDER BY a.elapsed_ms LIMIT 1);
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_puzzle_stats(uuid, uuid, text, integer) TO anon, authenticated;

-- ── 6. quiz_team_leaderboard — ปริศนา/แผ่นป้ายจัดอันดับด้วยคะแนนรวม ──
-- ชนิดที่คืนเหมือนเดิมทุกคอลัมน์ (ไม่ต้อง DROP) เปลี่ยนแค่ลำดับ
-- ควิซยังเรียงด้วยค่าเฉลี่ยต่อคนเหมือนเดิม
CREATE OR REPLACE FUNCTION public.quiz_team_leaderboard(p_session_id uuid)
RETURNS TABLE(id uuid, name text, color_index integer, member_count integer,
              total_score integer, avg_score integer, rank integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH mode AS (
    SELECT coalesce(bool_or(s.game_kind IN ('puzzle', 'tiles')), false) AS by_total
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

COMMIT;

NOTIFY pgrst, 'reload schema';
