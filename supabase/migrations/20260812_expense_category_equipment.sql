-- เพิ่มหมวด 'equipment' (อุปกรณ์) ให้รายจ่าย
--
-- expenses.category ถูกล็อกด้วย CHECK constraint ไม่ใช่ตาราง lookup
-- เพิ่มหมวดใหม่ในโค้ดอย่างเดียวจึง insert ไม่ผ่าน — ต้องขยาย constraint ด้วย
--
-- ค่าเดิม: food, transport, accommodation, entrance, tip, misc

BEGIN;

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_category_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_category_check
  CHECK (category = ANY (ARRAY[
    'food'::text,
    'transport'::text,
    'accommodation'::text,
    'entrance'::text,
    'tip'::text,
    'equipment'::text,
    'misc'::text
  ]));

COMMIT;

-- rollback (ใช้ได้ก็ต่อเมื่อยังไม่มีแถวไหนเป็น 'equipment'):
-- ALTER TABLE public.expenses DROP CONSTRAINT expenses_category_check;
-- ALTER TABLE public.expenses ADD CONSTRAINT expenses_category_check
--   CHECK (category = ANY (ARRAY['food','transport','accommodation','entrance','tip','misc']));
