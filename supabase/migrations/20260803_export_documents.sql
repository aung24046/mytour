-- =====================================================================
-- MyTour — Export Documents: หัวกระดาษบริษัท + ข้อมูลประจำตัวลูกทัวร์ + ชุดคอลัมน์
-- วันที่: 2026-08-03
--
-- ✅ รันบน project iirhnjoqpwwwdgoghnkc แล้วเมื่อ 2026-08-03
--    ผ่าน Supabase MCP แบ่งเป็น 6 migration ย่อย:
--      export_docs_part1_organizations_branding
--      export_docs_part2_guest_identity_columns
--      export_docs_part3_seed_core_form_fields
--      export_docs_part4_document_presets
--      export_docs_part5_purge_new_identity_columns
--      export_docs_part6_org_assets_bucket   (อยู่ใน supabase/storage_org_assets.sql)
--    ไฟล์นี้เก็บไว้เป็นฉบับรวมสำหรับ environment อื่น — รันซ้ำได้ ไม่พัง (idempotent)
--
-- ⚠️ ADDITIVE ONLY — ไม่มี DROP TABLE / TRUNCATE
--    อยู่ใน transaction เดียว มีอะไรผิด rollback ทั้งหมด
--
-- อ้างอิง: MyTour_Export_DataSpec_v1.md §0 §1 §2 §9 §11
--
-- ที่มา:
--   - ⚠️ ตาราง public.organizations มีอยู่แล้วในฐานข้อมูล (id, name, created_at)
--     แม้ไม่มีไฟล์ไหนใน src/ เรียกใช้ก็ตาม — tours.org_id / staff.org_id ชี้มาที่นี่
--     จึงต่อยอดตารางเดิม ไม่สร้าง orgs ขึ้นมาใหม่ให้ซ้ำซ้อน
--     organizations.name = ชื่อบริษัทภาษาไทย (คอลัมน์เดิม ไม่แตะ)
--   - RLS ทุกตารางในโปรเจกต์นี้เปิดพร้อม policy "true" (คุมสิทธิ์ที่ชั้นแอป) → ทำตามเดิม
--   - form_fields เป็นคลังระดับ org, ผูกเข้าทริปผ่าน tour_form_fields → seed ทั้งสองชั้น
-- =====================================================================

BEGIN;

-- =====================================================================
-- SECTION 1 — organizations: เพิ่มข้อมูลบริษัทสำหรับหัวกระดาษ
-- =====================================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS name_en         text,
  ADD COLUMN IF NOT EXISTS logo_url        text,
  ADD COLUMN IF NOT EXISTS tax_id          text,   -- เลขทะเบียนนิติบุคคล 13 หลัก
  ADD COLUMN IF NOT EXISTS tat_license_no  text,   -- เลขที่ใบอนุญาต ททท.
  ADD COLUMN IF NOT EXISTS address         text,
  ADD COLUMN IF NOT EXISTS phone           text,
  ADD COLUMN IF NOT EXISTS email           text,
  ADD COLUMN IF NOT EXISTS website         text,
  ADD COLUMN IF NOT EXISTS doc_footer_note text,   -- ข้อความท้ายกระดาษทุกใบ
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

-- กันกรณี org_id ถูกอ้างใน staff/tours แต่ยังไม่มีแถวใน organizations
INSERT INTO public.organizations (id, name)
SELECT DISTINCT org_id, 'บริษัททัวร์ (ยังไม่ได้ตั้งชื่อ)'
FROM (
  SELECT org_id FROM public.staff WHERE org_id IS NOT NULL
  UNION
  SELECT org_id FROM public.tours WHERE org_id IS NOT NULL
) s
ON CONFLICT (id) DO NOTHING;

-- ผูก FK ถ้ายังไม่มี (โปรเจกต์นี้มี tours_org_id_fkey อยู่แล้ว บล็อกนี้จึงมักถูกข้าม)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tours_org_id_fkey') THEN
    ALTER TABLE public.tours
      ADD CONSTRAINT tours_org_id_fkey
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT;
  END IF;
END $$;


