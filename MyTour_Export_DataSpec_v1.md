# MyTour — Data spec สำหรับเอกสาร Export

สเปกคอลัมน์ข้อมูลของเอกสารแต่ละใบ ตรวจสอบกับ schema จริงในโค้ด ณ ปัจจุบัน

**สัญลักษณ์**

| | ความหมาย |
|---|---|
| ✅ | มีในระบบแล้ว ใช้ได้ทันที |
| ⚠️ | มีได้ แต่เป็น custom field ใน `form_fields` ไม่การันตีว่าทุกทัวร์มี |
| ❌ | ยังไม่มี ต้องเพิ่ม column หรือ table |

---

## 0. สิ่งที่ทุกเอกสารใช้ร่วมกัน (หัว–ท้ายกระดาษ)

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| โลโก้บริษัท | `organizations.logo_url` | ❌ |
| ชื่อบริษัท (ไทย/อังกฤษ) | `organizations.name` / `name_en` | ❌ |
| เลขทะเบียนนิติบุคคล | `organizations.tax_id` | ❌ |
| เลขที่ใบอนุญาต ททท. | `organizations.tat_license_no` | ❌ |
| ที่อยู่ / โทร / อีเมล / เว็บไซต์ | `organizations.address`, `phone`, `email`, `website` | ❌ |
| ข้อความท้ายกระดาษ | `organizations.doc_footer_note` | ❌ |
| ชื่อโปรแกรม | `tours.name` | ✅ |
| รหัสทริป | `tours.join_code` | ✅ |
| วันเดินทาง | `tours.start_date` / `end_date` | ✅ |
| ปลายทาง | `destinations.name` ผ่าน `tours.destination_id` | ✅ |
| หัวหน้าทัวร์ + เบอร์ | `v_tour_staff` (role = leader) | ✅ |
| วันเวลาที่พิมพ์ / เลขหน้า | สร้างตอน render | ✅ |

---

## 1. Rooming list — ใบจัดห้องพัก

ส่งโรงแรมล่วงหน้า โรงแรมต่างประเทศมักขอเลขพาสปอร์ต ไม่ใช่บัตรประชาชน

### ระดับโรงแรม (หัวตาราง)

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| ชื่อโรงแรม | `hotels.name` | ✅ |
| วันเช็คอิน / เช็คเอาต์ | `hotels.check_in_date` / `check_out_date` | ✅ |
| เวลาเช็คเอาต์ | `hotels.checkout_time` | ✅ |

### ระดับห้อง

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| เลขห้อง | `hotel_rooms.room_number` | ✅ |
| ชั้น | `hotel_rooms.floor` | ✅ |
| ประเภทห้อง (TWN/DBL/TRP/SGL) | `hotel_rooms.room_type` | ✅ |
| จำนวนผู้พักสูงสุด | `hotel_rooms.max_guests` | ✅ |

### ระดับผู้พัก (ผ่าน `room_assignments`)

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| ชื่อ-นามสกุล (ไทย) | `guests.name` | ✅ |
| ชื่อเล่น | `guests.nickname` | ✅ |
| เพศ | `guests.gender` | ✅ |
| **ชื่อ-นามสกุล (อังกฤษ ตามพาสปอร์ต)** | — | ❌ |
| **เลขบัตรประชาชน** | — | ❌ |
| **เลขพาสปอร์ต + วันหมดอายุ** | — | ❌ |
| **สัญชาติ** | — | ❌ |
| วันเกิด | custom field `custom_birthdate` | ⚠️ |
| เบอร์โทร | `guests.phone` หรือ field ที่ `field_purpose='phone'` | ✅ |

> **ข้อเสนอ:** ยกวันเกิด / เลขบัตร / พาสปอร์ต / ชื่ออังกฤษ / สัญชาติ ขึ้นเป็น core column ของ `guests` แทนที่จะเป็น custom field — เพราะทั้ง rooming list, manifest, ประกันภัย และ ตม. ใช้ชุดเดียวกันหมด ถ้าปล่อยเป็น custom field เอกสารจะพังทันทีที่แอดมินคนใดคนหนึ่งลบฟิลด์ทิ้ง
>
> พร้อมกันนั้น เลขบัตร/พาสปอร์ตเป็นข้อมูลอ่อนไหวตาม PDPA ควรบวกเข้าไปใน `purge_tour_personal_data` และจำกัดสิทธิ์อ่านด้วย RLS

---

## 2. Guest manifest — บัญชีรายชื่อผู้เดินทาง

