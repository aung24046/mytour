-- =====================================================================
-- MyTour — Multi-Tour Part 1: ทริป + ทีมงาน
-- วันที่: 2026-07-28  ·  ตรวจสอบกับ schema จริงของ project iirhnjoqpwwwdgoghnkc แล้ว
--
-- ⚠️ ADDITIVE ONLY — ไม่มี DROP TABLE / TRUNCATE
--    DELETE ทุกจุด scope ด้วย tour_id เสมอ
--    อยู่ใน transaction เดียว มีอะไรผิด rollback ทั้งหมด
--
-- หมายเหตุจาก schema จริง:
--   - tours มี start_date / end_date / status / created_at อยู่แล้ว → ใช้ของเดิม ไม่สร้างซ้ำ
--   - staff.tour_id nullable อยู่แล้ว
--   - RLS เปิดทุกตาราง + policy เป็น "true" ทั้งหมด → ตารางใหม่ต้องมี policy ด้วย
-- =====================================================================

BEGIN;

-- =====================================================================
-- SECTION 1 — ขยาย tours (ไม่แตะคอลัมน์เดิม)
-- =====================================================================
ALTER TABLE public.tours
  ADD COLUMN IF NOT EXISTS join_code               text,
  ADD COLUMN IF NOT EXISTS is_template             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cloned_from             uuid,
  ADD COLUMN IF NOT EXISTS archived_at             timestamptz,
  ADD COLUMN IF NOT EXISTS personal_data_purged_at timestamptz;

-- status มีอยู่แล้ว (nullable, default 'active') → เติมค่าที่ขาด แล้วบังคับให้เป็นค่าที่รู้จัก
UPDATE public.tours SET status = 'active' WHERE status IS NULL OR btrim(status) = '';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tours WHERE status NOT IN ('draft','active','archived')) THEN
    RAISE EXCEPTION 'มี tours.status ค่าที่ไม่รู้จัก — ตรวจก่อน: SELECT DISTINCT status FROM tours';
  END IF;

  ALTER TABLE public.tours ALTER COLUMN status SET NOT NULL;
  ALTER TABLE public.tours ALTER COLUMN status SET DEFAULT 'active';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tours_status_check') THEN
    ALTER TABLE public.tours
      ADD CONSTRAINT tours_status_check CHECK (status IN ('draft','active','archived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tours_cloned_from_fkey') THEN
    ALTER TABLE public.tours
      ADD CONSTRAINT tours_cloned_from_fkey
      FOREIGN KEY (cloned_from) REFERENCES public.tours(id) ON DELETE SET NULL;
  END IF;
END $$;


-- =====================================================================
-- SECTION 2 — join_code + backfill
-- ตัวอักษร: ตัด I, O, 0, 1 ออก (อ่านผิดง่ายเวลาบอกปากเปล่า)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.generate_join_code(p_length int DEFAULT 6)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text; i int; attempts int := 0;
BEGIN
  LOOP
    candidate := '';
    FOR i IN 1..p_length LOOP
      candidate := candidate || substr(alphabet, floor(random() * length(alphabet))::int + 1, 1);
    END LOOP;

    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tours WHERE upper(join_code) = candidate);

    attempts := attempts + 1;
    IF attempts > 50 THEN
      RAISE EXCEPTION 'generate_join_code: หา code ว่างไม่ได้หลังลอง 50 ครั้ง';
    END IF;
  END LOOP;
  RETURN candidate;
END $fn$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM public.tours WHERE join_code IS NULL OR btrim(join_code) = '' LOOP
    UPDATE public.tours SET join_code = public.generate_join_code(6) WHERE id = t.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tours_join_code_key ON public.tours (upper(join_code));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tours WHERE join_code IS NULL) THEN
    RAISE EXCEPTION 'ยังมีทริปที่ join_code เป็น NULL — หยุด';
  END IF;
  ALTER TABLE public.tours ALTER COLUMN join_code SET NOT NULL;
END $$;

CREATE INDEX IF NOT EXISTS tours_status_idx ON public.tours (status);
CREATE INDEX IF NOT EXISTS tours_org_id_idx ON public.tours (org_id);


