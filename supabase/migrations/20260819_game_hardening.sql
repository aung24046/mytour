-- =====================================================================
-- เกม: อุดช่องที่อุดได้ทันที + แก้บั๊กคิดคะแนน — 19 ส.ค. 2026
-- =====================================================================
-- ต่อจาก 20260818_quiz.sql / 20260818_quiz_teams.sql
--
-- ── ส่วนที่ 1: ตัดสิทธิ์เขียนที่ไม่มีใครใช้ ──────────────────────────
-- 20260818_quiz.sql ลงทุนปิด quiz_keys / quiz_session_tokens อย่างดี
-- และออกแบบ host_token มาเพื่อกันลูกทัวร์สั่งเกม แต่ตารางที่เหลือยัง
-- GRANT UPDATE/DELETE ให้ anon พร้อม policy USING (true) ซึ่งทำให้ด่านทั้งหมด
-- ถูกข้ามได้จาก REST ตรงๆ โดยเฉพาะ quiz_players ที่เก็บ "คะแนนจริง" ไว้
-- (quiz_answers ปิดสนิทแล้วก็จริง แต่คะแนนที่ขึ้นกระดานอ่านจาก quiz_players)
--
-- ไฟล์นี้ปิดเฉพาะตารางที่ตรวจแล้วว่า **ฝั่งแอปไม่ได้เขียนตรงเลยสักจุด**
-- (ไล่ทุก .insert/.update/.delete/.upsert ใน src/ เมื่อ 19 ส.ค. 2026):
--   quiz_players   — 0 จุด  ทุกอย่างผ่าน quiz_join / quiz_submit / quiz_*_team
--   quiz_questions — 0 จุด  ผ่าน quiz_upsert_question / _delete_ / _reorder_ (ตรวจ PIN)
--   quiz_sessions  — 1 จุด  quizHost.js startSession() → ย้ายไป RPC ในไฟล์นี้
-- ทุกฟังก์ชันข้างต้นเป็น SECURITY DEFINER จึงยังเขียนได้ตามเดิม
--
-- ⚠️ ที่ยัง "ไม่" ปิดในไฟล์นี้ และเหตุผล:
--   quiz_sets  — ฝั่งแอปเขียนตรง 2 จุด (สร้างชุดใหม่ / แก้ข้อมูลชุด) และการ
--                ย้ายไป RPC ต้องขอ PIN ตั้งแต่ตอนกดสร้าง = เปลี่ยน flow ผู้ใช้
--                ผลกระทบจำกัด เพราะชุดที่เคยเปิดห้องเล่นแล้วลบไม่ได้อยู่แล้ว
--                (quiz_sessions.set_id เป็น ON DELETE RESTRICT)
--   draw_* / bingo_* — ฝั่งแอปเขียนตรงรวม 18 จุด ต้องเขียน RPC ใหม่ราวสิบตัว
--                พร้อมแก้หน้าจอตาม = งานรื้อ ไม่ใช่งานอุด ควรทำเป็นรอบของมันเอง
--                (บิงโกยังมีเรื่องที่หนักกว่า: bingo_call_number / bingo_call_random /
--                 bingo_review_win เป็น SECURITY DEFINER ที่ GRANT ให้ anon
--                 โดยไม่ตรวจอะไรเลย ต้องมี host_token แบบควิซก่อนถึงจะปิดได้)
--
-- ── ส่วนที่ 2: แก้บั๊กใน quiz_reveal ────────────────────────────────
--   2.1 กดเฉลยซ้ำแล้วคะแนนถูกบวกสองรอบ (เช็ค state ไม่พอ ต้องเช็คว่าข้อนี้เฉลยไปหรือยัง)
--   2.2 ข้อเดาตัวเลขไม่ล้าง streak ของคนที่ไม่ได้ตอบ ต่างจากข้อ mcq/tf
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- =====================================================================

BEGIN;

-- ── 1. ตัดสิทธิ์เขียนตรงจาก REST ────────────────────────────────────
-- ต้องทำสองชั้น: DROP POLICY อย่างเดียวไม่พอถ้า GRANT ยังอยู่ และ REVOKE
-- อย่างเดียวก็ทิ้ง policy ที่อ่านแล้วเข้าใจผิดว่ายังเขียนได้
DROP POLICY IF EXISTS quiz_players_write   ON public.quiz_players;
DROP POLICY IF EXISTS quiz_questions_write ON public.quiz_questions;
DROP POLICY IF EXISTS quiz_sessions_write  ON public.quiz_sessions;

