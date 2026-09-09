-- ═══════════════════════════════════════════════════════════════════════
-- เกม "เปิดแผ่นป้าย" — จอต้องรู้ทันทีว่าใครตอบถูก · 10 ก.ย. 2026 (รอบสอง)
-- ═══════════════════════════════════════════════════════════════════════
-- ต่อจาก 20260910_tile_reveal_guest_view.sql
--
-- ปัญหาที่เจอตอนเล่นจริง:
--   พอมีคนตอบถูก ข้อจะล็อกทันที แต่ "ชื่อผู้ชนะ" อยู่ใน reveal_payload
--   ซึ่งเกิดตอนคนคุมเกมกด "เฉลย" เท่านั้น ระหว่างนั้นจอเวทีกับมือถือคนคุมเกม
--   จึงยังโชว์ตัวเลข still_in = 0 พร้อมข้อความ "ยังตอบได้ 0 คน"
--   ซึ่งอ่านแล้วเหมือน "ไม่มีใครตอบได้" ทั้งที่เพิ่งมีคนตอบถูกไปเมื่อกี้
--
--   → ข้อมูลใน DB ถูกต้องทุกอย่าง (คะแนนขึ้น ผู้ชนะบันทึกครบ) เป็นปัญหาที่การแสดงผลล้วนๆ
--     แต่แก้ที่หน้าจออย่างเดียวไม่พอ เพราะหน้าจอไม่มีทางรู้ชื่อผู้ชนะจนกว่าจะกดเฉลย
--
-- ให้ stats คืนชื่อผู้ชนะ ทีม และเวลามาด้วย จอจะได้ฉลองทันทีที่มีคนตอบถูก
-- ปลอดภัยเพราะ stats ตรวจ host token อยู่แล้ว (จอเวที + มือถือคนคุมเกมเท่านั้น)
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ⚠️ เปลี่ยนชนิดที่คืน ต้อง DROP ก่อน — และ DROP กับ CREATE ต้องอยู่ก้อนเดียวกันเสมอ
--    (บทเรียนจากรอบก่อน: migration ล้มกลางทางแล้วเหลือ DROP อย่างเดียว ฟังก์ชันหายไปดื้อๆ)
DROP FUNCTION IF EXISTS public.quiz_tiles_stats(uuid, uuid, text, integer);

CREATE OR REPLACE FUNCTION public.quiz_tiles_stats(
  p_session_id uuid, p_question_id uuid, p_token text, p_online_window_sec integer DEFAULT 60
)
RETURNS TABLE (
  solved integer, guesses integer, online integer, total integer, still_in integer,
  winner_name text, winner_team text, winner_seconds numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_cap integer;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT least(coalesce(s.attempt_limit, 40), 40) INTO v_cap
    FROM public.quiz_questions q JOIN public.quiz_sets s ON s.id = q.set_id
   WHERE q.id = p_question_id;
  v_cap := coalesce(v_cap, 40);

  RETURN QUERY SELECT
    (SELECT count(*) FROM public.quiz_answers a
      WHERE a.session_id = p_session_id AND a.question_id = p_question_id AND a.is_correct)::integer,
    (SELECT count(*) FROM public.quiz_puzzle_guesses g
      WHERE g.session_id = p_session_id AND g.question_id = p_question_id)::integer,
    (SELECT count(*) FROM public.quiz_players p
      WHERE p.session_id = p_session_id
        AND p.last_seen_at > now() - make_interval(secs => p_online_window_sec))::integer,
    (SELECT count(*) FROM public.quiz_players p WHERE p.session_id = p_session_id)::integer,
    -- ยังตอบได้ = ยังไม่ตอบถูก และยังไม่หมดโควตา
    (SELECT count(*) FROM public.quiz_players p
      WHERE p.session_id = p_session_id
        AND NOT EXISTS (
          SELECT 1 FROM public.quiz_answers a
           WHERE a.session_id = p_session_id AND a.question_id = p_question_id
             AND a.player_id = p.id AND a.is_correct)
        AND (SELECT count(*) FROM public.quiz_puzzle_guesses g
              WHERE g.session_id = p_session_id AND g.question_id = p_question_id
                AND g.player_id = p.id) < v_cap)::integer,
    -- ผู้ชนะ — มีได้คนเดียวตามกติกา ORDER BY ไว้กันเหนียวเผื่อข้อมูลเก่า
    (SELECT p.display_name FROM public.quiz_answers a
       JOIN public.quiz_players p ON p.id = a.player_id
      WHERE a.session_id = p_session_id AND a.question_id = p_question_id AND a.is_correct
      ORDER BY a.elapsed_ms LIMIT 1),
    -- ทีมของผู้ชนะ — NULL เมื่อไม่ได้เล่นเป็นทีม
    (SELECT tm.name FROM public.quiz_answers a
       JOIN public.quiz_players p ON p.id = a.player_id
       JOIN public.quiz_teams tm ON tm.id = p.team_id
      WHERE a.session_id = p_session_id AND a.question_id = p_question_id AND a.is_correct
      ORDER BY a.elapsed_ms LIMIT 1),
    (SELECT round(a.elapsed_ms / 1000.0, 1) FROM public.quiz_answers a
      WHERE a.session_id = p_session_id AND a.question_id = p_question_id AND a.is_correct
      ORDER BY a.elapsed_ms LIMIT 1);
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_tiles_stats(uuid, uuid, text, integer) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── หมายเหตุเรื่องโหมดทีม ──────────────────────────────────────────
-- เกมนี้เล่นเป็นทีมได้โดยไม่ต้องแก้ DB เลย เพราะ quiz_sessions.team_mode /
-- quiz_teams / quiz_create_team / quiz_join_team / quiz_team_leaderboard
-- มีอยู่แล้วตั้งแต่ 20260818_quiz_teams.sql และเป็นของกลางของเครื่องยนต์ควิซ
--
-- กติกา "ทีมแรกที่ตอบถูก" ทำงานได้เองอยู่แล้ว: คนแรกที่ตอบถูกจบข้อและได้ 1 คะแนน
-- คะแนนทีมคิดจากค่าเฉลี่ยต่อคนใน quiz_team_leaderboard ทีมของคนนั้นจึงขยับตาม
-- ไม่มีคอลัมน์คะแนนของทีมแยกต่างหากให้ต้องดูแล
