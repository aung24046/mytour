-- ============================================================================
-- MyTour — ขยายข้อมูลทั่วไปของโรงแรม (Hotel Info Expansion)
-- 2026-08-03
--
-- ปัญหาเดิม: ตาราง hotels เก็บได้แค่ ชื่อ/วันเข้า-ออก/wifi/อาหารเช้า/เวลาเช็คเอาต์
-- ทำให้ข้อมูลที่ทีมงานต้องใช้จริงทุกทริป (ที่อยู่, เบอร์โทร, morning call,
-- เลข booking, โน้ตภายใน) ต้องยัดรวมใน general_info ซึ่งลูกทัวร์มองเห็นด้วย
--
-- migration นี้เพิ่ม:
--   hotels      — ข้อมูลติดต่อ/โลจิสติกส์/ภายใน + ผูกกับ suppliers + ลำดับโรงแรม
--   hotel_rooms — โน้ตรายห้อง (connecting room, ห้ามสูบบุหรี่, ขอชั้นสูง ฯลฯ)
-- ทุกคอลัมน์เป็น nullable ทั้งหมด — ข้อมูลเดิมไม่กระทบ
-- ============================================================================

-- ── hotels: ข้อมูลติดต่อ ─────────────────────────────────────────────────────
alter table public.hotels add column if not exists address        text;
alter table public.hotels add column if not exists address_local  text;  -- ที่อยู่ภาษาท้องถิ่น (ยื่นให้แท็กซี่ต่างประเทศ)
alter table public.hotels add column if not exists phone          text;
alter table public.hotels add column if not exists map_url        text;

-- ── hotels: โลจิสติกส์รายวัน ─────────────────────────────────────────────────
alter table public.hotels add column if not exists check_in_time  text;  -- คู่กับ checkout_time ที่มีอยู่แล้ว
alter table public.hotels add column if not exists morning_call   text;  -- เวลาโทรปลุก
alter table public.hotels add column if not exists luggage_time   text;  -- เวลาวางกระเป๋าหน้าห้อง
alter table public.hotels add column if not exists meeting_point  text;  -- จุดนัดพบ/จุดจอดรถ
alter table public.hotels add column if not exists dinner_time    text;
alter table public.hotels add column if not exists dinner_location text;

-- ── hotels: งานเอกสาร/ภายใน ─────────────────────────────────────────────────
alter table public.hotels add column if not exists booking_ref    text;  -- เลข booking / voucher
alter table public.hotels add column if not exists staff_notes    text;  -- โน้ตภายใน — ห้ามแสดงฝั่ง guest
alter table public.hotels add column if not exists supplier_id    uuid
  references public.suppliers(id) on delete set null;
alter table public.hotels add column if not exists sort_order     integer;

comment on column public.hotels.address_local  is 'ที่อยู่ภาษาท้องถิ่น สำหรับยื่นให้คนขับแท็กซี่/ตำรวจในต่างประเทศ';
comment on column public.hotels.staff_notes    is 'โน้ตภายในทีมงาน — ต้องไม่ถูก query จากหน้าฝั่ง guest';
comment on column public.hotels.sort_order     is 'ลำดับโรงแรมที่กำหนดเอง ใช้เมื่อ check_in_date ว่าง/ซ้ำกัน';

-- ── hotel_rooms: โน้ตรายห้อง ────────────────────────────────────────────────
alter table public.hotel_rooms add column if not exists note text;

comment on column public.hotel_rooms.note is 'โน้ตเฉพาะห้อง เช่น connecting room, non-smoking, ขอชั้นสูง';

-- ── index ──────────────────────────────────────────────────────────────────
create index if not exists hotels_supplier_id_idx on public.hotels (supplier_id);
create index if not exists hotels_tour_sort_idx   on public.hotels (tour_id, sort_order, check_in_date);

-- ── backfill sort_order ตามลำดับวันเช็คอินเดิม ─────────────────────────────
with ranked as (
  select id, row_number() over (
    partition by tour_id
    order by check_in_date nulls last, created_at
  ) as rn
  from public.hotels
)
update public.hotels h
set sort_order = ranked.rn
from ranked
where h.id = ranked.id and h.sort_order is null;
