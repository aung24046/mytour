-- =====================================================================
-- MyTour — Multi-Tour Part 2: คลังเนื้อหาใช้ร่วม + override ต่อทริป
-- วันที่: 2026-07-28  ·  รันหลัง 20260728_multi_tour.sql เท่านั้น
--
-- Pattern: Definition (คลัง) ↔ Assignment (junction ต่อทริป + override)
--
-- ⚠️ หลักการเดิม: ADDITIVE ONLY
--    - แถวเดิม "ไม่ถูกย้าย ไม่ถูกลบ ไม่เปลี่ยน id"
--    - guest_form_responses.field_id ที่ชี้อยู่ ยังชี้ถูกทุกแถว
--    - คอลัมน์ tour_id เดิมบนตารางคลัง "ยังอยู่" → โค้ดเก่ายังทำงานได้
--      ระหว่างทยอยแก้ทีละไฟล์
-- =====================================================================

BEGIN;

-- ตรวจว่ารัน part 1 แล้ว
DO $$
BEGIN
  IF to_regclass('public.tour_staff') IS NULL THEN
    RAISE EXCEPTION 'ต้องรัน 20260728_multi_tour.sql (part 1) ก่อน';
  END IF;
END $$;


-- =====================================================================
-- SECTION 1 — destinations (ปลายทาง/ประเทศ) — ขอบเขตของคลังเนื้อหา
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.destinations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  name         text NOT NULL,              -- 'ญี่ปุ่น', 'เกาหลี', 'เชียงใหม่'
  country_code text,                       -- 'JP', 'KR', 'TH'
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS destinations_org_idx ON public.destinations (org_id);

ALTER TABLE public.tours
  ADD COLUMN IF NOT EXISTS destination_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tours_destination_fkey') THEN
    ALTER TABLE public.tours
      ADD CONSTRAINT tours_destination_fkey
      FOREIGN KEY (destination_id) REFERENCES public.destinations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill: สร้างปลายทางตั้งต้น 1 อัน แล้วผูกทริปที่ยังไม่มี
DO $$
DECLARE v_org uuid; v_dest uuid;
BEGIN
  FOR v_org IN SELECT DISTINCT org_id FROM public.tours WHERE org_id IS NOT NULL LOOP
    SELECT id INTO v_dest FROM public.destinations
    WHERE org_id = v_org AND name = 'ทั่วไป';

    IF v_dest IS NULL THEN
      INSERT INTO public.destinations (org_id, name, note)
      VALUES (v_org, 'ทั่วไป', 'สร้างอัตโนมัติตอน migrate — เปลี่ยนชื่อ/แยกตามประเทศได้ทีหลัง')
      RETURNING id INTO v_dest;
    END IF;

    UPDATE public.tours SET destination_id = v_dest
    WHERE org_id = v_org AND destination_id IS NULL;
  END LOOP;
END $$;


-- =====================================================================
-- SECTION 2 — เติม destination_id ให้ตารางคลัง (ไม่ลบ tour_id เดิม)
-- =====================================================================
DO $$
DECLARE v_tbl text;
  v_tables text[] := ARRAY['form_fields','guide_categories','guide_articles',
                           'phrasebook_entries','emergency_contacts'];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS destination_id uuid', v_tbl);
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS is_library boolean NOT NULL DEFAULT false', v_tbl);

      -- ตารางคลังไม่ควรบังคับ tour_id อีกต่อไป (เนื้อหาคลังไม่ผูกทริป)
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=v_tbl
                   AND column_name='tour_id' AND is_nullable='NO')
      THEN
        EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tour_id DROP NOT NULL', v_tbl);
      END IF;

      -- form_fields เป็น org-scope (คำถามใช้ได้ทุกปลายทาง) จึงไม่ผูก destination
      IF v_tbl <> 'form_fields' THEN
        EXECUTE format($q$
          UPDATE public.%I c
          SET destination_id = t.destination_id, is_library = true
          FROM public.tours t
          WHERE c.tour_id = t.id AND c.destination_id IS NULL
        $q$, v_tbl);
      ELSE
        EXECUTE format('UPDATE public.%I SET is_library = true WHERE is_library = false', v_tbl);
      END IF;

      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (destination_id)',
                     v_tbl || '_destination_idx', v_tbl);
    END IF;
  END LOOP;
