-- =====================================================================
-- ข้อความคงที่บนแบบประเมินฉบับกระดาษ — ย้ายจากโค้ดมาไว้ที่ organizations
--
-- ทำไมอยู่ที่ระดับบริษัท ไม่ใช่ระดับทริป: ข้อความพวกนี้เป็นน้ำเสียงและ
-- ข้อผูกพันทางกฎหมายของบริษัท (คำขอความยินยอม, หมายเหตุ PDPA) ไม่ใช่
-- รายละเอียดของทริปใดทริปหนึ่ง ตั้งครั้งเดียวแล้วใช้ได้ทุกทริป
-- เข้าชุดกับ doc_footer_note ที่ทำแบบเดียวกันอยู่แล้ว
--
-- ⚠️ ทุกคอลัมน์เป็น NULL ได้โดยตั้งใจ — ฝั่งแอปมีค่าตั้งต้นอยู่ที่
-- src/lib/feedbackFormText.js และจะ fallback ให้เมื่อค่าว่าง
-- เหตุผล: ถ้าบังคับ NOT NULL แล้วแอดมินลบข้อความจนเหลือช่องว่าง
-- ฟอร์มจะพิมพ์ออกมาโดยไม่มีข้อความ PDPA ซึ่งทำให้ความเห็นที่เก็บมา
-- เอาไปเผยแพร่ไม่ได้ตามกฎหมาย การ fallback ในโค้ดกันได้ทุกกรณี
-- รวมถึงองค์กรที่สร้างก่อน migration นี้
-- =====================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS feedback_form_title    text,
  ADD COLUMN IF NOT EXISTS feedback_form_intro    text,
  ADD COLUMN IF NOT EXISTS feedback_rating_heading text,
  ADD COLUMN IF NOT EXISTS feedback_rating_legend text,
  ADD COLUMN IF NOT EXISTS feedback_consent_text  text,
  ADD COLUMN IF NOT EXISTS feedback_pdpa_note     text,
  ADD COLUMN IF NOT EXISTS feedback_thanks_note   text;

-- สวิตช์ซ่อนกล่องยินยอม/PDPA ทั้งก้อน — บางบริษัทเก็บความยินยอมด้วยวิธีอื่นอยู่แล้ว
-- (เช่นในสัญญาตอนจอง) จึงไม่อยากให้ซ้ำบนกระดาษ ค่าตั้งต้นคือแสดงเสมอ
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS feedback_show_consent boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.feedback_show_consent IS
  'แสดงกล่องขอความยินยอมเผยแพร่ + หมายเหตุ PDPA บนแบบประเมินกระดาษหรือไม่ (ค่าตั้งต้น = แสดง)';

COMMENT ON COLUMN public.organizations.feedback_form_title IS
  'หัวเรื่องบนแบบประเมินกระดาษ — ว่าง = ใช้ค่าตั้งต้นใน feedbackFormText.js';
COMMENT ON COLUMN public.organizations.feedback_pdpa_note IS
  'หมายเหตุ PDPA ใต้ข้อความยินยอม — ว่าง = ใช้ค่าตั้งต้น ห้ามพิมพ์ฟอร์มโดยไม่มีข้อความนี้';
