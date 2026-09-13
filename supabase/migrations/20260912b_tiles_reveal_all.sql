-- เกมเปิดแผ่นป้าย: กด "เฉลย" แล้วแผ่นต้องเปิดครบทุกแผ่น
--
-- อาการที่เจ้าของโปรเจกต์เจอ (12 ก.ย. 2026): กดเฉลยแล้วแผ่นป้ายไม่เปิดหมด
-- เหตุ: revealed_tiles ถูกเติมให้ครบเฉพาะตอน "มีคนตอบถูก" (quiz_tiles_guess /
--       quiz_tiles_accept) เท่านั้น ส่วน quiz_reveal_internal สาขา 'tiles'
--       ตั้งแค่ state + reveal_payload ไม่เคยแตะ revealed_tiles
--       ข้อที่หมดเวลา/ไม่มีใครตอบถูก จึงค้างอยู่ที่จำนวนแผ่นที่คนคุมเกมเปิดเอง
--
-- แก้: สาขา 'tiles' เติม revealed_tiles = 1..(rows*cols) ไปพร้อมกับ state = 'reveal'
--      ในทรานแซกชันเดียว จอเวที/มือถือคนคุมเกม/มือถือลูกทัวร์จึงเห็นตรงกันทันที
--
-- นอกนั้นเหมือนเดิมทุกบรรทัด (คัดลอกจากตัวที่ใช้งานอยู่จริง 12 ก.ย. 2026)

CREATE OR REPLACE FUNCTION public.quiz_reveal_internal(p_session_id uuid)
 RETURNS quiz_sessions
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
  v_total integer;
  v_all smallint[];
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
      DECLARE v_new_streak integer; v_bonus integer := 0; v_total_pts integer;
      BEGIN
        v_new_streak := CASE WHEN r.is_correct THEN r.streak + 1 ELSE 0 END;
        IF r.is_correct AND coalesce(v_set_streak, true) THEN
          v_bonus := least(greatest(v_new_streak - 1, 0), 4) * 100;
        END IF;
        v_total_pts := r.points + v_bonus;

        UPDATE public.quiz_answers SET points = v_total_pts WHERE id = r.id;
        UPDATE public.quiz_players
           SET score = score + v_total_pts,
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

    -- ★ เฉลย = เปิดแผ่นครบทุกแผ่น
    --   ของเดิมเติม revealed_tiles ให้ครบเฉพาะตอนมีคนตอบถูก ข้อที่ไม่มีใครตอบถูก
    --   จึงค้างอยู่ที่จำนวนแผ่นที่เปิดไปแล้ว แล้วทั้งห้องไม่เคยเห็นภาพเฉลยเต็มใบ
    SELECT t.grid_rows * t.grid_cols INTO v_total
      FROM public.quiz_tiles t WHERE t.question_id = v_q.id;
    IF coalesce(v_total, 0) > 0 THEN
      SELECT array_agg(g)::smallint[] INTO v_all FROM generate_series(1, v_total) g;
    END IF;

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
     SET state = 'reveal',
         reveal_payload = v_payload,
         -- v_all ไม่ null เฉพาะข้อ tiles ที่มีกริดจริง เกมอื่นจึงไม่ถูกแตะต้อง
         revealed_tiles = coalesce(v_all, revealed_tiles),
         last_tile_at   = CASE WHEN v_all IS NULL THEN last_tile_at ELSE NULL END,
         last_tile_n    = CASE WHEN v_all IS NULL THEN last_tile_n ELSE 0 END
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $function$;
