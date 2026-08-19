-- =====================================================================
-- ประกาศ: แนบจุดนัดพบ — 19 ส.ค. 2026
-- =====================================================================
-- ปัญหาที่แก้: ตอนปล่อยลูกทัวร์เดินเองในสถานที่ใหญ่ (สวนนงนุช ตลาด ห้าง)
-- จุดนัดพบถูก "พูดปากเปล่า" ครั้งเดียวก่อนแยกย้าย ไม่มีหลักฐานให้กลับไปดู
-- ลูกทัวร์ที่จำไม่ได้ก็ไม่กล้าถาม เดินวนหา แล้วมาสาย
--
-- ทำไมอยู่ที่ประกาศ ไม่ใช่ที่กำหนดการ:
--   จุดนัดพบถูกตกลงกันสดหน้างานเสมอ ไม่เคยวางแผนล่วงหน้า
--   ถ้าไปฝังใน itinerary จะเรียกร้องให้กรอกตั้งแต่ตอนวางแผน ซึ่งขัดกับวิธีทำงานจริง
--   ส่วนประกาศเป็นของที่ทีมงานใช้สดอยู่แล้ว หมุดจึงควรเกาะไปกับมัน
--
-- ⚠️ meet_time เก็บเป็น text 'HH:MM' ไม่ใช่ timestamptz โดยตั้งใจ
--    ตามแบบเดียวกับเวลาเช็คอิน/เช็คเอาต์โรงแรม (ดู lib/timeFormat.js)
--    เหตุผล: ทริปต่างประเทศ เครื่องทีมงานกับลูกทัวร์ตั้งโซนเวลาตามเครือข่ายท้องถิ่น
--    เหมือนกันอยู่แล้ว การเก็บ 'HH:MM' จึงตรงกันเสมอและอ่านออกด้วยตาโดยไม่ต้องแปลง
--    ส่วน timestamptz จะเปิดช่องให้เกิดคำถามว่า "15:00 ของโซนไหน" ซึ่งไม่มีใครอยากตอบหน้างาน
--
-- idempotent รันซ้ำได้
-- =====================================================================

BEGIN;

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS meet_lat   double precision,
  ADD COLUMN IF NOT EXISTS meet_lng   double precision,
  ADD COLUMN IF NOT EXISTS meet_label text,
  ADD COLUMN IF NOT EXISTS meet_time  text;

DO $$
BEGIN
  -- ต้องมีทั้งคู่หรือไม่มีเลย — พิกัดครึ่งเดียวเปิดแผนที่ไม่ได้ และจะไปโผล่เป็นหมุดที่เส้นศูนย์สูตร
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_meet_latlng_check') THEN
    ALTER TABLE public.announcements ADD CONSTRAINT announcements_meet_latlng_check
      CHECK (num_nonnulls(meet_lat, meet_lng) <> 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_meet_range_check') THEN
    ALTER TABLE public.announcements ADD CONSTRAINT announcements_meet_range_check
      CHECK (
        (meet_lat IS NULL OR meet_lat BETWEEN -90 AND 90) AND
        (meet_lng IS NULL OR meet_lng BETWEEN -180 AND 180)
      );
  END IF;

  -- กันค่าเพี้ยนแบบ '3 โมง' ที่ <input type="time"> โหลดกลับมาไม่ได้แล้วหายเงียบ
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_meet_time_check') THEN
    ALTER TABLE public.announcements ADD CONSTRAINT announcements_meet_time_check
      CHECK (meet_time IS NULL OR meet_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;

COMMENT ON COLUMN public.announcements.meet_lat   IS 'พิกัดจุดนัดพบ — ปักจาก GPS เครื่องทีมงาน หรือแกะจากลิงก์ Google Maps';
COMMENT ON COLUMN public.announcements.meet_label IS 'ชื่อจุดนัดพบที่คนอ่านเข้าใจ เช่น "ประตู 3 ชั้น G ข้างร้านกาแฟ"';
COMMENT ON COLUMN public.announcements.meet_time  IS 'เวลารวมพล รูปแบบ HH:MM 24 ชม. (เวลาท้องถิ่น) — ฝั่งแอปใช้ทำนับถอยหลัง';

COMMIT;

-- ── ตรวจหลังรัน ──────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'announcements' AND column_name LIKE 'meet%';
--
-- ── ย้อนกลับ ─────────────────────────────────────────────────────────
-- BEGIN;
--   ALTER TABLE public.announcements
--     DROP COLUMN IF EXISTS meet_lat, DROP COLUMN IF EXISTS meet_lng,
--     DROP COLUMN IF EXISTS meet_label, DROP COLUMN IF EXISTS meet_time;
-- COMMIT;