-- =====================================================================
-- SECTION 2 — guests: ยกข้อมูลประจำตัวขึ้นเป็น core column
--
-- เหตุผล: rooming list / guest manifest / ประกันภัย / ตม. ใช้ชุดเดียวกันหมด
-- ถ้าปล่อยเป็น custom field ใน form_fields เอกสารจะพังทันทีที่แอดมินลบฟิลด์ทิ้ง
-- =====================================================================
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS title           text,   -- คำนำหน้า
  ADD COLUMN IF NOT EXISTS name_en         text,   -- ชื่อ-นามสกุลอังกฤษตามพาสปอร์ต
  ADD COLUMN IF NOT EXISTS birthdate       date,
  ADD COLUMN IF NOT EXISTS national_id     text,   -- เลขบัตรประชาชน
  ADD COLUMN IF NOT EXISTS passport_no     text,
  ADD COLUMN IF NOT EXISTS passport_expiry date,
  ADD COLUMN IF NOT EXISTS nationality     text,
  ADD COLUMN IF NOT EXISTS insurance_no    text;

-- ย้ายค่าจาก custom field 'custom_birthdate' เดิมขึ้นมาที่คอลัมน์ใหม่ (ถ้ามี)
DO $$
DECLARE v_moved bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM public.form_fields WHERE field_key = 'custom_birthdate') THEN
    UPDATE public.guests g
    SET birthdate = to_date(r.value, 'YYYY-MM-DD')
    FROM public.guest_form_responses r
    JOIN public.form_fields f ON f.id = r.field_id
    WHERE r.guest_id = g.id
      AND f.field_key = 'custom_birthdate'
      AND g.birthdate IS NULL
      AND r.value ~ '^\d{4}-\d{2}-\d{2}$';
    GET DIAGNOSTICS v_moved = ROW_COUNT;
  END IF;
  RAISE NOTICE 'ย้ายวันเกิดจาก custom_birthdate: % แถว', v_moved;
END $$;


-- =====================================================================
-- SECTION 3 — seed core fields เข้าคลังฟอร์ม + ผูกเข้าทุกทริป
-- ปิดไว้ตั้งต้น (is_active = false) เพื่อไม่ให้ฟอร์มลงทะเบียนยาวขึ้นเองโดยไม่ตั้งใจ
-- แอดมินเปิดเองเมื่อทริปนั้นต้องใช้ (เช่น ทัวร์ต่างประเทศเปิดพาสปอร์ต)
-- =====================================================================
INSERT INTO public.form_fields
  (field_key, label, field_type, field_purpose, form_type, category,
   is_core, is_required, is_active, sort_order)
SELECT v.field_key, v.label, v.field_type, 'generic', 'registration', v.category,
       true, false, true, v.sort_order
FROM (VALUES
  ('title',           'คำนำหน้า',                    'text', 'personal', 11),
  ('name_en',         'ชื่อ-นามสกุล (อังกฤษ)',        'text', 'personal', 12),
  ('birthdate',       'วันเกิด',                     'date', 'personal', 13),
  ('national_id',     'เลขบัตรประชาชน',              'text', 'personal', 14),
  ('passport_no',     'เลขที่หนังสือเดินทาง',         'text', 'personal', 15),
  ('passport_expiry', 'วันหมดอายุหนังสือเดินทาง',     'date', 'personal', 16),
  ('nationality',     'สัญชาติ',                     'text', 'personal', 17),
  ('insurance_no',    'เลขที่กรมธรรม์',              'text', 'other',    18)
) AS v(field_key, label, field_type, category, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM public.form_fields f
  WHERE f.field_key = v.field_key AND f.tour_id IS NULL
);

-- ผูกเข้าทุกทริป แต่ปิดไว้ก่อน
INSERT INTO public.tour_form_fields (tour_id, field_id, is_active, is_required, sort_order)
SELECT t.id, f.id, false, NULL, f.sort_order
FROM public.tours t
CROSS JOIN public.form_fields f
WHERE f.tour_id IS NULL
  AND f.field_key IN ('title','name_en','birthdate','national_id',
                      'passport_no','passport_expiry','nationality','insurance_no')
ON CONFLICT (tour_id, field_id) DO NOTHING;


