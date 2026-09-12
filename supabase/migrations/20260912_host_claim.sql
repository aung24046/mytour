-- ═══════════════════════════════════════════════════════════════════════
-- ขอสิทธิ์คุมห้องด้วย PIN — quiz_claim_host · 12 ก.ย. 2026
-- ═══════════════════════════════════════════════════════════════════════
-- ต่อจาก 20260912_word_shuffle.sql
--
-- ปัญหาหน้างาน (เจ้าของโปรเจกต์เจอตอนเล่นจริง):
--   "เครื่องนี้ไม่มีสิทธิ์คุมห้องนี้ ทั้งๆ ที่ผมเป็นคนเปิด — เอาแค่ใส่รหัสผ่านก็พอ"
--
-- สาเหตุ: token ของห้องออกครั้งเดียวตอนสร้างห้องแล้วเก็บใน localStorage ของ "เครื่องนั้น"
--   เปลี่ยนเครื่อง · เปลี่ยนเบราว์เซอร์ · โหมดส่วนตัว · ล้างแคช · มือถือแบตหมดแล้วยืมเครื่องเพื่อน
--   = คุมห้องที่ตัวเองเปิดไม่ได้ ต้องเปิดห้องใหม่ทิ้งคะแนนเดิมทั้งห้อง
--
-- ทางแก้: ให้ขอ token เดิมของห้องคืนได้ด้วย PIN ทีมงาน (ตัวเดียวกับที่ใช้แก้ชุดคำถาม)
--   · ตรวจ PIN ด้วย quiz_check_staff เหมือน RPC ฝั่งสร้างข้อทุกตัว
--   · ตรวจด้วยว่าห้องนั้นอยู่ในองค์กรเดียวกับสตาฟคนนั้น (หรือถูก assign ในทริปนั้น)
--     PIN อย่างเดียวไม่พอ — ไม่งั้นสตาฟบริษัทอื่นที่รู้ PIN ตัวเองจะคุมห้องของบริษัทเราได้
--   · คืน token "ตัวเดิม" ไม่ออกใหม่ — จอใหญ่ที่เปิดค้างไว้ด้วย #t= เดิมจึงยังทำงานต่อ
--
-- idempotent รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.quiz_claim_host(p_session_id uuid, p_staff_id uuid, p_pin text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_token text; v_ok boolean;
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.quiz_sessions s
      JOIN public.tours t ON t.id = s.tour_id
      JOIN public.staff st ON st.id = p_staff_id
     WHERE s.id = p_session_id
       AND coalesce(st.is_active, true) = true
       AND (
         st.org_id = t.org_id
         OR EXISTS (
           SELECT 1 FROM public.tour_staff ts
            WHERE ts.staff_id = st.id AND ts.tour_id = s.tour_id AND ts.is_active = true
         )
       )
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'ห้องนี้ไม่ได้อยู่ในทริปของคุณ';
  END IF;

  SELECT token INTO v_token FROM public.quiz_session_tokens WHERE session_id = p_session_id LIMIT 1;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'ไม่พบห้องนี้';
  END IF;

  RETURN v_token;
END $fn$;

REVOKE ALL ON FUNCTION public.quiz_claim_host(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quiz_claim_host(uuid, uuid, text) TO anon, authenticated;

COMMIT;