REVOKE INSERT, UPDATE, DELETE ON public.quiz_players   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quiz_questions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quiz_sessions  FROM anon, authenticated;

-- อ่านยังต้องได้เหมือนเดิม (กระดานอันดับ / รายการห้อง / ตัวคำถาม)
-- policy *_read ของเดิมยังอยู่ ไม่ได้แตะ


-- ── 2. ตั้งค่าห้องหลังสร้าง (แทน UPDATE ตรงจากแอป) ──────────────────
-- quiz_start_session รับพารามิเตอร์ครบไม่ได้ เพราะการเพิ่มพารามิเตอร์ท้าย
-- ฟังก์ชันที่ GRANT ไว้แล้วต้อง DROP/CREATE ใหม่ทั้งตัว (เหตุผลเดิมใน quizHost.js)
-- จึงแยกเป็นฟังก์ชันตั้งค่าตามหลัง แต่คราวนี้ตรวจ token แทนที่จะเปิด UPDATE ทิ้งไว้
CREATE OR REPLACE FUNCTION public.quiz_set_options(
  p_session_id      uuid,
  p_token           text,
  p_team_mode       boolean DEFAULT NULL,
  p_team_size_limit integer DEFAULT NULL,
  p_stage_theme     text    DEFAULT NULL
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

  IF p_stage_theme IS NOT NULL AND p_stage_theme NOT IN ('day', 'neon') THEN
    RAISE EXCEPTION 'สกินจอเวทีไม่ถูกต้อง';
  END IF;

  -- โหมดทีมเปลี่ยนกลางเกมไม่ได้ — คนที่เข้าทีมไปแล้วจะค้างอยู่กับทีมที่หายไป
  -- ส่วนสกินจอเวทีเปลี่ยนได้ตลอด เป็นแค่เรื่องหน้าตา
  IF (p_team_mode IS NOT NULL OR p_team_size_limit IS NOT NULL)
     AND v_s.state <> 'lobby' THEN
    RAISE EXCEPTION 'เกมเริ่มแล้ว เปลี่ยนโหมดทีมไม่ได้';
  END IF;

  UPDATE public.quiz_sessions
     SET team_mode       = coalesce(p_team_mode, team_mode),
         -- ⚠️ ห้ามใช้ coalesce(greatest(p_team_size_limit, 0), ...) — GREATEST ของ
         --    Postgres ข้าม NULL แล้วคืน 0 ไม่ใช่ NULL ค่าเดิมจะโดนล้างเป็น 0
         team_size_limit = CASE
                             WHEN p_team_size_limit IS NULL THEN team_size_limit
                             ELSE greatest(p_team_size_limit, 0)
                           END,
         stage_theme     = coalesce(p_stage_theme, stage_theme)
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_set_options(uuid, text, boolean, integer, text)
  TO anon, authenticated;


-- ── 3. quiz_reveal — แก้คิดคะแนนซ้ำ + streak ของข้อเดาตัวเลข ────────
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
  v_set_streak boolean;
  r record;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN v_s; END IF;
  -- กดซ้ำ ไม่ให้คิดคะแนนรอบสอง
  -- ⚠️ เดิมเช็คแค่ state = 'reveal' ซึ่งไม่พอ: พอกด "โชว์กระดานอันดับ" ต่อ
  --    state จะกลายเป็น 'scoreboard' แล้วถ้ามีอะไรเรียก quiz_reveal ซ้ำ
  --    (ปุ่มที่ยังค้างบนจออีกเครื่อง / กดย้อน / สั่งซ้ำเพราะ network retry)
  --    คะแนนของข้อนั้นจะถูกบวกเข้ากระดานอีกรอบทั้งห้อง
  --    reveal_payload ถูกล้างเป็น '{}' ทุกครั้งที่ quiz_next เปิดข้อใหม่
  --    จึงใช้เป็นธงว่า "ข้อนี้เฉลยไปแล้วหรือยัง" ได้ตรงกว่า state
  -- ใช้ ->> แทนตัวดำเนินการ ? ของ jsonb เพราะ ? ชนกับ placeholder ของไคลเอนต์
  -- หลายตัว (เผื่อวันหนึ่งไฟล์นี้ถูกรันผ่าน migration tool ไม่ใช่ SQL editor)
  IF (v_s.reveal_payload->>'question_id')::uuid IS NOT DISTINCT FROM v_s.current_question_id THEN
    RETURN v_s;
  END IF;

  SELECT * INTO v_q FROM public.quiz_questions WHERE id = v_s.current_question_id;
  SELECT * INTO v_k FROM public.quiz_keys      WHERE question_id = v_s.current_question_id;
  SELECT streak_bonus INTO v_set_streak FROM public.quiz_sets WHERE id = v_q.set_id;

  -- ลงคะแนนของข้อนี้เข้ากระดานจริง — จุดเดียวในระบบที่คะแนนขยับ
  IF v_q.kind IN ('mcq', 'tf') THEN
    FOR r IN
      SELECT a.id, a.player_id, a.points, a.is_correct, p.streak
        FROM public.quiz_answers a
        JOIN public.quiz_players p ON p.id = a.player_id
       WHERE a.session_id = p_session_id AND a.question_id = v_q.id
    LOOP
      -- ถูกติดกัน 2,3,4,5+ ข้อ → +100,+200,+300,+400 (เพดานที่ 4 กันคะแนนบานปลาย)
      -- คิดตรงนี้ไม่ใช่ตอนส่ง เพราะ streak ของข้อก่อนหน้าเพิ่งลงจริงตอนเฉลยข้อนั้น
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

    -- คนที่ไม่ได้ตอบข้อนี้เลยต้องหลุด streak ด้วย
    -- ไม่งั้นหายไปหนึ่งข้อแล้วกลับมาต่อ streak ได้เหมือนไม่เคยขาด
    UPDATE public.quiz_players p
       SET streak = 0
     WHERE p.session_id = p_session_id
       AND NOT EXISTS (
         SELECT 1 FROM public.quiz_answers a
          WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.player_id = p.id
       );
  END IF;

  IF v_q.kind = 'numeric' THEN
    -- ตัดสิน "ใกล้สุดชนะ" ตอนนี้ เพราะต้องเห็นของทุกคนก่อนถึงจะจัดอันดับได้
    -- เท่ากัน → คนที่ส่งก่อนได้อันดับดีกว่า
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

    -- คนที่ไม่ได้ตอบข้อนี้ต้องหลุด streak ด้วย — สาย mcq/tf ทำอยู่แล้ว
    -- แต่สาย numeric ลืมไป ทำให้ข้ามข้อเดาตัวเลขแล้วยังต่อ streak ได้เหมือนไม่เคยขาด
    -- (ส่งมาแต่ number_value เป็น NULL ก็นับว่าไม่ได้ตอบ — ตรงกับลูปคิดคะแนนข้างบน)
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
  ELSE
    -- นับว่าแต่ละตัวเลือกมีคนกดกี่คน — เอาไปทำกราฟแท่งบนจอใหญ่
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
    'answered',       (SELECT count(*) FROM public.quiz_answers
                        WHERE session_id = p_session_id AND question_id = v_q.id)
  ));

  UPDATE public.quiz_sessions
     SET state = 'reveal', reveal_payload = v_payload
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

