# MyTour — Multi-Tour Architecture Design v1

**วันที่:** 28 ก.ค. 2026
**ปัญหาที่แก้:** (1) รีเซตข้อมูลทัวร์/เริ่มกรุ๊ปใหม่ไม่ได้ (2) รันหลายกรุ๊ปพร้อมกันไม่ได้
**หลักการ:** ทุกการเปลี่ยนแปลงเป็น **additive** — ทริปปัจจุบัน (`00000000-...-0002`) ต้องใช้งานได้ต่อเนื่องโดยไม่ต้องแก้อะไร

---

## 1. รากของปัญหา

```js
// src/lib/constants.js
export const ACTIVE_TOUR_ID = '00000000-0000-0000-0000-000000000002'  // hardcode
export const ACTIVE_ORG_ID  = '00000000-0000-0000-0000-000000000001'
```

ถูก import ใน **33 ไฟล์** (~200 จุดใช้งาน) → ทั้งแอปผูกกับทริปเดียวถาวร
- จะเริ่มกรุ๊ปใหม่ = ต้องแก้โค้ด + redeploy + ข้อมูลเก่าหาย/ปนกัน
- รัน 2 กรุ๊ปพร้อมกัน = เป็นไปไม่ได้เลย
- `localStorage['mytour_guest_id']` เก็บ id เดียว → ลูกทัวร์ที่ไปหลายทริปด้วยเครื่องเดิมจะทับกัน

**ข่าวดี:** ทุกตารางมี `tour_id` อยู่แล้ว (ตามที่วางไว้ใน Plan v2.3 §7.4) — ปัญหาอยู่ที่ **application layer เท่านั้น** ไม่ต้องรื้อ data model

---

## 2. ภาพรวมสถาปัตยกรรมใหม่

```
                        ┌──────────────────────────┐
                        │  orgs (บริษัททัวร์)      │
                        └────────────┬─────────────┘
                                     │ 1:N
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
        ┌─────▼─────┐          ┌─────▼─────┐          ┌─────▼──────┐
        │ tours     │          │ suppliers │          │ staff      │
        │ + join_code│         │ (org-wide)│          │ scope=org  │← admin
        │ + status  │          └───────────┘          │ tour_id=NULL│
        │ + is_template│                              └────────────┘
        └─────┬─────┘
              │ 1:N (ทุกตารางที่มี tour_id)
    guests / itinerary_items / buses / hotels / luggage /
    sos_alerts / expenses / guide_* / form_fields / staff(scope=tour) ...
```

### Entry point แยกตามฝั่ง

| ฝั่ง | เดิม | ใหม่ |
|---|---|---|
| Guest | `mytour.app/` → hardcoded tour | `mytour.app/t/JPN1102/` → resolve จาก `join_code` |
| Staff | `/staff/login` → PIN → hardcoded tour | `/staff/login` → เลือกทริป → ชื่อ → PIN (admin เห็นทุกทริป, staff เห็นเฉพาะของตัวเอง) |

---

## 3. Schema — สิ่งที่เพิ่ม

### 3.1 `tours` — เพิ่มคอลัมน์ (ไม่แตะของเดิม)

| คอลัมน์ | ชนิด | ความหมาย |
|---|---|---|
| `join_code` | `text UNIQUE` | รหัสสั้นใน URL เช่น `JPN1102` (A–Z, 0–9, ไม่มี I/O/0/1 กันสับสน) |
| `status` | `text` | `draft` \| `active` \| `archived` — default `active` |
| `starts_on` / `ends_on` | `date` | ใช้ auto-archive + เรียงลำดับ |
| `is_template` | `boolean` | ทริปนี้เป็นแม่แบบสำหรับ clone (ไม่มีลูกทัวร์จริง) |
| `cloned_from` | `uuid` FK→tours | เก็บที่มา ตรวจสอบย้อนหลังได้ |
| `archived_at` | `timestamptz` | เวลาปิดทริป |
| `personal_data_purged_at` | `timestamptz` | หลักฐาน PDPA ว่าลบข้อมูลส่วนตัวแล้วเมื่อไหร่ |

### 3.2 `staff` — เพิ่ม 2 คอลัมน์ + คลาย constraint

| คอลัมน์ | ชนิด | ความหมาย |
|---|---|---|
| `scope` | `text` | `org` = แอดมินบริษัท (เห็น/สร้างทุกทริป) \| `tour` = ทีมงานทริปเดียว |
| `staff_code` | `text` | รหัสประจำตัว 4 ตัวอักษร ใช้คู่ PIN กันชนกันข้ามทริป |