-- =====================================================================
-- SECTION 3 — ทีมงาน: staff (คน) + tour_staff (มอบหมายต่อทริป)
--
-- staff      = ตัวคน (คอลัมน์ tour_id เดิมกลายเป็น "ทริปแรกที่ถูกสร้าง")
-- tour_staff = อยู่ทริปไหน บทบาทอะไร PIN อะไร
-- role mapping: admin → lead, lead_guide → lead (ตามที่ตัดสินใจ)
-- =====================================================================
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS org_role   text,          -- NULL | 'admin' | 'owner'
  ADD COLUMN IF NOT EXISTS staff_code text,
  ADD COLUMN IF NOT EXISTS is_active  boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_org_role_check') THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_org_role_check
      CHECK (org_role IS NULL OR org_role IN ('admin','owner'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS staff_org_code_key
  ON public.staff (org_id, upper(staff_code))
  WHERE staff_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS staff_org_role_idx ON public.staff (org_id, org_role);

CREATE TABLE IF NOT EXISTS public.tour_staff (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id       uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  staff_id      uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'staff'
                CHECK (role IN ('lead','staff','driver','guide')),
  auth_pin      text,
  guest_id      uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  show_to_guest boolean NOT NULL DEFAULT false,
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tour_id, staff_id)
);

CREATE INDEX IF NOT EXISTS tour_staff_tour_idx  ON public.tour_staff (tour_id);
CREATE INDEX IF NOT EXISTS tour_staff_staff_idx ON public.tour_staff (staff_id);

-- PIN ห้ามซ้ำในทริปเดียวกัน (ข้ามทริปซ้ำได้)
DO $$
DECLARE v_dup int;
BEGIN
  SELECT count(*) INTO v_dup FROM (
    SELECT tour_id, auth_pin FROM public.staff
    WHERE tour_id IS NOT NULL AND auth_pin IS NOT NULL
    GROUP BY tour_id, auth_pin HAVING count(*) > 1
  ) d;

  IF v_dup > 0 THEN
    RAISE NOTICE '⚠ ข้าม tour_staff_pin_key: ข้อมูลเดิมมี PIN ซ้ำในทริปเดียวกัน % ชุด', v_dup;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS tour_staff_pin_key
      ON public.tour_staff (tour_id, auth_pin) WHERE auth_pin IS NOT NULL;
  END IF;
END $$;

-- 3.1 Backfill — staff เดิมทุกแถว → 1 แถว tour_staff (คง staff.id เดิม)
INSERT INTO public.tour_staff (tour_id, staff_id, role, auth_pin, guest_id,
                               show_to_guest, is_default)
SELECT s.tour_id, s.id,
       CASE lower(coalesce(s.role, 'staff'))
         WHEN 'admin'      THEN 'lead'
         WHEN 'lead_guide' THEN 'lead'
         WHEN 'lead'       THEN 'lead'
         WHEN 'driver'     THEN 'driver'
         WHEN 'guide'      THEN 'guide'
         ELSE 'staff'
       END,
       s.auth_pin, s.guest_id,
       coalesce(s.show_to_guest, false), coalesce(s.is_default, false)
FROM public.staff s
WHERE s.tour_id IS NOT NULL
ON CONFLICT (tour_id, staff_id) DO NOTHING;

-- 3.2 org owner คนแรก — ⚠️ PIN อยู่ใน git เปลี่ยนทันทีหลังใช้ครั้งแรก
DO $$
DECLARE v_org uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff WHERE org_id = v_org AND org_role IS NOT NULL) THEN
    INSERT INTO public.staff (org_id, tour_id, name, role, org_role, staff_code, auth_pin)
    VALUES (v_org, NULL, 'Admin', 'owner', 'owner', 'ADM1', '4256');
    RAISE NOTICE '✅ สร้าง org owner: staff_code=ADM1 / PIN=4256 → เปลี่ยน PIN ทันที!';
  END IF;
END $$;


-- =====================================================================
-- SECTION 4 — RLS policy สำหรับตารางใหม่
-- ให้เหมือนตารางเดิมทุกประการ (permissive "true")
-- ⚠️ นี่คือสภาพเดิมของระบบ ไม่ใช่ security จริง — ดู Design v2 §9
-- =====================================================================
ALTER TABLE public.tour_staff ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='tour_staff' AND policyname='tour_staff_read') THEN
    CREATE POLICY tour_staff_read ON public.tour_staff FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='tour_staff' AND policyname='tour_staff_write') THEN
    CREATE POLICY tour_staff_write ON public.tour_staff FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- =====================================================================
