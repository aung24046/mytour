-- ═══════════════════════════════════════════════════════════════════════
-- เกม "เปิดแผ่นป้าย" (Tile Reveal) — เฟส 1 · 1 ก.ย. 2026
-- ═══════════════════════════════════════════════════════════════════════
-- อ้างอิงแบบเต็ม: MyTour_TileReveal_Design_v1.md
--
-- เกมนี้ "ไม่ใช่เกมใหม่ทั้งใบ" — มันคือชนิดข้อใหม่ที่วิ่งบนเครื่องยนต์ควิซเดิม
-- และยืมงานหนักที่สุดของเกมปริศนาใบ้คำมาทั้งดุ้น:
--   quiz_norm_answer / quiz_loose_answer / quiz_edit_distance / quiz_puzzle_is_correct
--   quiz_puzzle_guesses / quiz_puzzle_close / quiz_puzzle_my_state
-- ทั้งหมดนี้ไม่ได้เขียนใหม่แม้แต่บรรทัดเดียว
--
-- สิ่งที่ไฟล์นี้เพิ่มมีสี่อย่าง:
--   1. เนื้อข้อแบบใหม่ (ภาพ 1 รูป + กริด + กรอบครอป + ภาพตอนปิด)
--   2. สถานะ "เปิดแผ่นไหนไปแล้ว" ที่ทุกจอเห็นตรงกัน
--   3. กติกา "คนแรกที่ตอบถูก = จบข้อ" ซึ่งต้องล็อกแถวห้อง (ปริศนาใบ้คำไม่ต้อง)
--   4. ค่าความใกล้เคียงของคำตอบ เก็บตอนบันทึก ไม่ใช่คำนวณตอนอ่าน
--
-- ⚠️ ต่างจากปริศนาใบ้คำตรงที่ **คนแรกที่ตอบถูกจบข้อทันที**
--    ปริศนาใบ้คำทุกคนตอบถูกได้คนละ 1 คะแนน ไม่มีอะไรต้องแย่ง จึงไม่ต้องล็อกแถวห้อง
--    เกมนี้มีของชิ้นเดียวให้แย่ง ถ้าไม่ล็อก สองคนที่กดห่างกัน 5 ms จะได้คะแนนทั้งคู่
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. ขยายค่าที่รับได้ของตารางเดิม ─────────────────────────────────
-- ขยาย ไม่ใช่บีบ — แถวเดิมทุกแถวยังผ่านทั้งหมด
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_questions_kind_check') THEN
    ALTER TABLE public.quiz_questions DROP CONSTRAINT quiz_questions_kind_check;
  END IF;
  ALTER TABLE public.quiz_questions ADD CONSTRAINT quiz_questions_kind_check
    CHECK (kind IN ('mcq', 'tf', 'numeric', 'puzzle', 'tiles'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sets_game_kind_check') THEN
    ALTER TABLE public.quiz_sets DROP CONSTRAINT quiz_sets_game_kind_check;
  END IF;
  ALTER TABLE public.quiz_sets ADD CONSTRAINT quiz_sets_game_kind_check
    CHECK (game_kind IN ('quiz', 'puzzle', 'tiles'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sessions_game_kind_check') THEN
    ALTER TABLE public.quiz_sessions DROP CONSTRAINT quiz_sessions_game_kind_check;
  END IF;
  ALTER TABLE public.quiz_sessions ADD CONSTRAINT quiz_sessions_game_kind_check
    CHECK (game_kind IN ('quiz', 'puzzle', 'tiles'));
END $$;

-- ── 2. คอลัมน์ใหม่บนตารางเดิม ───────────────────────────────────────
-- answer_mode: DEFAULT 'type' ทำให้ชุดควิซและชุดปริศนาเดิมทุกแถวถูกต้องเองโดยไม่ต้อง
-- backfill (แพตเทิร์นเดียวกับ game_kind) คอลัมน์นี้มีความหมายเฉพาะกับ game_kind='tiles'
ALTER TABLE public.quiz_sets
  ADD COLUMN IF NOT EXISTS answer_mode text NOT NULL DEFAULT 'type';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_sets_answer_mode_check') THEN
    ALTER TABLE public.quiz_sets ADD CONSTRAINT quiz_sets_answer_mode_check
      CHECK (answer_mode IN ('type', 'buzz', 'none'));
  END IF;
END $$;

-- revealed_tiles อยู่บน quiz_sessions ไม่ใช่ตารางแยก เพราะ useQuizSession ส่งทั้งแถว
-- ผ่าน realtime อยู่แล้ว เปิด 1 แผ่น = อัปเดต 1 แถว = 1 event ทุกจอเห็นพร้อมกัน
-- และ poll ทุก 4 วินาทีซ่อมตัวเองถ้า websocket หลุด (บนรถบัสหลุดบ่อย)
--
-- ⚠️ ต้องเติม revealed_tiles และ last_tile_at ใน SESSION_COLS ของ useQuizSession.js
--    รายชื่อคอลัมน์นั้นระบุเอง ไม่ใช่ select('*') ถ้าลืมเติม realtime กับ polling
--    จะให้ค่าไม่ตรงกัน อาการคือแผ่นป้ายเปิดแล้วปิดเองทุก 4 วินาที
--    (บั๊กเดียวกับที่เคยเจอตอน hint_payload ของปริศนาใบ้คำ)
--
-- last_tile_n ไม่ต้องอยู่ใน SESSION_COLS — ใช้ฝั่ง server ในปุ่มยกเลิกเท่านั้น
ALTER TABLE public.quiz_sessions
  ADD COLUMN IF NOT EXISTS revealed_tiles smallint[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_tile_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_tile_n    smallint    NOT NULL DEFAULT 0;

-- ค่าความใกล้เคียง 0-100 · คำนวณตอนบันทึก ไม่ใช่ตอนอ่าน (ดูข้อ 7.3 ของเอกสาร)
-- ตารางนี้เป็นของกลางสองเกม ปริศนาใบ้คำจะได้ใช้ด้วยเมื่อไหร่ก็ได้
ALTER TABLE public.quiz_puzzle_guesses
  ADD COLUMN IF NOT EXISTS closeness smallint;

-- ★ ภาพจริงคือเฉลย — อยู่ในตารางที่ anon อ่านไม่ได้ (ของเดิม ไม่ต้องแก้ RLS ซ้ำ)
--   ถ้าเก็บไว้ในตารางที่อ่านได้ ใครเปิด Network tab ก็เห็นภาพเต็มตั้งแต่วินาทีแรก
--   = เกมจบตั้งแต่ยังไม่เริ่ม โดยไม่มีใครรู้ตัว
ALTER TABLE public.quiz_keys
  ADD COLUMN IF NOT EXISTS tile_image_url text;

-- ── 3. ตารางเนื้อข้อ ────────────────────────────────────────────────
-- ไม่มี URL ภาพจริงในตารางนี้โดยตั้งใจ (ดูข้อ 2 ข้างบน)
--
-- ไม่ตัดภาพเป็น N ไฟล์: เรนเดอร์ rows×cols กล่องที่ใช้ภาพเดียวกันเป็น background
-- แล้วเลื่อนตำแหน่งเอา — เปลี่ยนกริดทีหลังไม่ต้องอัปใหม่ และไม่กิน storage 12 object ต่อข้อ
--
-- กรอบครอปเก็บเป็นสัดส่วน 0-1 ไม่ทำลายต้นฉบับ: ปรับกรอบใหม่ได้ตลอดโดยไม่ต้องหาไฟล์
-- ต้นฉบับในมือถืออีก ต้นทุน "ทุกเครื่องโหลดส่วนที่ครอปทิ้ง" เกือบศูนย์เพราะภาพเต็ม
-- เดินทางไปแค่จอเวทีเครื่องเดียว ไม่ใช่ 40 เครื่อง
CREATE TABLE IF NOT EXISTS public.quiz_tiles (
  question_id     uuid PRIMARY KEY REFERENCES public.quiz_questions(id) ON DELETE CASCADE,
  grid_rows       smallint NOT NULL DEFAULT 3,
  grid_cols       smallint NOT NULL DEFAULT 4,
  open_step       smallint NOT NULL DEFAULT 1,
  cover_image_url text,
  crop_x          real NOT NULL DEFAULT 0,
  crop_y          real NOT NULL DEFAULT 0,
  crop_w          real NOT NULL DEFAULT 1,
  crop_h          real NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_tiles_grid_check') THEN
    ALTER TABLE public.quiz_tiles ADD CONSTRAINT quiz_tiles_grid_check
      CHECK (grid_rows BETWEEN 2 AND 6 AND grid_cols BETWEEN 2 AND 6);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_tiles_step_check') THEN
    ALTER TABLE public.quiz_tiles ADD CONSTRAINT quiz_tiles_step_check
      CHECK (open_step BETWEEN 1 AND 4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quiz_tiles_crop_check') THEN
    ALTER TABLE public.quiz_tiles ADD CONSTRAINT quiz_tiles_crop_check
      CHECK (crop_x >= 0 AND crop_y >= 0 AND crop_w > 0 AND crop_h > 0
             AND crop_x + crop_w <= 1.0001 AND crop_y + crop_h <= 1.0001);
  END IF;
END $$;

-- ── 4. RLS ──────────────────────────────────────────────────────────
-- เนื้อข้อ: อ่านได้ (ลูกทัวร์ต้องเห็นกระดานและภาพตอนปิด) เขียนไม่ได้
-- เขียนผ่าน RPC ที่ตรวจ PIN — ตรงกับที่ 20260819_game_hardening.sql ทำกับ quiz_questions
ALTER TABLE public.quiz_tiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname='public' AND tablename='quiz_tiles' AND policyname='quiz_tiles_read') THEN
    CREATE POLICY quiz_tiles_read ON public.quiz_tiles FOR SELECT USING (true);
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.quiz_tiles FROM anon, authenticated;

COMMIT;

BEGIN;

-- ── 5. ค่าความใกล้เคียงของคำตอบ ─────────────────────────────────────
-- คำนวณตอนบันทึกคำเดา ไม่ใช่ตอนคนคุมเกมอ่าน — RPC เปิด quiz_keys อ่านเฉลยอยู่แล้ว
-- เพื่อตัดสินถูก/ผิด คำนวณตรงนั้นทีเดียวจบ ถ้าไปคำนวณตอน poll ทุก 1.5 วินาที
-- = ยิง quiz_edit_distance ใส่คำตอบเดิมซ้ำๆ ทุกรอบโดยเปล่าประโยชน์
--
-- เทียบบนรูป quiz_loose_answer (ตัดวรรณยุกต์และการันต์แล้ว) ไม่งั้น "บุรีรัม"
-- กับ "บุรีรัมย์" จะได้คะแนนต่ำทั้งที่คือคนที่รู้คำตอบ
-- เทียบกับคำตอบและ alias ทุกตัว เอาค่าดีที่สุด
CREATE OR REPLACE FUNCTION public.quiz_tiles_closeness(p_question_id uuid, p_text text)
RETURNS smallint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_mine text := public.quiz_loose_answer(coalesce(p_text, ''));
  v_k    public.quiz_keys;
  v_best integer := 0;
  v_cand text;
  v_c    text;
  v_d    integer;
  v_len  integer;
  v_score integer;
BEGIN
  IF v_mine = '' THEN RETURN 0::smallint; END IF;

  SELECT * INTO v_k FROM public.quiz_keys WHERE question_id = p_question_id;
  IF NOT FOUND THEN RETURN 0::smallint; END IF;

  FOREACH v_cand IN ARRAY (ARRAY[coalesce(v_k.correct_text, '')] || coalesce(v_k.answer_aliases, '{}'))
  LOOP
    v_c := public.quiz_loose_answer(v_cand);
    CONTINUE WHEN v_c = '';
    v_d := public.quiz_edit_distance(v_mine, v_c);
    v_len := greatest(length(v_mine), length(v_c), 1);
    v_score := 100 - round(v_d::numeric / v_len * 100);
    IF v_score > v_best THEN v_best := v_score; END IF;
  END LOOP;

  RETURN greatest(v_best, 0)::smallint;
END $fn$;
REVOKE ALL ON FUNCTION public.quiz_tiles_closeness(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 6. เปิดแผ่นป้าย ─────────────────────────────────────────────────
-- p_tile_no = NULL คือสุ่ม
--
-- ★ การสุ่มตัดสินที่นี่เท่านั้น ห้าม Math.random() ที่ client แล้วค่อยเขียนกลับ
--   กดรัวสองครั้งติด หรือคนคุมเกมเปิดสองแท็บ จะได้ผลคนละอย่างแล้วทับกัน
--   ที่นี่เลือกจาก "แผ่นที่ยังไม่เปิด" ภายใต้ FOR UPDATE จึงไม่มีทางซ้ำและไม่มีทางแตกกัน
CREATE OR REPLACE FUNCTION public.quiz_tiles_open(
  p_session_id uuid, p_token text, p_tile_no integer DEFAULT NULL
)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s     public.quiz_sessions;
  v_t     public.quiz_tiles;
  v_total integer;
  v_step  integer;
  v_new   smallint[];
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN v_s; END IF;
  IF v_s.state NOT IN ('answering', 'locked') THEN RETURN v_s; END IF;

  SELECT * INTO v_t FROM public.quiz_tiles WHERE question_id = v_s.current_question_id;
  IF NOT FOUND THEN RETURN v_s; END IF;

  v_total := v_t.grid_rows * v_t.grid_cols;
  v_step  := greatest(coalesce(v_t.open_step, 1), 1);

  IF p_tile_no IS NOT NULL THEN
    -- นอกช่วง หรือเปิดไปแล้ว = ไม่ทำอะไร ไม่ error (กดรัวเพราะคิดว่าเน็ตค้าง)
    IF p_tile_no < 1 OR p_tile_no > v_total THEN RETURN v_s; END IF;
    IF p_tile_no::smallint = ANY (v_s.revealed_tiles) THEN RETURN v_s; END IF;
    v_new := ARRAY[p_tile_no::smallint];
  ELSE
    SELECT array_agg(t)::smallint[] INTO v_new FROM (
      SELECT g AS t
        FROM generate_series(1, v_total) g
       WHERE NOT (g::smallint = ANY (v_s.revealed_tiles))
       ORDER BY random()
       LIMIT v_step
    ) x;
    IF v_new IS NULL OR array_length(v_new, 1) IS NULL THEN RETURN v_s; END IF;
  END IF;

  UPDATE public.quiz_sessions
     SET revealed_tiles = v_s.revealed_tiles || v_new,
         last_tile_at   = now(),
         last_tile_n    = array_length(v_new, 1)
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

-- ยกเลิกแผ่นที่เพิ่งเปิด — นิ้วลั่นครั้งเดียวต่อหน้าคน 40 คนแล้วแก้ไม่ได้ = ข้อนั้นจบ
--
-- จำกัด 5 วินาทีโดยตั้งใจ: เกินกว่านั้นคนเห็นไปแล้ว ปิดกลับไม่มีความหมาย
-- และจะกลายเป็นเครื่องมือโกงจังหวะแทนที่จะเป็นปุ่มแก้พลาด
CREATE OR REPLACE FUNCTION public.quiz_tiles_undo(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions; v_len integer; v_keep integer;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN v_s; END IF;
  IF v_s.state NOT IN ('answering', 'locked') THEN RETURN v_s; END IF;
  IF v_s.last_tile_at IS NULL OR now() - v_s.last_tile_at > interval '5 seconds' THEN
    RETURN v_s;
  END IF;

  v_len := coalesce(array_length(v_s.revealed_tiles, 1), 0);
  IF v_len = 0 OR v_s.last_tile_n <= 0 THEN RETURN v_s; END IF;
  v_keep := greatest(v_len - v_s.last_tile_n, 0);

  UPDATE public.quiz_sessions
     SET revealed_tiles = v_s.revealed_tiles[1:v_keep],
         last_tile_at = NULL,
         last_tile_n = 0
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

-- ภาพจริง — ออกได้ทางนี้ทางเดียว และเฉพาะคนที่ถือ token ของห้อง
-- จอเวทีถือ token อยู่แล้ว (stageUrl พามาใน hash) และมือถือคนคุมเกมก็ถือ
-- ลูกทัวร์ไม่มี token จึงไม่มีทางเรียกได้
--
-- รับ question_id แยกจาก current_question_id เพื่อให้จอเวทีโหลดภาพข้อถัดไป
-- ไว้ล่วงหน้าได้ (ดูข้อ 11.2 ของเอกสาร) แต่ต้องเป็นข้อในชุดเดียวกับห้องนี้เท่านั้น
CREATE OR REPLACE FUNCTION public.quiz_tiles_image(
  p_session_id uuid, p_question_id uuid, p_token text
)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_url text;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT k.tile_image_url INTO v_url
    FROM public.quiz_keys k
    JOIN public.quiz_questions q ON q.id = k.question_id
    JOIN public.quiz_sessions s  ON s.set_id = q.set_id
   WHERE k.question_id = p_question_id AND s.id = p_session_id;

  RETURN v_url;
END $fn$;

COMMIT;

BEGIN;

-- ── 7. ลูกทัวร์ส่งคำเดา ─────────────────────────────────────────────
-- ลอกด่านทั้งหมดจาก quiz_puzzle_guess มาตรงๆ แล้วเปลี่ยนสองจุด (ดูข้อ 7.3 ของเอกสาร)
--
-- ด่านที่ต้องผ่าน เรียงตามลำดับที่ถูกที่สุดก่อน:
--   1. ข้อที่ส่งมาต้องเป็นข้อปัจจุบัน และอยู่ในช่วงเปิดรับ (+ผ่อนผัน 200ms)
--   2. ★ มีคนตอบถูกไปแล้วหรือยัง — ของใหม่ ปริศนาใบ้คำไม่มีด่านนี้
--   3. ตัวเองตอบถูกไปแล้ว
--   4. rate limit 400ms
--   5. ข้อความซ้ำกับครั้งก่อน → ไม่นับ ไม่บันทึก
--      ★ ต้องคงไว้ ไม่งั้นนิ้วลั่นทีเดียวเสียโควตา ซึ่งเจ็บกว่าเดิมมากเมื่อโควตาจำกัด
--   6. โควตาของชุด (attempt_limit) และเพดานนิรภัย 40 ครั้ง
--
-- ★ จุดต่างที่ 1: SELECT ... FOR UPDATE ตั้งแต่ต้น
--   quiz_puzzle_guess เดิมไม่ล็อกเพราะปริศนาใบ้คำไม่ต้อง — ทุกคนตอบถูกได้คนละ 1 คะแนน
--   ไม่มีอะไรต้องแย่ง เกมนี้มีของชิ้นเดียวให้แย่ง ถ้าไม่ล็อก สองคนที่กดส่งห่างกัน
--   5 มิลลิวินาทีจะได้คะแนนทั้งคู่และสั่งจบข้อซ้อนกัน
--   บั๊กนี้ไม่โผล่ตอนทดสอบคนเดียว โผล่วันที่มีคน 40 คนกดพร้อมกัน
--
-- ★ จุดต่างที่ 2: คำนวณ closeness ตอนบันทึก และ "ไม่คืนกลับไปให้ผู้เล่นเด็ดขาด"
--   บอกไปคือแจกคำใบ้ชั้นดี และขัดกับกติกาโควตาจำกัดโดยตรง
CREATE OR REPLACE FUNCTION public.quiz_tiles_guess(
  p_session_id  uuid,
  p_player_id   uuid,
  p_question_id uuid,
  p_text        text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s public.quiz_sessions;
  v_q public.quiz_questions;
  v_t public.quiz_tiles;
  v_raw   text := btrim(coalesce(p_text, ''));
  v_norm  text;
  v_loose text;
  v_last  public.quiz_puzzle_guesses;
  v_used  integer;
  v_limit integer;
  v_points integer;
  v_elapsed integer;
  v_limit_ms integer;
  v_correct boolean := false;
  v_close smallint;
  v_rows integer := 0;
  v_has_last boolean := false;
  v_total integer;
  v_all smallint[];
  v_grace interval := interval '200 milliseconds';
BEGIN
  IF v_raw = '' THEN RETURN jsonb_build_object('status', 'empty'); END IF;
  IF length(v_raw) > 80 THEN RETURN jsonb_build_object('status', 'too_long'); END IF;

  -- ★ ล็อกตั้งแต่ต้น ทุกด่านหลังจากนี้อยู่ในธุรกรรมเดียวกัน
  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_session'); END IF;
  IF v_s.current_question_id IS DISTINCT FROM p_question_id THEN
    RETURN jsonb_build_object('status', 'wrong_question');
  END IF;
  IF v_s.question_started_at IS NULL OR now() < v_s.question_started_at THEN
    RETURN jsonb_build_object('status', 'not_started');
  END IF;

  -- ★ มีคนได้ไปแล้ว — ตอบก่อนด่านเวลา เพราะบอกความจริงได้ตรงกว่าคำว่า "ปิดรับแล้ว"
  IF EXISTS (
    SELECT 1 FROM public.quiz_answers
     WHERE session_id = p_session_id AND question_id = p_question_id AND is_correct
  ) THEN
    RETURN jsonb_build_object('status', 'already_solved');
  END IF;

  IF NOT (
    (v_s.state = 'answering' AND now() <= v_s.question_ends_at + v_grace)
    OR (v_s.state = 'locked' AND v_s.locked_at IS NOT NULL AND now() <= v_s.locked_at + v_grace)
  ) THEN
    RETURN jsonb_build_object('status', 'closed');
  END IF;

  SELECT * INTO v_last
    FROM public.quiz_puzzle_guesses
   WHERE session_id = p_session_id AND question_id = p_question_id AND player_id = p_player_id
   ORDER BY created_at DESC LIMIT 1;
  v_has_last := FOUND;

  IF v_has_last AND now() - v_last.created_at < interval '400 milliseconds' THEN
    RETURN jsonb_build_object('status', 'too_fast');
  END IF;

  v_norm  := public.quiz_norm_answer(v_raw);
  v_loose := public.quiz_loose_answer(v_raw);
  IF v_norm = '' THEN RETURN jsonb_build_object('status', 'empty'); END IF;
  IF v_has_last AND v_last.norm_text = v_loose THEN
    RETURN jsonb_build_object('status', 'duplicate');
  END IF;

  SELECT count(*) INTO v_used
    FROM public.quiz_puzzle_guesses
   WHERE session_id = p_session_id AND question_id = p_question_id AND player_id = p_player_id;

  SELECT * INTO v_q FROM public.quiz_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'wrong_question'); END IF;
  SELECT s.attempt_limit, s.points_per_correct
    INTO v_limit, v_points
    FROM public.quiz_sets s WHERE s.id = v_q.set_id;

  IF v_limit IS NOT NULL AND v_used >= v_limit THEN
    RETURN jsonb_build_object('status', 'no_attempts', 'attempts_left', 0);
  END IF;
  IF v_used >= 40 THEN
    RETURN jsonb_build_object('status', 'no_attempts', 'attempts_left', 0);
  END IF;

  v_limit_ms := greatest(coalesce(v_q.time_limit_sec, 300), 1) * 1000;
  v_elapsed := least(
    greatest((extract(epoch FROM (now() - v_s.question_started_at)) * 1000)::integer, 0),
    v_limit_ms
  );

  v_correct := public.quiz_puzzle_is_correct(p_question_id, v_raw);
  v_close   := public.quiz_tiles_closeness(p_question_id, v_raw);

  INSERT INTO public.quiz_puzzle_guesses
    (session_id, question_id, player_id, raw_text, norm_text, is_correct, elapsed_ms, closeness)
  VALUES
    (p_session_id, p_question_id, p_player_id, v_raw, v_loose, v_correct, v_elapsed, v_close);

  UPDATE public.quiz_players SET last_seen_at = now() WHERE id = p_player_id;

  IF v_correct THEN
    INSERT INTO public.quiz_answers
      (session_id, question_id, player_id, elapsed_ms, is_correct, points)
    VALUES
      (p_session_id, p_question_id, p_player_id, v_elapsed, true, coalesce(v_points, 1))
    ON CONFLICT (session_id, question_id, player_id) DO UPDATE
       SET is_correct = true, points = excluded.points, elapsed_ms = excluded.elapsed_ms
     WHERE public.quiz_answers.is_correct IS DISTINCT FROM true;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      UPDATE public.quiz_players
         SET score = score + coalesce(v_points, 1),
             correct_count = correct_count + 1
       WHERE id = p_player_id;
    END IF;

    -- จบข้อทันที: เปิดแผ่นป้ายทั้งหมดแล้วปิดรับ
    -- คนอื่นที่ยังพิมพ์ค้างอยู่จะไปตกด่าน already_solved ในธุรกรรมถัดไป
    SELECT * INTO v_t FROM public.quiz_tiles WHERE question_id = p_question_id;
    v_total := coalesce(v_t.grid_rows * v_t.grid_cols, 0);
    IF v_total > 0 THEN
      SELECT array_agg(g)::smallint[] INTO v_all FROM generate_series(1, v_total) g;
    ELSE
      v_all := v_s.revealed_tiles;
    END IF;

    UPDATE public.quiz_sessions
       SET revealed_tiles = v_all,
           state = 'locked',
           locked_at = now(),
           last_tile_at = NULL,
           last_tile_n = 0
     WHERE id = p_session_id;

    -- คนที่เหลือได้แถวสรุป 0 คะแนน — ไม่งั้น quiz_report นับไม่ครบ
    -- ฟังก์ชันนี้เป็นของกลาง ไม่ผูกกับเกมใดเกมหนึ่ง จึงใช้ซ้ำได้ตรงๆ
    PERFORM public.quiz_puzzle_close(p_session_id, p_question_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'correct', v_correct,
    'attempts_used', v_used + 1,
    'attempts_left', CASE WHEN v_limit IS NULL THEN NULL ELSE greatest(v_limit - v_used - 1, 0) END
  );
END $fn$;

COMMIT;

BEGIN;

-- ── 8. ฝั่งคนคุมเกม ─────────────────────────────────────────────────

-- ตัวเลขระหว่างเปิดรับ
-- ★ still_in = "ยังตอบได้อยู่กี่คน" ของใหม่ที่ปริศนาใบ้คำไม่มี
--   จำเป็นเพราะโควตาจำกัดทำให้ "คนหมดสิทธิ์" เป็นเรื่องปกติ ไม่ใช่เคสขอบ
--   ให้โควตา 3 ครั้งกับ "ผลไม้อะไร" คือคนครึ่งห้องหมดสิทธิ์ตั้งแต่เปิดไป 4 แผ่น
--   ถ้าเหลือคนตอบได้ 3 จาก 40 การเปิดแผ่นต่อไปไม่มีความหมายแล้ว
--   นี่คือตัวเลขที่บอกว่าควรเปิดต่อหรือเฉลยเลย
CREATE OR REPLACE FUNCTION public.quiz_tiles_stats(
  p_session_id uuid, p_question_id uuid, p_token text, p_online_window_sec integer DEFAULT 60
)
RETURNS TABLE (solved integer, guesses integer, online integer, total integer, still_in integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_cap integer;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT least(coalesce(s.attempt_limit, 40), 40) INTO v_cap
    FROM public.quiz_questions q JOIN public.quiz_sets s ON s.id = q.set_id
   WHERE q.id = p_question_id;
  v_cap := coalesce(v_cap, 40);

  RETURN QUERY SELECT
    (SELECT count(*) FROM public.quiz_answers a
      WHERE a.session_id = p_session_id AND a.question_id = p_question_id AND a.is_correct)::integer,
    (SELECT count(*) FROM public.quiz_puzzle_guesses g
      WHERE g.session_id = p_session_id AND g.question_id = p_question_id)::integer,
    (SELECT count(*) FROM public.quiz_players p
      WHERE p.session_id = p_session_id
        AND p.last_seen_at > now() - make_interval(secs => p_online_window_sec))::integer,
    (SELECT count(*) FROM public.quiz_players p WHERE p.session_id = p_session_id)::integer,
    (SELECT count(*) FROM public.quiz_players p
      WHERE p.session_id = p_session_id
        AND NOT EXISTS (
          SELECT 1 FROM public.quiz_answers a
           WHERE a.session_id = p_session_id AND a.question_id = p_question_id
             AND a.player_id = p.id AND a.is_correct)
        AND (SELECT count(*) FROM public.quiz_puzzle_guesses g
              WHERE g.session_id = p_session_id AND g.question_id = p_question_id
                AND g.player_id = p.id) < v_cap)::integer;
END $fn$;

-- คำตอบทุกคำเรียงตามเวลา พร้อมค่าความใกล้เคียง
--
-- ★ ห้ามเปิด RLS ให้ quiz_puzzle_guesses เพื่อทำสิ่งนี้ — ตารางนั้นตั้งใจปิดสนิท
--   ถ้าเปิดให้อ่าน ลูกทัวร์จะเห็นคำที่คนอื่นเดาแล้ว "ถูก" = ได้เฉลยฟรี
--
-- cursor เป็นคู่ (created_at, id) ไม่ใช่ created_at เดี่ยว เพราะสองคนส่งพร้อมกัน
-- ในไมโครวินาทีเดียวกันได้ ถ้าใช้ค่าเดียวจะมีแถวหล่นหายโดยไม่มีใครรู้
--
-- ครั้งแรก (ไม่มี cursor) ต้องคืน "แถวล่าสุด N แถว" ไม่ใช่ "N แถวแรก"
-- ไม่งั้นคนคุมเกมที่เปิดจอกลางข้อจะเห็นแต่คำตอบตอนต้นข้อ
CREATE OR REPLACE FUNCTION public.quiz_tiles_feed(
  p_session_id uuid,
  p_question_id uuid,
  p_token text,
  p_after_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 40
)
RETURNS TABLE (
  guess_id uuid, player_id uuid, player_name text, guess_text text,
  closeness smallint, is_correct boolean, elapsed_ms integer, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_lim integer := least(greatest(coalesce(p_limit, 40), 1), 200);
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  IF p_after_at IS NULL THEN
    RETURN QUERY
      SELECT t.gid, t.pid, t.pname, t.gtext, t.gclose, t.gcorrect, t.gelapsed, t.gat
        FROM (
          SELECT g.id AS gid, g.player_id AS pid, coalesce(p.display_name, '') AS pname,
                 g.raw_text AS gtext, coalesce(g.closeness, 0)::smallint AS gclose,
                 g.is_correct AS gcorrect, g.elapsed_ms AS gelapsed, g.created_at AS gat
            FROM public.quiz_puzzle_guesses g
            JOIN public.quiz_players p ON p.id = g.player_id
           WHERE g.session_id = p_session_id AND g.question_id = p_question_id
           ORDER BY g.created_at DESC, g.id DESC
           LIMIT v_lim
        ) t
       ORDER BY t.gat, t.gid;
  ELSE
    RETURN QUERY
      SELECT t.gid, t.pid, t.pname, t.gtext, t.gclose, t.gcorrect, t.gelapsed, t.gat
        FROM (
          SELECT g.id AS gid, g.player_id AS pid, coalesce(p.display_name, '') AS pname,
                 g.raw_text AS gtext, coalesce(g.closeness, 0)::smallint AS gclose,
                 g.is_correct AS gcorrect, g.elapsed_ms AS gelapsed, g.created_at AS gat
            FROM public.quiz_puzzle_guesses g
            JOIN public.quiz_players p ON p.id = g.player_id
           WHERE g.session_id = p_session_id AND g.question_id = p_question_id
             AND (g.created_at, g.id)
                 > (p_after_at, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
           ORDER BY g.created_at, g.id
           LIMIT v_lim
        ) t
       ORDER BY t.gat, t.gid;
  END IF;
END $fn$;

-- รับคำที่เกือบถูกเป็นคำตอบถูก
--
-- ต่างจาก quiz_puzzle_accept ตรงที่ **ให้คนเดียว ไม่ใช่ทุกคนที่พิมพ์คำนั้น**
-- เพราะเกมนี้เป็นการแข่ง คนแรกที่พิมพ์คือคนชนะ แล้วข้อจบทันที
CREATE OR REPLACE FUNCTION public.quiz_tiles_accept(
  p_session_id uuid, p_question_id uuid, p_token text, p_text text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s public.quiz_sessions;
  v_t public.quiz_tiles;
  v_target text := public.quiz_loose_answer(p_text);
  v_points integer; v_pid uuid; v_elapsed integer;
  v_total integer; v_all smallint[]; v_rows integer;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;
  IF v_target = '' THEN RETURN jsonb_build_object('status', 'empty'); END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_session'); END IF;
  IF v_s.state NOT IN ('answering', 'locked') THEN
    RETURN jsonb_build_object('status', 'too_late');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.quiz_answers
     WHERE session_id = p_session_id AND question_id = p_question_id AND is_correct
  ) THEN
    RETURN jsonb_build_object('status', 'already_solved');
  END IF;

  SELECT s.points_per_correct INTO v_points
    FROM public.quiz_questions q JOIN public.quiz_sets s ON s.id = q.set_id
   WHERE q.id = p_question_id;

  -- จำไว้ถาวร — ชุดนี้ครั้งหน้าไม่ต้องกดอีก คลังจะฉลาดขึ้นเองทุกครั้งที่เล่น
  UPDATE public.quiz_keys
     SET answer_aliases = (
           SELECT array_agg(DISTINCT x)
             FROM unnest(coalesce(answer_aliases, '{}') || ARRAY[btrim(p_text)]) x
            WHERE btrim(x) <> ''
         )
   WHERE question_id = p_question_id;

  SELECT g.player_id, g.elapsed_ms INTO v_pid, v_elapsed
    FROM public.quiz_puzzle_guesses g
   WHERE g.session_id = p_session_id AND g.question_id = p_question_id
     AND g.norm_text = v_target
   ORDER BY g.created_at
   LIMIT 1;

  IF v_pid IS NULL THEN RETURN jsonb_build_object('status', 'not_found'); END IF;

  INSERT INTO public.quiz_answers
    (session_id, question_id, player_id, elapsed_ms, is_correct, points)
  VALUES
    (p_session_id, p_question_id, v_pid, v_elapsed, true, coalesce(v_points, 1))
  ON CONFLICT (session_id, question_id, player_id) DO UPDATE
     SET is_correct = true, points = excluded.points, elapsed_ms = excluded.elapsed_ms
   WHERE public.quiz_answers.is_correct IS DISTINCT FROM true;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    UPDATE public.quiz_players
       SET score = score + coalesce(v_points, 1), correct_count = correct_count + 1
     WHERE id = v_pid;
  END IF;

  UPDATE public.quiz_puzzle_guesses
     SET is_correct = true
   WHERE session_id = p_session_id AND question_id = p_question_id
     AND player_id = v_pid AND norm_text = v_target;

  SELECT * INTO v_t FROM public.quiz_tiles WHERE question_id = p_question_id;
  v_total := coalesce(v_t.grid_rows * v_t.grid_cols, 0);
  IF v_total > 0 THEN
    SELECT array_agg(g)::smallint[] INTO v_all FROM generate_series(1, v_total) g;
  ELSE
    v_all := v_s.revealed_tiles;
  END IF;

  UPDATE public.quiz_sessions
     SET revealed_tiles = v_all, state = 'locked', locked_at = now(),
         last_tile_at = NULL, last_tile_n = 0
   WHERE id = p_session_id;

  PERFORM public.quiz_puzzle_close(p_session_id, p_question_id);

  RETURN jsonb_build_object('status', 'ok', 'player_id', v_pid);
END $fn$;

COMMIT;

BEGIN;

-- ── 9. คนสร้างข้อ ───────────────────────────────────────────────────
-- ต้องผ่าน PIN เพราะเฉลยและ URL ภาพจริงอยู่ใน quiz_keys ที่ปิดสนิท
-- และสตาฟกับลูกทัวร์ใช้ anon key ตัวเดียวกัน ถ้าไม่ตรวจอะไรเลย
-- ลูกทัวร์ก็เรียกดูภาพล่วงหน้าได้
CREATE OR REPLACE FUNCTION public.quiz_tiles_set_for_edit(
  p_set_id uuid, p_staff_id uuid, p_pin text
)
RETURNS TABLE (
  question_id uuid, sort_order integer, question_text text, time_limit_sec integer,
  grid_rows integer, grid_cols integer, open_step integer, cover_image_url text,
  crop_x real, crop_y real, crop_w real, crop_h real,
  tile_image_url text, correct_text text, answer_aliases text[], explain text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  RETURN QUERY
    SELECT q.id, q.sort_order, q.text, q.time_limit_sec,
           coalesce(z.grid_rows, 3)::integer, coalesce(z.grid_cols, 4)::integer,
           coalesce(z.open_step, 1)::integer, z.cover_image_url,
           coalesce(z.crop_x, 0)::real, coalesce(z.crop_y, 0)::real,
           coalesce(z.crop_w, 1)::real, coalesce(z.crop_h, 1)::real,
           k.tile_image_url, coalesce(k.correct_text, ''),
           coalesce(k.answer_aliases, '{}'), coalesce(k.explain, '')
      FROM public.quiz_questions q
      LEFT JOIN public.quiz_tiles z ON z.question_id = q.id
      LEFT JOIN public.quiz_keys  k ON k.question_id = q.id
     WHERE q.set_id = p_set_id AND q.kind = 'tiles'
     ORDER BY q.sort_order, q.created_at;
END $fn$;

-- บันทึกข้อ — คำถาม กระดาน กรอบครอป และเฉลย ต้องลงใน transaction เดียว
-- ไม่งั้นมีจังหวะที่ข้อมีอยู่แต่ยังไม่มีเฉลย แล้วทุกคนที่ตอบตอนนั้นจะกลายเป็นผิดหมด
CREATE OR REPLACE FUNCTION public.quiz_tiles_upsert(
  p_staff_id uuid, p_pin text, p_set_id uuid, p_question_id uuid,
  p_text text, p_time_limit_sec integer,
  p_grid_rows integer, p_grid_cols integer, p_open_step integer,
  p_cover_image_url text,
  p_crop_x real, p_crop_y real, p_crop_w real, p_crop_h real,
  p_tile_image_url text, p_answer text, p_aliases text[], p_explain text,
  p_sort_order integer
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_qid uuid; v_rows integer; v_cols integer; v_step integer; v_time integer;
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;
  IF btrim(coalesce(p_answer, '')) = '' THEN RAISE EXCEPTION 'ต้องมีคำตอบ'; END IF;
  IF btrim(coalesce(p_tile_image_url, '')) = '' THEN RAISE EXCEPTION 'ต้องมีภาพ'; END IF;

  v_rows := least(greatest(coalesce(p_grid_rows, 3), 2), 6);
  v_cols := least(greatest(coalesce(p_grid_cols, 4), 2), 6);
  v_step := least(greatest(coalesce(p_open_step, 1), 1), 4);
  -- เกมนี้คนคุมเกมกำหนดจังหวะเอง ไม่นับถอยหลัง — 300 คือเพดานของ quiz_questions_time_check
  -- ใส่ไว้กันข้อค้างตลอดกาลเฉยๆ หน้าจอไม่แสดงนาฬิกา (ดูข้อ 8 ของเอกสารออกแบบ)
  v_time := least(greatest(coalesce(p_time_limit_sec, 300), 5), 300);

  IF p_question_id IS NULL THEN
    INSERT INTO public.quiz_questions (set_id, sort_order, kind, text, time_limit_sec)
    VALUES (p_set_id, coalesce(p_sort_order, 0), 'tiles', coalesce(p_text, ''), v_time)
    RETURNING id INTO v_qid;
  ELSE
    UPDATE public.quiz_questions
       SET text = coalesce(p_text, ''), time_limit_sec = v_time,
           sort_order = coalesce(p_sort_order, sort_order), kind = 'tiles'
     WHERE id = p_question_id AND set_id = p_set_id
    RETURNING id INTO v_qid;
    IF v_qid IS NULL THEN RAISE EXCEPTION 'ไม่พบข้อนี้ในชุด'; END IF;
  END IF;

  INSERT INTO public.quiz_tiles
    (question_id, grid_rows, grid_cols, open_step, cover_image_url, crop_x, crop_y, crop_w, crop_h)
  VALUES
    (v_qid, v_rows, v_cols, v_step, nullif(btrim(coalesce(p_cover_image_url, '')), ''),
     coalesce(p_crop_x, 0), coalesce(p_crop_y, 0), coalesce(p_crop_w, 1), coalesce(p_crop_h, 1))
  ON CONFLICT (question_id) DO UPDATE
     SET grid_rows = excluded.grid_rows, grid_cols = excluded.grid_cols,
         open_step = excluded.open_step, cover_image_url = excluded.cover_image_url,
         crop_x = excluded.crop_x, crop_y = excluded.crop_y,
         crop_w = excluded.crop_w, crop_h = excluded.crop_h;

  INSERT INTO public.quiz_keys
    (question_id, correct_text, answer_aliases, tile_image_url, explain)
  VALUES
    (v_qid, btrim(p_answer),
     coalesce((SELECT array_agg(DISTINCT btrim(x)) FROM unnest(coalesce(p_aliases, '{}')) x
                WHERE btrim(x) <> ''), '{}'),
     btrim(p_tile_image_url), coalesce(p_explain, ''))
  ON CONFLICT (question_id) DO UPDATE
     SET correct_text = excluded.correct_text,
         answer_aliases = excluded.answer_aliases,
         tile_image_url = excluded.tile_image_url,
         explain = excluded.explain;

  RETURN v_qid;
END $fn$;

COMMIT;

BEGIN;

-- ── 10. แก้ฟังก์ชันเดิม 5 ตัว ───────────────────────────────────────

-- quiz_next: ของเดิมทุกบรรทัด + ล้างสถานะแผ่นป้ายของข้อที่แล้ว
-- ⚠️ ถ้าลืมล้าง revealed_tiles แผ่นที่เปิดของข้อเก่าจะค้างบนข้อใหม่ = เฉลยฟรี
--    บั๊กเดียวกับที่เคยเจอกับ hint_payload ของปริศนาใบ้คำ และมองไม่เห็นตอนเทสต์ทีละข้อ
CREATE OR REPLACE FUNCTION public.quiz_next(
  p_session_id uuid, p_token text,
  p_expected_index integer DEFAULT NULL, p_lead_ms integer DEFAULT 3000
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

  SELECT * INTO v_q FROM public.quiz_questions
   WHERE set_id = v_s.set_id ORDER BY sort_order, created_at OFFSET v_next LIMIT 1;

  IF NOT FOUND THEN
    UPDATE public.quiz_sessions
       SET state = 'finished', ended_at = now(), reveal_payload = '{}'::jsonb,
           hint_level = 0, hint_payload = '[]'::jsonb,
           revealed_tiles = '{}', last_tile_at = NULL, last_tile_n = 0
     WHERE id = p_session_id
    RETURNING * INTO v_s;
    RETURN v_s;
  END IF;

  UPDATE public.quiz_sessions
     SET state = 'answering',
         current_index = v_next,
         current_question_id = v_q.id,
         question_started_at = now() + make_interval(secs => p_lead_ms / 1000.0),
         question_ends_at = now() + make_interval(secs => p_lead_ms / 1000.0)
                                  + make_interval(secs => v_q.time_limit_sec),
         locked_at = NULL,
         reveal_payload = '{}'::jsonb,
         hint_level = 0, hint_payload = '[]'::jsonb,
         revealed_tiles = '{}', last_tile_at = NULL, last_tile_n = 0
   WHERE id = p_session_id
  RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

-- quiz_lock: ของเดิม + สาย 'tiles' (quiz_puzzle_close เป็นของกลาง ไม่ผูกกับเกมใดเกมหนึ่ง)
CREATE OR REPLACE FUNCTION public.quiz_lock(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_s public.quiz_sessions; v_kind text;
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

  IF v_s.current_question_id IS NOT NULL THEN
    SELECT kind INTO v_kind FROM public.quiz_questions WHERE id = v_s.current_question_id;
    IF v_kind IN ('puzzle', 'tiles') THEN
      PERFORM public.quiz_puzzle_close(p_session_id, v_s.current_question_id);
    END IF;
  END IF;

  RETURN v_s;
END $fn$;

-- quiz_start_session: ของเดิม + ชื่อห้องและสกินเวทีของเกมใหม่
-- game_kind ยังคัดฝั่ง DB เหมือนเดิม ไม่ให้ client ส่งมา (เหตุผลใน 20260826_word_puzzle.sql)
CREATE OR REPLACE FUNCTION public.quiz_start_session(
  p_tour_id uuid, p_set_id uuid, p_name text DEFAULT NULL, p_bus_id uuid DEFAULT NULL,
  p_screen_mode text DEFAULT 'projector', p_staff_id uuid DEFAULT NULL
)
RETURNS TABLE (session_id uuid, token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid; v_token text; v_kind text; v_default_name text;
BEGIN
  SELECT coalesce(game_kind, 'quiz') INTO v_kind FROM public.quiz_sets WHERE id = p_set_id;
  v_kind := coalesce(v_kind, 'quiz');
  v_default_name := CASE v_kind
                      WHEN 'puzzle' THEN 'ห้องปริศนาใบ้คำ'
                      WHEN 'tiles'  THEN 'ห้องเปิดแผ่นป้าย'
                      ELSE 'ห้องควิซ' END;

  INSERT INTO public.quiz_sessions
    (tour_id, set_id, name, bus_id, screen_mode, created_by, game_kind, stage_theme)
  VALUES (
    p_tour_id, p_set_id, coalesce(nullif(btrim(p_name), ''), v_default_name),
    p_bus_id, coalesce(p_screen_mode, 'projector'), p_staff_id, v_kind,
    CASE WHEN v_kind IN ('puzzle', 'tiles') THEN 'arcade' ELSE 'day' END
  )
  RETURNING id INTO v_id;

  -- ต่อ uuid สองก้อน = สุ่ม 256 bit · ห้ามใช้ gen_random_bytes (เหตุผลใน 20260818_quiz.sql)
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.quiz_session_tokens (session_id, token) VALUES (v_id, v_token);

  RETURN QUERY SELECT v_id, v_token;
END $fn$;

-- quiz_reveal: ของเดิมทุกบรรทัด + สาย 'tiles'
--
-- ⚠️ เกมเปิดแผ่นป้าย "ไม่คิดคะแนนตรงนี้" เหมือนเกมปริศนา เพราะคะแนนลงไปแล้วตอนตอบถูก
--    ถ้าเผลอเอาไปรวมกับสาย mcq/tf คะแนนจะถูกบวกซ้ำทั้งห้อง
--
-- ★ tile_image_url ออกมาที่นี่ได้เพราะข้อจบแล้ว — และนี่คือวิธีที่มือถือลูกทัวร์
--   ได้เห็นภาพเต็มบนเครื่องตัวเอง ซึ่งเป็นจังหวะพีคของข้อ
CREATE OR REPLACE FUNCTION public.quiz_reveal(p_session_id uuid, p_token text)
RETURNS public.quiz_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_s public.quiz_sessions; v_q public.quiz_questions; v_k public.quiz_keys;
  v_payload jsonb; v_stats jsonb; v_closest jsonb; v_clues jsonb; v_fastest jsonb;
  v_set_streak boolean; r record;
BEGIN
  IF NOT public.quiz_check_token(p_session_id, p_token) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คุมห้องนี้';
  END IF;

  SELECT * INTO v_s FROM public.quiz_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.current_question_id IS NULL THEN RETURN v_s; END IF;
  -- กดซ้ำ ไม่ให้คิดคะแนนรอบสอง — reveal_payload ถูกล้างทุกครั้งที่ quiz_next เปิดข้อใหม่
  IF (v_s.reveal_payload->>'question_id')::uuid IS NOT DISTINCT FROM v_s.current_question_id THEN
    RETURN v_s;
  END IF;

  SELECT * INTO v_q FROM public.quiz_questions WHERE id = v_s.current_question_id;
  SELECT * INTO v_k FROM public.quiz_keys      WHERE question_id = v_s.current_question_id;
  SELECT streak_bonus INTO v_set_streak FROM public.quiz_sets WHERE id = v_q.set_id;

  IF v_q.kind IN ('mcq', 'tf') THEN
    FOR r IN
      SELECT a.id, a.player_id, a.points, a.is_correct, p.streak
        FROM public.quiz_answers a JOIN public.quiz_players p ON p.id = a.player_id
       WHERE a.session_id = p_session_id AND a.question_id = v_q.id
    LOOP
      DECLARE v_new_streak integer; v_bonus integer := 0; v_total integer;
      BEGIN
        v_new_streak := CASE WHEN r.is_correct THEN r.streak + 1 ELSE 0 END;
        IF r.is_correct AND coalesce(v_set_streak, true) THEN
          v_bonus := least(greatest(v_new_streak - 1, 0), 4) * 100;
        END IF;
        v_total := r.points + v_bonus;
        UPDATE public.quiz_answers SET points = v_total WHERE id = r.id;
        UPDATE public.quiz_players
           SET score = score + v_total, streak = v_new_streak,
               correct_count = correct_count + CASE WHEN r.is_correct THEN 1 ELSE 0 END
         WHERE id = r.player_id;
      END;
    END LOOP;

    UPDATE public.quiz_players p SET streak = 0
     WHERE p.session_id = p_session_id
       AND NOT EXISTS (SELECT 1 FROM public.quiz_answers a
                        WHERE a.session_id = p_session_id AND a.question_id = v_q.id
                          AND a.player_id = p.id);
  END IF;

  IF v_q.kind = 'numeric' THEN
    FOR r IN
      SELECT a.id, a.player_id, a.number_value,
             row_number() OVER (ORDER BY abs(a.number_value - v_k.correct_number), a.created_at) AS rn
        FROM public.quiz_answers a
       WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.number_value IS NOT NULL
    LOOP
      UPDATE public.quiz_answers
         SET points = (CASE r.rn WHEN 1 THEN 1000 WHEN 2 THEN 800 WHEN 3 THEN 600 ELSE 300 END
                       + CASE WHEN r.number_value = v_k.correct_number THEN 200 ELSE 0 END),
             is_correct = (r.rn = 1)
       WHERE id = r.id;
      UPDATE public.quiz_players p
         SET score = p.score + (CASE r.rn WHEN 1 THEN 1000 WHEN 2 THEN 800 WHEN 3 THEN 600 ELSE 300 END
                                + CASE WHEN r.number_value = v_k.correct_number THEN 200 ELSE 0 END),
             correct_count = p.correct_count + CASE WHEN r.rn = 1 THEN 1 ELSE 0 END,
             streak = CASE WHEN r.rn = 1 THEN p.streak + 1 ELSE 0 END
       WHERE p.id = r.player_id;
    END LOOP;

    UPDATE public.quiz_players p SET streak = 0
     WHERE p.session_id = p_session_id
       AND NOT EXISTS (SELECT 1 FROM public.quiz_answers a
                        WHERE a.session_id = p_session_id AND a.question_id = v_q.id
                          AND a.player_id = p.id AND a.number_value IS NOT NULL);

    SELECT jsonb_agg(x) INTO v_closest FROM (
      SELECT jsonb_build_object('name', p.display_name, 'value', a.number_value) AS x
        FROM public.quiz_answers a JOIN public.quiz_players p ON p.id = a.player_id
       WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.number_value IS NOT NULL
       ORDER BY abs(a.number_value - v_k.correct_number), a.created_at LIMIT 3
    ) t;

  ELSIF v_q.kind = 'puzzle' THEN
    PERFORM public.quiz_puzzle_close(p_session_id, v_q.id);

    SELECT jsonb_agg(jsonb_build_object('kind', c.clue_kind, 'body', c.body) ORDER BY c.sort_order)
      INTO v_clues FROM public.quiz_puzzle_clues c WHERE c.question_id = v_q.id;

    SELECT jsonb_build_object('name', p.display_name, 'seconds', round(a.elapsed_ms / 1000.0, 1))
      INTO v_fastest
      FROM public.quiz_answers a JOIN public.quiz_players p ON p.id = a.player_id
     WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.is_correct
     ORDER BY a.elapsed_ms LIMIT 1;

  ELSIF v_q.kind = 'tiles' THEN
    -- ปิดข้อให้ครบก่อน เผื่อคนคุมเกมกดเฉลยตรงๆ โดยไม่มีใครตอบถูกและไม่ผ่าน "ปิดรับ"
    PERFORM public.quiz_puzzle_close(p_session_id, v_q.id);

    -- ผู้ชนะ — มีได้คนเดียวตามกติกา ORDER BY ไว้กันเหนียวเผื่อข้อมูลเก่า
    SELECT jsonb_build_object('name', p.display_name, 'seconds', round(a.elapsed_ms / 1000.0, 1))
      INTO v_fastest
      FROM public.quiz_answers a JOIN public.quiz_players p ON p.id = a.player_id
     WHERE a.session_id = p_session_id AND a.question_id = v_q.id AND a.is_correct
     ORDER BY a.elapsed_ms LIMIT 1;

  ELSE
    SELECT jsonb_object_agg(choice_index::text, n) INTO v_stats FROM (
      SELECT choice_index, count(*) AS n FROM public.quiz_answers
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
    'answer',           CASE WHEN v_q.kind IN ('puzzle', 'tiles') THEN v_k.correct_text END,
    'answer_split',     CASE WHEN v_q.kind = 'puzzle' THEN nullif(coalesce(v_k.answer_split, ''), '') END,
    'answer_image_url', CASE WHEN v_q.kind = 'puzzle' THEN v_k.answer_image_url END,
    'clue_labels',      CASE WHEN v_q.kind = 'puzzle' THEN to_jsonb(coalesce(v_k.clue_labels, '{}')) END,
    'clues',            v_clues,
    'tile_image_url',   CASE WHEN v_q.kind = 'tiles' THEN v_k.tile_image_url END,
    'fastest',          v_fastest,
    'solved',   (SELECT count(*) FROM public.quiz_answers
                  WHERE session_id = p_session_id AND question_id = v_q.id AND is_correct),
    'answered', (SELECT count(*) FROM public.quiz_answers
                  WHERE session_id = p_session_id AND question_id = v_q.id)
  ));

  UPDATE public.quiz_sessions SET state = 'reveal', reveal_payload = v_payload
   WHERE id = p_session_id RETURNING * INTO v_s;

  RETURN v_s;
END $fn$;

-- quiz_clone_set: ของเดิม + ก็อปของที่เพิ่มมาหลังจากที่ฟังก์ชันนี้ถูกเขียน
--
-- ⚠️ ของเดิมก็อปแค่ correct_index / correct_number / explain ซึ่งเขียนไว้ตั้งแต่ยังมีแต่ควิซล้วนๆ
--    พอมีเกมปริศนาใบ้คำเข้ามาก็ไม่ได้ตามแก้ **แปลว่าการก็อปชุดปริศนาพังอยู่แล้วก่อนหน้านี้**
--    (ได้ชุดที่ไม่มีเฉลย ไม่มีรูปใบ้ ไม่มีคำใบ้) ไฟล์นี้แก้ให้ทั้งสามเกมพร้อมกัน
CREATE OR REPLACE FUNCTION public.quiz_clone_set(
  p_staff_id uuid, p_pin text, p_set_id uuid, p_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_src public.quiz_sets; v_q public.quiz_questions; v_new uuid; v_new_qid uuid;
BEGIN
  IF NOT public.quiz_check_staff(p_staff_id, p_pin) THEN
    RAISE EXCEPTION 'PIN ไม่ถูกต้อง';
  END IF;

  SELECT * INTO v_src FROM public.quiz_sets WHERE id = p_set_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบชุดคำถาม'; END IF;

  INSERT INTO public.quiz_sets
    (org_id, destination_id, title, description, lang, cover_url,
     default_time_limit, streak_bonus, created_by,
     game_kind, answer_mode, attempt_limit, points_per_correct)
  VALUES
    (v_src.org_id, v_src.destination_id,
     coalesce(nullif(btrim(p_title), ''), v_src.title || ' (สำเนา)'),
     v_src.description, v_src.lang, v_src.cover_url,
     v_src.default_time_limit, v_src.streak_bonus, p_staff_id,
     v_src.game_kind, v_src.answer_mode, v_src.attempt_limit, v_src.points_per_correct)
  RETURNING id INTO v_new;

  -- ก็อปทีละข้อด้วยลูป ไม่ใช่ INSERT ... SELECT ก้อนเดียว
  -- (เหตุผลเดิม: sort_order ซ้ำกันได้ แล้ว row_number() จะจับคู่เฉลยสลับข้อ)
  FOR v_q IN
    SELECT * FROM public.quiz_questions WHERE set_id = p_set_id ORDER BY sort_order, created_at
  LOOP
    INSERT INTO public.quiz_questions
      (set_id, sort_order, kind, text, media_url, media_kind, options,
       numeric_unit, time_limit_sec, points_factor)
    VALUES
      (v_new, v_q.sort_order, v_q.kind, v_q.text, v_q.media_url, v_q.media_kind,
       v_q.options, v_q.numeric_unit, v_q.time_limit_sec, v_q.points_factor)
    RETURNING id INTO v_new_qid;

    INSERT INTO public.quiz_keys
      (question_id, correct_index, correct_number, explain,
       correct_text, answer_split, answer_aliases, clue_labels, answer_image_url, hints,
       tile_image_url)
    SELECT v_new_qid, k.correct_index, k.correct_number, k.explain,
           k.correct_text, k.answer_split, k.answer_aliases, k.clue_labels,
           k.answer_image_url, k.hints, k.tile_image_url
      FROM public.quiz_keys k WHERE k.question_id = v_q.id;

    INSERT INTO public.quiz_puzzle (question_id, syllable_count, hint_count)
    SELECT v_new_qid, z.syllable_count, z.hint_count
      FROM public.quiz_puzzle z WHERE z.question_id = v_q.id;

    INSERT INTO public.quiz_puzzle_clues (question_id, sort_order, clue_kind, body)
    SELECT v_new_qid, c.sort_order, c.clue_kind, c.body
      FROM public.quiz_puzzle_clues c WHERE c.question_id = v_q.id;

    INSERT INTO public.quiz_tiles
      (question_id, grid_rows, grid_cols, open_step, cover_image_url, crop_x, crop_y, crop_w, crop_h)
    SELECT v_new_qid, t.grid_rows, t.grid_cols, t.open_step, t.cover_image_url,
           t.crop_x, t.crop_y, t.crop_w, t.crop_h
      FROM public.quiz_tiles t WHERE t.question_id = v_q.id;
  END LOOP;

  RETURN v_new;
END $fn$;

-- ── 11. สิทธิ์เรียกฟังก์ชัน ─────────────────────────────────────────
-- quiz_tiles_closeness ไม่อยู่ในรายการนี้โดยตั้งใจ (ถูก REVOKE ไว้ในข้อ 5)
-- ถ้าเปิดให้เรียกตรง ลูกทัวร์จะยิงคำเดารัวๆ วัดความใกล้เคียงได้ฟรี โดยไม่ผ่าน
-- ด่านเวลา rate limit และโควตา = ไล่หาคำตอบได้ในไม่กี่วินาที
GRANT EXECUTE ON FUNCTION public.quiz_tiles_open(uuid, text, integer)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_tiles_undo(uuid, text)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_tiles_image(uuid, uuid, text)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_tiles_guess(uuid, uuid, uuid, text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_tiles_stats(uuid, uuid, text, integer)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_tiles_feed(uuid, uuid, text, timestamptz, uuid, integer)
                                                                                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_tiles_accept(uuid, uuid, text, text)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_tiles_set_for_edit(uuid, uuid, text)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quiz_tiles_upsert(
  uuid, text, uuid, uuid, text, integer, integer, integer, integer, text,
  real, real, real, real, text, text, text[], text, integer)                     TO anon, authenticated;

COMMIT;

-- ── ย้อนกลับ (ถ้าต้องถอน) ────────────────────────────────────────────
-- ถอนไม่ได้ทั้งหมด เพราะ quiz_next / quiz_lock / quiz_reveal / quiz_start_session /
-- quiz_clone_set ถูกเขียนทับ ต้องรัน 20260826_word_puzzle.sql ใหม่เพื่อคืนสี่ตัวแรก
-- และ 20260818_quiz_library.sql เพื่อคืน quiz_clone_set
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.quiz_tiles_upsert(uuid,text,uuid,uuid,text,integer,integer,integer,integer,text,real,real,real,real,text,text,text[],text,integer);
--   DROP FUNCTION IF EXISTS public.quiz_tiles_set_for_edit(uuid,uuid,text);
--   DROP FUNCTION IF EXISTS public.quiz_tiles_accept(uuid,uuid,text,text);
--   DROP FUNCTION IF EXISTS public.quiz_tiles_feed(uuid,uuid,text,timestamptz,uuid,integer);
--   DROP FUNCTION IF EXISTS public.quiz_tiles_stats(uuid,uuid,text,integer);
--   DROP FUNCTION IF EXISTS public.quiz_tiles_guess(uuid,uuid,uuid,text);
--   DROP FUNCTION IF EXISTS public.quiz_tiles_image(uuid,uuid,text);
--   DROP FUNCTION IF EXISTS public.quiz_tiles_undo(uuid,text);
--   DROP FUNCTION IF EXISTS public.quiz_tiles_open(uuid,text,integer);
--   DROP FUNCTION IF EXISTS public.quiz_tiles_closeness(uuid,text);
--   DROP TABLE IF EXISTS public.quiz_tiles;
--   ALTER TABLE public.quiz_keys      DROP COLUMN IF EXISTS tile_image_url;
--   ALTER TABLE public.quiz_puzzle_guesses DROP COLUMN IF EXISTS closeness;
--   ALTER TABLE public.quiz_sessions  DROP COLUMN IF EXISTS revealed_tiles,
--                                     DROP COLUMN IF EXISTS last_tile_at,
--                                     DROP COLUMN IF EXISTS last_tile_n;
--   ALTER TABLE public.quiz_sets      DROP COLUMN IF EXISTS answer_mode;
-- COMMIT;