-- =====================================================================
-- SECTION 4 — document_presets (ชุดคอลัมน์ของเอกสาร)
--
-- columns เก็บทั้งลำดับ การเปิด-ปิด และนโยบายข้อความยาว (§10.2)
--   [{ "key": "name", "overflow": "nowrap" },
--    { "key": "name_en", "overflow": "stack", "stackWith": "name" },
--    { "key": "note", "overflow": "footnote" }]
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.document_presets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doc_type    text NOT NULL,
  name        text NOT NULL,
  columns     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, doc_type, name),
  CONSTRAINT document_presets_doc_type_check CHECK (doc_type IN (
    'rooming_list', 'guest_manifest', 'seat_manifest', 'dietary_sheet',
    'itinerary_booklet', 'emergency_card', 'expense_report', 'feedback_report'
  ))
);

CREATE INDEX IF NOT EXISTS document_presets_org_doc_idx
  ON public.document_presets (org_id, doc_type);

-- ค่าตั้งต้นได้ชุดเดียวต่อ (org, doc_type)
CREATE UNIQUE INDEX IF NOT EXISTS document_presets_one_default_idx
  ON public.document_presets (org_id, doc_type) WHERE is_default;

ALTER TABLE public.document_presets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='document_presets'
                   AND policyname='document_presets_read') THEN
    CREATE POLICY document_presets_read ON public.document_presets FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='document_presets'
                   AND policyname='document_presets_write') THEN
    CREATE POLICY document_presets_write ON public.document_presets
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- seed ชุดตั้งต้น 2 ชุดต่อ org: ทัวร์ในประเทศ (ค่าตั้งต้น) + ทัวร์ต่างประเทศ
INSERT INTO public.document_presets (org_id, doc_type, name, columns, is_default)
SELECT o.id, 'rooming_list', 'ทัวร์ในประเทศ', '[
  {"key":"room_number","overflow":"nowrap"},
  {"key":"floor","overflow":"nowrap"},
  {"key":"room_type","overflow":"nowrap"},
  {"key":"name","overflow":"stack","stackWith":"nickname"},
  {"key":"gender","overflow":"stack","stackWith":"birthdate"},
  {"key":"national_id","overflow":"nowrap","sensitive":true},
  {"key":"phone","overflow":"nowrap"}
]'::jsonb, true
FROM public.organizations o
ON CONFLICT (org_id, doc_type, name) DO NOTHING;

INSERT INTO public.document_presets (org_id, doc_type, name, columns, is_default)
SELECT o.id, 'rooming_list', 'ทัวร์ต่างประเทศ', '[
  {"key":"room_number","overflow":"nowrap"},
  {"key":"floor","overflow":"nowrap"},
  {"key":"room_type","overflow":"nowrap"},
  {"key":"name","overflow":"stack","stackWith":"name_en"},
  {"key":"gender","overflow":"stack","stackWith":"birthdate"},
  {"key":"passport_no","overflow":"stack","stackWith":"passport_expiry","sensitive":true},
  {"key":"nationality","overflow":"nowrap"}
]'::jsonb, false
FROM public.organizations o
ON CONFLICT (org_id, doc_type, name) DO NOTHING;

INSERT INTO public.document_presets (org_id, doc_type, name, columns, is_default)
SELECT o.id, 'guest_manifest', 'ทัวร์ในประเทศ', '[
  {"key":"index","overflow":"nowrap"},
  {"key":"name","overflow":"stack","stackWith":"nickname"},
  {"key":"gender","overflow":"stack","stackWith":"birthdate"},
  {"key":"national_id","overflow":"nowrap","sensitive":true},
  {"key":"phone","overflow":"stack","stackWith":"emergency_contact_phone"},
  {"key":"food_allergy","overflow":"clamp","lines":2},
  {"key":"medical_condition","overflow":"subrow","sensitive":true},
  {"key":"note","overflow":"footnote"}
]'::jsonb, true
FROM public.organizations o
ON CONFLICT (org_id, doc_type, name) DO NOTHING;

