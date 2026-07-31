# MyTour — Multi-Tour Architecture Design v2

**วันที่:** 28 ก.ค. 2026 · **แทนที่ v1** (v1 ยังไม่ได้รัน — ใช้ไฟล์นี้แทน)

**ปัญหาที่แก้**
1. รีเซตข้อมูลทัวร์ / เริ่มกรุ๊ปใหม่ไม่ได้
2. รันหลายกรุ๊ปพร้อมกันไม่ได้
3. ลำดับชั้น admin ไม่มีจริง (มี default admin ตัวเดียว, ไม่มีการบังคับสิทธิ์)
4. ข้อมูลที่ใช้ร่วมกันได้ (คู่มือ/supplier/ทีมงาน/ฟอร์ม) ต้องแสดงต่างกันต่อทริป

**หลักการ:** ADDITIVE เท่านั้น — ทริปปัจจุบัน (`...0002`) ต้องใช้งานต่อได้โดยไม่ต้องแก้อะไร

---

## 0. สรุปการตัดสินใจ (28 ก.ค. 2026)

| หัวข้อ | ตัดสินใจ |
|---|---|
| ลูกทัวร์เข้ากรุ๊ป | URL ต่อทริป `/t/:code` |
| ทีมงาน | แยก `staff` (คน, org-level) + `tour_staff` (มอบหมาย, ต่อทริป) |
| `role='admin'` เดิม | map ลงเป็น `lead` (tour-level) |
| org admin คนแรก | สร้างใหม่ — `staff_code=ADM1`, PIN **4256** |
| คลังเนื้อหา | แยกตาม **ปลายทาง/ประเทศ** (`destinations`) |

---

## 1. รากของปัญหา

```js
export const ACTIVE_TOUR_ID = '00000000-0000-0000-0000-000000000002'  // ← 33 ไฟล์, ~200 จุด
```

**ข่าวดี:** ทุกตารางมี `tour_id` อยู่แล้ว → ปัญหาอยู่ที่ application layer เป็นหลัก
**ข่าวร้ายที่เพิ่งเจอ:** `staff` ผูก `tour_id` ตรงๆ, และ `guide_articles` / `phrasebook_entries` มี `itinerary_item_id` อยู่บนตัวเนื้อหาเอง → ผูกกับกำหนดการของทริปนั้น เอาไปใช้ซ้ำข้ามทริปไม่ได้ ต้องย้ายฟิลด์นี้ออกไปอยู่ที่ "การมอบหมาย"

---

## 2. Pattern หลักของ v2 — Definition ↔ Assignment

หัวใจของทั้งข้อ 3 และข้อ 4 คืออันเดียวกัน: **แยก "ตัวเนื้อหา" ออกจาก "ทริปนี้ใช้ยังไง"**

```
   คลังกลาง (org / destination)          การมอบหมาย (ต่อทริป)
   ┌──────────────────────┐              ┌────────────────────────────┐
   │ นิยาม: อะไร          │◄────────────►│ ทริปนี้: เปิด/ปิด, ลำดับ,   │
   │ label, body, type    │   junction   │ override, ผูกกำหนดการ      │
   └──────────────────────┘              └────────────────────────────┘
        แก้ครั้งเดียว                        ต่างกันได้ทุกทริป
      อัปเดตทุกทริปที่ใช้
```

### แบ่งข้อมูลเป็น 3 ประเภท — ไม่ใช้วิธีเดียวกับทุกอย่าง

| ข้อมูล | วิธี | เหตุผล |
|---|---|---|
| กำหนดการ, ผังรถ, ผังห้อง, ค่าใช้จ่าย | **Copy** (clone) | ผูกกับทริปนั้นจริง ไม่มีวันใช้ร่วม |
| supplier | **Library + link** | ✅ ทำถูกอยู่แล้ว (`suppliers.org_id` + `tour_suppliers`) |
| ฟอร์มลงทะเบียน | **Library + link + override** | ← ใหม่ |
| คู่มือทริป, phrasebook, เบอร์ฉุกเฉิน | **Library (ต่อปลายทาง) + link + override** | ← ใหม่ |
| ทีมงาน | **Library (คน) + link (บทบาทต่อทริป)** | ← ใหม่ |

