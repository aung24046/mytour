-- =====================================================================
-- สุ่มรายชื่อ (Lucky draw) — 18 ส.ค. 2026
-- =====================================================================
-- เกมที่สองต่อจากบิงโก ใช้จับรางวัลหรือสุ่มคนออกมาเล่นกิจกรรม
--
-- โครงสร้าง 3 ตาราง:
--   draw_rooms   — "ห้องสุ่ม" หนึ่งทริปมีได้หลายห้อง (รถคัน 1 / รถคัน 2 / ห้องอาหาร)
--                  แต่ละห้องถือตัวกรองรายชื่อ ตัวเลือกการเฉลย และสถานะรอบปัจจุบัน
--   draw_prizes  — รางวัลของห้องนั้น พร้อมจำนวนที่ยังไม่ได้จ่าย
--   draw_results — ผู้ที่ถูกสุ่มแล้วยืนยันรับ (แถวนี้คือ "ความจริง" ของประวัติ)
--
-- ทำไมห้องต้องแยกตาราง ไม่ใช่ใส่ tour_id ไว้ที่ผลลัพธ์เฉยๆ:
--   งานจริงเล่นพร้อมกันหลายคัน แต่ละคันมีรางวัลและกติกาคนละชุด
--   ถ้าไม่มีห้อง ทีมงานสองคนจะแย่งกันแก้ค่าเดียวกันจนพัง (บทเรียนจาก bingo_games)
--
-- ทำไมเก็บ display_name ซ้ำใน draw_results:
--   ประกาศบนเวทีใช้ "ชื่อเล่น" ซึ่งทีมงานแก้เฉพาะกิจได้ต่อห้อง (เช่น ชื่อเล่นซ้ำกัน)
--   และถ้าลูกทัวร์ถูกลบทีหลัง ใบเซ็นรับรางวัลที่พิมพ์ไปแล้วต้องยังตรวจย้อนได้
--
-- RLS: เปิดกว้างแบบเดียวกับตารางอื่นในโปรเจกต์ — การป้องกันจริงอยู่ที่ชั้นแอป
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- =====================================================================

BEGIN;

-- ── 1. ห้องสุ่ม ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.draw_rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id     uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT 'ห้องสุ่ม',

  -- ตัวกรองรายชื่อ เลือกได้ทีละอัน: all | bus | custom
  filter_kind text NOT NULL DEFAULT 'all',
  filter_bus  uuid REFERENCES public.buses(id) ON DELETE SET NULL,
  -- ชื่อกลุ่มที่ทีมงานตั้งเอง ใช้เมื่อ filter_kind = 'custom'
  custom_name text NOT NULL DEFAULT 'กลุ่มพิเศษ',
  -- สมาชิกของกลุ่ม custom / คนที่ถูกติ๊กออก / ชื่อเล่นที่แก้เฉพาะห้องนี้
  custom_ids  uuid[] NOT NULL DEFAULT '{}',
  excluded_ids uuid[] NOT NULL DEFAULT '{}',
  nicknames   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- คนนอกระบบที่พิมพ์เพิ่มเอง เช่น คนขับ ไกด์ท้องถิ่น: [{ "id": "x1", "name": "พี่คนขับ" }]
  extras      jsonb NOT NULL DEFAULT '[]'::jsonb,

  checkin_only boolean NOT NULL DEFAULT true,
  no_repeat    boolean NOT NULL DEFAULT true,
  need_confirm boolean NOT NULL DEFAULT true,
  use_prizes   boolean NOT NULL DEFAULT true,

  draw_count  integer NOT NULL DEFAULT 1,          -- สุ่มครั้งละกี่คน
  reveal_animation text NOT NULL DEFAULT 'slot',   -- slot | wheel | elim
  stage_theme text NOT NULL DEFAULT 'led',         -- ธีมจอใหญ่

  -- รอบล่าสุด: ใช้ให้จอใหญ่กับมือถือลูกทัวร์เล่นอนิเมชันเดียวกัน
  round_no    integer NOT NULL DEFAULT 0,
  round_seed  text,
  -- ผลรอบล่าสุดที่ยังไม่ยืนยัน: [{ "guest_id": ..., "name": ..., "nickname": ... }]
  pending     jsonb,
  pending_prize_id uuid,
  drawn_at    timestamptz,

  status      text NOT NULL DEFAULT 'open',        -- open | archived
  created_by  uuid REFERENCES public.tour_staff(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'draw_rooms_filter_kind_check') THEN
    ALTER TABLE public.draw_rooms ADD CONSTRAINT draw_rooms_filter_kind_check
      CHECK (filter_kind IN ('all', 'bus', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'draw_rooms_animation_check') THEN
    ALTER TABLE public.draw_rooms ADD CONSTRAINT draw_rooms_animation_check
      CHECK (reveal_animation IN ('slot', 'wheel', 'elim'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'draw_rooms_status_check') THEN
    ALTER TABLE public.draw_rooms ADD CONSTRAINT draw_rooms_status_check
      CHECK (status IN ('open', 'archived'));
  END IF;
  -- สุ่มหลายคนใช้ได้เฉพาะแบบคัดออก — สล็อตกับวงล้อเฉลยได้ทีละชื่อ
  -- บังคับที่ DB ด้วย ไม่ใช่แค่ที่ UI เพราะจอใหญ่อ่านค่านี้ไปเล่นอนิเมชันตรงๆ
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'draw_rooms_count_animation_check') THEN
    ALTER TABLE public.draw_rooms ADD CONSTRAINT draw_rooms_count_animation_check
      CHECK (draw_count = 1 OR reveal_animation = 'elim');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'draw_rooms_count_range_check') THEN
    ALTER TABLE public.draw_rooms ADD CONSTRAINT draw_rooms_count_range_check
      CHECK (draw_count BETWEEN 1 AND 20);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS draw_rooms_tour_idx ON public.draw_rooms (tour_id, status, created_at);


