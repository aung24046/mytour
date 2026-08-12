-- =====================================================================
-- SOS — ปุ่มโทรด่วน 4 เบอร์ (ตั้งค่าได้จากฝั่งทีมงาน)
-- ส.ค. 2569
--
-- หน้า SOS ฝั่งลูกทัวร์มีปุ่มโทรด่วน 4 ปุ่มอยู่ใต้ปุ่มกดค้าง เดิมเลือกให้
-- อัตโนมัติตามลำดับหมวด (ไกด์ก่อน) ซึ่งเดาใจทีมงานไม่ได้ — บางทริปอยาก
-- ให้เบอร์รถบัสหรือ รพ. คู่สัญญาขึ้นก่อนเบอร์ราชการ
--
-- เพิ่มธงปักหมุดไว้ที่ "ตารางเชื่อม" ทั้งสองฝั่ง ไม่ใช่ที่ตารางคลัง
-- เพราะเบอร์ชุดเดียวกันถูกใช้ข้ามทริป — แต่ละทริปต้องปักหมุดต่างกันได้
--
-- ค่าเริ่มต้นเป็น false ทั้งหมด และฝั่งลูกทัวร์ถูกเขียนให้ fallback ไป
-- ใช้ลำดับหมวดแบบเดิมเมื่อยังไม่มีใครปักหมุด → ทริปเก่าไม่ต้องแก้อะไร
--
-- ⚠️ clone_tour / clone_tour_assignments ยังไม่ก๊อป is_quick — ทริปที่ปั๊มจาก
--    ทริปเก่าจะกลับไปใช้ค่า fallback จนกว่าจะปักหมุดใหม่ จงใจไม่แก้สองฟังก์ชัน
--    นั้นเพราะมันเป็น SECURITY DEFINER ก้อนใหญ่ และชุดเบอร์ด่วนมักผูกกับ
--    "ทริปนั้น" (คนละไกด์ คนละ รพ. คู่สัญญา) อยู่แล้ว ถ้าวันหนึ่งพบว่าทีมงาน
--    ต้องมานั่งปักซ้ำทุกครั้ง ค่อยเติมคอลัมน์นี้เข้าไปในสอง INSERT นั้น
-- =====================================================================

ALTER TABLE public.tour_emergency_contacts
  ADD COLUMN IF NOT EXISTS is_quick boolean NOT NULL DEFAULT false;

ALTER TABLE public.tour_staff
  ADD COLUMN IF NOT EXISTS is_quick boolean NOT NULL DEFAULT false;

-- ค้นหาเบอร์ที่ปักหมุดของทริปหนึ่ง ๆ — แถวที่ปักมีไม่เกิน 4 ต่อทริป
-- จึงทำ partial index เฉพาะ true ให้ index เล็กที่สุด
CREATE INDEX IF NOT EXISTS tour_emergency_quick_idx
  ON public.tour_emergency_contacts (tour_id) WHERE is_quick;
CREATE INDEX IF NOT EXISTS tour_staff_quick_idx
  ON public.tour_staff (tour_id) WHERE is_quick;


-- ── View ────────────────────────────────────────────────────────────
-- ⚠️ CREATE OR REPLACE VIEW เพิ่มคอลัมน์กลางลำดับไม่ได้ — ต่อท้ายเท่านั้น
--    ถ้าวันหนึ่งอยากเรียงใหม่ ต้อง DROP แล้วสร้างใหม่ (กระทบ GRANT ด้วย)
CREATE OR REPLACE VIEW public.v_tour_emergency_contacts AS
SELECT
  j.tour_id, e.id, j.id AS assignment_id,
  e.label, e.phone, e.category,
  j.is_active, j.sort_order,
  j.is_quick
FROM public.tour_emergency_contacts j
JOIN public.emergency_contacts e ON e.id = j.contact_id;

CREATE OR REPLACE VIEW public.v_tour_staff
WITH (security_invoker = true) AS
SELECT
  ts.tour_id,
  s.id  AS id,
  ts.id AS assignment_id,
  s.org_id,
  s.name,
  s.phone,
  ts.role,
  ts.job_title, -- ⚠️ มีอยู่จริงบน production แต่ไม่มีในไฟล์ migration เดิม
  ts.auth_pin,
  ts.guest_id,
  ts.show_to_guest,
  ts.is_default,
  ts.is_active,
  s.org_role,
  g.name     AS guest_name,
  g.nickname AS guest_nickname,
  g.phone    AS guest_phone,
  ts.is_quick
FROM public.tour_staff ts
JOIN public.staff s ON s.id = ts.staff_id
LEFT JOIN public.guests g ON g.id = ts.guest_id;

GRANT SELECT ON public.v_tour_emergency_contacts, public.v_tour_staff TO anon, authenticated;
