-- =====================================================================
-- Bingo hardening — 6 ส.ค. 2026
-- =====================================================================
-- แก้ 3 ปัญหาที่รากของฝั่ง DB:
--   1) called_numbers / marked_numbers เดิมเป็น read-modify-write ฝั่ง client
--      → staff 2 คนกดพร้อมกัน เลขหายไปหนึ่งตัว  ย้ายมาเป็น RPC atomic
--   2) has_bingo เดิมเขียนจาก client ล้วน → ปลอมได้
--      → ตรวจแถวที่ชนะบนเซิร์ฟเวอร์ และเก็บสถานะรีวิวของ staff
--   3) loadOrCreateCard แข่งกันเอง สร้างการ์ดซ้ำได้ → unique + upsert
--
-- idempotent ทั้งไฟล์ รันซ้ำได้
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- SECTION 1 — กันการ์ดซ้ำต่อ (เกม, ลูกทัวร์)
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS bingo_cards_game_guest_uniq
  ON public.bingo_cards (game_id, guest_id);


-- ---------------------------------------------------------------------
-- SECTION 2 — คอลัมน์สำหรับรีวิวผู้ชนะ
-- ---------------------------------------------------------------------
-- win_status: none → claimed (ลูกทัวร์กดยืนยัน) → confirmed / rejected (staff ตัดสิน)
ALTER TABLE public.bingo_cards
  ADD COLUMN IF NOT EXISTS win_status      text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS win_line        text,
  ADD COLUMN IF NOT EXISTS win_reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bingo_cards_win_status_check'
  ) THEN
    ALTER TABLE public.bingo_cards
      ADD CONSTRAINT bingo_cards_win_status_check
      CHECK (win_status IN ('none', 'claimed', 'confirmed', 'rejected'));
  END IF;
END $$;

-- backfill: ผู้ชนะเดิมที่ยังไม่เคยผ่านระบบรีวิว นับเป็น 'claimed'
UPDATE public.bingo_cards
   SET win_status = 'claimed'
 WHERE has_bingo IS TRUE AND win_status = 'none';


-- ---------------------------------------------------------------------
-- SECTION 3 — ตรรกะตรวจบิงโก (ฝั่งเซิร์ฟเวอร์ = แหล่งความจริง)
-- ---------------------------------------------------------------------
-- คืนชื่อแถวที่ชนะ เช่น 'row3' / 'col1' / 'diag1' — ไม่ชนะคืน NULL
-- ช่องจะนับว่าติ๊กแล้วก็ต่อเมื่อ "เลขถูกประกาศจริง" ด้วย กันการมาร์กมั่ว
CREATE OR REPLACE FUNCTION public.bingo_winning_line(
  p_numbers int[], p_marked int[], p_called int[]
) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_ok     boolean[] := array_fill(false, ARRAY[25]);
  v_marked int[] := COALESCE(p_marked, '{}');
  v_called int[] := COALESCE(p_called, '{}');
  i int; r int; c int; v_line boolean;
BEGIN
  IF p_numbers IS NULL OR array_length(p_numbers, 1) <> 25 THEN
    RETURN NULL;
  END IF;

  FOR i IN 1..25 LOOP
    v_ok[i] := (p_numbers[i] = 0)  -- ช่องฟรีตรงกลาง
            OR (p_numbers[i] = ANY(v_marked) AND p_numbers[i] = ANY(v_called));
  END LOOP;

  FOR r IN 0..4 LOOP                       -- แนวนอน
    v_line := true;
    FOR c IN 0..4 LOOP
      IF NOT v_ok[r * 5 + c + 1] THEN v_line := false; EXIT; END IF;
    END LOOP;
    IF v_line THEN RETURN 'row' || (r + 1); END IF;
  END LOOP;

  FOR c IN 0..4 LOOP                       -- แนวตั้ง
    v_line := true;
    FOR r IN 0..4 LOOP
      IF NOT v_ok[r * 5 + c + 1] THEN v_line := false; EXIT; END IF;
    END LOOP;
    IF v_line THEN RETURN 'col' || (c + 1); END IF;
  END LOOP;

  v_line := true;                          -- ทแยงซ้ายบน→ขวาล่าง
  FOR i IN 0..4 LOOP
    IF NOT v_ok[i * 6 + 1] THEN v_line := false; EXIT; END IF;
  END LOOP;
  IF v_line THEN RETURN 'diag1'; END IF;

  v_line := true;                          -- ทแยงขวาบน→ซ้ายล่าง
  FOR i IN 0..4 LOOP
    IF NOT v_ok[i * 4 + 5] THEN v_line := false; EXIT; END IF;
  END LOOP;
  IF v_line THEN RETURN 'diag2'; END IF;

  RETURN NULL;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 4 — ประกาศเลข (atomic, ไม่มี read-modify-write ฝั่ง client)