---

## 3. ลำดับชั้น admin

### 3.1 สภาพปัจจุบัน

`staff.role` เป็น text อิสระ (`LEGACY_ROLE_KEYS = ['lead_guide','staff','driver','admin']`)
`StaffAuthGuard` เช็คแค่ว่ามี session ไหม → **ใครล็อกอินได้ ก็เข้าได้ทุกหน้าเท่ากันหมด** รวมถึง FormBuilder, StaffManager, PrintExport

### 3.2 โครงสร้างใหม่ — 2 ชั้น

```
staff (คน — org level)
├─ org_role: NULL | 'admin' | 'owner'      ← ชั้นบริษัท
└─ tour_staff (มอบหมายต่อทริป)
   └─ role: 'lead' | 'staff' | 'driver' | 'guide'   ← ชั้นทริป
```

คนเดียวเป็น `lead` ในทริป A และ `staff` ในทริป B ได้ — **role และ PIN อยู่ที่การมอบหมาย ไม่ใช่ที่ตัวคน**

| ระดับ | ที่เก็บ | ทำอะไรได้ |
|---|---|---|
| `owner` | `staff.org_role` | ทุกอย่าง + ลบทริป + ตั้ง/ถอด admin + purge + billing |
| `admin` | `staff.org_role` | สร้าง/clone/archive ทริป, จัดการคลังกลาง, ออกรหัสทีมงาน, เข้าได้ทุกทริป — ลบทริป/ตั้ง owner **ไม่ได้** |
| `lead` | `tour_staff.role` | ทุกอย่างในทริปตัวเอง: config + หน้างาน + เพิ่ม/ลบทีมงานในทริปนั้น |
| `staff` | `tour_staff.role` | หน้างาน: check-in, กระเป๋า, ที่นั่ง, ห้อง, SOS, broadcast — แก้ config **ไม่ได้** |
| `driver` / `guide` | `tour_staff.role` | อ่านอย่างเดียว + ฟังก์ชันเฉพาะทาง (ผังรถ / คู่มือ) |

### 3.3 ตั้งค่าที่ไหน — แยกให้ชัด

**ตารางสิทธิ์ (role ไหนทำอะไรได้)** → **hardcode ใน `src/lib/permissions.js`**
เหตุผลที่ไม่เก็บใน DB: สิทธิ์ที่ config เองได้ = ทดสอบไม่ได้ + เป็นช่องโหว่ + ไม่มีลูกค้าคนไหนขอ

```js
// src/lib/permissions.js
can(session, 'tour.create')      // → boolean
can(session, 'form.edit')
requireRole(session, 'lead')
```

**การมอบ role ให้คน** → 2 หน้า
- `/staff/admin/team` — org level (owner/admin เท่านั้น) — เพิ่มคน, ตั้ง org_role, มอบหมายเข้าทริป
- `/staff/staff-manager` (เดิม) — tour level (lead ขึ้นไป) — จัดการทีมในทริปตัวเอง

**กฎกันสิทธิ์บานปลาย (บังคับทั้งใน UI และใน RPC)**
1. มอบ role สูงกว่าตัวเองไม่ได้
2. ห้ามลบ/ถอด `owner` คนสุดท้ายของ org
3. ห้ามถอดสิทธิ์ตัวเอง
4. `lead` เพิ่มคนเข้าทริปได้เฉพาะจากคลังคนที่มีอยู่ สร้างคนใหม่ในระบบไม่ได้

### 3.4 เปลี่ยน guard

```jsx
// เดิม
<StaffAuthGuard><FormBuilder /></StaffAuthGuard>
// ใหม่
<RequireRole capability="form.edit"><FormBuilder /></RequireRole>
```

