# Migration — Multi-Tour (28 ก.ค. 2026)

## ✅ รันบน Supabase project `iirhnjoqpwwwdgoghnkc` (MyTour) เรียบร้อยแล้ว

ลงใน migration history ตามลำดับนี้:

| version | ชื่อ | ทำอะไร |
|---|---|---|
| 20260728101301 | `multi_tour_part1_tours_and_staff` | join_code, is_template, cloned_from, archived_at · `tour_staff` + backfill · org owner · view `v_tour_staff` · luggage tag unique ต่อทริป |
| 20260728101418 | `multi_tour_part2_content_library` | `destinations` · destination_id/is_library บนตารางคลัง · junction 5 ตาราง + backfill · view `v_tour_*` |
| 20260728101518 | `multi_tour_part3_auth_and_rpc` | RPC login/มอบหมาย/`assign_destination_library`/`clone_tour_assignments`/`fork_content` |
| 20260728101646 | `multi_tour_part1b_clone_archive_purge_reset` | `clone_tour` + helper · `archive_tour` · `purge_tour_personal_data` · `reset_tour_runtime_data` |
| 20260728101735 | `multi_tour_widen_tours_status_check` | ขยาย CHECK เดิม (active/completed/cancelled) ให้รับ draft/archived ด้วย |
| (part 4) | `multi_tour_part4_tour_manager_rpc` | `list_org_tours` · `create_tour` · `update_tour` · `regenerate_join_code` · `delete_empty_tour` · `list_destinations` · `upsert_destination` |
| (fix) | `multi_tour_fix_clone_no_library_duplication` | **แก้บั๊ก**: `clone_tour` เดิมก๊อปเนื้อหาคลังเป็นแถวใหม่ → คลังบวมทุกครั้งที่ clone ตอนนี้ชี้ junction มาที่ต้นฉบับแทน |

**ไฟล์ .sql ในโฟลเดอร์นี้เป็นฉบับอ้างอิง/เอกสาร** — ของจริงอยู่ใน migration history ของ Supabase แล้ว
อย่ารันซ้ำโดยไม่จำเป็น (ทุกไฟล์ idempotent แต่ไม่มีเหตุต้องรัน)

## ผลลัพธ์หลังรัน

- ทริปเดิม "ทริปฝึกนำทัวร์ รุ่น 1" ได้รหัส **H2YFCN** → URL ลูกทัวร์ = `/t/H2YFCN`
- staff 19 คน → tour_staff 19 แถว (lead 2, staff 17) — `role='admin'` เดิม map เป็น `lead`
- org owner ใหม่: `staff_code=ADM1` / PIN `4256` — **⚠️ เปลี่ยนทันที**
- ลูกทัวร์ 71 คน / คำตอบฟอร์ม 552 แถว ครบ ไม่มีแถวกำพร้า

## ทดสอบไปแล้ว (แล้วลบข้อมูลทดสอบทิ้ง)

- clone ทริป → ทริปใหม่ได้ config ครบ (กำหนดการ 15, ที่นั่ง 128, ห้อง 5, ฟอร์ม 15, บทความ 7, ศัพท์ 60) แต่ **ลูกทัวร์ 0 คน**
- ปิดคำถามฟอร์ม 1 ข้อ + ตั้ง label_override ในทริป 2 → ทริป 1 ยังครบ 15 ข้อ ไม่มี override
- guard 4 เคส: reset ชื่อผิด / purge ก่อน archive / fork ตารางที่ไม่รองรับ / role มั่ว → บล็อกครบ
- RPC login ทั้งหมด: PIN ถูกผ่าน / PIN ผิดคืน null

## ⚠️ เรื่องที่พบตอนรันจริง

`tours_status_check` เดิมอนุญาตแค่ `active/completed/cancelled` → ขยายเป็น
`draft/active/archived/completed/cancelled` (เก็บ 2 ค่าเดิมไว้ เผื่อมีโค้ดใช้อยู่)

## บั๊กที่เจอจากการทดสอบ (แก้แล้ว)

`clone_tour` รอบแรกก๊อป `form_fields` / `guide_*` / `phrasebook` / `emergency_contacts`
เป็นแถวใหม่ที่ยังติดธง `is_library=true` + `destination_id` เดิม
→ clone 1 ครั้ง คลังโตเท่าตัว ทริปว่างที่สร้างถัดมาเลยได้ฟอร์ม 30 ข้อแทน 15

แก้เป็น: clone ก๊อปเฉพาะของที่ผูกทริปจริง (กำหนดการ/ผังรถ/ผังห้อง/supplier)
ส่วนเนื้อหาคลังชี้ junction มาที่ต้นฉบับ — ตรงตามเจตนาเดิมของ Design v2 §4.2

## Rollback

`20260728_multi_tour_rollback.sql` — ใช้ได้เฉพาะตอนที่ยังมีทริปเดียวและยังไม่ fork เนื้อหา
มีทริปที่ 2 แล้ว → กู้จาก Supabase Backup แทน
