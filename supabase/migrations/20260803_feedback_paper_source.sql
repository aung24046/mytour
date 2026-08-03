-- =====================================================================
-- แบบประเมินฉบับกระดาษ — รองรับคำตอบที่ไม่ได้มาจากแอป
--
-- ทำไมต้องมี: ลูกทัวร์สูงวัยจำนวนหนึ่งกรอกแบบประเมินผ่านมือถือไม่ไหว
-- ทีมงานจึงพิมพ์ฟอร์มกระดาษแจกแล้วคีย์กลับเข้าระบบทีหลัง ถ้าไม่แยกที่มา
-- จะไม่มีทางรู้ว่าคะแนนเฉลี่ยมาจากคนใช้แอปอย่างเดียวหรือรวมกระดาษด้วย
--
-- ปัญหาที่ต้องแก้พร้อมกัน: guest_form_responses มี UNIQUE (guest_id, field_id)
-- และ guest_id เป็น NULL ได้ ใบกระดาษที่ไม่ระบุชื่อจึงลงเป็น guest_id = NULL
-- ซึ่ง Postgres ถือว่า NULL ไม่ชนกัน → ลงได้หลายใบ (ดี) แต่ผลข้างเคียงคือ
-- คำตอบของใบเดียวกันไม่มีอะไรผูกไว้ด้วยกันเลย นับจำนวนผู้ตอบก็เพี้ยน
-- (Set ของ NULL เหลือ 1) จึงต้องมีเลขที่ใบเป็นตัวจับกลุ่ม
-- =====================================================================

BEGIN;

ALTER TABLE public.guest_form_responses
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS paper_slip_no text;

-- ค่าที่ยอมรับ: app = ลูกทัวร์กรอกเอง, paper = ทีมงานคีย์จากใบกระดาษ
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.guest_form_responses'::regclass
      AND conname = 'guest_form_responses_source_check'
  ) THEN
    ALTER TABLE public.guest_form_responses
      ADD CONSTRAINT guest_form_responses_source_check
      CHECK (source IN ('app', 'paper'));
  END IF;
END $$;

-- เลขที่ใบเป็นของคำตอบที่มาจากกระดาษเท่านั้น กันไม่ให้ฝั่งแอปมีเลขติดมาเงียบ ๆ
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.guest_form_responses'::regclass
      AND conname = 'guest_form_responses_slip_source_check'
  ) THEN
    ALTER TABLE public.guest_form_responses
      ADD CONSTRAINT guest_form_responses_slip_source_check
      CHECK (paper_slip_no IS NULL OR source = 'paper');
  END IF;
END $$;

-- คีย์ใบเดิมซ้ำสองรอบเป็นความผิดพลาดที่เกิดง่ายมากตอนนั่งคีย์ทีละ 40 ใบ
-- ล็อกไว้ที่ระดับฐานข้อมูล: หนึ่งใบตอบหนึ่งคำถามได้ครั้งเดียว
CREATE UNIQUE INDEX IF NOT EXISTS guest_form_responses_slip_field_uniq
  ON public.guest_form_responses (paper_slip_no, field_id)
  WHERE paper_slip_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS guest_form_responses_source_idx
  ON public.guest_form_responses (source);

COMMENT ON COLUMN public.guest_form_responses.source IS
  'ที่มาของคำตอบ: app = ลูกทัวร์กรอกในแอป, paper = ทีมงานคีย์จากแบบประเมินกระดาษ';
COMMENT ON COLUMN public.guest_form_responses.paper_slip_no IS
  'เลขที่ใบกระดาษ — ใช้จับกลุ่มคำตอบของใบเดียวกันเมื่อผู้ตอบไม่ระบุชื่อ (guest_id = NULL)';

COMMIT;