ใช้กับ ตม. / สายการบิน / ประกันภัย ชุดข้อมูลเข้มที่สุด

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| ลำดับที่ | นับตอน render | ✅ |
| คำนำหน้า | — | ❌ |
| ชื่อ-นามสกุล ไทย | `guests.name` | ✅ |
| ชื่อ-นามสกุล อังกฤษ | — | ❌ |
| เพศ | `guests.gender` | ✅ |
| วันเกิด / อายุ | `custom_birthdate` | ⚠️ |
| เลขบัตรประชาชน | — | ❌ |
| เลขพาสปอร์ต / วันออก / วันหมดอายุ | — | ❌ |
| สัญชาติ | — | ❌ |
| เบอร์โทร | `guests.phone` | ✅ |
| ผู้ติดต่อฉุกเฉิน ชื่อ + เบอร์ | `guests.emergency_contact_name` / `_phone` | ✅ |
| โรคประจำตัว | `guests.medical_condition` | ✅ |
| แพ้อาหาร | `guests.food_allergy` | ✅ |
| หมายเหตุ | `guests.note` | ✅ |
| เลขที่กรมธรรม์ | — | ❌ |

> เอกสารนี้ควรมี 2 โปรไฟล์: **แบบเต็ม** (ภายใน) และ **แบบย่อ** (ส่งออกนอกองค์กร ตัดข้อมูลสุขภาพและเลขบัตรออก)

---

## 3. Seat manifest — ผังที่นั่งรถ

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| ชื่อ/ทะเบียนรถ | `buses` | ✅ |
| เลขที่นั่ง | `bus_seats.seat_number` | ✅ |
| ชื่อผู้โดยสาร | `guests.name` / `nickname` | ✅ |
| เพศ (แสดงสี) | `guests.gender` | ✅ |
| เบอร์โทร | `guests.phone` | ✅ |
| คนขับ + เบอร์ | `buses.driver_name` / `driver_phone` | ✅ |
| ทะเบียนรถ | `buses.license_plate` | ✅ |
| ไกด์ประจำรถ | — | ❌ |
| ที่นั่งว่าง | คำนวณ | ✅ |

> แก้จากฉบับร่างแรก: `buses` มี `driver_name`, `driver_phone`, `license_plate` อยู่แล้ว
> (เห็นได้จาก query ใน `SeatMap.jsx`) เหลือขาดแค่ไกด์ประจำรถ

---

## 4. Dietary & allergy sheet — ส่งร้านอาหาร

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| ชื่อ/ชื่อเล่น | `guests.name` / `nickname` | ✅ |
| แพ้อาหาร | `guests.food_allergy` | ✅ |
| ข้อจำกัดด้านอาหาร | field ที่ `field_purpose='dietary'` | ✅ |
| โรคประจำตัวที่เกี่ยวกับอาหาร | `guests.medical_condition` | ✅ |
| สรุปนับตามประเภท | คำนวณ | ✅ |
| มื้อ/ร้าน/วันที่ | `itinerary_items` | ✅ |

---

## 5. Itinerary booklet — เล่มโปรแกรมทัวร์ (แจกลูกค้า)

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| วันที่ | `itinerary_items.day_number` | ✅ |
| เวลา | `itinerary_items.scheduled_time` | ✅ |
| หัวข้อ / รายละเอียด | `itinerary_items.title` / `description` | ✅ |
| สถานที่ + ลิงก์แผนที่ | `location_name` / `maps_url` | ✅ |
| ลำดับ | `sort_order` | ✅ |
| ข้อมูลโรงแรมแต่ละคืน | `hotels.*` (wifi, breakfast) | ✅ |
| เบอร์ฉุกเฉิน | `v_tour_emergency_contacts` | ✅ |
| QR เข้าแอป | `tours.join_code` | ✅ |
| รูปประกอบ | — | ❌ |

---

## 6. Emergency card — การ์ดฉุกเฉิน (A5 พับ)

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| ชื่อรายการ / เบอร์ / หมวด | `v_tour_emergency_contacts` | ✅ |
| หัวหน้าทัวร์ + เบอร์ | `v_tour_staff` | ✅ |
| ชื่อโรงแรม + ที่อยู่แต่ละคืน | `hotels` | ✅ |
| ที่อยู่โรงแรม (ภาษาท้องถิ่น) | — | ❌ |
| ประโยคฉุกเฉิน | `v_tour_phrasebook` | ✅ |

---