### 3.5 การ migrate

- `role='admin'` เดิม → `tour_staff.role = 'lead'` (ตามที่ตัดสินใจ) — ไม่มีใครได้สิทธิ์เพิ่มโดยไม่ตั้งใจ
- `lead_guide` → `lead` · `staff` → `staff` · `driver` → `driver`
- สร้าง org owner ใหม่ 1 คน: `staff_code = ADM1`, PIN = **4256**
  → เข้าที่ `/staff/login` แท็บ "แอดมิน" แล้วเลื่อนคนที่ควรเป็น admin ขึ้นเองทีหลัง

⚠️ PIN 4256 อยู่ในไฟล์ migration ที่อยู่ใน git — **เปลี่ยนทันทีหลังใช้ครั้งแรก**

---

## 4. ข้อมูลใช้ร่วม แต่แสดงต่างกัน

### 4.1 คลังเนื้อหาแยกตามปลายทาง

```sql
destinations (id, org_id, name, country_code)   -- ญี่ปุ่น, เกาหลี, เชียงใหม่
tours.destination_id → destinations
```

สร้างทริปใหม่ → เลือกปลายทาง → คู่มือ + ศัพท์ + เบอร์ฉุกเฉินของปลายทางนั้นถูกเสนอให้ทันที ติ๊กเลือกว่าจะเปิดอันไหน

### 4.2 ตารางที่เพิ่ม

| คลัง (ของเดิม + `destination_id`) | Junction ใหม่ | override ที่ปรับต่อทริปได้ |
|---|---|---|
| `form_fields` | `tour_form_fields` | `is_active`, `is_required`, `sort_order`, `label_override`, `options_override` |
| `guide_categories` | `tour_guide_categories` | `is_active`, `sort_order` |
| `guide_articles` | `tour_guide_articles` | `is_published`, `is_featured`, `sort_order`, **`itinerary_item_id`** |
| `phrasebook_entries` | `tour_phrasebook_entries` | `is_active`, `sort_order`, **`itinerary_item_id`**, `place_label_override` |
| `emergency_contacts` | `tour_emergency_contacts` | `is_active`, `sort_order` |
| `staff` | `tour_staff` | `role`, `auth_pin`, `show_to_guest`, `is_default`, `guest_id` |

**`itinerary_item_id` ย้ายมาอยู่ที่ junction** — บทความ "วิธีขึ้นรถไฟชินคันเซ็น" ใช้ได้ทุกทริปญี่ปุ่น แต่ผูกกับ "วันที่ 2 – ไปเกียวโต" ของแต่ละทริปคนละ item

### 4.3 ตอบโจทย์ที่ถามตรงๆ

> "คำถามลงทะเบียนบางอันแสดงในทัวร์ที่ 1 บางอันไม่แสดงในทัวร์ที่ 2"

```
form_fields (คลัง)                tour_form_fields
─────────────────                ────────────────────────────────
"แพ้อาหารอะไร"    ──┬──► ทริป A: is_active=true,  sort=3, required
                    └──► ทริป B: is_active=false          ← ไม่แสดง

"เบอร์คนติดต่อฉุกเฉิน" ─┬──► ทริป A: is_active=true
                        └──► ทริป C: is_active=true, label_override=
                                     "เบอร์ผู้ปกครอง (ทริปนักเรียน)"
```

### 4.4 อ่านผ่าน View — โค้ดแอปแทบไม่เปลี่ยน

```sql
CREATE VIEW v_tour_form_fields AS
SELECT j.tour_id, f.id, f.field_key, f.field_type, f.field_purpose, f.is_core,
       COALESCE(j.label_override,   f.label)   AS label,
       COALESCE(j.options_override, f.options) AS options,
       j.is_active, j.is_required, j.sort_order
FROM tour_form_fields j JOIN form_fields f ON f.id = j.field_id;
```

