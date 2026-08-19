-- ═══════════════════════════════════════════════════════════════════════
-- ควิซ: สกินจอเวที — เปลี่ยนค่าเริ่มต้นและจำกัดให้เหลือสองแบบ
-- ═══════════════════════════════════════════════════════════════════════
-- คอลัมน์ stage_theme มีอยู่แล้วตั้งแต่ 20260818_quiz.sql แต่ตอนนั้นก๊อป
-- ค่าเริ่มต้น 'led' มาจาก draw_rooms ทั้งที่หน้าควิซไม่เคยอ่านค่านี้เลย
-- (จอเวทีควิซ hardcode พื้นดำไว้ตรงๆ) migration นี้ทำให้คอลัมน์มีความหมายจริง
--
-- สองสกินที่เหลือ — เคยร่างไว้สามแบบแล้วตัด "ตั๋วกระดาษ" ทิ้ง เพราะจอเวที
-- พื้นสว่างในห้องจัดเลี้ยงที่ปิดไฟจะแยงตาคนแถวหน้า และเคสจอกลางแดด
-- ถูกจัดการด้วยแกน screen_mode = 'bus_tv' อยู่แล้ว ไม่ใช่แกนสกิน
--   day  : ค่าเริ่มต้น พื้นเข้มไล่เฉด ตัวเลือกทึบ ฟอนต์ Noto Sans Thai Looped
--   neon : งานเลี้ยงกลางคืน ตัวเลือกเป็นกรอบเรืองแสงพื้นโปร่ง
--
-- ห้องเก่าที่ค้างค่า 'led' (หรือค่าอื่นจาก draw_rooms) ย้ายไป 'neon' เพราะ
-- ใกล้เคียงของเดิมที่สุด — จอควิซแบบเก่าเป็นพื้นดำ ตัวหนังสือขาว

ALTER TABLE public.quiz_sessions ALTER COLUMN stage_theme SET DEFAULT 'day';

UPDATE public.quiz_sessions
SET stage_theme = 'neon'
WHERE stage_theme IS NULL OR stage_theme NOT IN ('day', 'neon');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sessions_stage_theme_check') THEN
    ALTER TABLE public.quiz_sessions DROP CONSTRAINT quiz_sessions_stage_theme_check;
  END IF;

  ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_stage_theme_check
    CHECK (stage_theme IN ('day', 'neon'));
END $$;

COMMENT ON COLUMN public.quiz_sessions.stage_theme IS
  'สกินจอเวที: day (ค่าเริ่มต้น) หรือ neon — คนละแกนกับ screen_mode ซึ่งบอกขนาดจอ';
