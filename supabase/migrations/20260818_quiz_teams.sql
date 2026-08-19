-- =====================================================================
-- ควิซ เฟส 3 — โหมดทีม — 18 ส.ค. 2026
-- =====================================================================
-- ต่อจาก 20260818_quiz.sql (ใช้คอลัมน์ quiz_players.team_id ที่เผื่อไว้ตั้งแต่เฟส 1)
--
-- รูปแบบที่เลือก (ตัดสินใจร่วมกับเจ้าของโปรเจกต์):
--   • ทุกคนยังตอบเองจากมือถือตัวเอง — ไม่ใช่แบบ Kahoot ที่หนึ่งเครื่องต่อทีม
--   • ลูกทัวร์ "สร้างทีมเอง" และใครกดเข้าทีมไหนก็ได้ ทีมงานไม่ต้องจัดให้
--
-- ⚠️ ผลข้างเคียงของการให้เลือกทีมเอง และวิธีที่เรารับมือ:
--
--   1. ทีมจะขนาดไม่เท่ากันแน่นอน (เพื่อนกระจุกกันเป็นก้อน)
--      → คะแนนทีมจึงคิดเป็น "ค่าเฉลี่ยต่อคน" ไม่ใช่ผลรวม
--        ถ้าใช้ผลรวม ทีม 20 คนชนะทีม 4 คนตั้งแต่ยังไม่เริ่มเล่น เกมจะไม่มีความหมาย
--
--   2. ย้ายทีมกลางเกมได้ = กระโดดไปเกาะทีมที่กำลังนำ
--      → ล็อกไว้ ย้ายได้เฉพาะตอน state = 'lobby' เท่านั้น
--
--   3. ชื่อทีมลูกทัวร์พิมพ์เอง แล้วขึ้นจอใหญ่ต่อหน้าทุกคน
--      → ทีมงานเปลี่ยนชื่อหรือลบทีมได้ (ต้องมี host_token)
--
--   4. สีทีมไม่ให้เลือกเอง — ระบบแจกจากจานสีที่แยกออกจากกันชัดบนจอโปรเจกเตอร์
--      ถ้าให้เลือกเอง เดี๋ยวได้สองทีมสีฟ้าใกล้กันจนแยกไม่ออกจากท้ายรถ
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- =====================================================================

BEGIN;

-- ── 1. เปิด/ปิดโหมดทีมต่อห้อง ───────────────────────────────────────
ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS team_mode boolean NOT NULL DEFAULT false;

-- จำนวนคนสูงสุดต่อทีม 0 = ไม่จำกัด
-- มีไว้เผื่อทีมงานอยากบังคับให้ทีมพอๆ กัน โดยไม่ต้องเดินไปบอกทีละคน
ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS team_size_limit integer NOT NULL DEFAULT 0;