โค้ดเดิม:
```js
supabase.from('form_fields').select('*').eq('tour_id', ACTIVE_TOUR_ID)
```
โค้ดใหม่:
```js
supabase.from('v_tour_form_fields').select('*').eq('tour_id', tourId)
```

**อ่านผ่าน view / เขียนลงตารางฐาน** (view ที่มี join เขียนตรงไม่ได้) — FormBuilder แก้ 2 ที่: แก้ตัวคำถาม → `form_fields`, เปิด/ปิด/เรียง → `tour_form_fields`

### 4.5 กุญแจของการ migrate โดยไม่กระทบข้อมูล — **คง UUID เดิม**

แถวเดิมใน `form_fields` / `guide_articles` / ฯลฯ **ไม่ถูกย้าย ไม่ถูกลบ ไม่เปลี่ยน id** เพียงแค่:
1. เติม `destination_id`
2. สร้างแถว junction ให้ทริปปัจจุบัน โดยก๊อปค่า `is_active` / `sort_order` / `itinerary_item_id` เดิมมา

→ `guest_form_responses.field_id` ที่ชี้อยู่ **ยังชี้ถูกทุกแถว ไม่ต้องแตะเลย**
→ คอลัมน์ `tour_id` เดิมบนตารางคลังยังอยู่ (กลายเป็น "ทริปที่สร้างขึ้นมาครั้งแรก") — โค้ดเก่าที่ยังไม่แก้จึงยังทำงานได้ระหว่าง migrate ทีละไฟล์

### 4.6 ปุ่ม "แยกสำเนาเฉพาะทริปนี้" (fork) — จำเป็น

ปัญหาคลาสสิกของ shared library: แก้เนื้อหาให้ทริปนี้ แล้วทริปอื่นเปลี่ยนตามโดยไม่ตั้งใจ

ทางแก้: ใน GuideBuilder/FormBuilder ถ้าเนื้อหาถูกใช้อยู่ >1 ทริป ตอนกดแก้จะถาม

```
บทความนี้ใช้อยู่ใน 3 ทริป
  ○ แก้ให้ทุกทริป            (แก้ที่คลัง)
  ● แยกสำเนาเฉพาะทริปนี้     (fork → def ใหม่ ผูกทริปนี้อย่างเดียว)
```

RPC: `fork_content(p_table, p_row_id, p_tour_id)` → ก๊อปแถว (id ใหม่, `destination_id=NULL`, `tour_id=<ทริปนี้>`) แล้วชี้ junction มาที่ตัวใหม่

---

## 5. Flow ลูกทัวร์ (เหมือน v1)

- Routing: `/t/:code/*` — ทุกหน้า guest ย้ายมาอยู่ใต้นี้
- Route เดิม (`/itinerary`, `/my-qr`) **ไม่ลบ** → redirect ไป `/t/<code เดิม>/...` → QR ที่แจกไปแล้วยังใช้ได้
- `TourContext` + `useTourId()` แทน `ACTIVE_TOUR_ID`
- `guestSession` เปลี่ยนจาก id เดียว → map `{ tourId: guestId }` + auto-migrate คีย์เก่า
- สถานะที่ต้อง handle: `loading` / `not_found` / `archived` (read-only)

## 6. Flow ทีมงาน

```
/staff/login
  ├─ [ทีมงาน]  เลือกทริป (active) → เลือกชื่อ → PIN
  │             (มีทริป active แค่ 1 → ข้ามขั้นเลือกอัตโนมัติ = เหมือนเดิม 100%)
  └─ [แอดมิน]  staff_code + PIN → /staff/admin
```

`staffSession` = `{ staff, orgRole, activeTourId, tourRole }`
- ไม่มี `org_role` → `activeTourId` ล็อกตาม `tour_staff` ตรวจซ้ำทุกครั้งที่อ่าน session
- มี `org_role` → สลับทริปได้ผ่าน switcher บน header