-- ── 2. รางวัล ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.draw_prizes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid NOT NULL REFERENCES public.draw_rooms(id) ON DELETE CASCADE,
  name       text NOT NULL,
  qty        integer NOT NULL DEFAULT 1,
  -- คงเหลือ = qty ลบจำนวนที่จ่ายไปแล้ว เก็บแยกเพราะแก้ qty ระหว่างงานได้
  qty_left   integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  image_url  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'draw_prizes_qty_check') THEN
    ALTER TABLE public.draw_prizes ADD CONSTRAINT draw_prizes_qty_check
      CHECK (qty >= 0 AND qty_left >= 0 AND qty_left <= qty);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS draw_prizes_room_idx ON public.draw_prizes (room_id, sort_order);

-- ห้องหนึ่งชี้รางวัลที่ "กำลังสุ่มอยู่" ได้หนึ่งชิ้น — ผูกทีหลังเพราะอ้างกันไปมา
ALTER TABLE public.draw_rooms
  ADD COLUMN IF NOT EXISTS current_prize_id uuid REFERENCES public.draw_prizes(id) ON DELETE SET NULL;


-- ── 3. ผู้ได้รับรางวัล ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.draw_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid NOT NULL REFERENCES public.draw_rooms(id) ON DELETE CASCADE,
  -- ว่างได้ เพราะคนนอกระบบ (คนขับ ไกด์ท้องถิ่น) ไม่มีแถวใน guests
  guest_id    uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  display_name text NOT NULL,                      -- ชื่อเล่นที่ประกาศบนเวที
  full_name    text NOT NULL DEFAULT '',           -- ชื่อจริง ณ ตอนสุ่ม
  prize_id    uuid REFERENCES public.draw_prizes(id) ON DELETE SET NULL,
  prize_name  text,                                -- สำเนาชื่อรางวัล กันรางวัลถูกลบทีหลัง
  round_no    integer NOT NULL DEFAULT 0,
  seq         integer NOT NULL DEFAULT 0,          -- ลำดับภายในรอบ (สุ่มหลายคน)
  seed        text,                                -- ตรวจย้อนได้ว่ารอบนั้นใช้ seed อะไร
  was_reroll  boolean NOT NULL DEFAULT false,      -- มาแทนคนที่ไม่อยู่
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS draw_results_room_idx ON public.draw_results (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS draw_results_guest_idx ON public.draw_results (guest_id);


-- ── 4. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.draw_rooms   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draw_prizes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draw_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS draw_rooms_read ON public.draw_rooms;
CREATE POLICY draw_rooms_read ON public.draw_rooms FOR SELECT USING (true);
DROP POLICY IF EXISTS draw_rooms_write ON public.draw_rooms;
CREATE POLICY draw_rooms_write ON public.draw_rooms FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS draw_prizes_read ON public.draw_prizes;
CREATE POLICY draw_prizes_read ON public.draw_prizes FOR SELECT USING (true);
DROP POLICY IF EXISTS draw_prizes_write ON public.draw_prizes;
CREATE POLICY draw_prizes_write ON public.draw_prizes FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS draw_results_read ON public.draw_results;
CREATE POLICY draw_results_read ON public.draw_results FOR SELECT USING (true);
DROP POLICY IF EXISTS draw_results_write ON public.draw_results;
CREATE POLICY draw_results_write ON public.draw_results FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.draw_rooms   TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.draw_prizes  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.draw_results TO anon, authenticated;


-- ── 5. หักจำนวนรางวัลแบบ atomic ─────────────────────────────────────
-- ทีมงานสองคนกดยืนยันพร้อมกันได้ ถ้าอ่านมาลบแล้วเขียนกลับฝั่ง client
-- รางวัลชิ้นสุดท้ายจะถูกจ่ายสองครั้ง (ปัญหาเดียวกับ called_numbers ของบิงโก)
CREATE OR REPLACE FUNCTION public.draw_claim_prize(p_prize_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_left integer;
BEGIN
  IF p_prize_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.draw_prizes
     SET qty_left = qty_left - 1
   WHERE id = p_prize_id AND qty_left > 0
  RETURNING qty_left INTO v_left;

  -- ของหมดพอดี → คืน NULL ให้ฝั่งแอปรู้ว่าคนนี้ไม่ได้ผูกรางวัล
  RETURN v_left;
END $$;

GRANT EXECUTE ON FUNCTION public.draw_claim_prize(uuid) TO anon, authenticated;


-- ── 6. Realtime ─────────────────────────────────────────────────────
-- จอใหญ่กับมือถือลูกทัวร์ต้องเห็นรอบเดียวกันพร้อมกัน
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'draw_rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draw_rooms;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'draw_results'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.draw_results;
  END IF;
END $$;

COMMIT;

-- ── ย้อนกลับ (ถ้าต้องถอน) ────────────────────────────────────────────
-- BEGIN;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.draw_results;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.draw_rooms;
--   DROP FUNCTION IF EXISTS public.draw_claim_prize(uuid);
--   DROP TABLE IF EXISTS public.draw_results;
--   ALTER TABLE public.draw_rooms DROP COLUMN IF EXISTS current_prize_id;
--   DROP TABLE IF EXISTS public.draw_prizes;
--   DROP TABLE IF EXISTS public.draw_rooms;
-- COMMIT;