END $$;


-- =====================================================================
-- SECTION 3 — Junction tables (การมอบหมาย + override ต่อทริป)
-- =====================================================================

-- 3.1 ฟอร์มลงทะเบียน ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tour_form_fields (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id          uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  field_id         uuid NOT NULL REFERENCES public.form_fields(id) ON DELETE CASCADE,
  is_active        boolean NOT NULL DEFAULT true,
  is_required      boolean,          -- NULL = ใช้ค่าจากคลัง
  sort_order       int NOT NULL DEFAULT 0,
  label_override   text,
  options_override jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tour_id, field_id)
);
CREATE INDEX IF NOT EXISTS tour_form_fields_tour_idx ON public.tour_form_fields (tour_id);

-- 3.2 หมวดคู่มือ ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tour_guide_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id     uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.guide_categories(id) ON DELETE CASCADE,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tour_id, category_id)
);
CREATE INDEX IF NOT EXISTS tour_guide_categories_tour_idx ON public.tour_guide_categories (tour_id);

-- 3.3 บทความคู่มือ ────────────────────────────────────────────────
-- itinerary_item_id ย้ายมาอยู่ที่นี่ — บทความเดียวผูกกำหนดการคนละ item ต่อทริป
CREATE TABLE IF NOT EXISTS public.tour_guide_articles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id           uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  article_id        uuid NOT NULL REFERENCES public.guide_articles(id) ON DELETE CASCADE,
  is_published      boolean NOT NULL DEFAULT true,
  is_featured       boolean NOT NULL DEFAULT false,
  sort_order        int NOT NULL DEFAULT 0,
  itinerary_item_id uuid,
  title_override    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tour_id, article_id)
);
CREATE INDEX IF NOT EXISTS tour_guide_articles_tour_idx ON public.tour_guide_articles (tour_id);

-- 3.4 ศัพท์/ประโยค ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tour_phrasebook_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id              uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  entry_id             uuid NOT NULL REFERENCES public.phrasebook_entries(id) ON DELETE CASCADE,
  is_active            boolean NOT NULL DEFAULT true,
  sort_order           int NOT NULL DEFAULT 0,
  itinerary_item_id    uuid,
  place_label_override text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tour_id, entry_id)
);
CREATE INDEX IF NOT EXISTS tour_phrasebook_tour_idx ON public.tour_phrasebook_entries (tour_id);

-- 3.5 เบอร์ฉุกเฉิน ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tour_emergency_contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id    uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.emergency_contacts(id) ON DELETE CASCADE,
  is_active  boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tour_id, contact_id)
);
CREATE INDEX IF NOT EXISTS tour_emergency_tour_idx ON public.tour_emergency_contacts (tour_id);


-- =====================================================================
-- SECTION 4 — Backfill junction จากข้อมูลเดิม (คงค่า is_active/sort เดิม)
-- =====================================================================

-- 4.1 form_fields
-- is_required ปล่อย NULL = สืบทอดค่าจากคลัง (ทริปไหนอยากต่างค่อยตั้งทับ)
INSERT INTO public.tour_form_fields (tour_id, field_id, is_active, is_required, sort_order)
SELECT f.tour_id, f.id, coalesce(f.is_active, true), NULL, coalesce(f.sort_order, 0)
FROM public.form_fields f
WHERE f.tour_id IS NOT NULL
ON CONFLICT (tour_id, field_id) DO NOTHING;

