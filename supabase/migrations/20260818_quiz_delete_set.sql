-- =====================================================================
-- ควิซ — ลบชุดคำถาม — 18 ส.ค. 2026
-- =====================================================================
-- ต่อจาก 20260818_quiz_library.sql
--
-- ทำไมต้องเป็น RPC ไม่ใช่ DELETE ตรงจากแอป:
--   1. ต้องตรวจ PIN — การลบชุดกระทบทุกทริปที่หยิบชุดนี้ไปใช้ ไม่ใช่แค่ทริปที่กำลังเปิดอยู่
--   2. ต้องบอกกลับให้ชัดว่า "ลบไม่ได้เพราะเคยเล่นไปแล้ว" ซึ่งเป็นคนละเรื่องกับ "ลบไม่สำเร็จ"
--   3. ต้องคืนรายชื่อไฟล์สื่อในถัง quiz-media ให้ฝั่งแอปไปลบตาม
--      ไม่งั้นรูปกลายเป็นไฟล์กำพร้าที่ไม่มีใครรู้ว่ามีอยู่ แล้วกินโควตา Storage ไปเรื่อยๆ
--
-- ⚠️ กติกาสำคัญ: ชุดที่ "เคยเปิดห้องเล่นไปแล้ว" ลบไม่ได้
--    quiz_sessions.set_id เป็น ON DELETE RESTRICT ตั้งแต่เฟส 1 โดยตั้งใจ
--    ถ้าลบได้ รายงานหลังเกมของทริปเก่าจะพังทันที (ไม่รู้ว่าคำถามคืออะไร)
--    → ทางที่ถูกคือ "เก็บเข้ากรุ" (is_archived) ซึ่งซ่อนจากรายการแต่ประวัติยังอยู่ครบ
--
-- idempotent รันซ้ำได้
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.quiz_delete_set(
  p_staff_id uuid, p_pin text, p_set_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_sessions integer;
  v_media    text[];
  v_title    text;
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  SELECT title INTO v_title FROM public.quiz_sets WHERE id = p_set_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- เคยเปิดห้องเล่นไปแล้วหรือยัง (นับรวมห้องที่จบไปแล้วด้วย เพราะรายงานยังต้องใช้)
  SELECT count(*) INTO v_sessions FROM public.quiz_sessions WHERE set_id = p_set_id;
  IF v_sessions > 0 THEN
    -- ไม่ raise เพราะนี่ไม่ใช่ error — เป็นคำตอบที่ฝั่งแอปต้องเอาไปเสนอทางเลือก
    -- "เก็บเข้ากรุแทนไหม" ให้ผู้ใช้ ถ้า raise ไปจะกลายเป็นข้อความแดงๆ ที่ทำอะไรต่อไม่ได้
    RETURN jsonb_build_object('status', 'in_use', 'sessions', v_sessions, 'title', v_title);
  END IF;

  -- เก็บ path ของสื่อไว้ก่อนลบ — หลังลบแถวแล้วจะตามหาไม่เจออีก
  SELECT array_agg(media_url) INTO v_media
    FROM public.quiz_questions
   WHERE set_id = p_set_id AND media_url IS NOT NULL;

  -- quiz_questions → quiz_keys ตามไปเองด้วย ON DELETE CASCADE
  DELETE FROM public.quiz_sets WHERE id = p_set_id;

  RETURN jsonb_build_object(
    'status', 'deleted',
    'title', v_title,
    'media', coalesce(to_jsonb(v_media), '[]'::jsonb)
  );
END $fn$;

GRANT EXECUTE ON FUNCTION public.quiz_delete_set(uuid, text, uuid) TO anon, authenticated;

COMMIT;

-- ── ย้อนกลับ (ถ้าต้องถอน) ────────────────────────────────────────────
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.quiz_delete_set(uuid, text, uuid);
-- COMMIT;