INSERT INTO public.document_presets (org_id, doc_type, name, columns, is_default)
SELECT o.id, 'guest_manifest', 'ทัวร์ต่างประเทศ', '[
  {"key":"index","overflow":"nowrap"},
  {"key":"name","overflow":"stack","stackWith":"name_en"},
  {"key":"gender","overflow":"stack","stackWith":"birthdate"},
  {"key":"national_id","overflow":"stack","stackWith":"nationality","sensitive":true},
  {"key":"passport_no","overflow":"stack","stackWith":"passport_expiry","sensitive":true},
  {"key":"phone","overflow":"stack","stackWith":"emergency_contact_phone"},
  {"key":"insurance_no","overflow":"nowrap"},
  {"key":"food_allergy","overflow":"clamp","lines":2},
  {"key":"medical_condition","overflow":"subrow","sensitive":true}
]'::jsonb, false
FROM public.organizations o
ON CONFLICT (org_id, doc_type, name) DO NOTHING;


-- =====================================================================
-- SECTION 5 — PDPA: ล้างข้อมูลประจำตัวใหม่ตอน purge ด้วย
-- ของเดิม hardcode รายชื่อคอลัมน์ไว้ → ต้องเติมคอลัมน์ใหม่เข้าไป
-- birthdate / passport_expiry เป็น date ไม่เข้าเงื่อนไข text → ล้างแยก
-- =====================================================================
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
                        'food_allergy','medical_condition',
                        -- เพิ่มใหม่ 2026-08-03 (ข้อมูลประจำตัวสำหรับเอกสาร)
                        'title','name_en','national_id','passport_no',
                        'nationality','insurance_no');

  IF v_sets IS NOT NULL THEN
    v_sets := v_sets || ', birthdate = NULL, passport_expiry = NULL';
    EXECUTE format('UPDATE public.guests SET %s WHERE tour_id = $1', v_sets) USING p_tour_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guests_anonymized', v_n);
  END IF;

  UPDATE tours SET personal_data_purged_at = now() WHERE id = p_tour_id;
  RETURN v_result;
END $fn$;


-- =====================================================================
-- SECTION 6 — ตรวจความถูกต้องก่อน COMMIT
-- =====================================================================
DO $$
DECLARE v_orphan bigint; v_orgs bigint; v_fields bigint; v_presets bigint;
BEGIN
  SELECT count(*) INTO v_orphan
  FROM public.tours t
  WHERE t.org_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = t.org_id);
  IF v_orphan > 0 THEN
    RAISE EXCEPTION 'มีทริปที่ org_id ไม่มีใน organizations: % แถว — rollback', v_orphan;
  END IF;

  SELECT count(*) INTO v_orgs FROM public.organizations;
  SELECT count(*) INTO v_fields FROM public.form_fields
    WHERE tour_id IS NULL AND field_key IN
      ('title','name_en','birthdate','national_id',
       'passport_no','passport_expiry','nationality','insurance_no');
  SELECT count(*) INTO v_presets FROM public.document_presets;

  IF v_fields <> 8 THEN
    RAISE EXCEPTION 'core field ใหม่ควรมี 8 ตัว แต่พบ % — rollback', v_fields;
  END IF;

  RAISE NOTICE 'organizations: % · core field ใหม่: % · document_presets: %', v_orgs, v_fields, v_presets;
  RAISE NOTICE '✅ export documents migration ผ่านทั้งหมด';
END $$;

COMMIT;

-- ---------------------------------------------------------------------
-- ตรวจด้วยตาหลัง COMMIT
-- ---------------------------------------------------------------------
-- SELECT id, name, name_en, tat_license_no FROM public.organizations;
-- SELECT field_key, label, is_core FROM public.form_fields WHERE tour_id IS NULL ORDER BY sort_order;
-- SELECT doc_type, name, is_default, jsonb_array_length(columns) AS cols FROM public.document_presets;
--
-- ⚠️ ต้องสร้าง storage bucket ชื่อ 'org-assets' (public read) — ดู supabase/storage_org_assets.sql
--    ใช้เก็บโลโก้บริษัท — แพตเทิร์นเดียวกับ bucket 'receipt-photos' ที่ ExpenseTracker ใช้