-- 4.2 guide_categories
INSERT INTO public.tour_guide_categories (tour_id, category_id, is_active, sort_order)
SELECT c.tour_id, c.id, coalesce(c.is_active, true), coalesce(c.sort_order, 0)
FROM public.guide_categories c
WHERE c.tour_id IS NOT NULL
ON CONFLICT (tour_id, category_id) DO NOTHING;

-- 4.3 guide_articles (ยก itinerary_item_id เดิมมาที่ junction)
INSERT INTO public.tour_guide_articles
  (tour_id, article_id, is_published, is_featured, sort_order, itinerary_item_id)
SELECT a.tour_id, a.id,
       coalesce(a.is_published, true), coalesce(a.is_featured, false),
       coalesce(a.sort_order, 0), a.itinerary_item_id
FROM public.guide_articles a
WHERE a.tour_id IS NOT NULL
ON CONFLICT (tour_id, article_id) DO NOTHING;

-- 4.4 phrasebook_entries
INSERT INTO public.tour_phrasebook_entries
  (tour_id, entry_id, is_active, sort_order, itinerary_item_id)
SELECT p.tour_id, p.id, true, coalesce(p.sort_order, 0), p.itinerary_item_id
FROM public.phrasebook_entries p
WHERE p.tour_id IS NOT NULL
ON CONFLICT (tour_id, entry_id) DO NOTHING;

-- 4.5 emergency_contacts
INSERT INTO public.tour_emergency_contacts (tour_id, contact_id, is_active, sort_order)
SELECT e.tour_id, e.id, coalesce(e.is_active, true), coalesce(e.sort_order, 0)
FROM public.emergency_contacts e
WHERE e.tour_id IS NOT NULL
ON CONFLICT (tour_id, contact_id) DO NOTHING;


-- =====================================================================
-- SECTION 5 — Views ที่แอปอ่าน (คอลัมน์ชื่อเดิม + tour_id → โค้ดแทบไม่เปลี่ยน)
-- อ่านผ่าน view / เขียนลงตารางฐาน (view มี join → เขียนตรงไม่ได้)
-- =====================================================================

CREATE OR REPLACE VIEW public.v_tour_form_fields AS
SELECT
  j.tour_id,
  f.id,
  j.id AS assignment_id,
  f.field_key, f.field_type, f.field_purpose, f.is_core,
  f.form_type,                              -- 'register' | 'feedback'
  f.category,
  COALESCE(j.label_override, f.label)     AS label,
  COALESCE(j.options_override, f.options) AS options,
  j.is_active,
  COALESCE(j.is_required, f.is_required)  AS is_required,   -- NULL = สืบทอดจากคลัง
  j.sort_order,
  (j.label_override IS NOT NULL OR j.options_override IS NOT NULL) AS has_override,
  (SELECT count(*) FROM public.tour_form_fields x WHERE x.field_id = f.id) AS used_in_tours
FROM public.tour_form_fields j
JOIN public.form_fields f ON f.id = j.field_id;

CREATE OR REPLACE VIEW public.v_tour_guide_categories AS
SELECT
  j.tour_id, c.id, j.id AS assignment_id,
  c.label_th, c.label_en, c.label_zh, c.icon, c.color, c.layout,
  j.is_active, j.sort_order
FROM public.tour_guide_categories j
JOIN public.guide_categories c ON c.id = j.category_id;

CREATE OR REPLACE VIEW public.v_tour_guide_articles AS
SELECT
  j.tour_id, a.id, j.id AS assignment_id,
  a.category_id,
  COALESCE(j.title_override, a.title) AS title,
  a.body, a.source_url, a.maps_url, a.province, a.image_url,
  j.itinerary_item_id,          -- ← มาจาก junction ไม่ใช่จากตัวบทความ
  j.is_published, j.is_featured, j.sort_order,
  (SELECT count(*) FROM public.tour_guide_articles x WHERE x.article_id = a.id) AS used_in_tours