-- ── 2. ทีม ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.quiz_sessions(id) ON DELETE CASCADE,
  name        text NOT NULL,
  -- ดัชนีในจานสีฝั่งแอป (src/lib/quizStyle.js → TEAM_STYLES) ไม่เก็บ hex
  -- เพราะถ้าวันหนึ่งเปลี่ยนจานสี ของเก่าจะเปลี่ยนตามไปด้วยเอง
  color_index integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES public.quiz_players(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_teams_session_idx ON public.quiz_teams (session_id, created_at);

-- ชื่อทีมห้ามซ้ำในห้องเดียวกัน — ไม่งั้นบนจอใหญ่จะมี "ทีมเสือ" สองอันแล้วงงกันทั้งงาน
CREATE UNIQUE INDEX IF NOT EXISTS quiz_teams_name_uniq
  ON public.quiz_teams (session_id, lower(btrim(name)));

-- team_id เดิมเป็น uuid ลอยๆ (เผื่อไว้ตั้งแต่เฟส 1) — ผูก FK จริงตอนนี้
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_players_team_fk') THEN
    ALTER TABLE public.quiz_players
      ADD CONSTRAINT quiz_players_team_fk
      FOREIGN KEY (team_id) REFERENCES public.quiz_teams(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS quiz_players_team_idx ON public.quiz_players (team_id);

ALTER TABLE public.quiz_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_teams_read ON public.quiz_teams;
CREATE POLICY quiz_teams_read ON public.quiz_teams FOR SELECT USING (true);

-- ⚠️ ต้อง REVOKE ก่อน ไม่ใช่ GRANT SELECT เฉยๆ
--    Supabase ตั้ง default privileges ให้ anon/authenticated ได้ ALL บนตารางใหม่ใน public
--    ถ้าเขียนแค่ GRANT SELECT จะไม่ได้จำกัดอะไรเลย — สิทธิ์เขียนติดมาตั้งแต่ CREATE TABLE
--    (เจอตอนรันบน Supabase จริง ไม่เจอตอนทดสอบบนเครื่อง เพราะที่นั่นไม่มี default privileges)
--
--    RLS กันไว้อีกชั้นอยู่แล้ว (ไม่มี policy สำหรับ INSERT/UPDATE/DELETE = ปฏิเสธ)
--    แต่ไม่ควรพึ่งชั้นเดียว ถ้าวันหนึ่งมีคนเผลอเพิ่ม policy กว้างๆ จะเปิดช่องทันที
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.quiz_teams FROM anon, authenticated;
GRANT SELECT ON public.quiz_teams TO anon, authenticated;
-- ตั้งใจไม่ให้เขียนตรง — ต้องผ่าน RPC เท่านั้น
-- ไม่งั้นลูกทัวร์ยิง REST ย้ายทีมกลางเกม หรือลบทีมคู่แข่งทิ้งได้


-- ── 3. ลูกทัวร์: สร้างทีม ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_create_team(
  p_session_id uuid, p_player_id uuid, p_name text
)
RETURNS public.quiz_teams
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions; v_t public.quiz_teams; v_name text; v_color integer;
BEGIN
  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบห้อง'; END IF;
  IF NOT v_s.team_mode THEN RAISE EXCEPTION 'ห้องนี้ไม่ได้เล่นแบบทีม'; END IF;

  -- ตั้งทีมใหม่ได้เฉพาะตอนยังไม่เริ่ม — ระหว่างเกมมีทีมโผล่มาใหม่ = จอใหญ่กระโดด
  IF v_s.state <> 'lobby' THEN RAISE EXCEPTION 'เกมเริ่มแล้ว ตั้งทีมใหม่ไม่ได้'; END IF;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN RAISE EXCEPTION 'ต้องตั้งชื่อทีม'; END IF;
  IF length(v_name) > 20 THEN v_name := left(v_name, 20); END IF;

  -- แจกสีเรียงตามลำดับที่สร้าง สีจะได้ไม่ชนกันเอง
  SELECT count(*) INTO v_color FROM public.quiz_teams WHERE session_id = p_session_id;

  INSERT INTO public.quiz_teams (session_id, name, color_index, created_by)
  VALUES (p_session_id, v_name, v_color, p_player_id)
  RETURNING * INTO v_t;

  -- คนสร้างเข้าทีมตัวเองทันที ไม่ต้องกดซ้ำอีกที
  UPDATE public.quiz_players SET team_id = v_t.id WHERE id = p_player_id;

  RETURN v_t;
END $fn$;


-- ── 4. ลูกทัวร์: เข้าทีม / ออกจากทีม ────────────────────────────────
CREATE OR REPLACE FUNCTION public.quiz_join_team(
  p_session_id uuid, p_player_id uuid, p_team_id uuid
)
RETURNS public.quiz_players
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions; v_p public.quiz_players; v_count integer;
BEGIN
  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบห้อง'; END IF;
  IF NOT v_s.team_mode THEN RAISE EXCEPTION 'ห้องนี้ไม่ได้เล่นแบบทีม'; END IF;

  SELECT * INTO v_p FROM public.quiz_players
   WHERE id = p_player_id AND session_id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบผู้เล่นในห้องนี้'; END IF;

  -- ⚠️ กฎที่ขาดไม่ได้: ย้ายทีมได้เฉพาะก่อนเริ่มเกม
  --    ถ้าย้ายกลางเกมได้ ทุกคนจะกระโดดไปเกาะทีมที่กำลังนำตอนขึ้นกระดานอันดับ
  --    (คนที่ "ยังไม่เคยมีทีม" ยกเว้นให้ — เข้ามาสายแล้วยังไม่ได้เลือกทีม ต้องเลือกได้)
  IF v_s.state <> 'lobby' AND v_p.team_id IS NOT NULL THEN
    RAISE EXCEPTION 'เกมเริ่มแล้ว ย้ายทีมไม่ได้';
  END IF;

  IF p_team_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.quiz_teams WHERE id = p_team_id AND session_id = p_session_id
    ) THEN
      RAISE EXCEPTION 'ไม่พบทีมนี้';
    END IF;

    IF v_s.team_size_limit > 0 THEN
      SELECT count(*) INTO v_count FROM public.quiz_players
       WHERE team_id = p_team_id AND id <> p_player_id;
      IF v_count >= v_s.team_size_limit THEN
        RAISE EXCEPTION 'ทีมนี้เต็มแล้ว';
      END IF;
    END IF;
  END IF;

  UPDATE public.quiz_players SET team_id = p_team_id, last_seen_at = now()
   WHERE id = p_player_id
  RETURNING * INTO v_p;

  RETURN v_p;
END $fn$;


-- ── 5. กระดานอันดับทีม ──────────────────────────────────────────────
-- คิดเป็น "ค่าเฉลี่ยต่อคน" ไม่ใช่ผลรวม — เหตุผลอยู่หัวไฟล์
-- คืน member_count มาด้วยเพื่อให้จอใหญ่โชว์ได้ว่าทีมนี้กี่คน
-- (คนดูต้องเห็นว่าเฉลี่ยมาจากกี่คน ไม่งั้นจะรู้สึกว่าตัวเลขลอยมา)
CREATE OR REPLACE FUNCTION public.quiz_team_leaderboard(p_session_id uuid)
RETURNS TABLE (
  id uuid, name text, color_index integer,
  member_count integer, total_score integer, avg_score integer, rank integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH agg AS (
    SELECT t.id, t.name, t.color_index,
           count(p.id)::integer AS member_count,
           coalesce(sum(p.score), 0)::integer AS total_score,
           -- ทีมที่ยังไม่มีสมาชิกให้เป็น 0 ไม่ใช่ NULL จอใหญ่จะได้ไม่ขึ้นช่องว่าง
           coalesce(round(avg(p.score)), 0)::integer AS avg_score
      FROM public.quiz_teams t
      LEFT JOIN public.quiz_players p ON p.team_id = t.id
     WHERE t.session_id = p_session_id
     GROUP BY t.id, t.name, t.color_index
  )
  SELECT a.id, a.name, a.color_index, a.member_count, a.total_score, a.avg_score,
         (row_number() OVER (ORDER BY a.avg_score DESC, a.total_score DESC, a.name))::integer
    FROM agg a
   ORDER BY a.avg_score DESC, a.total_score DESC, a.name;
$fn$;


-- ── 6. ทีมงาน: เปลี่ยนชื่อ / ลบทีม ──────────────────────────────────
-- จำเป็นเพราะชื่อทีมลูกทัวร์พิมพ์เอง แล้วขึ้นจอใหญ่ต่อหน้าทุกคน
CREATE OR REPLACE FUNCTION public.quiz_rename_team(
  p_session_id uuid, p_token text, p_team_id uuid, p_name text
)
RETURNS public.quiz_teams
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_t public.quiz_teams;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  UPDATE public.quiz_teams
     SET name = left(btrim(p_name), 20)
   WHERE id = p_team_id AND session_id = p_session_id
  RETURNING * INTO v_t;

  RETURN v_t;
END $fn$;

CREATE OR REPLACE FUNCTION public.quiz_delete_team(
  p_session_id uuid, p_token text, p_team_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  -- สมาชิกไม่ถูกลบไปด้วย (FK เป็น ON DELETE SET NULL)
  -- เขายังเล่นต่อได้ในฐานะคนไม่มีทีม แล้วค่อยเลือกทีมใหม่
  DELETE FROM public.quiz_teams WHERE id = p_team_id AND session_id = p_session_id;
END $fn$;


-- ── 7. สิทธิ์เรียกฟังก์ชัน ──────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.quiz_create_team(uuid, uuid, text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_join_team(uuid, uuid, uuid)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_team_leaderboard(uuid)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_rename_team(uuid, text, uuid, text)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_delete_team(uuid, text, uuid)        TO anon, authenticated;


-- ── 8. Realtime ─────────────────────────────────────────────────────
-- ต้อง publish quiz_teams เพราะหน้า lobby ของทุกคนต้องเห็นทีมใหม่โผล่ทันที
-- ที่มีคนสร้าง ไม่งั้นจะมีคนตั้งทีมชื่อเดียวกันซ้อนกันเพราะไม่เห็นของคนอื่น
--
-- ⚠️ ต่างจาก quiz_players/quiz_answers ที่ตั้งใจไม่ publish:
--    การสร้างทีมเกิดไม่กี่ครั้งต่อเกม (5-8 ทีม) ไม่ใช่ 40 คน × 20 ข้อ
--    ปริมาณ event จึงคนละระดับกัน
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'quiz_teams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.quiz_teams;
  END IF;
END $$;

COMMIT;

-- ── ย้อนกลับ (ถ้าต้องถอน) ────────────────────────────────────────────
-- BEGIN;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.quiz_teams;
--   DROP FUNCTION IF EXISTS public.quiz_delete_team(uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.quiz_rename_team(uuid, text, uuid, text);
--   DROP FUNCTION IF EXISTS public.quiz_team_leaderboard(uuid);
--   DROP FUNCTION IF EXISTS public.quiz_join_team(uuid, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.quiz_create_team(uuid, uuid, text);
--   ALTER TABLE public.quiz_players DROP CONSTRAINT IF EXISTS quiz_players_team_fk;
--   DROP TABLE IF EXISTS public.quiz_teams;
--   ALTER TABLE public.quiz_sessions DROP COLUMN IF EXISTS team_size_limit;
--   ALTER TABLE public.quiz_sessions DROP COLUMN IF EXISTS team_mode;
-- COMMIT;