- `tour_id` เปลี่ยนเป็น **nullable** — `scope='org'` จะมี `tour_id IS NULL`
- CHECK constraint บังคับ: `scope='tour'` → ต้องมี `tour_id`; `scope='org'` → ต้องไม่มี
- แถวเดิมทั้งหมด backfill เป็น `scope='tour'` → **ทีมงานทริปปัจจุบัน login ได้เหมือนเดิมทุกประการ**

### 3.3 ตารางใหม่ `tour_admin_access` (optional, เผื่ออนาคต)

junction `staff_id × tour_id` สำหรับกรณี "หัวหน้าทัวร์ 1 คนดูแล 3 ทริป แต่ไม่ใช่แอดมินบริษัท" — ยังไม่จำเป็นตอนนี้ แต่ migration สร้างตารางเปล่าไว้ให้แล้ว ไม่มีต้นทุน

### 3.4 Unique constraints ที่ต้องเป็น **per-tour** ไม่ใช่ global

⚠️ จุดที่จะพังตอนมี 2 ทริปพร้อมกัน — ต้องตรวจก่อน deploy:

| ตาราง | คอลัมน์ | ต้องเป็น |
|---|---|---|
| `guests` | `phone` | `UNIQUE (tour_id, phone)` |
| `guests` | `qr_token` | global unique ได้ (ควรเป็น random) |
| `luggage` | `tag_code` | `UNIQUE (tour_id, tag_code)` — ป้ายกระเป๋าหมายเลข 001 มีได้ทุกทริป |
| `buses` | `code`/`name` | `UNIQUE (tour_id, code)` |
| `hotel_rooms` | `room_no` | `UNIQUE (hotel_id, room_no)` |
| `form_fields` | `key` | `UNIQUE (tour_id, key)` |
| `staff` | `auth_pin` | `UNIQUE (tour_id, auth_pin)` + org-admin ใช้ `staff_code` |

Migration มี query ตรวจสอบให้ (§6) — รันดูก่อน แล้วค่อยแก้เฉพาะตัวที่เป็น global จริง

---

## 4. Flow ฝั่งลูกทัวร์ (Guest)

### 4.1 Routing

```
/t/:code                 → Register (ลงทะเบียนเข้าทริป code นี้)
/t/:code/itinerary
/t/:code/my-qr
/t/:code/trip-guide  ... (ทุกหน้า guest ย้ายมาอยู่ใต้ /t/:code)

/                        → หน้า "เลือกทริปของฉัน" (ดูจาก session ที่เคยเข้า) + ช่องกรอกรหัส
/bag/:tagCode            → คงเดิม (tagCode resolve tour_id เองได้จาก DB)
```

**Backward compat:** route เดิม `/itinerary`, `/my-qr` ฯลฯ **ไม่ลบ** — ทำเป็น redirect ไป `/t/<legacy_code>/...` โดยใช้ join_code ของทริปปัจจุบัน → QR/ลิงก์ที่แจกลูกทัวร์ไปแล้วยังใช้ได้

### 4.2 TourContext

```jsx
// src/lib/TourContext.jsx
<TourProvider>          // อ่าน :code จาก URL → query tours → ให้ { tour, tourId, orgId }
  useTour()             // hook หลัก
  useTourId()           // shorthand แทน ACTIVE_TOUR_ID
</TourProvider>
```

สถานะที่ต้อง handle: `loading` (skeleton) / `not_found` (รหัสผิด) / `archived` (ทริปจบแล้ว — โชว์ read-only + ข้อความ)

### 4.3 guestSession — เปลี่ยนจาก id เดียวเป็น map

```js
// เดิม: localStorage['mytour_guest_id'] = "<uuid>"
// ใหม่: localStorage['mytour_guest_sessions'] = { "<tourId>": "<guestId>", ... }

getGuestId(tourId)        // อ่านเฉพาะทริปนั้น
saveGuestId(tourId, id)
clearGuestId(tourId)
listGuestSessions()       // สำหรับหน้า "/" เลือกทริปของฉัน
```

**Auto-migrate:** ตอนโหลดครั้งแรก ถ้าเจอคีย์เก่า `mytour_guest_id` → ย้ายเข้า map ใต้ `tourId` ของทริปปัจจุบัน แล้วลบคีย์เก่า → **ลูกทัวร์ที่ลงทะเบียนแล้วไม่ต้องทำอะไรเลย**

---

## 5. Flow ฝั่งทีมงาน (Staff) — ตามที่ตกลง

> แอดมินตำแหน่งใหญ่เป็นผู้สร้างทัวร์และสร้างรหัส; staff ทั่วไปเข้าถึงได้เฉพาะทริปของตัวเอง