FROM public.tour_guide_articles j
JOIN public.guide_articles a ON a.id = j.article_id;

CREATE OR REPLACE VIEW public.v_tour_phrasebook AS
SELECT
  j.tour_id, p.id, j.id AS assignment_id,
  p.category_l1, p.category_l2, p.phrase,
  COALESCE(j.place_label_override, p.place_label) AS place_label,
  p.translation_zh, p.pronunciation_zh, p.translation_en,
  j.itinerary_item_id, j.is_active, j.sort_order
FROM public.tour_phrasebook_entries j
JOIN public.phrasebook_entries p ON p.id = j.entry_id;

CREATE OR REPLACE VIEW public.v_tour_emergency_contacts AS
SELECT
  j.tour_id, e.id, j.id AS assignment_id,
  e.label, e.phone, e.category,
  j.is_active, j.sort_order
FROM public.tour_emergency_contacts j
JOIN public.emergency_contacts e ON e.id = j.contact_id;

GRANT SELECT ON
  public.v_tour_form_fields,
  public.v_tour_guide_categories,
  public.v_tour_guide_articles,
  public.v_tour_phrasebook,
  public.v_tour_emergency_contacts
TO anon, authenticated;


-- =====================================================================
-- SECTION 6 — RPC: มอบหมายคลังเข้าทริป + fork
-- =====================================================================