## 7. Expense report — รายงานค่าใช้จ่าย

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| วันที่ | `expenses.expense_date` | ✅ |
| หมวด | `expenses.category` | ✅ |
| รายละเอียด | `expenses.description` | ✅ |
| จำนวนเงิน | `expenses.amount` | ✅ |
| ผู้จ่าย / ผู้บันทึก | `paid_by` / `created_by` | ✅ |
| ใบเสร็จ | `expenses.receipt_url` | ✅ |
| ซัพพลายเออร์ | `suppliers.name` | ✅ |
| สกุลเงิน + เรทแลก | — | ❌ |
| งบที่ตั้งไว้ / ส่วนต่าง | — | ❌ |
| ต้นทุนต่อหัว | คำนวณจากจำนวน `guests` | ✅ |

---

## 8. Feedback report — รายงานความพึงพอใจ

| ฟิลด์ | แหล่ง | สถานะ |
|---|---|---|
| คำถาม | `form_fields` (form_type = feedback) | ✅ |
| คำตอบ | `guest_form_responses.value` | ✅ |
| คะแนนเฉลี่ยรายข้อ | คำนวณ | ✅ |
| การกระจายคะแนน | คำนวณ | ✅ |
| ความเห็นปลายเปิด | `guest_form_responses.value` | ✅ |
| อัตราการตอบ | นับเทียบจำนวน `guests` | ✅ |

> ควร export แบบไม่ระบุตัวตนเป็นค่าตั้งต้น

---

## 9. ชุดคอลัมน์ (document presets)

ทัวร์ไทยกับทัวร์นอกใช้คอลัมน์คนละชุด ต้องเลือกเพิ่ม-ลดเองได้ ทำงาน 2 กลไกคู่กัน

### 9.1 ซ่อนอัตโนมัติ

คอลัมน์ที่ไม่มีลูกทัวร์คนใดกรอกเลย (`0/26`) จะจางลงและไม่ถูกติ๊กตั้งแต่แรก — ทัวร์ไทยที่ไม่มีใครกรอกพาสปอร์ตจึงหายไปเองโดยไม่ต้องตั้งค่า แต่ยังแสดงในรายการพร้อมตัวนับ เพื่อให้เห็นว่าทำไมถึงหาย ไม่ใช่หายเงียบ

### 9.2 Preset เก็บไว้ใช้ซ้ำ

ตารางใหม่ระดับ org ใช้ร่วมกันได้ทั้ง 8 เอกสาร ไม่ต้องเขียนแยกทีละใบ

```
document_presets
  id           uuid
  org_id       uuid  → organizations(id)
  doc_type     text  'rooming_list' | 'guest_manifest' | ...
  name         text  'ทัวร์ในประเทศ' | 'ทัวร์ต่างประเทศ' | 'ส่งประกันภัย'
  columns      jsonb  ดู §10.2
  is_default   boolean
```

### 9.3 แนวกระดาษคำนวณอัตโนมัติ

ไม่ต้องให้ผู้ใช้เลือกตั้ง/นอน — รวมความกว้างคอลัมน์ที่ติ๊กแล้วเทียบกับความกว้างใช้งานของ A4 ถ้าเกินให้สลับเป็นแนวนอนพร้อมแจ้งเหตุผล

### 9.4 ป้ายข้อมูลอ่อนไหว

คอลัมน์ `national_id`, `passport_no`, `medical_condition` ติดป้ายเตือนในหน้าเลือกคอลัมน์ ก่อนพิมพ์ส่งออกนอกองค์กร — ใช้แทนแนวคิด "2 โปรไฟล์ตายตัว" ใน §2 ที่ยืดหยุ่นน้อยกว่า

---

## 10. รูปแบบตาราง (format)

### 10.1 หลักการ

ปัญหาข้อความยาวไม่ใช่การ wrap แต่คือ **แถวสูงไม่เท่ากัน** แก้ที่ความสม่ำเสมอของความสูงแถวเป็นหลัก

| วิธี | ใช้เมื่อ |
|---|---|
| **1. ตรึงความสูง + ตัด 2 บรรทัด** | ค่าตั้งต้นของข้อความอิสระสั้น |
| **2. แถวย่อยเต็มความกว้าง** | ข้อความยาวที่ห้ามหาย · เอกสารสำหรับทีมงาน |
| **3. ซ้อน 2 บรรทัดในช่องเดียว** | ฟิลด์ที่จับคู่กัน ลดจำนวนคอลัมน์ |
| **4. เชิงอรรถท้ายหน้า** | เอกสารส่งภายนอก ตารางต้องสะอาด |

วิธี 3 ลดคอลัมน์ guest manifest จาก 8 เหลือ 5 ทำให้กลับมาพิมพ์แนวตั้งได้

### 10.2 นโยบายรายคอลัมน์

กำหนดที่ระดับคอลัมน์ ไม่ใช่ทั้งตาราง เก็บใน `document_presets.columns`

