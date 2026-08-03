-- ============================================================================
-- MyTour — ช่องเวลาใช้รูปแบบเดียวกันทั้งระบบ + ตัด wifi_coverage
-- 2026-08-03
--
-- 1) ตัด hotels.wifi_coverage ออก (ยังไม่มีข้อมูลใช้งานจริงสักแถว)
--
-- 2) ช่องเวลาทั้งหมดเปลี่ยนไปใช้ <input type="time"> ฝั่ง UI ซึ่งรับ-ส่งเป็น
--    'HH:MM' 24 ชั่วโมงเท่านั้น ข้อมูลเดิมถูกพิมพ์มือเป็น '08:00 AM' และ
--    'ุ06:30 AM' (มีสระอุหลงมาหน้าเลข — พิมพ์ผิดจากคีย์บอร์ดไทย)
--    ถ้าไม่แปลง ค่าเดิมจะโหลดเข้า time input ไม่ได้และจะหายเงียบตอนกดบันทึกครั้งถัดไป
--    จึงแปลงทุกคอลัมน์เวลาให้เป็น HH:MM ก่อน โดยตัดอักขระที่ไม่ใช่ตัวเลขทิ้ง
--    และแปลง AM/PM เป็น 24 ชั่วโมง
-- ============================================================================

alter table public.hotels drop constraint if exists hotels_wifi_coverage_valid;
alter table public.hotels drop column if exists wifi_coverage;

-- แปลงข้อความเวลาแบบอิสระ → 'HH:MM' (คืน null ถ้าอ่านไม่ออก เพื่อไม่ให้ค่าขยะค้างในระบบ)
create or replace function public.normalize_time_text(p_raw text)
returns text language plpgsql immutable as $$
declare
  m text[];
  h int;
  mi int;
  is_pm boolean;
  is_am boolean;
begin
  if p_raw is null or btrim(p_raw) = '' then return null; end if;

  -- ดึงชั่วโมง/นาที โดยยอมให้มีอักขระแปลกปลอมนำหน้า (เช่น 'ุ06:30 AM')
  m := regexp_match(p_raw, '(\d{1,2})\s*[:.]\s*(\d{2})');
  if m is null then
    -- รองรับกรณีพิมพ์เลขล้วน เช่น '0630' หรือ '630'
    m := regexp_match(p_raw, '^\D*(\d{1,2})(\d{2})\D*$');
  end if;
  if m is null then return null; end if;

  h  := m[1]::int;
  mi := m[2]::int;
  if mi > 59 then return null; end if;

  is_pm := p_raw ~* '(p\.?\s*m|PM)';
  is_am := p_raw ~* '(a\.?\s*m|AM)';

  if is_pm and h < 12 then h := h + 12; end if;
  if is_am and h = 12 then h := 0; end if;
  if h > 23 then return null; end if;

  return lpad(h::text, 2, '0') || ':' || lpad(mi::text, 2, '0');
end $$;

update public.hotels set
  breakfast_time = public.normalize_time_text(breakfast_time),
  checkout_time  = public.normalize_time_text(checkout_time),
  check_in_time  = public.normalize_time_text(check_in_time),
  morning_call   = public.normalize_time_text(morning_call),
  luggage_time   = public.normalize_time_text(luggage_time),
  dinner_time    = public.normalize_time_text(dinner_time)
where breakfast_time is not null
   or checkout_time  is not null
   or check_in_time  is not null
   or morning_call   is not null
   or luggage_time   is not null
   or dinner_time    is not null;

-- ใช้ครั้งเดียวตอน migrate — ไม่ต้องค้างไว้ในสคีมา
drop function if exists public.normalize_time_text(text);