-- SECTION 5 — View: v_tour_staff (แอปอ่านแทน .from('staff'))
-- security_invoker → เคารพ policy ของตารางฐาน (เตรียมทางไว้ตอนทำ RLS จริง)
-- PostgREST embed ผ่าน view ไม่ได้ → join guests มาเป็นคอลัมน์เลย
-- =====================================================================
CREATE OR REPLACE VIEW public.v_tour_staff
WITH (security_invoker = true) AS
SELECT
  ts.tour_id,
  s.id  AS id,               -- คง staff.id เดิม → โค้ดที่อ้าง id ไม่พัง
  ts.id AS assignment_id,
  s.org_id,
  s.name,
  s.phone,
  ts.role,
  ts.auth_pin,
  ts.guest_id,
  ts.show_to_guest,
  ts.is_default,
  ts.is_active,
  s.org_role,
  g.name     AS guest_name,
  g.nickname AS guest_nickname,
  g.phone    AS guest_phone
FROM public.tour_staff ts
JOIN public.staff s ON s.id = ts.staff_id
LEFT JOIN public.guests g ON g.id = ts.guest_id;

GRANT SELECT ON public.v_tour_staff TO anon, authenticated;


-- =====================================================================
-- SECTION 6 — resolve tour จาก join_code
-- =====================================================================
CREATE OR REPLACE FUNCTION public.resolve_tour_by_code(p_code text)
RETURNS TABLE (id uuid, org_id uuid, name text, join_code text,
               status text, start_date date, end_date date)
LANGUAGE sql STABLE
AS $fn$
  SELECT t.id, t.org_id, t.name, t.join_code, t.status, t.start_date, t.end_date
  FROM public.tours t
  WHERE upper(t.join_code) = upper(btrim(p_code)) AND t.is_template = false
  LIMIT 1;
$fn$;


-- =====================================================================
-- SECTION 7 — Clone helpers
-- คอลัมน์ที่ไม่ก๊อปเสมอ: id, created_at, updated_at, guest_id
-- =====================================================================
CREATE OR REPLACE FUNCTION public._clone_col_list(p_table text, p_skip text[])
RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = p_table
    AND is_generated = 'NEVER'
    AND column_name NOT IN ('id','created_at','updated_at','guest_id')
    AND NOT (column_name = ANY(COALESCE(p_skip, ARRAY[]::text[])));
$fn$;

CREATE OR REPLACE FUNCTION public._clone_sel_list(
  p_table text, p_skip text[], p_new_tour uuid,
  p_fk_col text DEFAULT NULL, p_fk_value uuid DEFAULT NULL
)
RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT string_agg(
           CASE
             WHEN column_name = 'tour_id' THEN quote_literal(p_new_tour) || '::uuid'
             WHEN p_fk_col IS NOT NULL AND column_name = p_fk_col
                  THEN quote_literal(p_fk_value) || '::uuid'
             ELSE quote_ident(column_name)
           END, ', ' ORDER BY ordinal_position)
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = p_table
    AND is_generated = 'NEVER'
    AND column_name NOT IN ('id','created_at','updated_at','guest_id')
    AND NOT (column_name = ANY(COALESCE(p_skip, ARRAY[]::text[])));
$fn$;

CREATE OR REPLACE FUNCTION public._clone_flat_table(
  p_table text, p_src_tour uuid, p_new_tour uuid
)
RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE v_cols text; v_sel text; v_n int := 0;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=p_table AND column_name='tour_id')
  THEN RETURN 0; END IF;

  v_cols := public._clone_col_list(p_table, NULL);
  v_sel  := public._clone_sel_list(p_table, NULL, p_new_tour);

  EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM public.%I WHERE tour_id = $1',
                 p_table, v_cols, v_sel, p_table)
  USING p_src_tour;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $fn$;

-- พ่อ-ลูก: buses→bus_seats, hotels→hotel_rooms, guide_categories→guide_articles
CREATE OR REPLACE FUNCTION public._clone_parent_child(
  p_parent text, p_child text, p_fk_col text, p_src_tour uuid, p_new_tour uuid
)
RETURNS int LANGUAGE plpgsql AS $fn$
DECLARE
  r record; v_new_parent uuid;
  v_pcols text; v_psel text; v_ccols text; v_csel text;
  v_n int := 0; v_has_child boolean;