```json
[
  { "key": "name",              "overflow": "nowrap" },
  { "key": "name_en",           "overflow": "stack", "stackWith": "name" },
  { "key": "gender",            "overflow": "stack", "stackWith": "birthdate" },
  { "key": "national_id",       "overflow": "nowrap", "sensitive": true },
  { "key": "food_allergy",      "overflow": "clamp",   "lines": 2 },
  { "key": "medical_condition", "overflow": "subrow",  "sensitive": true },
  { "key": "note",              "overflow": "footnote" }
]
```

| ชนิดข้อมูล | นโยบาย |
|---|---|
| ชื่อ, เลขบัตร, เบอร์, วันที่, จำนวนเงิน | `nowrap` |
| ชื่อไทย+อังกฤษ, เพศ+วันเกิด, เลขบัตร+พาสปอร์ต | `stack` |
| แพ้อาหาร, ข้อจำกัดด้านอาหาร | `clamp` 2 บรรทัด |
| โรคประจำตัว, หมายเหตุ | `subrow` หรือ `footnote` |

### 10.3 เลือก subrow หรือ footnote ตามผู้รับ

- **ส่งโรงแรม / ร้านอาหาร / ประกัน** → `footnote` เพราะผู้รับสแกนหาเลขห้องหรือชื่อเป็นหลัก ตารางต้องสะอาด
- **หัวหน้าทัวร์ / ใช้ภายใน** → `subrow` เพราะต้องเห็นข้อมูลครบตรงหน้า ไม่ต้องกวาดตาลงท้ายหน้า

ตั้งเป็นค่าตั้งต้นต่อ preset ได้

---

## 11. ตัวอักษร (typography)

### 11.1 ฟอนต์

ฟอนต์ไทยแบบมีหัว อ่านง่ายในเอกสารราชการและเอกสารพิมพ์

```css
--doc-font: 'Noto Sans Thai Looped', 'Google Sans', sans-serif;
```

- **Noto Sans Thai Looped** — รับเฉพาะอักษรไทย `U+0E00-0E7F` เพราะต้องการแบบ **มีหัว** · SIL Open Font License
- **Google Sans** — อักษรละตินและตัวเลข · อยู่บน Google Fonts ภายใต้ SIL Open Font License ใช้เชิงพาณิชย์ได้

Google Sans มีกลิฟไทยด้วย แต่เป็นแบบไม่มีหัว จึงกันไว้ด้วย `unicode-range` ให้ Noto รับช่วงเฉพาะช่วงอักษรไทย

น้ำหนักที่ใช้: 400 ปกติ / 500 หัวตาราง–หัวข้อ เท่านั้น ไม่ใช้ 600–700 เพราะหนาเกินในงานพิมพ์

### 11.2 ต้อง self-host

แอปเป็น PWA มี `vite-plugin-pwa` และ `offlineCache` อยู่แล้ว — ถ้าโหลดฟอนต์จาก CDN หัวหน้าทัวร์สั่งพิมพ์ตอนไม่มีเน็ตจะได้ fallback แทน

วางไฟล์ woff2 ใน `public/fonts/` ประกาศ `@font-face` เอง และเพิ่มเข้า precache list ของ PWA

### 11.3 ค่าที่เหมาะกับงานพิมพ์

อักษรไทยมีสระบนและวรรณยุกต์ ต้องการระยะบรรทัดมากกว่าละติน

| จุด | ค่า |
|---|---|
| ตัวตาราง | 9pt / line-height 1.45 |
| หัวตาราง | 9pt / weight 500 |
| หัวเอกสาร | 13pt / weight 500 |
| ข้อมูลบริษัท, ท้ายกระดาษ | 7.5pt |
| เชิงอรรถ | 7.5pt / line-height 1.6 |
| ต่ำสุดที่ยอมรับ | 7pt — ต่ำกว่านี้สระไทยเริ่มติดกัน |

ตัวเลขทั้งหมดใช้เลขอารบิก ไม่ใช้เลขไทย และเปิด `font-variant-numeric: tabular-nums` ในคอลัมน์ตัวเลขเพื่อให้หลักตรงกัน

---

## สรุปสิ่งที่ต้องเพิ่ม

### A. คอลัมน์ branding ใน `organizations` (บล็อก §0 ทั้งหมด)
ตาราง `organizations` มีอยู่แล้วในฐานข้อมูล (แต่ไม่มีโค้ดไหนใน src/ เรียกใช้) จึงต่อยอดตารางเดิม ไม่สร้าง `orgs` ซ้ำ

### B. Core columns ใน `guests`
ปลดล็อก §1 §2 พร้อมกัน