-- 6.1 ดึงเนื้อหาคลังของปลายทางเข้าทริป (ใช้ตอนสร้างทริปใหม่)
CREATE OR REPLACE FUNCTION public.assign_destination_library(
  p_tour_id  uuid,
  p_activate boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_dest uuid; v_org uuid; v_res jsonb := '{}'::jsonb; v_n bigint;
BEGIN
  SELECT destination_id, org_id INTO v_dest, v_org FROM tours WHERE id = p_tour_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'assign_destination_library: ไม่พบทริป %', p_tour_id;
  END IF;

  -- ฟอร์ม: org-scope (ทุกปลายทางใช้ร่วม)
  INSERT INTO tour_form_fields (tour_id, field_id, is_active, sort_order)
  SELECT p_tour_id, f.id, p_activate, coalesce(f.sort_order, 0)
  FROM form_fields f
  WHERE f.is_library = true
    AND (f.tour_id IS NULL OR f.tour_id IN (SELECT id FROM tours WHERE org_id = v_org))
  ON CONFLICT (tour_id, field_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('form_fields', v_n);

  IF v_dest IS NOT NULL THEN
    INSERT INTO tour_guide_categories (tour_id, category_id, is_active, sort_order)
    SELECT p_tour_id, c.id, p_activate, coalesce(c.sort_order, 0)
    FROM guide_categories c WHERE c.destination_id = v_dest AND c.is_library = true
    ON CONFLICT (tour_id, category_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('guide_categories', v_n);

    INSERT INTO tour_guide_articles (tour_id, article_id, is_published, sort_order)
    SELECT p_tour_id, a.id, p_activate, coalesce(a.sort_order, 0)
    FROM guide_articles a WHERE a.destination_id = v_dest AND a.is_library = true
    ON CONFLICT (tour_id, article_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('guide_articles', v_n);

    INSERT INTO tour_phrasebook_entries (tour_id, entry_id, is_active, sort_order)
    SELECT p_tour_id, p.id, p_activate, coalesce(p.sort_order, 0)
    FROM phrasebook_entries p WHERE p.destination_id = v_dest AND p.is_library = true
    ON CONFLICT (tour_id, entry_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('phrasebook', v_n);

    INSERT INTO tour_emergency_contacts (tour_id, contact_id, is_active, sort_order)
    SELECT p_tour_id, e.id, p_activate, coalesce(e.sort_order, 0)
    FROM emergency_contacts e WHERE e.destination_id = v_dest AND e.is_library = true
    ON CONFLICT (tour_id, contact_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('emergency_contacts', v_n);
  END IF;

  RETURN v_res;
END $fn$;


-- 6.2 FORK — "แยกสำเนาเฉพาะทริปนี้"
-- ก๊อปแถวคลังเป็นแถวใหม่ที่ผูกทริปนี้อย่างเดียว แล้วชี้ junction มาที่ตัวใหม่
-- → แก้ต่อได้โดยไม่กระทบทริปอื่นที่ใช้ต้นฉบับอยู่
CREATE OR REPLACE FUNCTION public.fork_content(
  p_table   text,      -- 'form_fields' | 'guide_articles' | 'phrasebook_entries' |
                       -- 'guide_categories' | 'emergency_contacts'
  p_row_id  uuid,
  p_tour_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_new_id   uuid := gen_random_uuid();
  v_cols     text;
  v_junction text;
  v_fk       text;
BEGIN
  -- map ตาราง → junction + ชื่อคอลัมน์ FK
  SELECT j, fk INTO v_junction, v_fk FROM (VALUES
    ('form_fields',        'tour_form_fields',        'field_id'),
    ('guide_categories',   'tour_guide_categories',   'category_id'),
    ('guide_articles',     'tour_guide_articles',     'article_id'),
    ('phrasebook_entries', 'tour_phrasebook_entries', 'entry_id'),
    ('emergency_contacts', 'tour_emergency_contacts', 'contact_id')
  ) AS m(t, j, fk) WHERE m.t = p_table;

  IF v_junction IS NULL THEN
    RAISE EXCEPTION 'fork_content: ไม่รองรับตาราง %', p_table;
  END IF;

  -- คอลัมน์ทั้งหมดยกเว้น id / created_at / updated_at
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  INTO v_cols
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name=p_table
    AND is_generated = 'NEVER'
    AND column_name NOT IN ('id','created_at','updated_at');

  -- ก๊อปแถว: destination_id = NULL, tour_id = ทริปนี้, is_library = false
  EXECUTE format($q$
    INSERT INTO public.%1$I (id, %2$s)
    SELECT $2, %2$s FROM public.%1$I WHERE id = $1
  $q$, p_table, v_cols) USING p_row_id, v_new_id;

  EXECUTE format(
    'UPDATE public.%I SET destination_id = NULL, is_library = false, tour_id = $2 WHERE id = $1',
    p_table
  ) USING v_new_id, p_tour_id;

  -- ชี้ junction ของทริปนี้มาที่สำเนาใหม่
  EXECUTE format('UPDATE public.%I SET %I = $3 WHERE tour_id = $1 AND %I = $2',
                 v_junction, v_fk, v_fk)
  USING p_tour_id, p_row_id, v_new_id;

  RETURN v_new_id;
END $fn$;


-- 6.3 อัปเดต clone_tour ให้ก๊อป "การมอบหมาย" แทนการก๊อปเนื้อหา
-- (เนื้อหาอยู่ในคลังแล้ว ไม่ต้องซ้ำ — ทริปใหม่แค่ชี้มาที่เดิม)
CREATE OR REPLACE FUNCTION public.clone_tour_assignments(
  p_source_tour_id uuid,
  p_new_tour_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE v_res jsonb := '{}'::jsonb; v_n bigint;
BEGIN
  INSERT INTO tour_form_fields (tour_id, field_id, is_active, is_required, sort_order,
                                label_override, options_override)
  SELECT p_new_tour_id, field_id, is_active, is_required, sort_order,
         label_override, options_override
  FROM tour_form_fields WHERE tour_id = p_source_tour_id
  ON CONFLICT (tour_id, field_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('form_fields', v_n);

  INSERT INTO tour_guide_categories (tour_id, category_id, is_active, sort_order)
  SELECT p_new_tour_id, category_id, is_active, sort_order
  FROM tour_guide_categories WHERE tour_id = p_source_tour_id
  ON CONFLICT (tour_id, category_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('guide_categories', v_n);

  -- itinerary_item_id ไม่ก๊อป — กำหนดการของทริปใหม่เป็นคนละ item
  INSERT INTO tour_guide_articles (tour_id, article_id, is_published, is_featured,
                                   sort_order, title_override)
  SELECT p_new_tour_id, article_id, is_published, is_featured, sort_order, title_override
  FROM tour_guide_articles WHERE tour_id = p_source_tour_id
  ON CONFLICT (tour_id, article_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('guide_articles', v_n);

  INSERT INTO tour_phrasebook_entries (tour_id, entry_id, is_active, sort_order,
                                       place_label_override)
  SELECT p_new_tour_id, entry_id, is_active, sort_order, place_label_override
  FROM tour_phrasebook_entries WHERE tour_id = p_source_tour_id
  ON CONFLICT (tour_id, entry_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('phrasebook', v_n);

  INSERT INTO tour_emergency_contacts (tour_id, contact_id, is_active, sort_order)
  SELECT p_new_tour_id, contact_id, is_active, sort_order
  FROM tour_emergency_contacts WHERE tour_id = p_source_tour_id
  ON CONFLICT (tour_id, contact_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_res := v_res || jsonb_build_object('emergency_contacts', v_n);

  RETURN v_res;
END $fn$;


-- =====================================================================
-- SECTION 7 — ตรวจผลลัพธ์
-- =====================================================================
DO $$
DECLARE
  v_src int; v_dst int; v_orphan int;
BEGIN
  RAISE NOTICE '=== ผลลัพธ์ part 2 ===';

  SELECT count(*) INTO v_src FROM public.form_fields WHERE tour_id IS NOT NULL;
  SELECT count(*) INTO v_dst FROM public.tour_form_fields;
  RAISE NOTICE 'form_fields เดิม % → junction % (ต้อง >= )', v_src, v_dst;
  IF v_dst < v_src THEN
    RAISE EXCEPTION 'tour_form_fields ไม่ครบ — rollback';
  END IF;

  SELECT count(*) INTO v_src FROM public.guide_articles WHERE tour_id IS NOT NULL;
  SELECT count(*) INTO v_dst FROM public.tour_guide_articles;
  RAISE NOTICE 'guide_articles เดิม % → junction %', v_src, v_dst;
  IF v_dst < v_src THEN
    RAISE EXCEPTION 'tour_guide_articles ไม่ครบ — rollback';
  END IF;

  -- คำตอบฟอร์มต้องไม่มีแถวกำพร้า (นี่คือจุดที่เสี่ยงข้อมูลหายที่สุด)
  IF to_regclass('public.guest_form_responses') IS NOT NULL THEN
    SELECT count(*) INTO v_orphan
    FROM public.guest_form_responses r
    LEFT JOIN public.form_fields f ON f.id = r.field_id
    WHERE f.id IS NULL;
    RAISE NOTICE 'guest_form_responses กำพร้า: % (ต้อง 0)', v_orphan;
    IF v_orphan > 0 THEN
      RAISE EXCEPTION 'พบคำตอบฟอร์มกำพร้า % แถว — rollback', v_orphan;
    END IF;
  END IF;

  SELECT count(*) INTO v_src FROM public.tours WHERE destination_id IS NULL;
  RAISE NOTICE 'ทริปที่ยังไม่มี destination: % (ควร 0)', v_src;

  RAISE NOTICE '✅ part 2 ผ่านทั้งหมด';
END $$;

COMMIT;

-- ---------------------------------------------------------------------
-- ตรวจด้วยตาหลัง COMMIT
-- ---------------------------------------------------------------------
-- SELECT * FROM public.v_tour_form_fields ORDER BY tour_id, sort_order;
-- SELECT name, join_code, (SELECT name FROM destinations d WHERE d.id = t.destination_id) AS dest
-- FROM public.tours t;