COMMIT;

-- ── ตรวจหลังรัน ──────────────────────────────────────────────────────
-- ต้องได้ 0 แถวทั้งสามตาราง (เหลือแต่ SELECT)
--   SELECT table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE grantee IN ('anon','authenticated')
--      AND table_name IN ('quiz_players','quiz_questions','quiz_sessions')
--      AND privilege_type <> 'SELECT';
--
-- ── ย้อนกลับ (ถ้าต้องถอน) ────────────────────────────────────────────
-- BEGIN;
--   GRANT INSERT, UPDATE, DELETE ON public.quiz_players   TO anon, authenticated;
--   GRANT INSERT, UPDATE, DELETE ON public.quiz_questions TO anon, authenticated;
--   GRANT INSERT, UPDATE, DELETE ON public.quiz_sessions  TO anon, authenticated;
--   CREATE POLICY quiz_players_write   ON public.quiz_players   FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY quiz_questions_write ON public.quiz_questions FOR ALL USING (true) WITH CHECK (true);
--   CREATE POLICY quiz_sessions_write  ON public.quiz_sessions  FOR ALL USING (true) WITH CHECK (true);
--   DROP FUNCTION IF EXISTS public.quiz_set_options(uuid, text, boolean, integer, text);
-- COMMIT;