```
name_en          text     ชื่อ-นามสกุลอังกฤษตามพาสปอร์ต
title            text     คำนำหน้า
birthdate        date
national_id      text     เลขบัตรประชาชน
passport_no      text
passport_expiry  date
nationality      text
insurance_no     text
```

ต้องเพิ่มเข้า `CORE_FIELD_KEYS` ใน `GuestManager.jsx`, seed ลง `form_fields` เป็น `is_core = true`, และเพิ่มเข้า `purge_tour_personal_data`

### C. ระดับรอง (ยังไม่ได้ทำ)

- `buses` — ไกด์ประจำรถ
- `expenses` — สกุลเงินต่างประเทศ, เรทแลก, งบตั้งต้น
- ~~`hotels` — ที่อยู่ภาษาท้องถิ่น~~ ✅ ทำแล้ว (migration `20260803_hotel_info_expansion`) พร้อม `address`, `phone`, `map_url`, `check_in_time`, `morning_call`, `luggage_time`, `meeting_point`, `dinner_*`, `booking_ref`, `staff_notes`, `supplier_id`, `sort_order` และ `hotel_rooms.note`
- `itinerary_items` — รูปประกอบ

---

## สถานะการพัฒนา (2026-08-03)

ทำแล้ว:

| งาน | ไฟล์ |
|---|---|
| Migration A + B + D | `supabase/migrations/20260803_export_documents.sql` |
| Print profile + แนวกระดาษอัตโนมัติ | `src/lib/printProfiles.js` |
| ข้อมูลร่วม + preset + ตัวช่วย format | `src/lib/documentData.js` |
| หัว/ท้ายกระดาษ, ตาราง, เปลือกหน้า, ตัวเลือกคอลัมน์ | `src/components/document/` |
| หน้าตั้งค่าบริษัท | `src/pages/staff/CompanyProfile.jsx` |
| หน้ารวมเอกสาร | `src/pages/staff/DocumentHub.jsx` |
| เอกสารทั้ง 8 ใบ | `src/pages/staff/docs/` |
| ฟอนต์ + PWA precache | `src/index.css`, `vite.config.js`, `public/fonts/README.md` |

รันบนฐานข้อมูลจริงแล้ว (project `iirhnjoqpwwwdgoghnkc`, 2026-08-03):

| รายการ | ผล |
|---|---|
| คอลัมน์ branding ใน `organizations` | 10/10 |
| Core column ใหม่ใน `guests` | 8/8 |
| Core field ในคลังฟอร์ม (ผูกทุกทริป ปิดไว้) | 8 ฟิลด์ × 3 ทริป = 24 · เปิดอยู่ 0 |
| `document_presets` | 4 ชุด |
| วันเกิดที่ย้ายจาก `custom_birthdate` | 78 คน |
| Bucket `org-assets` (public) | สร้างแล้ว |

เหลือทำด้วยมือ:

1. ~~รัน migration~~ ✅
2. ~~สร้าง bucket `org-assets`~~ ✅
3. วางไฟล์ฟอนต์ 4 ไฟล์ตาม `public/fonts/README.md`
4. เข้า `/staff/company-profile` กรอกข้อมูลบริษัท

> **หมายเหตุการค้นพบ:** ตาราง `organizations` มีอยู่ในฐานข้อมูลมาตั้งแต่ต้น (1 แถว)
> แต่ไม่มีไฟล์ไหนใน `src/` เรียกใช้เลย จึงไม่เห็นตอนอ่านโค้ด — แผนเดิมที่จะสร้างตาราง `orgs`
> ถูกเปลี่ยนเป็นต่อยอด `organizations` แทน เพื่อไม่ให้มีตาราง org ซ้ำสองตัว

### D. ตาราง `document_presets` (§9.2)

ทำครั้งเดียว ใช้ได้ทั้ง 8 เอกสาร

### E. ไฟล์ฟอนต์ (§11)

`public/fonts/` — Noto Sans Thai Looped + Google Sans น้ำหนัก 400/500 เป็น woff2 พร้อมเพิ่มเข้า PWA precache

### ลำดับที่แนะนำ

1. ขยาย `organizations` + `<DocumentHeader />` + ฟอนต์ (E)
2. Core columns ใน `guests` (B) — ปลดล็อกเอกสารสำคัญ 2 ใบ
3. `lib/printProfiles.js` — print profile A4 ตั้ง/นอน + นโยบาย overflow (§10)
4. `document_presets` (D) + หน้าเลือกคอลัมน์
5. Rooming list + Guest manifest
6. ที่เหลือทำได้ด้วยข้อมูลที่มีอยู่แล้วทั้งหมด