### `/staff/admin` — Tour Manager
รายการทริป · สร้างใหม่ (ว่าง / clone / จากปลายทาง) · Archive · Purge (PDPA) · ตั้งเป็นแม่แบบ · จัดการคลังกลาง (คู่มือ/ศัพท์/ฟอร์ม/คน/supplier) · ทีมบริษัท

## 7. "รีเซต / เริ่มกรุ๊ปใหม่" — 3 ทาง

| วิธี | ใช้เมื่อ | ผลกับข้อมูลเดิม |
|---|---|---|
| **Clone → ทริปใหม่** (แนะนำ) | จัดทริปรูปแบบเดิมอีกรอบ | ไม่แตะเลย เปิดดูย้อนหลังได้ |
| **Archive + Purge** | ทริปจบ + PDPA | ลบเฉพาะข้อมูลส่วนตัว เก็บสถิติ/ค่าใช้จ่าย |
| **Reset runtime** | ทดสอบ / กรอกผิดตั้งแต่ต้น | ลบลูกทัวร์+ข้อมูลหน้างาน เก็บ config |

RPC: `clone_tour()` · `archive_tour()` · `purge_tour_personal_data()` · `reset_tour_runtime_data()` · `fork_content()`
ทุกตัว scope ด้วย `tour_id` เสมอ — ไม่มี `DELETE` ที่ไม่มี `WHERE tour_id`

---

## 8. แผนแก้โค้ด + สถานะ

| # | งาน | สถานะ |
|---|---|---|
| 0 | รัน migration | ✅ รันบน Supabase แล้ว (ดู §8.1) |
| 1 | `permissions.js`, `TourContext.jsx`, `tourPath.js`, `guestSession.js`, `staffSession.js`, `RequireRole.jsx` | ✅ เสร็จ |
| 2 | `App.jsx` — `/t/:code/*` + legacy redirect + `RequireRole` ทุก route | ✅ เสร็จ |
| 3 | หน้า staff 19 ไฟล์ → `useActiveTourId()` / `useActiveOrgId()` | ✅ เสร็จ |
| 4 | หน้า guest 11 ไฟล์ + `GuestNav`/`GuestHome`/`HomeButton`/`AnnouncementBanner` → `useTourId()` / `tp()` | ✅ เสร็จ |
| 5 | `Login.jsx` — เลือกทริป + แท็บแอดมิน | ✅ เสร็จ |
| 5b | `StaffManager` + อีก 5 ไฟล์ → อ่าน `v_tour_staff` / เขียน `tour_staff` | ✅ เสร็จ |
| 6 | `FormBuilder` / `GuideBuilder` — แยกคลัง vs ต่อทริป + ปุ่ม fork | ⬜ **ยังไม่ทำ** |
| 7 | `TourManager.jsx` (/staff/admin) + `TourSwitcher` บน Dashboard | ✅ เสร็จ |
| 7b | `OrgTeam.jsx` — จัดการทีมระดับบริษัท | ⬜ ยังไม่ทำ (ใช้ StaffManager ต่อทริปไปก่อนได้) |
| 8 | ลบ `ACTIVE_TOUR_ID` / `ACTIVE_ORG_ID` | ✅ ลบแล้ว (0 references) |

### 8.1 migration ที่รันไปแล้ว (Supabase project MyTour)

| version | ชื่อ |
|---|---|
| 20260728101301 | `multi_tour_part1_tours_and_staff` |
| 20260728101418 | `multi_tour_part2_content_library` |
| 20260728101518 | `multi_tour_part3_auth_and_rpc` |
| 20260728101646 | `multi_tour_part1b_clone_archive_purge_reset` |
| 20260728101735 | `multi_tour_widen_tours_status_check` |

**ผลลัพธ์**
- ทริปเดิมได้รหัส **H2YFCN** → ลูกทัวร์เข้าที่ `/t/H2YFCN`
- staff 19 → tour_staff 19 (lead 2, staff 17) · `role='admin'` เดิม map เป็น `lead`
- org owner: `ADM1` / PIN `4256` — **⚠️ เปลี่ยนทันที**
- ลูกทัวร์ 71 / คำตอบฟอร์ม 552 ครบ ไม่มีแถวกำพร้า

