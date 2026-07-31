-- =====================================================================
-- ROLLBACK: 20260728_multi_tour.sql (part 1) + _part2_library.sql
--
-- ใช้เมื่อ: รัน migration แล้วเจอปัญหา และ **ยังไม่ได้สร้างทริปที่ 2**
-- ⚠️ ถ้าสร้างทริปใหม่ / fork เนื้อหาไปแล้ว อย่ารันไฟล์นี้
--    → กู้จาก Supabase Backup แทน
--
-- ลบเฉพาะ "สิ่งที่ migration เพิ่มเข้ามา" ไม่แตะข้อมูลทริปเดิม
-- รันไฟล์นี้ทีเดียว ครอบคลุมทั้ง part 1 และ part 2
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Guard: ตรวจว่าปลอดภัยที่จะ rollback
-- ---------------------------------------------------------------------
DO $$
DECLARE v_tours int; v_forked int := 0;
BEGIN
  SELECT count(*) INTO v_tours FROM public.tours;
  IF v_tours > 1 THEN
    RAISE EXCEPTION 'พบทริป % รายการ — rollback ไม่ปลอดภัย ให้กู้จาก backup แทน', v_tours;
  END IF;

  -- มีเนื้อหาที่ fork ออกมาหลัง migrate หรือยัง
  IF to_regclass('public.guide_articles') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='guide_articles'
                   AND column_name='is_library')
  THEN
    SELECT count(*) INTO v_forked FROM public.guide_articles WHERE is_library = false;
    IF v_forked > 0 THEN
      RAISE EXCEPTION 'พบบทความที่ fork แล้ว % แถว — rollback จะทำให้ข้อมูลกำพร้า', v_forked;
    END IF;
  END IF;
END $$;


-- =====================================================================
-- PART 2 — คลังเนื้อหา
-- =====================================================================
DROP VIEW IF EXISTS public.v_tour_form_fields;
DROP VIEW IF EXISTS public.v_tour_guide_categories;
DROP VIEW IF EXISTS public.v_tour_guide_articles;
DROP VIEW IF EXISTS public.v_tour_phrasebook;
DROP VIEW IF EXISTS public.v_tour_emergency_contacts;

DROP FUNCTION IF EXISTS public.clone_tour_assignments(uuid, uuid);
DROP FUNCTION IF EXISTS public.fork_content(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.assign_destination_library(uuid, boolean);

-- junction tables (ข้อมูลในนี้สร้างจาก backfill ทั้งหมด ไม่มีอะไรหาย)
DROP TABLE IF EXISTS public.tour_form_fields;
DROP TABLE IF EXISTS public.tour_guide_categories;
DROP TABLE IF EXISTS public.tour_guide_articles;
DROP TABLE IF EXISTS public.tour_phrasebook_entries;
DROP TABLE IF EXISTS public.tour_emergency_contacts;

-- คืน destination_id / is_library ออกจากตารางคลัง
DO $$
DECLARE v_tbl text;
  v_tables text[] := ARRAY['form_fields','guide_categories','guide_articles',
                           'phrasebook_entries','emergency_contacts'];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      EXECUTE format('DROP INDEX IF EXISTS public.%I', v_tbl || '_destination_idx');
      EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS destination_id', v_tbl);
      EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS is_library', v_tbl);
      -- คืน NOT NULL ของ tour_id (ทำได้เพราะทุกแถวยังมี tour_id เดิมอยู่)
      BEGIN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tour_id SET NOT NULL', v_tbl);
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'ข้าม SET NOT NULL ของ %.tour_id (%)', v_tbl, SQLERRM;
      END;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.tours DROP CONSTRAINT IF EXISTS tours_destination_fkey;
ALTER TABLE public.tours DROP COLUMN IF EXISTS destination_id;
DROP TABLE IF EXISTS public.destinations;


-- =====================================================================
-- PART 1 — ทริป + ทีมงาน
-- =====================================================================
DROP VIEW IF EXISTS public.v_tour_staff;

DROP FUNCTION IF EXISTS public.reset_tour_runtime_data(uuid, text);
DROP FUNCTION IF EXISTS public.purge_tour_personal_data(uuid, text);
DROP FUNCTION IF EXISTS public.unarchive_tour(uuid);
DROP FUNCTION IF EXISTS public.archive_tour(uuid);
DROP FUNCTION IF EXISTS public.clone_tour(uuid, text, date, date,
       boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public._clone_parent_child(text, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public._clone_flat_table(text, uuid, uuid);
DROP FUNCTION IF EXISTS public._clone_sel_list(text, text[], uuid, text, uuid);
DROP FUNCTION IF EXISTS public._clone_col_list(text, text[]);
DROP FUNCTION IF EXISTS public.resolve_tour_by_code(text);
DROP FUNCTION IF EXISTS public.generate_join_code(int);

DROP TABLE IF EXISTS public.tour_staff;

-- ลบ org owner ที่ migration สร้างให้ (แถวที่มี org_role เท่านั้น)
DELETE FROM public.staff WHERE org_role IS NOT NULL;

ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_org_role_check;
DROP INDEX IF EXISTS public.staff_org_role_idx;
DROP INDEX IF EXISTS public.staff_org_code_key;
ALTER TABLE public.staff
  DROP COLUMN IF EXISTS org_role,
  DROP COLUMN IF EXISTS staff_code,
  DROP COLUMN IF EXISTS is_active;
-- คืน NOT NULL (ทำได้เพราะไม่มีแถว org_role เหลือแล้ว)
DO $$
BEGIN
  ALTER TABLE public.staff ALTER COLUMN tour_id SET NOT NULL;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'ข้าม SET NOT NULL ของ staff.tour_id (%)', SQLERRM;
END $$;

ALTER TABLE public.tours DROP CONSTRAINT IF EXISTS tours_cloned_from_fkey;
ALTER TABLE public.tours DROP CONSTRAINT IF EXISTS tours_status_check;
DROP INDEX IF EXISTS public.tours_join_code_key;
DROP INDEX IF EXISTS public.tours_status_idx;
DROP INDEX IF EXISTS public.tours_org_id_idx;
ALTER TABLE public.tours
  DROP COLUMN IF EXISTS join_code,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS starts_on,
  DROP COLUMN IF EXISTS ends_on,
  DROP COLUMN IF EXISTS is_template,
  DROP COLUMN IF EXISTS cloned_from,
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS personal_data_purged_at;
-- ไม่ลบ created_at — ไม่มีผลเสีย และอาจมีอยู่ก่อนแล้ว

-- index tour_id ที่เพิ่ม: ปล่อยไว้ได้ ไม่มีผลเสีย (แค่ query เร็วขึ้น)

COMMIT;
