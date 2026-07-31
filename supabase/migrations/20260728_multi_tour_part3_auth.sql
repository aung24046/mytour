-- =====================================================================
-- MyTour — Multi-Tour Part 3: RPC สำหรับ login แบบหลายทริป
-- รันหลัง part 1 (และ part 2 จะรันก่อนหรือหลังก็ได้)
--
-- ของเดิม: verify_staff_pin(p_staff_id, p_pin) — PIN อยู่บน staff
-- ของใหม่: PIN ย้ายไปอยู่บน tour_staff (คนเดียวมี PIN ต่างกันได้ต่อทริป)
--
-- ⚠️ ไม่ลบ verify_staff_pin เดิม — เผื่อ rollback ฝั่งโค้ด
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tour_staff') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20260728_multi_tour.sql (part 1) ก่อน';
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- 1) รายชื่อทริปที่เปิดให้ login (แสดงบนหน้า /staff/login)
--    เผยแค่ชื่อ+รหัส ไม่มีข้อมูลลูกทัวร์
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_active_tours()
RETURNS TABLE (id uuid, name text, join_code text, starts_on date, ends_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT t.id, t.name, t.join_code, t.starts_on, t.ends_on
  FROM public.tours t
  WHERE t.status = 'active' AND t.is_template = false
  ORDER BY coalesce(t.starts_on, '9999-12-31'::date), t.name;
$fn$;


-- ---------------------------------------------------------------------
-- 2) รายชื่อทีมงานของทริปหนึ่ง (ไม่คืน PIN)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_tour_staff(p_tour_id uuid)
RETURNS TABLE (staff_id uuid, name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT s.id, s.name, ts.role
  FROM public.tour_staff ts
  JOIN public.staff s ON s.id = ts.staff_id
  WHERE ts.tour_id = p_tour_id
    AND ts.is_active = true
    AND coalesce(s.is_active, true) = true
  ORDER BY s.name;
$fn$;


-- ---------------------------------------------------------------------
-- 3) ตรวจ PIN ของทีมงานในทริป → คืนข้อมูลพอสร้าง session
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_tour_staff_pin(
  p_tour_id  uuid,
  p_staff_id uuid,
  p_pin      text
)
RETURNS TABLE (
  staff_id uuid, name text, phone text, org_id uuid,
  org_role text, tour_id uuid, role text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT s.id, s.name, s.phone, s.org_id, s.org_role, ts.tour_id, ts.role
  FROM public.tour_staff ts
  JOIN public.staff s ON s.id = ts.staff_id
  WHERE ts.tour_id  = p_tour_id
    AND ts.staff_id = p_staff_id
    AND ts.auth_pin = btrim(p_pin)
    AND ts.is_active = true
    AND coalesce(s.is_active, true) = true
  LIMIT 1;
$fn$;


-- ---------------------------------------------------------------------
-- 4) ตรวจ PIN แอดมินบริษัท (staff_code + PIN, ไม่ผูกทริป)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_admin_pin(
  p_staff_code text,
  p_pin        text
)
RETURNS TABLE (staff_id uuid, name text, phone text, org_id uuid, org_role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT s.id, s.name, s.phone, s.org_id, s.org_role
  FROM public.staff s
  WHERE upper(s.staff_code) = upper(btrim(p_staff_code))
    AND s.auth_pin = btrim(p_pin)
    AND s.org_role IS NOT NULL
    AND coalesce(s.is_active, true) = true
  LIMIT 1;
$fn$;


-- ---------------------------------------------------------------------
-- 5) ทริปที่คนนี้ถูกมอบหมาย — ใช้เติม assignments ใน session
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_staff_assignments(p_staff_id uuid)
RETURNS TABLE (tour_id uuid, tour_name text, role text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT ts.tour_id, t.name, ts.role, t.status
  FROM public.tour_staff ts
  JOIN public.tours t ON t.id = ts.tour_id
  WHERE ts.staff_id = p_staff_id AND ts.is_active = true
  ORDER BY coalesce(t.starts_on, '9999-12-31'::date) DESC;
$fn$;


-- ---------------------------------------------------------------------
-- 6) เปลี่ยน PIN ตัวเอง (บังคับให้แอดมินเปลี่ยนจาก 4256 ได้ในแอป)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_own_pin(
  p_staff_id uuid,
  p_old_pin  text,
  p_new_pin  text,
  p_tour_id  uuid DEFAULT NULL   -- NULL = PIN แอดมิน (บน staff), มีค่า = PIN ในทริปนั้น
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_n int;
BEGIN
  IF p_new_pin IS NULL OR length(btrim(p_new_pin)) < 4 THEN
    RAISE EXCEPTION 'PIN ใหม่ต้องมีอย่างน้อย 4 หลัก';
  END IF;

  IF p_tour_id IS NULL THEN
    UPDATE staff SET auth_pin = btrim(p_new_pin)
    WHERE id = p_staff_id AND auth_pin = btrim(p_old_pin) AND org_role IS NOT NULL;
  ELSE
    UPDATE tour_staff SET auth_pin = btrim(p_new_pin)
    WHERE staff_id = p_staff_id AND tour_id = p_tour_id AND auth_pin = btrim(p_old_pin);
  END IF;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $fn$;


-- ---------------------------------------------------------------------
-- 7) เพิ่มทีมงานเข้าทริป — สร้าง "คน" ถ้ายังไม่มี แล้วมอบหมายเข้าทริป
--    ใช้เบอร์โทรเป็นตัวจับคู่คนเดิม → คนเดียวไม่ถูกสร้างซ้ำข้ามทริป
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_tour_staff_member(
  p_tour_id  uuid,
  p_org_id   uuid,
  p_name     text,
  p_phone    text,
  p_role     text,
  p_pin      text,
  p_guest_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_staff_id uuid;
BEGIN
  IF p_role NOT IN ('lead','staff','driver','guide') THEN
    RAISE EXCEPTION 'บทบาทไม่ถูกต้อง: %', p_role;
  END IF;

  -- หาคนเดิมจากเบอร์โทรใน org เดียวกัน
  IF p_phone IS NOT NULL AND btrim(p_phone) <> '' THEN
    SELECT id INTO v_staff_id FROM staff
    WHERE org_id = p_org_id AND phone = btrim(p_phone)
    LIMIT 1;
  END IF;

  IF v_staff_id IS NULL THEN
    INSERT INTO staff (org_id, tour_id, name, phone, role)
    VALUES (p_org_id, p_tour_id, p_name, nullif(btrim(p_phone), ''), p_role)
    RETURNING id INTO v_staff_id;
  END IF;

  INSERT INTO tour_staff (tour_id, staff_id, role, auth_pin, guest_id)
  VALUES (p_tour_id, v_staff_id, p_role, nullif(btrim(p_pin), ''), p_guest_id)
  ON CONFLICT (tour_id, staff_id)
  DO UPDATE SET role = EXCLUDED.role,
                auth_pin = coalesce(EXCLUDED.auth_pin, tour_staff.auth_pin),
                guest_id = coalesce(EXCLUDED.guest_id, tour_staff.guest_id),
                is_active = true;

  RETURN v_staff_id;
END $fn$;


GRANT EXECUTE ON FUNCTION
  public.add_tour_staff_member(uuid, uuid, text, text, text, text, uuid),
  public.list_active_tours(),
  public.list_tour_staff(uuid),
  public.verify_tour_staff_pin(uuid, uuid, text),
  public.verify_admin_pin(text, text),
  public.get_staff_assignments(uuid),
  public.change_own_pin(uuid, text, text, uuid)
TO anon, authenticated;

COMMIT;