**เรื่องที่พบตอนรันจริง (ต่างจากที่คาด)**
- `tours` ใช้ `start_date`/`end_date` ไม่ใช่ `starts_on`/`ends_on` → แก้ทั้ง migration และโค้ด
- `tours_status_check` เดิมอนุญาตแค่ `active/completed/cancelled` → ขยายให้รับ `draft`/`archived`
- `luggage.tag_code` unique แบบ global → เปลี่ยนเป็น `(tour_id, tag_code)`
- RLS เปิดทุกตารางพร้อม policy `true` → ตารางใหม่ตั้ง policy แบบเดียวกัน, view ใช้ `security_invoker`
- ทีมงานทั้ง 19 คนใช้ PIN เดียวกัน → ข้ามการสร้าง unique index บน PIN (ระบบแจ้งเตือนแล้วไปต่อ)

### 8.2 หน้า Tour Manager (`/staff/admin`) — เข้าได้เฉพาะแอดมิน/เจ้าของ

ทางเข้า: แถบชื่อทริปบน Dashboard → "จัดการทริปทั้งหมด"

| ปุ่ม | ทำอะไร | RPC |
|---|---|---|
| สร้างทริป (ก๊อปจากทริปเดิม) | ก๊อปกำหนดการ/ผังรถ/ผังห้อง/supplier + ชี้คลังเนื้อหาชุดเดียวกัน · **ไม่ก๊อปลูกทัวร์** | `clone_tour` |
| สร้างทริป (เริ่มจากว่าง) | เลือกปลายทาง → ดึงคู่มือ/ศัพท์/เบอร์ฉุกเฉินของปลายทางนั้นมาให้ | `create_tour` |
| เข้าทำงานทริปนี้ | สลับ `activeTourId` ของ session | `switchActiveTour()` |
| เปิดใช้งาน | `draft` → `active` (ลูกทัวร์เข้าได้) | `update_tour` |
| ปิดทริป / เปิดอีกครั้ง | `archived` ↔ `active` | `archive_tour` |
| ออกรหัสใหม่ | เปลี่ยน join_code — **QR เดิมใช้ไม่ได้ทันที** | `regenerate_join_code` |
| ล้างข้อมูลหน้างาน | ลบลูกทัวร์+เช็คอิน+กระเป๋า เก็บ config (พิมพ์ชื่อยืนยัน) | `reset_tour_runtime_data` |
| ลบข้อมูลส่วนบุคคล | PDPA — ต้อง archive ก่อน (เจ้าของเท่านั้น) | `purge_tour_personal_data` |
| ลบทริป | เฉพาะทริปที่ยังไม่มีลูกทัวร์ (เจ้าของเท่านั้น) | `delete_empty_tour` |

**ยังไม่ทำ** — เปิด/ปิดคำถามฟอร์มต่อทริปจาก UI (junction + view พร้อมแล้ว
แต่ FormBuilder ยังเขียนลง `form_fields.tour_id` แบบเดิม) และหน้าจัดการทีมระดับบริษัท

### 8.3 ทดสอบไปแล้ว

