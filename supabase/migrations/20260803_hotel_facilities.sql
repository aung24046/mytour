-- ============================================================================
-- MyTour — สิ่งอำนวยความสะดวกของโรงแรม (Hotel Facilities)
-- 2026-08-03
--
-- ทำไมเป็น jsonb ไม่ใช่คอลัมน์ boolean ต่อ facility:
--   facility แต่ละอย่างลูกทัวร์ถามครบ 3 คำถามเสมอ — มีไหม / ฟรีหรือเสียเงิน / เปิดกี่โมง
--   ถ้าแตกเป็น boolean จะต้องมี 3 คอลัมน์ต่อ 1 facility และเพิ่มรายการใหม่ทีต้อง migrate ทุกครั้ง
--   เก็บเป็น array ของ object แทน แล้วให้ taxonomy อยู่ในโค้ด (src/lib/hotelFacilities.js)
--   → เพิ่ม/ตัดรายการได้โดยไม่ต้องแตะฐานข้อมูล
--
-- รูปแบบ facilities:
--   [{ "key": "pool", "fee": "free", "hours": "06:00-22:00", "note": "ชั้น 5" }, ...]
--     fee: '' | 'free' | 'paid'
--     hours/note: ว่างได้
--
-- รูปแบบ room_amenities (ของในห้อง ไม่มีเวลาเปิด-ปิด):
--   [{ "key": "fridge", "fee": "free", "note": "" }, ...]
--
-- power_plug / wifi_coverage เป็นค่าเดี่ยว จึงแยกเป็นคอลัมน์ธรรมดา ไม่ยัดลง jsonb
-- ============================================================================

alter table public.hotels
  add column if not exists facilities     jsonb not null default '[]'::jsonb;

alter table public.hotels
  add column if not exists room_amenities jsonb not null default '[]'::jsonb;

alter table public.hotels
  add column if not exists power_plug     text;   -- เช่น 'Type C · 220V'

alter table public.hotels
  add column if not exists wifi_coverage  text;   -- 'all' | 'room_only' | 'public_only'

comment on column public.hotels.facilities is
  'สิ่งอำนวยความสะดวกของโรงแรม — array ของ {key, fee, hours, note}; taxonomy อยู่ใน src/lib/hotelFacilities.js';
comment on column public.hotels.room_amenities is
  'ของใช้ในห้องพัก — array ของ {key, fee, note}';
comment on column public.hotels.power_plug is
  'ชนิดปลั๊กไฟ + แรงดัน สำหรับทริปต่างประเทศ';
comment on column public.hotels.wifi_coverage is
  'ความครอบคลุมของ wifi: all | room_only | public_only';

-- กันข้อมูลเสียรูป: ต้องเป็น array เท่านั้น (object/สตริงเดี่ยวจะพังฝั่ง UI ที่ .map())
alter table public.hotels drop constraint if exists hotels_facilities_is_array;
alter table public.hotels add constraint hotels_facilities_is_array
  check (jsonb_typeof(facilities) = 'array');

alter table public.hotels drop constraint if exists hotels_room_amenities_is_array;
alter table public.hotels add constraint hotels_room_amenities_is_array
  check (jsonb_typeof(room_amenities) = 'array');

alter table public.hotels drop constraint if exists hotels_wifi_coverage_valid;
alter table public.hotels add constraint hotels_wifi_coverage_valid
  check (wifi_coverage is null or wifi_coverage in ('all', 'room_only', 'public_only'));

-- ค้นหาโรงแรมที่มี facility ที่ต้องการ (เช่น หาที่มีลิฟต์ทั้งหมด)
create index if not exists hotels_facilities_gin on public.hotels using gin (facilities);
