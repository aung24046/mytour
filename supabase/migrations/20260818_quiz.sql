-- =====================================================================
-- ควิซตอบคำถามสด (Quiz) — เฟส 1 — 18 ส.ค. 2026
-- =====================================================================
-- เกมที่สามต่อจากบิงโกและสุ่มรายชื่อ อ้างอิง MyTour_Quiz_Design_v1.md
--
-- โครงสร้าง 7 ตาราง:
--   quiz_sets           — ชุดคำถามในคลังกลาง (ระดับบริษัท/ปลายทาง ใช้ซ้ำข้ามทริปได้)
--   quiz_questions      — ตัวคำถาม + ตัวเลือก (ลูกทัวร์อ่านได้)
--   quiz_keys           — เฉลย (ลูกทัวร์อ่านไม่ได้เด็ดขาด — ดูหมายเหตุด้านล่าง)
--   quiz_sessions       — "ห้อง" หนึ่งทริปมีได้หลายห้อง (แบบเดียวกับ bingo_games)
--   quiz_session_tokens — ความลับของคนคุมเกม (ไม่ให้ใครอ่าน)
--   quiz_players        — คนในห้อง: ลูกทัวร์ / ทีมงาน / ไกด์ท้องถิ่นที่ขึ้นรถกลางทาง
--   quiz_answers        — คำตอบรายข้อ ตอบได้ครั้งเดียว เปลี่ยนใจไม่ได้
--
-- ⚠️ ต่างจากตารางอื่นในโปรเจกต์ตรงนี้ — อ่านก่อนแก้:
--   ตารางอื่น (draw_*, bingo_*) เปิด RLS แบบ USING (true) เพราะไม่มีอะไรต้องปิด
--   แต่ควิซมี "เฉลย" ถ้าเปิดกว้างแบบเดิม ลูกทัวร์เปิด DevTools ยิง REST อ่านได้ตรงๆ
--   จึงมี 2 ตารางที่ "ไม่มี policy และถูก REVOKE" คือ quiz_keys กับ quiz_session_tokens
--   → เข้าถึงได้ทางเดียวคือผ่านฟังก์ชัน SECURITY DEFINER ในไฟล์นี้
--   ถ้าเผลอ GRANT SELECT ให้ anon เมื่อไหร่ = เกมโกงได้ทันที
--
-- ⚠️ เวลาทั้งหมดคิดจาก now() ฝั่ง server เท่านั้น ห้ามรับเวลาจาก client
--   นาฬิกามือถือแต่ละเครื่องเพี้ยนได้เป็นนาที และปลอมได้ด้วย
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- =====================================================================

BEGIN;

-- ── 1. ชุดคำถาม (คลังกลาง) ──────────────────────────────────────────
-- ทำตาม pattern Definition ↔ Assignment ของ Multi-Tour Design v2:
-- ชุด "รู้จักญี่ปุ่นแค่ไหน" ทำครั้งเดียว ใช้ได้ทุกกรุ๊ปที่ไปญี่ปุ่น
CREATE TABLE IF NOT EXISTS public.quiz_sets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  destination_id uuid REFERENCES public.destinations(id) ON DELETE SET NULL,
  title          text NOT NULL DEFAULT 'ชุดคำถามใหม่',
  description    text NOT NULL DEFAULT '',
  -- ชุดหนึ่งมีภาษาเดียว ไม่ทำ i18n รายข้อ — ถ้าบังคับกรอก 3 ภาษาต่อข้อจะไม่มีใครใช้จริง
  lang           text NOT NULL DEFAULT 'th',
  cover_url      text,
  default_time_limit integer NOT NULL DEFAULT 20,
  streak_bonus   boolean NOT NULL DEFAULT true,
  is_archived    boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_sets_org_idx ON public.quiz_sets (org_id, is_archived);
CREATE INDEX IF NOT EXISTS quiz_sets_dest_idx ON public.quiz_sets (destination_id);