### 5.1 บทบาท

| scope | role ตัวอย่าง | เห็นอะไร | ทำอะไรได้ |
|---|---|---|---|
| `org` | `owner`, `admin` | ทุกทริปในบริษัท | สร้าง/clone/archive ทริป, ออกรหัส staff, สลับทริปได้อิสระ, purge ข้อมูล |
| `tour` | `lead`, `staff` | ทริปเดียวที่ผูกไว้ | ทุกฟีเจอร์หน้างานของทริปนั้น สลับไปทริปอื่น**ไม่ได้** |

### 5.2 Login flow ใหม่

```
/staff/login
  ├─ [Tab: ทีมงาน]  เลือกทริป (เฉพาะ status=active) → เลือกชื่อ → PIN
  │                  ✅ ตรงกับ flow เดิมเป๊ะ แค่เพิ่มขั้น "เลือกทริป" ข้างหน้า
  │                  ✅ ถ้ามีทริป active แค่ 1 → ข้ามขั้นนี้อัตโนมัติ (วันนี้ = เหมือนเดิม 100%)
  └─ [Tab: แอดมิน]   staff_code + PIN → เข้า /staff/admin (Tour Manager)
```

### 5.3 staffSession — เพิ่ม tourId

```js
{ staff: { id, name, role, scope, tour_id }, activeTourId: "<uuid>" }
```

- `scope='tour'` → `activeTourId` ล็อกเป็น `staff.tour_id` เปลี่ยนไม่ได้ (ตรวจซ้ำทุกครั้งที่อ่าน session ไม่ใช่แค่ตอน login)
- `scope='org'` → เปลี่ยนได้ผ่าน tour switcher บน header
- ทุก staff page อ่าน tour_id จาก `useActiveTourId()` แทน `ACTIVE_TOUR_ID`

### 5.4 หน้าใหม่: `/staff/admin` — Tour Manager (admin only)

- รายการทริป: ชื่อ / รหัส / วันที่ / จำนวนลูกทัวร์ / สถานะ — filter draft/active/archived
- **สร้างทริปใหม่**: ชื่อ, วันที่, สร้างจาก → `[ว่างเปล่า]` หรือ `[clone จากทริป/แม่แบบ...]`
- **Clone**: เลือกได้ว่าจะก๊อปอะไร (ฟอร์ม / กำหนดการ / ผังรถ / โรงแรม / คู่มือ / phrasebook / เบอร์ฉุกเฉิน / supplier / ทีมงาน) — **ไม่ก๊อปลูกทัวร์และข้อมูลส่วนตัวเด็ดขาด**
- **Archive**: ปิดทริป → guest เห็นเป็น read-only, ไม่ขึ้นในรายการ login
- **Purge personal data** (PDPA): ลบ location / responses / รูป / เบอร์ ของทริปที่ archive แล้ว — ต้องพิมพ์ชื่อทริปยืนยัน
- **ตั้งเป็นแม่แบบ**: `is_template=true`

---

## 6. แผนแก้โค้ด (33 ไฟล์) — ทำแบบไม่พัง

**กุญแจสำคัญ:** `constants.js` ยังคง export `ACTIVE_TOUR_ID` ต่อไปเป็น **fallback** ไม่ใช่ค่าหลัก

```js
// src/lib/constants.js (หลังแก้)
/** @deprecated ใช้ useTourId() แทน — เหลือไว้เป็น fallback ระหว่าง migrate */
export const LEGACY_TOUR_ID = '00000000-0000-0000-0000-000000000002'
export const ACTIVE_TOUR_ID = LEGACY_TOUR_ID   // ยังมีอยู่ → ไฟล์ที่ยังไม่แก้ ไม่พัง
```

### ลำดับการแก้ (แก้ทีละก้อน deploy ได้ทุกก้อน)

| ลำดับ | งาน | ไฟล์ | เสี่ยง |
|---|---|---|---|
| 0 | รัน SQL migration + ตรวจ constraint | — | ต่ำ (additive) |
| 1 | `TourContext.jsx`, `guestSession.js` (map + auto-migrate), `staffSession.js` (+activeTourId) | 3 ไฟล์ใหม่/แก้ | ต่ำ |
| 2 | `App.jsx` — เพิ่ม `/t/:code/*` + legacy redirect + `/staff/admin` | 1 | กลาง — ทดสอบ QR เดิม |
| 3 | หน้า staff: เปลี่ยน `ACTIVE_TOUR_ID` → `useActiveTourId()` (20 ไฟล์) | 20 | ต่ำ ทำเป็น batch |
| 4 | หน้า guest: เปลี่ยนเป็น `useTourId()` (12 ไฟล์) | 12 | ต่ำ |
| 5 | `Login.jsx` เพิ่มขั้นเลือกทริป + tab แอดมิน | 1 | กลาง |
| 6 | `TourManager.jsx` (ใหม่) — สร้าง/clone/archive/purge | 1 ใหม่ | ต่ำ (หน้าใหม่) |
| 7 | ลบ fallback `ACTIVE_TOUR_ID` ออกจาก constants.js | 1 | — ทำเมื่อ 0 references |

