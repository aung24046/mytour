-- =====================================================================
-- ควิซ เฟส 4 — คลังชุดคำถาม + รายงานหลังเกม — 18 ส.ค. 2026
-- =====================================================================
-- ต่อจาก 20260818_quiz.sql และ 20260818_quiz_teams.sql
--
-- 2 เรื่องในไฟล์เดียว เพราะทั้งคู่ติดกำแพงเดียวกัน:
-- ตารางที่ต้องอ่าน (quiz_keys, quiz_answers) ปิดสนิทจาก anon
-- จึงต้องเข้าทาง SECURITY DEFINER + ตรวจ PIN ทีมงานเหมือน quiz_set_for_edit
--
-- 1. quiz_clone_set  — ก็อปชุดคำถามทั้งชุดพร้อมเฉลย
--    ทำไมต้องมี: คลังชุดคำถามออกแบบให้ใช้ซ้ำข้ามทริป (Design v2 — Definition ↔ Assignment)
--    แต่บางทีอยากได้ "ชุดญี่ปุ่นแบบง่าย" ที่แยกจาก "ชุดญี่ปุ่น" เดิม
--    ถ้าไม่มี clone สตาฟต้องพิมพ์ใหม่ทั้ง 20 ข้อ ซึ่งไม่มีใครทำ แล้วจบลงที่แก้ของเดิมทับ
--    → ทริปที่กำลังใช้ชุดนั้นอยู่โดนกระทบไปด้วย
--
-- 2. quiz_report     — สรุปหลังเกม
--    ทำไมต้องมี: ค่าของควิซไม่ได้จบตอนเกมจบ — ทีมงานอยากรู้ว่าข้อไหนยากเกินไป
--    ข้อไหนง่ายจนไม่มีความหมาย เพื่อแก้ชุดก่อนเอาไปใช้กรุ๊ปหน้า
--    ข้อมูลนี้อยู่ใน quiz_answers ซึ่ง anon อ่านไม่ได้ (ตั้งใจ ดูเฟส 1)
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- =====================================================================

BEGIN;