**บนฐานข้อมูลจริง** (สร้างทริปทดสอบ → ตรวจ → ลบทิ้ง · ยอดทุกตารางกลับเท่าเดิมเป๊ะ)
- clone ทริป → ทริปใหม่ได้ config ครบ (กำหนดการ 15, ที่นั่ง 128, ห้อง 5, ฟอร์ม 15, บทความ 7, ศัพท์ 60) แต่ลูกทัวร์ **0 คน**
- ปิดคำถาม 1 ข้อ + ตั้ง `label_override` ในทริป 2 → ทริป 1 ยังครบ 15 ข้อ ไม่มี override ← **โจทย์ข้อ 2**
- **3 ทริปพร้อมกัน** → ทุกทริปเห็น 15/7/60/4 เท่ากัน ไม่ปนกัน ← **โจทย์ข้อ 1**
- แก้บทความที่คลัง 1 ครั้ง → ทุกทริปเห็นพร้อมกัน · กด fork ในทริป A แล้วแก้ → มีแค่ทริป A ที่เปลี่ยน
- flow ปุ่มทุกปุ่มบน Tour Manager (สร้าง/เปิดใช้งาน/ออกรหัสใหม่/ปิดทริป/ลบ) รันในบทบาท `anon`
- guard 4 เคส: reset ชื่อผิด / purge ก่อน archive / fork ตารางที่ไม่รองรับ / role มั่ว → บล็อกครบ
- RPC login: PIN ถูกผ่าน · PIN ผิดคืน null · รหัสทริปพิมพ์เล็กก็ resolve ได้

**บั๊กที่เจอจากการทดสอบ (แก้แล้ว)**
`clone_tour` รอบแรกก๊อปเนื้อหาคลังเป็นแถวใหม่ที่ยังติดธง `is_library` → clone 1 ครั้งคลังโตเท่าตัว
ทริปว่างที่สร้างถัดมาได้ฟอร์ม 30 ข้อแทน 15 · แก้เป็นชี้ junction มาที่ต้นฉบับตามเจตนาเดิมของ §4.2

**บนโค้ด**
- parse ผ่าน 75 ไฟล์ · import/export resolve ครบ · capability ตรงกับ `permissions.js`
- `permissions.js` 18 เคส · `guestSession`/`staffSession`/`tourPath` 20 เคส
- ⚠️ ยังไม่ได้ `npm run build` — sandbox ไม่มี rollup binary ของ Linux ต้องรันบนเครื่องคุณเอง

---

## 9. ข้อจำกัดที่ยังอยู่

⚠️ PIN เป็น screen-gate ระดับ UI — **multi-tour ทำให้เรื่องนี้แย่ลง** เพราะข้อมูลหลายทริปอยู่ฐานเดียว ยิง API ตรงข้ามทริปได้ และตอนนี้ `permissions.js` ก็บังคับได้แค่ฝั่ง client

ก่อนเปิดให้บริษัทอื่นใช้ (ไม่ใช่รอบนี้ แต่ต้องทำก่อนลูกค้ารายที่ 2):
1. Supabase Auth จริงสำหรับ staff
2. RLS ทุกตาราง scope ด้วย `org_id` + `tour_id` — และ **ย้าย permission matrix ไปเป็น policy ด้วย** ไม่ใช่แค่ client
3. Guest ใช้ signed token ต่อทริป แทน guest_id ดิบใน localStorage

รอบนี้ = multi-tour ภายในบริษัทเดียว ปลอดภัยพอสำหรับใช้เอง

---

## 10. Checklist ก่อน deploy

- [ ] รัน SECTION 0 (PRE-FLIGHT) → ดู unique constraint ที่เป็น global
- [ ] Backup DB ก่อนรัน + ลองบน Supabase branch ก่อน
- [ ] ยืนยันหลัง migrate: ทุกทริปมี `join_code` · `tour_staff` มีครบทุกคน · junction ครบทุกเนื้อหา · `guest_form_responses` ไม่มีแถวกำพร้า
- [ ] เปิด URL เดิม (`/`, `/itinerary`) → redirect ถูก
- [ ] เครื่องที่เคยลงทะเบียน → ยังจำตัวตนได้
- [ ] Staff login PIN เดิม → เข้าได้ปกติ, role เป็น `lead`/`staff` ตามที่ map
- [ ] เข้าแอดมินด้วย ADM1/4256 → **เปลี่ยน PIN ทันที**
- [ ] สร้างทริปที่ 2 → เปิด 2 browser คนละทริป → ข้อมูลไม่ปนกัน (check-in, luggage, seat, room)
- [ ] ปิดคำถามฟอร์ม 1 ข้อในทริป B → ทริป A ต้องยังแสดงอยู่
