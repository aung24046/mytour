-- ประกาศด่วน: ยอดคนเปิดอ่าน + ข้อความลัด
--
-- 1) announcement_reads   — ใครเปิดอ่านประกาศไหนแล้ว (ฝั่งลูกทัวร์บันทึกตอนแบนเนอร์ถูกแสดง)
-- 2) announcement_templates — ข้อความลัดของบริษัท ใช้ซ้ำได้ทุกทริป (ข้อความล้วน ไม่มีตัวแปร)
--
-- RLS: ตามแบบเดียวกับตารางอื่นในโปรเจกต์ (เปิดกว้าง — การป้องกันจริงอยู่ที่ชั้นแอป)

BEGIN;

-- ── 1. ยอดคนเปิดอ่าน ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcement_reads (
  announcement_id uuid NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  guest_id        uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  -- คนหนึ่งอ่านประกาศหนึ่งได้ครั้งเดียว — ให้ upsert ซ้ำได้โดยไม่ต้องเช็คก่อน
  PRIMARY KEY (announcement_id, guest_id)
);

-- นับ "อ่านแล้วกี่คน" ของประกาศหนึ่ง = สแกนด้วย PK ได้อยู่แล้ว
-- แต่หน้าประวัติถามย้อนจาก guest ด้วย จึงต้องมี index อีกทาง
CREATE INDEX IF NOT EXISTS announcement_reads_guest_idx
  ON public.announcement_reads (guest_id);

ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcement_reads_read ON public.announcement_reads;
CREATE POLICY announcement_reads_read ON public.announcement_reads FOR SELECT USING (true);

DROP POLICY IF EXISTS announcement_reads_write ON public.announcement_reads;
CREATE POLICY announcement_reads_write ON public.announcement_reads FOR ALL USING (true);

GRANT SELECT, INSERT ON public.announcement_reads TO anon, authenticated;


-- ── 2. ข้อความลัด ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcement_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  text       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcement_templates_org_idx
  ON public.announcement_templates (org_id, sort_order);

ALTER TABLE public.announcement_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcement_templates_read ON public.announcement_templates;
CREATE POLICY announcement_templates_read ON public.announcement_templates FOR SELECT USING (true);

DROP POLICY IF EXISTS announcement_templates_write ON public.announcement_templates;
CREATE POLICY announcement_templates_write ON public.announcement_templates FOR ALL USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcement_templates TO anon, authenticated;


-- ── 3. ข้อความลัดตั้งต้นให้ทุกบริษัทที่ยังไม่มี ─────────────────────
-- ถ้าเปิดหน้ามาแล้วว่างเปล่า ผู้ใช้จะไม่รู้ว่าช่องนี้มีไว้ทำอะไร
INSERT INTO public.announcement_templates (org_id, text, sort_order)
SELECT o.id, v.text, v.sort_order
FROM public.organizations o
CROSS JOIN (VALUES
  ('รวมพลอีก 5 นาทีนะครับ', 1),
  ('ขึ้นรถได้เลยครับ รถจอดที่เดิม', 2),
  ('ถึงเวลาอาหารแล้วครับ', 3),
  ('เดี๋ยวเจอกันที่จุดเดิมนะครับ', 4)
) AS v(text, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.announcement_templates x WHERE x.org_id = o.id
);

COMMIT;

-- rollback:
-- DROP TABLE IF EXISTS public.announcement_reads;
-- DROP TABLE IF EXISTS public.announcement_templates;