**ประมาณเวลา:** 2.5–3.5 วันงาน (ก้อน 3–4 เป็น mechanical replace ส่วนใหญ่)

### Guard rail
- เพิ่ม ESLint rule ห้าม import `ACTIVE_TOUR_ID` ในไฟล์ใหม่
- ทุก query ที่ `.eq('tour_id', ...)` ต้องมาจาก context — เขียน helper `tourQuery(table)` ที่ผูก tour_id ให้อัตโนมัติ กันลืม

---

## 7. "รีเซตข้อมูล / เริ่มกรุ๊ปใหม่" ทำได้ 3 แบบ

| วิธี | ใช้เมื่อไหร่ | ผลกับข้อมูลเดิม |
|---|---|---|
| **Clone → ทริปใหม่** (แนะนำ) | จบทริปแล้วจัดทริปรูปแบบเดิมอีก | ไม่แตะเลย ทริปเก่ายังเปิดดูย้อนหลังได้ |
| **Archive + Purge** | ทริปจบ + ต้องลบข้อมูลส่วนตัวตาม PDPA | ลบเฉพาะ personal data เก็บสถิติ/expense ไว้ |
| **Reset ทริปเดิม** | ทดสอบ / กรอกผิดตั้งแต่ต้น | ลบ guests + ข้อมูล runtime ของทริปนั้น **เก็บ config** (ฟอร์ม/กำหนดการ/ผังรถ) |

ทั้งสามทำผ่าน RPC ใน migration: `clone_tour()`, `archive_tour()`, `purge_tour_personal_data()`, `reset_tour_runtime_data()`
— ทุกตัว scope ด้วย `tour_id` เสมอ **ไม่มี DELETE ที่ไม่มี WHERE tour_id**

---

## 8. ความปลอดภัย — ข้อจำกัดที่ยังคงอยู่

⚠️ PIN เป็น screen-gate ระดับ UI เท่านั้น (ตามที่บันทึกไว้ใน Plan v2.3 §4.2) — **multi-tour ทำให้เรื่องนี้แย่ลง** เพราะตอนนี้ข้อมูลหลายบริษัท/หลายทริปอยู่ใน DB เดียว ใครก็ยิง API ตรงข้ามทริปได้

ก่อนขายจริง (ไม่ใช่รอบนี้ แต่ต้องทำก่อนมีลูกค้าที่ 2):
1. Supabase Auth จริงสำหรับ staff
2. RLS ทุกตาราง scope ด้วย `org_id` + `tour_id`
3. Guest ใช้ signed token ต่อทริป แทน guest_id ดิบใน localStorage

รอบนี้ทำแค่ multi-tour **ภายในบริษัทเดียว** ปลอดภัยพอสำหรับใช้เอง แต่ห้ามเปิดให้บริษัทอื่นใช้จนกว่าจะมี RLS

---

## 9. Checklist ก่อน deploy

- [ ] รันส่วน "PRE-FLIGHT CHECK" ใน migration → ดูว่ามี unique constraint ที่เป็น global ตัวไหนบ้าง
- [ ] Backup DB (Supabase → Database → Backups) ก่อนรัน
- [ ] รัน migration บน branch/staging ก่อน
- [ ] ยืนยัน: ทริปเดิมได้ `join_code` แล้ว, `staff` ทุกแถว `scope='tour'`, `tour_id` ครบ
- [ ] เปิดแอปด้วย URL เดิม (`/`, `/itinerary`) → ต้อง redirect ไป `/t/<code>/...` ได้
- [ ] เปิดด้วยเครื่องที่เคยลงทะเบียน → ต้องยังจำตัวตนได้ (auto-migrate localStorage)
- [ ] Staff login ด้วย PIN เดิม → เข้าได้ปกติ
- [ ] สร้างทริปที่ 2 → เปิด 2 browser คนละทริป → ตรวจว่าข้อมูลไม่ปนกัน (โดยเฉพาะ checkin, luggage, seat)