-- ---------------------------------------------------------------------
-- ประกาศเลขที่ระบุเอง
CREATE OR REPLACE FUNCTION public.bingo_call_number(p_game_id uuid, p_number int)
RETURNS int[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_called int[];
BEGIN
  IF p_number IS NULL OR p_number < 1 OR p_number > 75 THEN
    RAISE EXCEPTION 'BINGO_OUT_OF_RANGE';
  END IF;

  SELECT called_numbers INTO v_called
    FROM bingo_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BINGO_NO_GAME'; END IF;

  v_called := COALESCE(v_called, '{}');
  IF p_number = ANY(v_called) THEN RAISE EXCEPTION 'BINGO_DUPLICATE'; END IF;

  UPDATE bingo_games
     SET called_numbers = array_append(v_called, p_number)
   WHERE id = p_game_id
  RETURNING called_numbers INTO v_called;

  RETURN v_called;
END $$;

-- สุ่มประกาศ — สุ่มบนเซิร์ฟเวอร์ทั้งหมด กดพร้อมกันก็ไม่ได้เลขซ้ำ
CREATE OR REPLACE FUNCTION public.bingo_call_random(p_game_id uuid)
RETURNS TABLE (picked int, called int[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_called int[]; v_pick int;
BEGIN
  SELECT called_numbers INTO v_called
    FROM bingo_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BINGO_NO_GAME'; END IF;
  v_called := COALESCE(v_called, '{}');

  SELECT n INTO v_pick
    FROM generate_series(1, 75) AS n
   WHERE NOT (n = ANY(v_called))
   ORDER BY random() LIMIT 1;

  IF v_pick IS NULL THEN RAISE EXCEPTION 'BINGO_ALL_CALLED'; END IF;

  UPDATE bingo_games
     SET called_numbers = array_append(v_called, v_pick)
   WHERE id = p_game_id
  RETURNING called_numbers INTO v_called;

  picked := v_pick; called := v_called;
  RETURN NEXT;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 5 — การ์ดลูกทัวร์
-- ---------------------------------------------------------------------
-- สร้างการ์ดถ้ายังไม่มี / คืนของเดิมถ้ามีแล้ว — กันสร้างซ้ำตอนเรียกซ้อนกัน
CREATE OR REPLACE FUNCTION public.bingo_ensure_card(
  p_game_id uuid, p_guest_id uuid, p_numbers int[]
) RETURNS public.bingo_cards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_card public.bingo_cards;
BEGIN
  INSERT INTO bingo_cards (game_id, guest_id, numbers, marked_numbers, has_bingo, is_confirmed)
  VALUES (p_game_id, p_guest_id, p_numbers, '{}', false, false)
  ON CONFLICT (game_id, guest_id)
    DO UPDATE SET guest_id = EXCLUDED.guest_id   -- no-op เพื่อให้ RETURNING คืนแถวเดิม
  RETURNING * INTO v_card;
  RETURN v_card;
END $$;

-- ติ๊ก / ยกเลิกติ๊ก — atomic และตรวจว่าเลขถูกประกาศแล้วจริง
CREATE OR REPLACE FUNCTION public.bingo_toggle_mark(p_card_id uuid, p_number int)
RETURNS int[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_marked int[]; v_numbers int[]; v_confirmed boolean; v_game uuid; v_called int[];
BEGIN
  SELECT marked_numbers, numbers, is_confirmed, game_id
    INTO v_marked, v_numbers, v_confirmed, v_game
    FROM bingo_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BINGO_NO_CARD'; END IF;
  IF NOT v_confirmed THEN RAISE EXCEPTION 'BINGO_CARD_NOT_CONFIRMED'; END IF;
  IF NOT (p_number = ANY(v_numbers)) THEN RAISE EXCEPTION 'BINGO_NOT_ON_CARD'; END IF;

  SELECT COALESCE(called_numbers, '{}') INTO v_called FROM bingo_games WHERE id = v_game;
  IF NOT (p_number = ANY(v_called)) THEN RAISE EXCEPTION 'BINGO_NOT_CALLED'; END IF;

  v_marked := COALESCE(v_marked, '{}');
  IF p_number = ANY(v_marked) THEN
    v_marked := array_remove(v_marked, p_number);
  ELSE
    v_marked := array_append(v_marked, p_number);
  END IF;

  UPDATE bingo_cards SET marked_numbers = v_marked WHERE id = p_card_id;
  RETURN v_marked;
END $$;

-- ลูกทัวร์กดยืนยันบิงโก — เซิร์ฟเวอร์ตรวจเองว่าชนะจริงไหม
CREATE OR REPLACE FUNCTION public.bingo_claim(p_card_id uuid)
RETURNS public.bingo_cards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_card public.bingo_cards; v_called int[]; v_line text;
BEGIN
  SELECT * INTO v_card FROM bingo_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BINGO_NO_CARD'; END IF;
  IF v_card.has_bingo THEN RETURN v_card; END IF;   -- กดซ้ำ ไม่ต้องทำอะไร

  SELECT COALESCE(called_numbers, '{}') INTO v_called
    FROM bingo_games WHERE id = v_card.game_id;

  v_line := bingo_winning_line(v_card.numbers, v_card.marked_numbers, v_called);
  IF v_line IS NULL THEN RAISE EXCEPTION 'BINGO_NOT_A_WIN'; END IF;

  UPDATE bingo_cards
     SET has_bingo = true,
         bingo_claimed_at = now(),
         win_status = 'claimed',
         win_line = v_line,
         win_reviewed_at = NULL
   WHERE id = p_card_id
  RETURNING * INTO v_card;

  RETURN v_card;
END $$;

-- staff ตัดสินผล — ปฏิเสธแล้วเล่นต่อได้ ไม่ต้องออกจากเกม
CREATE OR REPLACE FUNCTION public.bingo_review_win(p_card_id uuid, p_approve boolean)
RETURNS public.bingo_cards
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_card public.bingo_cards;
BEGIN
  IF p_approve THEN
    UPDATE bingo_cards
       SET win_status = 'confirmed', win_reviewed_at = now()
     WHERE id = p_card_id
    RETURNING * INTO v_card;
  ELSE
    UPDATE bingo_cards
       SET win_status = 'rejected', win_reviewed_at = now(),
           has_bingo = false, bingo_claimed_at = NULL, win_line = NULL
     WHERE id = p_card_id
    RETURNING * INTO v_card;
  END IF;

  IF v_card.id IS NULL THEN RAISE EXCEPTION 'BINGO_NO_CARD'; END IF;
  RETURN v_card;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 6 — สิทธิ์ (แอปใช้ anon key + guest session)
-- ---------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.bingo_winning_line(int[], int[], int[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bingo_call_number(uuid, int)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bingo_call_random(uuid)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bingo_ensure_card(uuid, uuid, int[])    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bingo_toggle_mark(uuid, int)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bingo_claim(uuid)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bingo_review_win(uuid, boolean)         TO anon, authenticated;

COMMIT;