-- ── 2. คำถาม (ไม่มีเฉลยอยู่ในนี้) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id        uuid NOT NULL REFERENCES public.quiz_sets(id) ON DELETE CASCADE,
  sort_order    integer NOT NULL DEFAULT 0,
  kind          text NOT NULL DEFAULT 'mcq',
  text          text NOT NULL DEFAULT '',
  media_url     text,
  media_kind    text,
  -- ตัวเลือกเป็น jsonb ไม่ใช่ตารางแยก เพราะไม่เคยถูก query แยก ไม่มี FK ชี้เข้ามา
  -- และต้องมาพร้อมคำถามเสมอ — ตารางแยกจะได้ join เปล่าๆ ทุกครั้ง
  options       jsonb NOT NULL DEFAULT '[]'::jsonb,
  numeric_unit  text NOT NULL DEFAULT '',
  time_limit_sec integer NOT NULL DEFAULT 20,
  points_factor numeric NOT NULL DEFAULT 1.0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_questions_set_idx
  ON public.quiz_questions (set_id, sort_order);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_questions_kind_check') THEN
    ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_kind_check
      CHECK (kind IN ('mcq', 'tf', 'numeric'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_questions_media_check') THEN
    ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_media_check
      CHECK (media_kind IS NULL OR media_kind IN ('image', 'video'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_questions_time_check') THEN
    ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_time_check
      CHECK (time_limit_sec BETWEEN 5 AND 300);
  END IF;
END $$;


-- ── 3. เฉลย — ตารางที่ห้ามใครอ่าน ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_keys (
  question_id    uuid PRIMARY KEY REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  correct_index  integer,
  correct_number numeric,
  explain        text NOT NULL DEFAULT ''
);


-- ── 4. ห้อง ─────────────────────────────────────────────────────────
-- หนึ่งแถว = หนึ่งห้อง เทียบเท่า bingo_games
-- รถ 2 คันเล่นพร้อมกัน = สร้าง 2 ห้อง ใส่ bus_id คนละคัน ไม่ต้องออกแบบอะไรเพิ่ม
--
-- state:
--   lobby      — เปิดห้องรอคน (ยังไม่เริ่ม)
--   answering  — เปิดข้ออยู่ — ระหว่าง now() < question_started_at คือช่วงนับถอยหลัง
--                ฝั่งจอคิดเอาเองจากเวลา ไม่ต้องมี state 'countdown' ให้ต้องมีตัวตั้งเวลาฝั่ง server
--   locked     — ปิดรับคำตอบแล้ว ยังไม่เฉลย
--   reveal     — เฉลยแล้ว (reveal_payload มีของ)
--   scoreboard — โชว์กระดานอันดับ
--   finished   — จบเกม ห้องหลุดจากรายการของลูกทัวร์
CREATE TABLE IF NOT EXISTS public.quiz_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id      uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  set_id       uuid NOT NULL REFERENCES public.quiz_sets(id) ON DELETE RESTRICT,
  name         text NOT NULL DEFAULT 'ห้องควิซ',
  -- NULL = ทั้งทริปเห็น / ระบุ = เฉพาะคนบนรถคันนั้น (เป็นตัวกรอง "ใครเห็นห้อง" ไม่ใช่การแบ่งทีม)
  bus_id       uuid REFERENCES public.buses(id) ON DELETE SET NULL,

  state        text NOT NULL DEFAULT 'lobby',
  current_index integer NOT NULL DEFAULT -1,
  current_question_id uuid REFERENCES public.quiz_questions(id) ON DELETE SET NULL,

  -- เวลาสัมบูรณ์ที่ทุกจอนับถึง — หัวใจของความยุติธรรมทั้งเกม
  question_started_at timestamptz,
  question_ends_at    timestamptz,
  locked_at           timestamptz,

  -- ใส่ของตอน state = 'reveal' เท่านั้น ก่อนหน้านั้นต้องว่าง ไม่งั้นเท่ากับแจกเฉลยล่วงหน้า
  reveal_payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  join_open    boolean NOT NULL DEFAULT true,
  late_join    boolean NOT NULL DEFAULT true,
  stage_theme  text NOT NULL DEFAULT 'led',
  screen_mode  text NOT NULL DEFAULT 'projector',

  created_by   uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);

CREATE INDEX IF NOT EXISTS quiz_sessions_tour_idx ON public.quiz_sessions (tour_id, state);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sessions_state_check') THEN
    ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_state_check
      CHECK (state IN ('lobby', 'answering', 'locked', 'reveal', 'scoreboard', 'finished'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sessions_screen_check') THEN
    ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_screen_check
      CHECK (screen_mode IN ('projector', 'bus_tv', 'none'));
  END IF;
END $$;


-- ── 5. ความลับของคนคุมเกม ───────────────────────────────────────────
-- แยกตารางแทนการเก็บเป็นคอลัมน์ใน quiz_sessions เพราะ PostgREST ยิง select *
-- ถ้า token อยู่ในแถวเดียวกับข้อมูลที่ลูกทัวร์ต้องอ่านได้ จะปิดเฉพาะคอลัมน์ไม่ได้
CREATE TABLE IF NOT EXISTS public.quiz_session_tokens (
  session_id uuid PRIMARY KEY REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  token      text NOT NULL
);


-- ── 6. คนในห้อง ─────────────────────────────────────────────────────
-- ตั้งใจไม่มี checkin_only ต่างจาก draw_rooms:
--   สุ่มรางวัล คนไม่อยู่ในงานติดมา = รางวัลลอย ต้องสุ่มใหม่ เสียจังหวะบนเวที
--   ควิซ      คนไม่อยู่ = ได้ 0 แล้วหายไปเอง ไม่กระทบใคร
-- ประตูควบคุมที่เหลือคือ join_open ซึ่งทีมงานกดปิดเมื่อไหร่ก็ได้
CREATE TABLE IF NOT EXISTS public.quiz_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'guest',
  guest_id    uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  staff_id    uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  -- ไกด์ท้องถิ่นที่ขึ้นรถกลางทาง ไม่มีแถวในระบบเลย — จำเครื่องด้วยค่าสุ่มใน localStorage
  device_key  text,
  display_name text NOT NULL DEFAULT '',
  team_id     uuid,                                   -- เผื่อโหมดทีมเฟส 3 ยังไม่ใช้
  score        integer NOT NULL DEFAULT 0,
  streak       integer NOT NULL DEFAULT 0,
  correct_count integer NOT NULL DEFAULT 0,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  -- ใช้ตัดสินว่า "ทุกคนตอบครบแล้ว" หรือยัง — ถ้านับจากคนในห้องทั้งหมด
  -- แค่มีคนเดียวแบตหมด ปุ่ม "ปิดรับ+เฉลยเลย" จะไม่มีวันเด้ง
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_players_kind_check') THEN
    ALTER TABLE public.quiz_players ADD CONSTRAINT quiz_players_kind_check
      CHECK (kind IN ('guest', 'staff', 'visitor'));
  END IF;

  -- ต้องมีตัวตนอย่างใดอย่างหนึ่งเท่านั้น
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_players_identity_check') THEN
    ALTER TABLE public.quiz_players ADD CONSTRAINT quiz_players_identity_check
      CHECK (num_nonnulls(guest_id, staff_id, device_key) = 1);
  END IF;
END $$;

-- กันคนเดียวเปิด 2 แท็บแล้วได้ 2 สิทธิ์ตอบ
-- ต้องเป็น partial index เพราะคอลัมน์ตัวตนเป็น NULL ได้ และ UNIQUE ธรรมดาไม่กัน NULL
CREATE UNIQUE INDEX IF NOT EXISTS quiz_players_guest_uniq
  ON public.quiz_players (session_id, guest_id) WHERE guest_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quiz_players_staff_uniq
  ON public.quiz_players (session_id, staff_id) WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quiz_players_device_uniq
  ON public.quiz_players (session_id, device_key) WHERE device_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS quiz_players_session_idx
  ON public.quiz_players (session_id, score DESC);


-- ── 7. คำตอบ ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  player_id   uuid NOT NULL REFERENCES public.quiz_players(id) ON DELETE CASCADE,
  choice_index integer,
  number_value numeric,
  elapsed_ms  integer NOT NULL DEFAULT 0,     -- คิดฝั่ง server เท่านั้น
  is_correct  boolean,                        -- numeric ยังเป็น NULL จนกว่าจะเฉลย
  points      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ตอบได้ครั้งเดียว เปลี่ยนใจไม่ได้ (กติกาเดียวกับ Kahoot)
CREATE UNIQUE INDEX IF NOT EXISTS quiz_answers_once_uniq
  ON public.quiz_answers (session_id, question_id, player_id);


-- ── 8. RLS ──────────────────────────────────────────────────────────
-- ตารางที่ลูกทัวร์ต้องอ่านได้ → เปิดกว้างแบบเดียวกับ draw_* / bingo_*
ALTER TABLE public.quiz_sets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_answers   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_sets_read ON public.quiz_sets;
CREATE POLICY quiz_sets_read ON public.quiz_sets FOR SELECT USING (true);
DROP POLICY IF EXISTS quiz_sets_write ON public.quiz_sets;
CREATE POLICY quiz_sets_write ON public.quiz_sets FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS quiz_questions_read ON public.quiz_questions;
CREATE POLICY quiz_questions_read ON public.quiz_questions FOR SELECT USING (true);
DROP POLICY IF EXISTS quiz_questions_write ON public.quiz_questions;
CREATE POLICY quiz_questions_write ON public.quiz_questions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS quiz_sessions_read ON public.quiz_sessions;
CREATE POLICY quiz_sessions_read ON public.quiz_sessions FOR SELECT USING (true);
DROP POLICY IF EXISTS quiz_sessions_write ON public.quiz_sessions;
CREATE POLICY quiz_sessions_write ON public.quiz_sessions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS quiz_players_read ON public.quiz_players;
CREATE POLICY quiz_players_read ON public.quiz_players FOR SELECT USING (true);
DROP POLICY IF EXISTS quiz_players_write ON public.quiz_players;
CREATE POLICY quiz_players_write ON public.quiz_players FOR ALL USING (true) WITH CHECK (true);

-- คำตอบ: ปิดสนิททั้งอ่านและเขียน
--   เขียน — ต้องผ่าน quiz_submit ไม่งั้นยิง INSERT เองแล้วใส่ points เท่าไหร่ก็ได้
--   อ่าน  — แถวคำตอบมี is_correct ติดมาด้วยตั้งแต่ตอนส่ง (mcq/tf ตัดสินได้ทันที)
--           ถ้าเปิดให้อ่าน ลูกทัวร์ยิง REST ดูแถวของตัวเอง = รู้ผลก่อนเฉลย
--           และดูแถวคนอื่นที่ is_correct = true = รู้เฉลยเลย
--   สิ่งที่ต้องเปิดเผยจริงๆ (จำนวนคนตอบ, สถิติตอนเฉลย, กระดานอันดับ) มี RPC ให้แล้ว

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quiz_sets      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quiz_questions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quiz_sessions  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quiz_players   TO anon, authenticated;
REVOKE ALL                            ON public.quiz_answers  FROM anon, authenticated;

-- ★★★ สองตารางนี้ห้ามแตะ ★★★
-- ไม่สร้าง policy ใดๆ + REVOKE = ไม่มีใครอ่านได้ผ่าน REST ไม่ว่าจะยิงยังไง
-- ทางเข้าเดียวคือฟังก์ชัน SECURITY DEFINER ข้างล่าง
ALTER TABLE public.quiz_keys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_session_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quiz_keys           FROM anon, authenticated;
REVOKE ALL ON public.quiz_session_tokens FROM anon, authenticated;


-- ── 9. ฟังก์ชันช่วย ─────────────────────────────────────────────────

-- เวลา server — ลูกค้าเรียกครั้งเดียวตอนเข้าเกม วัด round-trip แล้วเก็บ offset ไว้ใช้ทั้งเกม
CREATE OR REPLACE FUNCTION public.quiz_now()
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $fn$ SELECT now(); $fn$;

-- ตรวจ token ของคนคุมเกม — ใช้ในทุก RPC ที่สั่งงานได้
CREATE OR REPLACE FUNCTION public.quiz_check_token(p_session_id uuid, p_token text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.quiz_session_tokens
     WHERE session_id = p_session_id AND token = p_token
  );
$fn$;

-- ตรวจ PIN ทีมงาน — ใช้ก่อนปล่อยเฉลยให้คนสร้างข้อสอบเห็น
-- รับได้ทั้ง PIN ระดับทริป (tour_staff.auth_pin) และ PIN แอดมินบริษัท (staff.auth_pin)
CREATE OR REPLACE FUNCTION public.quiz_check_staff(p_staff_id uuid, p_pin text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
     WHERE s.id = p_staff_id
       AND coalesce(s.is_active, true) = true
       AND (
         s.auth_pin = btrim(p_pin)
         OR EXISTS (
           SELECT 1 FROM public.tour_staff ts
            WHERE ts.staff_id = s.id
              AND ts.auth_pin = btrim(p_pin)
              AND ts.is_active = true
         )
       )
  );
$fn$;

GRANT EXECUTE ON FUNCTION public.quiz_now() TO anon, authenticated;

-- ตัวตรวจความลับ 2 ตัวนี้ห้ามให้เรียกตรง — Postgres ให้ EXECUTE กับ PUBLIC มาโดยอัตโนมัติ
-- ถ้าปล่อยไว้ ลูกทัวร์จะยิงเดา token/PIN รัวๆ ได้ฟรี
REVOKE ALL ON FUNCTION public.quiz_check_token(uuid, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quiz_check_staff(uuid, text)  FROM PUBLIC, anon, authenticated;


-- ── 10. คนคุมเกม: สร้างห้อง ─────────────────────────────────────────
-- คืน token ครั้งเดียวตรงนี้เท่านั้น หลังจากนี้ไม่มีทางอ่านได้อีก
CREATE OR REPLACE FUNCTION public.quiz_start_session(
  p_tour_id uuid,
  p_set_id  uuid,
  p_name    text DEFAULT NULL,
  p_bus_id  uuid DEFAULT NULL,
  p_screen_mode text DEFAULT 'projector',
  p_staff_id uuid DEFAULT NULL
)
RETURNS TABLE (session_id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid; v_token text;
BEGIN
  INSERT INTO public.quiz_sessions (tour_id, set_id, name, bus_id, screen_mode, created_by)
  VALUES (
    p_tour_id, p_set_id,
    coalesce(nullif(btrim(p_name), ''), 'ห้องควิซ'),
    p_bus_id, coalesce(p_screen_mode, 'projector'), p_staff_id
  )
  RETURNING id INTO v_id;

  -- ต่อ uuid สองก้อน = สุ่ม 256 bit
  -- ตั้งใจไม่ใช้ gen_random_bytes ของ pgcrypto: บน Supabase ส่วนขยายติดตั้งไว้ที่ schema
  -- "extensions" ไม่ใช่ "public" — ฟังก์ชันนี้ตั้ง SET search_path = public ไว้เพื่อความปลอดภัย
  -- จึงมองไม่เห็นและพังตอนสร้างห้อง (เจอตอนรันบน Supabase จริง ไม่เจอตอนทดสอบเครื่องตัวเอง
  -- เพราะที่นั่น pgcrypto อยู่ใน public) ส่วน gen_random_uuid ใช้ได้เพราะเป็นของ core ตั้งแต่ PG13
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.quiz_session_tokens (session_id, token) VALUES (v_id, v_token);

  RETURN QUERY SELECT v_id, v_token;
END $fn$;


-- ── 11. คนคุมเกม: เปิดข้อถัดไป ──────────────────────────────────────
-- p_expected_index กันกดรัว/กดซ้อน: ถ้าค่าไม่ตรงแปลว่ามีคนกดไปแล้ว → ไม่ทำอะไร
-- (ไม่ใช่ error เพราะทีมงานกดปุ่มสองทีบนมือถือเป็นเรื่องปกติ)
CREATE OR REPLACE FUNCTION public.quiz_next(
  p_session_id uuid,
  p_token      text,
  p_expected_index integer DEFAULT NULL,
  p_lead_ms    integer DEFAULT 3000
)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions; v_q public.quiz_questions; v_next integer;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบห้อง'; END IF;

  IF p_expected_index IS NOT NULL AND v_s.current_index <> p_expected_index THEN
    RETURN v_s;   -- มีคนกดไปก่อนแล้ว
  END IF;

  v_next := v_s.current_index + 1;

  SELECT * INTO v_q
    FROM public.quiz_questions
   WHERE set_id = v_s.set_id
   ORDER BY sort_order, created_at
   OFFSET v_next LIMIT 1;

  IF NOT FOUND THEN
    -- หมดข้อแล้ว → จบเกมเอง ทีมงานไม่ต้องกดซ้ำ
    UPDATE public.quiz_sessions
       SET state = 'finished', ended_at = now(), reveal_payload = '{}'::jsonb
     WHERE id = p_session_id
    RETURNING * INTO v_s;
    RETURN v_s;
  END IF;

  -- ตั้งเวลาเริ่มไว้ในอนาคต p_lead_ms — ช่วงนี้ทุกจอนับถอยหลังไปที่วินาทีเดียวกัน
  -- และเป็น buffer กลบ latency ของ realtime ไปในตัว
  UPDATE public.quiz_sessions
     SET state = 'answering',
         current_index = v_next,
         current_question_id = v_q.id,
         question_started_at = now() + make_interval(secs => p_lead_ms / 1000.0),
         question_ends_at = now() + make_interval(secs => p_lead_ms / 1000.0)
                                  + make_interval(secs => v_q.time_limit_sec),
         locked_at = NULL,
         reveal_payload = '{}'::jsonb
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;


-- ── 12. คนคุมเกม: ปิดรับคำตอบ ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_lock(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  UPDATE public.quiz_sessions
     SET state = 'locked', locked_at = now()
   WHERE id = p_session_id AND state = 'answering'
  RETURNING * INTO v_s;

  IF NOT FOUND THEN
    SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id;
  END IF;
  RETURN v_s;
END $fn$;


-- ── 13. ลูกทัวร์: ส่งคำตอบ ──────────────────────────────────────────
-- หัวใจของการกันโกงอยู่ที่นี่ทั้งหมด:
--   1. เวลาที่ใช้คิดคะแนนมาจาก now() ฝั่ง server — client ส่งเวลาเข้ามาไม่ได้เลย
--   2. อ่านเฉลยจาก quiz_keys ข้างในฟังก์ชัน แล้ว "ไม่บอก" ว่าถูกหรือผิด
--      คืนแค่ว่ารับคำตอบแล้ว — จะรู้ผลตอนทีมงานกดเฉลยพร้อมกันทุกคน
--   3. ON CONFLICT DO NOTHING = ตอบครั้งเดียว ยิงซ้ำกี่ครั้งก็ไม่เปลี่ยน
CREATE OR REPLACE FUNCTION public.quiz_submit(
  p_session_id uuid,
  p_player_id  uuid,
  p_question_id uuid,
  p_choice     integer DEFAULT NULL,
  p_number     numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s public.quiz_sessions;
  v_q public.quiz_questions;
  v_k public.quiz_keys;
  v_elapsed integer;
  v_limit_ms integer;
  v_correct boolean;
  v_points integer := 0;
  v_rows integer := 0;
  -- ผ่อนผัน 200ms ให้คนที่กดพอดีตอนหมดเวลา/ตอนทีมงานกดปิด
  -- ไม่มีอันนี้ คนเน็ตช้าจะโดนตัดทิ้งทั้งที่กดทันบนหน้าจอตัวเอง
  v_grace interval := interval '200 milliseconds';
BEGIN
  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_session'); END IF;

  IF v_s.current_question_id IS DISTINCT FROM p_question_id THEN
    RETURN jsonb_build_object('status', 'wrong_question');
  END IF;

  IF v_s.question_started_at IS NULL OR now() < v_s.question_started_at THEN
    RETURN jsonb_build_object('status', 'not_started');
  END IF;

  IF NOT (
    (v_s.state = 'answering' AND now() <= v_s.question_ends_at + v_grace)
    OR (v_s.state = 'locked' AND v_s.locked_at IS NOT NULL AND now() <= v_s.locked_at + v_grace)
  ) THEN
    RETURN jsonb_build_object('status', 'closed');
  END IF;

  SELECT * INTO v_q FROM public.quiz_questions WHERE id = p_question_id;
  SELECT * INTO v_k FROM public.quiz_keys      WHERE question_id = p_question_id;

  v_limit_ms := greatest(v_q.time_limit_sec, 1) * 1000;
  v_elapsed := least(
    greatest((extract(epoch FROM (now() - v_s.question_started_at)) * 1000)::integer, 0),
    v_limit_ms
  );

  IF v_q.kind IN ('mcq', 'tf') THEN
    v_correct := (p_choice IS NOT NULL AND v_k.correct_index IS NOT NULL
                  AND p_choice = v_k.correct_index);
    IF v_correct THEN
      -- ช้าสุด (หมดเวลาพอดี) ยังได้ 500 — คนเน็ตช้าบนรถต้องไม่แพ้เพราะเน็ต
      v_points := round(1000 * (1 - 0.5 * v_elapsed::numeric / v_limit_ms)
                        * coalesce(v_q.points_factor, 1))::integer;
    END IF;
  ELSE
    -- numeric ตัดสินไม่ได้ตอนนี้ ต้องรอดูของทุกคนก่อน → ให้คะแนนตอน quiz_reveal
    v_correct := NULL;
  END IF;

  INSERT INTO public.quiz_answers
    (session_id, question_id, player_id, choice_index, number_value, elapsed_ms, is_correct, points)
  VALUES
    (p_session_id, p_question_id, p_player_id, p_choice, p_number, v_elapsed, v_correct, v_points)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN jsonb_build_object('status', 'already');
  END IF;

  -- ⚠️ ตั้งใจ "ไม่" บวกคะแนนเข้า quiz_players ตรงนี้ ทั้งที่ตัดสินถูกผิดได้แล้ว
  --    quiz_players ต้องเปิดให้อ่าน (ใช้ทำกระดานอันดับ) ถ้าบวกคะแนนทันทีที่ส่ง
  --    ลูกทัวร์ poll แถวตัวเองเห็นคะแนนขยับ = รู้ว่าตอบถูกก่อนถึงเวลาเฉลย
  --    และถ้าดูของคนอื่นด้วยก็เดาเฉลยออกทั้งข้อ
  --    คะแนนจึงพักไว้ใน quiz_answers (ตารางปิด) แล้วไปลงจริงตอน quiz_reveal
  UPDATE public.quiz_players SET last_seen_at = now() WHERE id = p_player_id;

  -- ตั้งใจไม่บอก is_correct / points กลับไป
  RETURN jsonb_build_object('status', 'ok', 'elapsed_ms', v_elapsed);
END $fn$;


-- ── 14. คนคุมเกม: เฉลย ──────────────────────────────────────────────
-- ตรงนี้คือจุดเดียวที่เฉลยออกจาก quiz_keys มาสู่โลกภายนอก
-- copy ลง reveal_payload แล้ว realtime ส่งให้ทุกจอพร้อมกัน — ไม่มีใครเห็นก่อนใคร
CREATE OR REPLACE FUNCTION public.quiz_reveal(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s public.quiz_sessions;
  v_q public.quiz_questions;
  v_k public.quiz_keys;
  v_payload jsonb;
  v_stats jsonb;
  v_closest jsonb;
  v_set_streak boolean;
  r record;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN v_s; END IF;
  IF v_s.state = 'reveal' THEN RETURN v_s; END IF;   -- กดซ้ำ ไม่ให้คิดคะแนนรอบสอง

  SELECT * INTO v_q FROM public.quiz_questions WHERE id = v_s.current_question_id;
  SELECT * INTO v_k FROM public.quiz_keys      WHERE question_id = v_s.current_question_id;
  SELECT streak_bonus INTO v_set_streak FROM public.quiz_sets WHERE id = v_q.set_id;

  -- ลงคะแนนของข้อนี้เข้ากระดานจริง — จุดเดียวในระบบที่คะแนนขยับ
  IF v_q.kind IN ('mcq', 'tf') THEN
    FOR r IN
      SELECT a.id, a.player_id, a.points, a.is_correct, p.streak
        FROM public.quiz_answers a
        JOIN public.quiz_players p ON p.id = a.player_id
       WHERE a.session_id = p_session_id AND a.question_id = v_q.id
    LOOP
      -- ถูกติดกัน 2,3,4,5+ ข้อ → +100,+200,+300,+400 (เพดานที่ 4 กันคะแนนบานปลาย)
      -- คิดตรงนี้ไม่ใช่ตอนส่ง เพราะ streak ของข้อก่อนหน้าเพิ่งลงจริงตอนเฉลยข้อนั้น
      DECLARE v_new_streak integer; v_bonus integer := 0; v_total integer;
      BEGIN
        v_new_streak := CASE WHEN r.is_correct THEN r.streak + 1 ELSE 0 END;
        IF r.is_correct AND coalesce(v_set_streak, true) THEN
          v_bonus := least(greatest(v_new_streak - 1, 0), 4) * 100;
        END IF;
        v_total := r.points + v_bonus;

        UPDATE public.quiz_answers SET points = v_total WHERE id = r.id;
        UPDATE public.quiz_players
           SET score = score + v_total,
               streak = v_new_streak,
               correct_count = correct_count + CASE WHEN r.is_correct THEN 1 ELSE 0 END
         WHERE id = r.player_id;
      END;
    END LOOP;

    -- คนที่ไม่ได้ตอบข้อนี้เลยต้องหลุด streak ด้วย
    -- ไม่งั้นหายไปหนึ่งข้อแล้วกลับมาต่อ streak ได้เหมือนไม่เคยขาด
    UPDATE public.quiz_players p
       SET streak = 0
     WHERE p.session_id = p_session_id
       AND NOT EXISTS (
         SELECT 1 FROM public.quiz_answers a
          WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.player_id = p.id
       );
  END IF;

  IF v_q.kind = 'numeric' THEN
    -- ตัดสิน "ใกล้สุดชนะ" ตอนนี้ เพราะต้องเห็นของทุกคนก่อนถึงจะจัดอันดับได้
    -- เท่ากัน → คนที่ส่งก่อนได้อันดับดีกว่า
    FOR r IN
      SELECT a.id, a.player_id, a.number_value,
             row_number() OVER (
               ORDER BY abs(a.number_value - v_k.correct_number), a.created_at
             ) AS rn
        FROM public.quiz_answers a
       WHERE a.session_id = p_session_id
         AND a.question_id = v_q.id
         AND a.number_value IS NOT NULL
    LOOP
      UPDATE public.quiz_answers
         SET points = (CASE r.rn WHEN 1 THEN 1000 WHEN 2 THEN 800 WHEN 3 THEN 600 ELSE 300 END
                       + CASE WHEN r.number_value = v_k.correct_number THEN 200 ELSE 0 END),
             is_correct = (r.rn = 1)
       WHERE id = r.id;

      UPDATE public.quiz_players p
         SET score = p.score + (
               CASE r.rn WHEN 1 THEN 1000 WHEN 2 THEN 800 WHEN 3 THEN 600 ELSE 300 END
               + CASE WHEN r.number_value = v_k.correct_number THEN 200 ELSE 0 END),
             correct_count = p.correct_count + CASE WHEN r.rn = 1 THEN 1 ELSE 0 END,
             streak = CASE WHEN r.rn = 1 THEN p.streak + 1 ELSE 0 END
       WHERE p.id = r.player_id;
    END LOOP;

    SELECT jsonb_agg(x) INTO v_closest FROM (
      SELECT jsonb_build_object('name', p.display_name, 'value', a.number_value) AS x
        FROM public.quiz_answers a
        JOIN public.quiz_players p ON p.id = a.player_id
       WHERE a.session_id = p_session_id AND a.question_id = v_q.id
         AND a.number_value IS NOT NULL
       ORDER BY abs(a.number_value - v_k.correct_number), a.created_at
       LIMIT 3
    ) t;
  ELSE
    -- นับว่าแต่ละตัวเลือกมีคนกดกี่คน — เอาไปทำกราฟแท่งบนจอใหญ่
    SELECT jsonb_object_agg(choice_index::text, n) INTO v_stats FROM (
      SELECT choice_index, count(*) AS n
        FROM public.quiz_answers
       WHERE session_id = p_session_id AND question_id = v_q.id AND choice_index IS NOT NULL
       GROUP BY choice_index
    ) t;
  END IF;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'question_id',    v_q.id,
    'kind',           v_q.kind,
    'correct_index',  v_k.correct_index,
    'correct_number', v_k.correct_number,
    'explain',        nullif(coalesce(v_k.explain, ''), ''),
    'stats',          v_stats,
    'closest',        v_closest,
    'answered',       (SELECT count(*) FROM public.quiz_answers
                        WHERE session_id = p_session_id AND question_id = v_q.id)
  ));

  UPDATE public.quiz_sessions
     SET state = 'reveal', reveal_payload = v_payload
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;


-- ── 15. คนคุมเกม: กระดานอันดับ / จบเกม ──────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_set_state(
  p_session_id uuid, p_token text, p_state text
)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;
  IF p_state NOT IN ('lobby', 'scoreboard', 'finished') THEN
    RAISE EXCEPTION 'สถานะนี้ต้องสั่งผ่านฟังก์ชันเฉพาะ';
  END IF;

  UPDATE public.quiz_sessions
     SET state = p_state,
         ended_at = CASE WHEN p_state = 'finished' THEN now() ELSE ended_at END,
         join_open = CASE WHEN p_state = 'finished' THEN false ELSE join_open END
   WHERE id = p_session_id
  RETURNING * INTO v_s;
  RETURN v_s;
END $fn$;


-- ── 16. ลูกทัวร์: เข้าห้อง ──────────────────────────────────────────
-- upsert ฝั่ง DB แบบเดียวกับ bingo_ensure_card
-- (ของเดิมเคยเป็น select-then-insert แล้วได้การ์ดซ้ำตอนกดรัวๆ — อย่าทำซ้ำ)
CREATE OR REPLACE FUNCTION public.quiz_join(
  p_session_id uuid,
  p_kind       text,
  p_guest_id   uuid DEFAULT NULL,
  p_staff_id   uuid DEFAULT NULL,
  p_device_key text DEFAULT NULL,
  p_name       text DEFAULT NULL
)
RETURNS public.quiz_players
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_p public.quiz_players; v_s public.quiz_sessions; v_name text;
BEGIN
  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบห้อง'; END IF;
  IF v_s.state = 'finished' THEN RAISE EXCEPTION 'ห้องนี้จบไปแล้ว'; END IF;

  -- คนที่เข้ามาแล้วกลับเข้ามาใหม่ (แอปเด้ง/เน็ตหลุด) ต้องผ่านเสมอ
  SELECT * INTO v_p FROM public.quiz_players
   WHERE session_id = p_session_id
     AND ((p_guest_id   IS NOT NULL AND guest_id   = p_guest_id)
       OR (p_staff_id   IS NOT NULL AND staff_id   = p_staff_id)
       OR (p_device_key IS NOT NULL AND device_key = p_device_key));

  IF FOUND THEN
    UPDATE public.quiz_players SET last_seen_at = now() WHERE id = v_p.id RETURNING * INTO v_p;
    RETURN v_p;
  END IF;

  IF NOT v_s.join_open THEN RAISE EXCEPTION 'ห้องนี้ปิดรับคนเข้าใหม่แล้ว'; END IF;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  IF v_name IS NULL AND p_guest_id IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(g.nickname), ''), g.name) INTO v_name
      FROM public.guests g WHERE g.id = p_guest_id;
  END IF;
  IF v_name IS NULL AND p_staff_id IS NOT NULL THEN
    SELECT s.name INTO v_name FROM public.staff s WHERE s.id = p_staff_id;
  END IF;

  INSERT INTO public.quiz_players (session_id, kind, guest_id, staff_id, device_key, display_name)
  VALUES (p_session_id, p_kind, p_guest_id, p_staff_id, p_device_key, coalesce(v_name, 'ผู้เล่น'))
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_p;

  IF v_p.id IS NULL THEN
    -- ชนกันพอดีกับอีกแท็บ — อ่านของที่มีอยู่กลับมา
    SELECT * INTO v_p FROM public.quiz_players
     WHERE session_id = p_session_id
       AND ((p_guest_id   IS NOT NULL AND guest_id   = p_guest_id)
         OR (p_staff_id   IS NOT NULL AND staff_id   = p_staff_id)
         OR (p_device_key IS NOT NULL AND device_key = p_device_key));
  END IF;

  RETURN v_p;
END $fn$;


-- ── 17. ลูกทัวร์: บอกว่ายังอยู่ ─────────────────────────────────────
-- ยิงทุก 20 วิ — ถ้าไม่มีอันนี้ ปุ่ม "ปิดรับ+เฉลยเลย" ของทีมงานจะไม่มีวันเด้ง
-- เพราะคนที่ปิดแอปไปแล้วจะถูกนับว่า "ยังไม่ตอบ" ตลอดกาล
CREATE OR REPLACE FUNCTION public.quiz_heartbeat(p_player_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $fn$
  UPDATE public.quiz_players SET last_seen_at = now() WHERE id = p_player_id;
$fn$;


-- ── 18. คนคุมเกม: ตอบครบหรือยัง ─────────────────────────────────────
-- host poll ตัวนี้ทุก 1.5 วิ ระหว่างเปิดรับ — ถูกกว่ายิง realtime 80 event ต่อข้อมาก
CREATE OR REPLACE FUNCTION public.quiz_answer_count(
  p_session_id uuid,
  p_question_id uuid,
  p_online_window_sec integer DEFAULT 60
)
RETURNS TABLE (answered integer, online integer, total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT
    (SELECT count(*) FROM public.quiz_answers
      WHERE session_id = p_session_id AND question_id = p_question_id)::integer,
    (SELECT count(*) FROM public.quiz_players
      WHERE session_id = p_session_id
        AND last_seen_at > now() - make_interval(secs => p_online_window_sec))::integer,
    (SELECT count(*) FROM public.quiz_players WHERE session_id = p_session_id)::integer;
$fn$;


-- ── 19. คนคุมเกม: ใครยังไม่ส่ง ──────────────────────────────────────
-- เอาไว้เรียกชื่อบนไมค์ "รออีกคนเดียวนะครับ พี่สมชาย" — บรรยากาศดีกว่ารอเงียบๆ
CREATE OR REPLACE FUNCTION public.quiz_pending_players(
  p_session_id uuid,
  p_question_id uuid,
  p_token text,
  p_limit integer DEFAULT 5,
  p_online_window_sec integer DEFAULT 60
)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  RETURN QUERY
    SELECT p.id, p.display_name
      FROM public.quiz_players p
     WHERE p.session_id = p_session_id
       AND p.last_seen_at > now() - make_interval(secs => p_online_window_sec)
       AND NOT EXISTS (
         SELECT 1 FROM public.quiz_answers a
          WHERE a.session_id = p_session_id
            AND a.question_id = p_question_id
            AND a.player_id = p.id
       )
     ORDER BY p.joined_at
     LIMIT p_limit;
END $fn$;


-- ── 20. คนคุมเกม: เตะคนออก ──────────────────────────────────────────
-- จำเป็นเพราะ visitor พิมพ์ชื่อเองได้ และชื่อนั้นขึ้นจอใหญ่ต่อหน้าทุกคน
CREATE OR REPLACE FUNCTION public.quiz_remove_player(
  p_session_id uuid, p_token text, p_player_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;
  DELETE FROM public.quiz_players WHERE id = p_player_id AND session_id = p_session_id;
END $fn$;


-- ── 19.1 ลูกทัวร์: ฉันตอบอะไรไปแล้ว ─────────────────────────────────
-- จำเป็นเพราะแอปเด้ง/รีเฟรชกลางข้อได้ (เน็ตหลุดบนรถเป็นเรื่องปกติ)
-- ถ้าไม่มีตัวนี้ พอกลับเข้ามาจะเห็นปุ่มว่างเปล่าเหมือนยังไม่ได้ตอบ
-- ⚠️ คืนเฉพาะ "ตอบอะไรไป" — ห้ามคืน is_correct/points เด็ดขาด นั่นคือการบอกเฉลยก่อนเวลา
CREATE OR REPLACE FUNCTION public.quiz_my_answer(
  p_session_id uuid, p_player_id uuid, p_question_id uuid
)
RETURNS TABLE (choice_index integer, number_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT a.choice_index, a.number_value
    FROM public.quiz_answers a
   WHERE a.session_id = p_session_id
     AND a.player_id = p_player_id
     AND a.question_id = p_question_id;
$fn$;


-- ── 20.1 ตัวเลขที่ทยอยส่งเข้ามา (ข้อเดาตัวเลข) ──────────────────────
-- ข้อ numeric ให้เวลา 45 วิ ซึ่งนานพอที่จอใหญ่จะเงียบจนน่าอึดอัด
-- โชว์ตัวเลขที่คนอื่นส่งมาเป็นจุดๆ ระหว่างรอ — เห็นแล้วสนุกและกดดันดี
-- ไม่บอกว่าใครตอบอะไร และไม่บอกเฉลย จึงยังไม่รั่ว
-- ต้องมี token เพราะจอใหญ่เท่านั้นที่ควรเห็น ไม่ใช่มือถือลูกทัวร์
CREATE OR REPLACE FUNCTION public.quiz_live_numbers(
  p_session_id uuid, p_question_id uuid, p_token text
)
RETURNS TABLE (value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  RETURN QUERY
    SELECT a.number_value
      FROM public.quiz_answers a
     WHERE a.session_id = p_session_id
       AND a.question_id = p_question_id
       AND a.number_value IS NOT NULL
     ORDER BY a.created_at;
END $fn$;


-- ── 21. กระดานอันดับ ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_leaderboard(p_session_id uuid, p_limit integer DEFAULT 10)
RETURNS TABLE (id uuid, display_name text, score integer, correct_count integer, rank integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT p.id, p.display_name, p.score, p.correct_count,
         (row_number() OVER (ORDER BY p.score DESC, p.correct_count DESC, p.joined_at))::integer
    FROM public.quiz_players p
   WHERE p.session_id = p_session_id
   ORDER BY p.score DESC, p.correct_count DESC, p.joined_at
   LIMIT p_limit;
$fn$;


-- ── 22. คนสร้างข้อสอบ: อ่านชุดพร้อมเฉลย ─────────────────────────────
-- ต้องผ่าน PIN เพราะ quiz_keys ปิดสนิท — สตาฟกับลูกทัวร์ใช้ anon key ตัวเดียวกัน
-- ถ้าไม่ตรวจอะไรเลย ลูกทัวร์ก็เรียกฟังก์ชันนี้ดูเฉลยล่วงหน้าได้
CREATE OR REPLACE FUNCTION public.quiz_set_for_edit(
  p_set_id uuid, p_staff_id uuid, p_pin text
)
RETURNS TABLE (
  question_id uuid, sort_order integer, kind text, question_text text,
  media_url text, media_kind text, options jsonb, numeric_unit text,
  time_limit_sec integer, points_factor numeric,
  correct_index integer, correct_number numeric, explain text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  RETURN QUERY
    SELECT q.id, q.sort_order, q.kind, q.text,
           q.media_url, q.media_kind, q.options, q.numeric_unit,
           q.time_limit_sec, q.points_factor,
           k.correct_index, k.correct_number, coalesce(k.explain, '')
      FROM public.quiz_questions q
      LEFT JOIN public.quiz_keys k ON k.question_id = q.id
     WHERE q.set_id = p_set_id
     ORDER BY q.sort_order, q.created_at;
END $fn$;


-- ── 23. คนสร้างข้อสอบ: บันทึกข้อ ────────────────────────────────────
-- คำถามกับเฉลยต้องเขียนใน transaction เดียว ไม่งั้นมีจังหวะที่ข้อมีอยู่แต่ไม่มีเฉลย
-- แล้ว quiz_submit จะตัดสินว่าทุกคนตอบผิดหมด
CREATE OR REPLACE FUNCTION public.quiz_upsert_question(
  p_staff_id uuid,
  p_pin      text,
  p_set_id   uuid,
  p_question_id uuid,
  p_kind     text,
  p_text     text,
  p_options  jsonb,
  p_correct_index integer,
  p_correct_number numeric,
  p_numeric_unit text,
  p_time_limit_sec integer,
  p_points_factor numeric,
  p_media_url text,
  p_media_kind text,
  p_explain  text,
  p_sort_order integer
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid;
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  IF p_question_id IS NULL THEN
    INSERT INTO public.quiz_questions
      (set_id, sort_order, kind, text, options, numeric_unit,
       time_limit_sec, points_factor, media_url, media_kind)
    VALUES
      (p_set_id, coalesce(p_sort_order, 0), p_kind, coalesce(p_text, ''),
       coalesce(p_options, '[]'::jsonb), coalesce(p_numeric_unit, ''),
       coalesce(p_time_limit_sec, 20), coalesce(p_points_factor, 1),
       nullif(p_media_url, ''), nullif(p_media_kind, ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.quiz_questions
       SET sort_order = coalesce(p_sort_order, sort_order),
           kind = p_kind,
           text = coalesce(p_text, ''),
           options = coalesce(p_options, '[]'::jsonb),
           numeric_unit = coalesce(p_numeric_unit, ''),
           time_limit_sec = coalesce(p_time_limit_sec, 20),
           points_factor = coalesce(p_points_factor, 1),
           media_url = nullif(p_media_url, ''),
           media_kind = nullif(p_media_kind, '')
     WHERE id = p_question_id AND set_id = p_set_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อนี้ในชุด'; END IF;
  END IF;

  INSERT INTO public.quiz_keys (question_id, correct_index, correct_number, explain)
  VALUES (v_id, p_correct_index, p_correct_number, coalesce(p_explain, ''))
  ON CONFLICT (question_id) DO UPDATE
    SET correct_index = excluded.correct_index,
        correct_number = excluded.correct_number,
        explain = excluded.explain;

  RETURN v_id;
END $fn$;


-- ── 24. คนสร้างข้อสอบ: ลบข้อ / เรียงใหม่ ────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_delete_question(
  p_staff_id uuid, p_pin text, p_question_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;
  DELETE FROM public.quiz_questions WHERE id = p_question_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.quiz_reorder_questions(
  p_staff_id uuid, p_pin text, p_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  UPDATE public.quiz_questions q
     SET sort_order = x.ord
    FROM (SELECT unnest(p_ids) AS id, generate_subscripts(p_ids, 1) AS ord) x
   WHERE q.id = x.id;
END $fn$;


-- ── 25. สิทธิ์เรียกฟังก์ชัน ─────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.quiz_start_session(uuid, uuid, text, uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_next(uuid, text, integer, integer)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_lock(uuid, text)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_reveal(uuid, text)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_set_state(uuid, text, text)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_submit(uuid, uuid, uuid, integer, numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_join(uuid, text, uuid, uuid, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_heartbeat(uuid)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_answer_count(uuid, uuid, integer)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_pending_players(uuid, uuid, text, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_remove_player(uuid, text, uuid)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_my_answer(uuid, uuid, uuid)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_leaderboard(uuid, integer)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_live_numbers(uuid, uuid, text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_set_for_edit(uuid, uuid, text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_upsert_question(uuid, text, uuid, uuid, text, text, jsonb, integer, numeric, text, integer, numeric, text, text, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_delete_question(uuid, text, uuid)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_reorder_questions(uuid, text, uuid[])   TO anon, authenticated;


-- ── 26. Realtime ────────────────────────────────────────────────────
-- publish เฉพาะ quiz_sessions (แถวเดียวต่อห้อง)
-- ตั้งใจไม่ publish quiz_players / quiz_answers: 80 คนตอบพร้อมกัน = 80 event
-- ยิงใส่ทุกเครื่องโดยไม่จำเป็น — ฝั่งที่ต้องรู้จำนวนใช้ poll แทน (ดูข้อ 18)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quiz_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_sessions;
  END IF;
END $$;

COMMIT;

-- ── ย้อนกลับ (ถ้าต้องถอน) ────────────────────────────────────────────
-- BEGIN;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.quiz_sessions;
--   DROP FUNCTION IF EXISTS public.quiz_reorder_questions(uuid, text, uuid[]);
--   DROP FUNCTION IF EXISTS public.quiz_delete_question(uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.quiz_upsert_question(uuid, text, uuid, uuid, text, text, jsonb, integer, numeric, text, integer, numeric, text, text, text, integer);
--   DROP FUNCTION IF EXISTS public.quiz_set_for_edit(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.quiz_my_answer(uuid, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.quiz_live_numbers(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.quiz_leaderboard(uuid, integer);
--   DROP FUNCTION IF EXISTS public.quiz_remove_player(uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.quiz_pending_players(uuid, uuid, text, integer, integer);
--   DROP FUNCTION IF EXISTS public.quiz_answer_count(uuid, uuid, integer);
--   DROP FUNCTION IF EXISTS public.quiz_heartbeat(uuid);
--   DROP FUNCTION IF EXISTS public.quiz_join(uuid, text, uuid, uuid, text, text);
--   DROP FUNCTION IF EXISTS public.quiz_submit(uuid, uuid, uuid, integer, numeric);
--   DROP FUNCTION IF EXISTS public.quiz_set_state(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.quiz_reveal(uuid, text);
--   DROP FUNCTION IF EXISTS public.quiz_lock(uuid, text);
--   DROP FUNCTION IF EXISTS public.quiz_next(uuid, text, integer, integer);
--   DROP FUNCTION IF EXISTS public.quiz_start_session(uuid, uuid, text, uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.quiz_check_staff(uuid, text);
--   DROP FUNCTION IF EXISTS public.quiz_check_token(uuid, text);
--   DROP FUNCTION IF EXISTS public.quiz_now();
--   DROP TABLE IF EXISTS public.quiz_answers;
--   DROP TABLE IF EXISTS public.quiz_players;
--   DROP TABLE IF EXISTS public.quiz_session_tokens;
--   DROP TABLE IF EXISTS public.quiz_sessions;
--   DROP TABLE IF EXISTS public.quiz_keys;
--   DROP TABLE IF EXISTS public.quiz_questions;
--   DROP TABLE IF EXISTS public.quiz_sets;
-- COMMIT;