-- ── 1. ก็อปชุดคำถามทั้งชุด ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_clone_set(
  p_staff_id uuid,
  p_pin      text,
  p_set_id   uuid,
  p_title    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_src public.quiz_sets;
  v_q   public.quiz_questions;
  v_new uuid;
  v_new_qid uuid;
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  SELECT * INTO v_src FROM public.quiz_sets WHERE id = p_set_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบชุดคำถาม'; END IF;

  INSERT INTO public.quiz_sets
    (org_id, destination_id, title, description, lang, cover_url,
     default_time_limit, streak_bonus, created_by)
  VALUES
    (v_src.org_id, v_src.destination_id,
     coalesce(nullif(btrim(p_title), ''), v_src.title || ' (สำเนา)'),
     v_src.description, v_src.lang, v_src.cover_url,
     v_src.default_time_limit, v_src.streak_bonus, p_staff_id)
  RETURNING id INTO v_new;

  -- ก็อปทีละข้อด้วยลูป ไม่ใช่ INSERT ... SELECT ก้อนเดียว
  --
  -- เคยเขียนเป็น CTE ที่จับคู่ข้อเก่า-ข้อใหม่ด้วย row_number() แล้วพบว่าเปราะ:
  -- ถ้าสองข้อมี sort_order เท่ากัน (เกิดได้ เพราะ reorder ไม่ได้บังคับให้ไม่ซ้ำ)
  -- ลำดับของฝั่ง source กับฝั่ง RETURNING ไม่จำเป็นต้องตรงกัน
  -- ผลคือ "เฉลยสลับข้อ" ซึ่งเป็นบั๊กที่ไม่มีใครสังเกตจนกว่าจะเล่นจริงหน้างาน
  -- ลูปช้ากว่าเล็กน้อย แต่จับคู่ถูกแน่นอนเพราะรู้ทั้ง id เก่าและ id ใหม่ในรอบเดียวกัน
  FOR v_q IN
    SELECT * FROM public.quiz_questions
     WHERE set_id = p_set_id
     ORDER BY sort_order, created_at
  LOOP
    INSERT INTO public.quiz_questions
      (set_id, sort_order, kind, text, media_url, media_kind, options,
       numeric_unit, time_limit_sec, points_factor)
    VALUES
      (v_new, v_q.sort_order, v_q.kind, v_q.text, v_q.media_url, v_q.media_kind,
       v_q.options, v_q.numeric_unit, v_q.time_limit_sec, v_q.points_factor)
    RETURNING id INTO v_new_qid;

    INSERT INTO public.quiz_keys (question_id, correct_index, correct_number, explain)
    SELECT v_new_qid, k.correct_index, k.correct_number, k.explain
      FROM public.quiz_keys k
     WHERE k.question_id = v_q.id;
  END LOOP;

  RETURN v_new;
END $fn$;


-- ── 2. สรุปหลังเกม รายข้อ ───────────────────────────────────────────
-- ตัวเลขที่ทีมงานเอาไปใช้ตัดสินใจจริงคือ correct_rate:
--   สูงเกิน ~90% = ข้อง่ายจนไม่มีใครแพ้ใคร ไม่ได้คัดอะไรเลย
--   ต่ำกว่า ~20% = ข้อยากเกินหรือคำถามกำกวม คนเดามั่วกันหมด
-- ทั้งสองแบบควรแก้ก่อนเอาชุดนี้ไปใช้กรุ๊ปหน้า
CREATE OR REPLACE FUNCTION public.quiz_report(
  p_session_id uuid, p_staff_id uuid, p_pin text
)
RETURNS TABLE (
  question_id   uuid,
  sort_order    integer,
  kind          text,
  question_text text,
  answered      integer,
  correct       integer,
  correct_rate  integer,
  avg_seconds   numeric,
  correct_index integer,
  correct_number numeric,
  option_counts jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  RETURN QUERY
    SELECT
      q.id,
      q.sort_order,
      q.kind,
      q.text,
      count(a.id)::integer,
      count(a.id) FILTER (WHERE a.is_correct)::integer,
      -- ไม่มีคนตอบเลย → 0 ไม่ใช่ NULL หน้าจอจะได้ไม่ต้องเช็คซ้ำ
      CASE WHEN count(a.id) = 0 THEN 0
           ELSE round(100.0 * count(a.id) FILTER (WHERE a.is_correct) / count(a.id))::integer
      END,
      round(coalesce(avg(a.elapsed_ms), 0) / 1000.0, 1),
      k.correct_index,
      k.correct_number,
      (SELECT jsonb_object_agg(x.choice_index::text, x.n)
         FROM (SELECT a2.choice_index, count(*) AS n
                 FROM public.quiz_answers a2
                WHERE a2.session_id = p_session_id
                  AND a2.question_id = q.id
                  AND a2.choice_index IS NOT NULL
                GROUP BY a2.choice_index) x)
      FROM public.quiz_questions q
      JOIN public.quiz_sessions s ON s.id = p_session_id AND s.set_id = q.set_id
      LEFT JOIN public.quiz_keys k ON k.question_id = q.id
      LEFT JOIN public.quiz_answers a
        ON a.question_id = q.id AND a.session_id = p_session_id
     GROUP BY q.id, q.sort_order, q.kind, q.text, k.correct_index, k.correct_number
     ORDER BY q.sort_order;
END $fn$;


-- ── 3. สิทธิ์เรียกฟังก์ชัน ──────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.quiz_clone_set(uuid, text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_report(uuid, uuid, text)          TO anon, authenticated;

COMMIT;

-- ── ย้อนกลับ (ถ้าต้องถอน) ────────────────────────────────────────────
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.quiz_report(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.quiz_clone_set(uuid, text, uuid, text);
-- COMMIT;