BEGIN
  IF to_regclass('public.' || p_parent) IS NULL THEN RETURN 0; END IF;

  v_has_child := to_regclass('public.' || p_child) IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name=p_child AND column_name=p_fk_col);

  v_pcols := public._clone_col_list(p_parent, NULL);
  v_psel  := public._clone_sel_list(p_parent, NULL, p_new_tour);

  FOR r IN EXECUTE format('SELECT id FROM public.%I WHERE tour_id = $1 ORDER BY id', p_parent)
           USING p_src_tour
  LOOP
    v_new_parent := gen_random_uuid();

    EXECUTE format('INSERT INTO public.%I (id, %s) SELECT $2, %s FROM public.%I WHERE id = $1',
                   p_parent, v_pcols, v_psel, p_parent)
    USING r.id, v_new_parent;
    v_n := v_n + 1;

    IF v_has_child THEN
      v_ccols := public._clone_col_list(p_child, NULL);
      v_csel  := public._clone_sel_list(p_child, NULL, p_new_tour, p_fk_col, v_new_parent);
      EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM public.%I WHERE %I = $1',
                     p_child, v_ccols, v_csel, p_child, p_fk_col)
      USING r.id;
    END IF;
  END LOOP;

  RETURN v_n;
END $fn$;


-- =====================================================================
-- SECTION 8 — clone_tour: ก๊อป config ไม่ก๊อปลูกทัวร์/ข้อมูลส่วนตัว
-- =====================================================================
CREATE OR REPLACE FUNCTION public.clone_tour(
  p_source_tour_id uuid,
  p_new_name       text,
  p_start_date     date    DEFAULT NULL,
  p_end_date       date    DEFAULT NULL,
  p_copy_form      boolean DEFAULT true,
  p_copy_itinerary boolean DEFAULT true,
  p_copy_transport boolean DEFAULT true,
  p_copy_hotels    boolean DEFAULT true,
  p_copy_guide     boolean DEFAULT true,
  p_copy_emergency boolean DEFAULT true,
  p_copy_suppliers boolean DEFAULT true,
  p_copy_staff     boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_org_id uuid; v_src_start date; v_offset int := 0; v_date_sets text;
BEGIN
  SELECT org_id, start_date INTO v_org_id, v_src_start
  FROM tours WHERE id = p_source_tour_id;

  IF v_org_id IS NULL AND NOT EXISTS (SELECT 1 FROM tours WHERE id = p_source_tour_id) THEN
    RAISE EXCEPTION 'clone_tour: ไม่พบทริปต้นทาง %', p_source_tour_id;
  END IF;
  IF p_new_name IS NULL OR btrim(p_new_name) = '' THEN
    RAISE EXCEPTION 'clone_tour: ต้องระบุชื่อทริปใหม่';
  END IF;

  IF p_start_date IS NOT NULL AND v_src_start IS NOT NULL THEN
    v_offset := p_start_date - v_src_start;
  END IF;

  INSERT INTO tours (id, org_id, name, join_code, status, start_date, end_date,
                     is_template, cloned_from)
  VALUES (v_new_id, v_org_id, btrim(p_new_name), generate_join_code(6), 'draft',
          p_start_date, p_end_date, false, p_source_tour_id);

  IF p_copy_form      THEN PERFORM _clone_flat_table('form_fields',        p_source_tour_id, v_new_id); END IF;
  IF p_copy_emergency THEN PERFORM _clone_flat_table('emergency_contacts', p_source_tour_id, v_new_id); END IF;
  IF p_copy_suppliers THEN PERFORM _clone_flat_table('tour_suppliers',     p_source_tour_id, v_new_id); END IF;

  IF p_copy_guide THEN
    PERFORM _clone_parent_child('guide_categories', 'guide_articles', 'category_id',
                                p_source_tour_id, v_new_id);
    PERFORM _clone_flat_table('phrasebook_entries', p_source_tour_id, v_new_id);
  END IF;

  IF p_copy_transport THEN
    PERFORM _clone_parent_child('buses', 'bus_seats', 'bus_id', p_source_tour_id, v_new_id);
  END IF;

  IF p_copy_hotels THEN
    PERFORM _clone_parent_child('hotels', 'hotel_rooms', 'hotel_id', p_source_tour_id, v_new_id);
  END IF;

  IF p_copy_itinerary THEN
    PERFORM _clone_flat_table('itinerary_items', p_source_tour_id, v_new_id);

    IF v_offset <> 0 THEN
      SELECT string_agg(format('%I = %I + %s', column_name, column_name, v_offset), ', ')
      INTO v_date_sets
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='itinerary_items' AND data_type='date';

      IF v_date_sets IS NOT NULL THEN
        EXECUTE format('UPDATE itinerary_items SET %s WHERE tour_id = $1', v_date_sets)
        USING v_new_id;
      END IF;
    END IF;
  END IF;

  -- ทีมงาน: ไม่ก๊อป "คน" (อยู่ในคลังแล้ว) ก๊อปแค่การมอบหมาย ไม่เอา guest_id
  IF p_copy_staff THEN
    INSERT INTO tour_staff (tour_id, staff_id, role, auth_pin, show_to_guest, is_default)
    SELECT v_new_id, staff_id, role, auth_pin, show_to_guest, is_default
    FROM tour_staff WHERE tour_id = p_source_tour_id AND is_active = true
    ON CONFLICT (tour_id, staff_id) DO NOTHING;
  END IF;

  RETURN v_new_id;
END $fn$;


-- =====================================================================
-- SECTION 9 — archive / purge / reset
-- =====================================================================
CREATE OR REPLACE FUNCTION public.archive_tour(p_tour_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  UPDATE public.tours SET status = 'archived', archived_at = now() WHERE id = p_tour_id;
$fn$;

CREATE OR REPLACE FUNCTION public.unarchive_tour(p_tour_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  UPDATE public.tours SET status = 'active', archived_at = NULL WHERE id = p_tour_id;
$fn$;

-- PDPA: ต้อง archive ก่อน + พิมพ์ชื่อทริปยืนยัน
CREATE OR REPLACE FUNCTION public.purge_tour_personal_data(
  p_tour_id uuid, p_confirm_name text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_name text; v_status text; v_result jsonb := '{}'::jsonb;
  v_n bigint; v_tbl text; v_sets text;
  v_wipe text[] := ARRAY['guest_locations','location_sessions','guest_form_responses','sos_alerts'];
BEGIN
  SELECT name, status INTO v_name, v_status FROM tours WHERE id = p_tour_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'purge: ไม่พบทริป %', p_tour_id; END IF;
  IF v_name IS DISTINCT FROM p_confirm_name THEN
    RAISE EXCEPTION 'purge: ชื่อทริปยืนยันไม่ตรง (ต้องพิมพ์ "%")', v_name;
  END IF;
  IF v_status <> 'archived' THEN
    RAISE EXCEPTION 'purge: ต้อง archive ทริปก่อน (status ตอนนี้ = %)', v_status;
  END IF;

  FOREACH v_tbl IN ARRAY v_wipe LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=v_tbl AND column_name='tour_id')
    THEN
      EXECUTE format('DELETE FROM public.%I WHERE tour_id = $1', v_tbl) USING p_tour_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_result := v_result || jsonb_build_object(v_tbl, v_n);
    END IF;
  END LOOP;

  -- guests: เก็บแถวไว้ (นับสถิติ/FK) แต่ล้างฟิลด์ระบุตัวตน
  SELECT string_agg(
           CASE WHEN column_name = 'name' THEN 'name = ''ลบแล้ว'''
                WHEN is_nullable = 'YES'  THEN format('%I = NULL', column_name)
                ELSE format('%I = ''purged-'' || id::text', column_name) END, ', ')
  INTO v_sets
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='guests'
    AND data_type IN ('text','character varying')
    AND column_name IN ('name','nickname','phone','qr_token','note',
                        'emergency_contact_name','emergency_contact_phone',
                        'food_allergy','medical_condition');

  IF v_sets IS NOT NULL THEN
    EXECUTE format('UPDATE public.guests SET %s WHERE tour_id = $1', v_sets) USING p_tour_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guests_anonymized', v_n);
  END IF;

  UPDATE tours SET personal_data_purged_at = now() WHERE id = p_tour_id;
  RETURN v_result;
END $fn$;

-- "เริ่มกรุ๊ปใหม่บนทริปเดิม" — ลบลูกทัวร์+ข้อมูลหน้างาน เก็บ config
CREATE OR REPLACE FUNCTION public.reset_tour_runtime_data(
  p_tour_id uuid, p_confirm_name text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_name text; v_result jsonb := '{}'::jsonb; v_n bigint; v_tbl text;
  v_tables text[] := ARRAY[
    'guest_locations','location_sessions','sos_alerts','guest_form_responses',
    'checkin_records','checkin_events','room_assignments','luggage',
    'bingo_cards','bingo_games','announcements','guests'
  ];
BEGIN
  SELECT name INTO v_name FROM tours WHERE id = p_tour_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'reset: ไม่พบทริป %', p_tour_id; END IF;
  IF v_name IS DISTINCT FROM p_confirm_name THEN
    RAISE EXCEPTION 'reset: ชื่อทริปยืนยันไม่ตรง (ต้องพิมพ์ "%")', v_name;
  END IF;

  -- ปลดที่นั่ง (bus_seats ผูก bus ไม่ใช่ tour ตรงๆ)
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='bus_seats' AND column_name='guest_id')
  THEN
    UPDATE bus_seats SET guest_id = NULL
    WHERE bus_id IN (SELECT id FROM buses WHERE tour_id = p_tour_id);
  END IF;

  -- ตัดการอ้างอิง guests ที่เหลือ ไม่งั้น DELETE FROM guests ติด FK
  UPDATE staff SET guest_id = NULL WHERE tour_id = p_tour_id;
  UPDATE tour_staff SET guest_id = NULL WHERE tour_id = p_tour_id;

  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=v_tbl AND column_name='tour_id')
    THEN
      EXECUTE format('DELETE FROM public.%I WHERE tour_id = $1', v_tbl) USING p_tour_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_result := v_result || jsonb_build_object(v_tbl, v_n);
    END IF;
  END LOOP;

  RETURN v_result;
END $fn$;


-- =====================================================================
-- SECTION 10 — unique constraint ที่ต้องเป็น per-tour
-- luggage.tag_code เป็น global อยู่ (ตรวจจาก schema จริง) → ทริป 2 ใช้ป้ายเลขเดิมไม่ได้
-- ตอนนี้ luggage มี 0 แถว จึงเปลี่ยนได้ปลอดภัย
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'luggage_tag_code_key') THEN
    ALTER TABLE public.luggage DROP CONSTRAINT IF EXISTS luggage_tag_code_key;
    DROP INDEX IF EXISTS public.luggage_tag_code_key;
    RAISE NOTICE '✅ เปลี่ยน luggage.tag_code เป็น unique ต่อทริป';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS luggage_tour_tag_key
  ON public.luggage (tour_id, tag_code);


-- =====================================================================
-- SECTION 11 — index tour_id ทุกตาราง (กัน full scan เมื่อมีหลายทริป)
-- =====================================================================
DO $$
DECLARE v_tbl text;
  v_tables text[] := ARRAY[
    'guests','itinerary_items','buses','hotels','luggage','announcements',
    'checkin_events','checkin_records','room_assignments','guest_locations',
    'location_sessions','sos_alerts','guest_form_responses','form_fields',
    'expenses','emergency_contacts','guide_categories','guide_articles',
    'phrasebook_entries','bingo_games','bingo_cards','tour_suppliers','staff'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=v_tbl AND column_name='tour_id')
    THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tour_id)',
                     v_tbl || '_tour_id_idx', v_tbl);
    END IF;
  END LOOP;
END $$;


-- =====================================================================
-- SECTION 12 — ตรวจผลลัพธ์ (ไม่ผ่าน = rollback ทั้ง transaction)
-- =====================================================================
DO $$
DECLARE v_no_code int; v_dupcode int; v_staff_src int; v_assigned int; v_owner int;
BEGIN
  SELECT count(*) INTO v_no_code FROM public.tours WHERE join_code IS NULL OR btrim(join_code)='';
  SELECT count(*) INTO v_dupcode FROM (
    SELECT upper(join_code) FROM public.tours GROUP BY 1 HAVING count(*) > 1) d;
  SELECT count(*) INTO v_staff_src FROM public.staff WHERE tour_id IS NOT NULL;
  SELECT count(*) INTO v_assigned  FROM public.tour_staff;
  SELECT count(*) INTO v_owner     FROM public.staff WHERE org_role = 'owner';

  RAISE NOTICE 'join_code ว่าง: % / ซ้ำ: % (ต้อง 0 ทั้งคู่)', v_no_code, v_dupcode;
  RAISE NOTICE 'staff เดิม % → tour_staff % (ต้องเท่ากัน)', v_staff_src, v_assigned;
  RAISE NOTICE 'org owner: % (ต้อง >= 1)', v_owner;

  IF v_no_code > 0 OR v_dupcode > 0 THEN
    RAISE EXCEPTION 'ไม่ผ่านการตรวจ join_code — rollback';
  END IF;
  IF v_assigned < v_staff_src THEN
    RAISE EXCEPTION 'tour_staff (%) น้อยกว่า staff เดิม (%) — rollback', v_assigned, v_staff_src;
  END IF;
  IF v_owner < 1 THEN
    RAISE EXCEPTION 'ไม่มี org owner — rollback';
  END IF;
  RAISE NOTICE '✅ part 1 ผ่านทั้งหมด';
END $$;

COMMIT;
