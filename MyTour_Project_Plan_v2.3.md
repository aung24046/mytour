# MyTour — แผนพัฒนา v2.3

> **เอกสารนี้สำหรับ:** อัพเดตงานต่อใน Claude Cowork
> **สถานะปัจจุบัน:** Phase 0–3 เสร็จหมดแล้ว (รวม Luggage/Wristband/Print) — งานถัดไปคือ **Phase 4A (5 ระบบก่อนทริป)** ทริปจริงอีก ~1 เดือน
> **เป้าหมายระยะยาว:** เตรียมขายเป็น SaaS — ทริป 80 คนนี้คือทริปทดสอบ/เดโม่
> **อัปเดตล่าสุด:** กรกฎาคม 2026
> **Supabase Project ID:** `iirhnjoqpwwwdgoghnkc`
> **Deploy:** https://mytour-iota.vercel.app (Vercel Hobby — พอสำหรับทริปทดลอง ห้ามใช้เชิงพาณิชย์)

---

## 📋 Changelog v2.2 → v2.3

- Phase 2 (Luggage + Print) **เสร็จแล้ว**: `LuggageManager.jsx`, `PrintExport.jsx`, `BagLookup.jsx` อยู่ในโค้ดจริง + Phase 3 (ทดสอบก่อนทริป) จบแล้ว
- วิเคราะห์ Phase 4 ใหม่ทั้งหมดตามเป้าหมาย "เตรียมขาย + ทดสอบในทริปที่จะถึง":
  - **Phase 4A (ก่อนทริป):** 5 ระบบ — SOS+เบอร์ฉุกเฉิน, คู่มือทริป, Feedback, Expense Tracker, Supplier Contacts (สเปคเต็มใน Section 3)
  - **Phase 4B (หลังทริป):** แทร็ค SaaS — multi-tour, Auth จริง, RLS, multi-tenant, billing
  - **ตัดออก:** Sound Effect Panel/Kahoot (มีบิงโกแล้ว ไม่ใช่ differentiator), Currency/Weather/แปลภาษา (มือถือทำได้เอง + ต้องพึ่ง API ภายนอก)

---

## 1. สถานะงานที่เสร็จแล้ว ✅

### Core MVP + Tour Builder + Staff Auth + PWA/Deploy
(รายละเอียดเต็มดู v2.2 — สรุป: Register + กู้คืนข้ามเครื่อง, CheckIn + offline queue, MyQR, Itinerary, Broadcast, MyRoom, Bingo, ShareLocation, FormBuilder, ItineraryBuilder, SeatMap, RoomMap, BingoHost, LocationMonitor, Dashboard, DietarySummary, GuestManager, StaffManager, Login PIN + StaffAuthGuard, i18n th/en/zh, PWA + Vercel deploy)

### 🆕 Phase 2 — Luggage + Print (เสร็จตั้งแต่รอบก่อน v2.3)
- ✅ `LuggageManager.jsx` — Tag Generator / ผูกเจ้าของ / โหมดโหลดขึ้นรถ
- ✅ `PrintExport.jsx` — พิมพ์ tag กระเป๋า + wristband
- ✅ `BagLookup.jsx` — หน้า public `/bag/{tag_code}` (ชื่อเล่น+รูปเท่านั้น)

### 🆕 Phase 3 — ทดสอบก่อนทริป: จบแล้ว

---

## 2. ⚠️ ประเด็นที่ต้องจำไว้ (ยกมาจาก v2.2 — ยังจริงทุกข้อ)

1. **RLS เปิด public ทุกตาราง** (screen-gate เท่านั้น) — โอเคสำหรับทริปทดลอง แต่**ต้องทำ RLS จริงก่อนขาย** (อยู่ใน Phase 4B)
2. **Vercel Hobby ห้ามใช้เชิงพาณิชย์** — ต้องอัป Pro ตอนขายจริง
3. **PDPA** — consent พิกัด + ลบ location/response/รูป หลังจบทริป
4. **PWA push บน iOS จำกัด** — SOS ฝั่ง staff ต้องเปิด Dashboard/SOSMonitor ค้างไว้ (Realtime)
5. ตารางใหม่ทุกตารางใน Phase 4A **ใส่ tour_id/org_id ตั้งแต่แรก** → ตอนทำ RLS/multi-tenant ไม่ต้องรื้อ

---

## 3. 🟢 Phase 4A — 5 ระบบก่อนทริป (~5.5–6 วันงาน)

**ลำดับทำ: 1 → 3 → 2 → 5 → 4** (SOS+Feedback ต้องทันทริป / คู่มือทริปก้อนใหญ่รองลงมา / Supplier+Expense ไม่ผูกกับวันทริป)

### 3.1 SOS + เบอร์ฉุกเฉิน (~1 วัน)

**Schema — `emergency_contacts`:**

| คอลัมน์ | รายละเอียด |
|---|---|
| `id`, `tour_id` | uuid PK, FK → tours |
| `label`, `phone` | ชื่อที่แสดง + เบอร์ |
| `category` | `guide` / `staff` / `government` / `hospital` / `other` |
| `sort_order`, `is_active` | เรียงลำดับ + เปิด/ปิด |

**Schema — `sos_alerts`:**

| คอลัมน์ | รายละเอียด |
|---|---|
| `id`, `tour_id`, `guest_id` | uuid PK, FK |
| `lat`, `lng`, `accuracy` | พิกัดตอนกด |
| `note` | ข้อความจากลูกทัวร์ (optional) |
| `status` | `open` / `acknowledged` / `resolved` |
| `created_at`, `resolved_by` | เวลา + staff ที่ปิดเคส |

- **Guest — `SOS.jsx`:** ปุ่ม SOS ใหญ่ **กดค้าง 2 วิ** (กันกดพลาด) → ส่งพิกัด (reuse ตรรกะ ShareLocation) + ลิสต์ปุ่มโทร `tel:` จัดกลุ่มตาม category
- **Staff — `SOSMonitor.jsx`:** ลิสต์ alert (Realtime), ลิงก์ Google Maps, ปุ่มโทรกลับ, acknowledge/resolve + **badge สีแดงบน Dashboard** เมื่อมี alert เปิดค้าง
- **จัดการเบอร์:** seed default (191 ตำรวจ, 1669 แพทย์ฉุกเฉิน, 1155 ตำรวจท่องเที่ยว, 1672 ททท.) + staff เพิ่ม/ลบต่อทริป (เช่น รพ.ใกล้โรงแรมแต่ละคืน) / **เบอร์ไกด์ดึงจากตาราง staff ผ่าน flag `show_to_guest`** — ไม่กรอกซ้ำ ไม่มีข้อมูลสองชุด
- **Offline (สำคัญสุด):** cache เบอร์ทั้งหมดด้วย `offlineCache.js` — หน้านี้ห้ามพังตอนเน็ตหลุด, `tel:` ทำงานได้โดยไม่มีเน็ต, ถ้าส่ง SOS ไม่สำเร็จ → fallback แสดง "โทรหาไกด์เลย" ชัด ๆ

### 3.2 Feedback Form (~1 วัน)

**แนวทาง: reuse เครื่อง FormBuilder ทั้งดุ้น — ไม่สร้างระบบฟอร์มใหม่**
- เพิ่มคอลัมน์ `form_type` (`registration` / `feedback`) ใน `form_fields`
- เพิ่ม field type ใหม่ **"rating"** (ดาว 1–5) ใน renderer
- คำตอบลง `guest_form_responses` เดิม (แยกด้วย form_type ของ field)

- **Staff — FormBuilder เดิม:** สลับโหมดสร้างฟอร์มลงทะเบียน / ฟอร์ม feedback
- **Guest — `Feedback.jsx`:** ดาวต่อหัวข้อ (ที่พัก/อาหาร/ไกด์/ภาพรวม — staff กำหนดเองได้) + ช่องข้อความ, ผูก guest_id จาก session, ส่งครั้งเดียวแก้ไขได้จนปิดฟอร์ม
- **Staff — `FeedbackSummary.jsx`:** คะแนนเฉลี่ยต่อหัวข้อ + กราฟแท่ง + ลิสต์คอมเมนต์ + **export CSV**
- **การแจก:** ส่งลิงก์ผ่าน Broadcast วันสุดท้าย + banner ในหน้า guest
- **มูลค่าต่อการขาย:** ผลคะแนนจากทริปจริง = testimonial

### 3.3 คู่มือทริป — Trip Guide (~2 วัน, ก้อนใหญ่สุด)

**หลักการ: เนื้อหาทั้งหมดอยู่ใน DB ไม่ใช่ในโค้ด** → clone เป็น template ข้ามทริปได้ (จุดขายตอนเป็น SaaS)

**Schema — `guide_articles`:**

| คอลัมน์ | รายละเอียด |
|---|---|
| `id`, `tour_id` | uuid PK, FK |
| `category` | `place` / `knowledge` / `culture` / `tips` |
| `title`, `body` | หัวข้อ + เนื้อหา (markdown) |
| `image_url` | รูปจาก Storage (บีบอัด client เหมือนรูปกระเป๋า) |
| `itinerary_item_id` | **nullable** — ผูกบทความกับสถานที่ในกำหนดการ |
| `sort_order`, `is_published` | เรียง + toggle เผยแพร่ |

**Schema — `phrasebook_entries`:**

| คอลัมน์ | รายละเอียด |
|---|---|
| `id`, `tour_id` | uuid PK, FK |
| `category` | หมวดศัพท์ (ทักทาย/อาหาร/ฉุกเฉิน ฯลฯ) |
| `phrase`, `translation`, `pronunciation` | คำ + คำแปล + คำอ่าน |
| `sort_order` | เรียงลำดับ |

- **Guest — `TripGuide.jsx`:** 3 แท็บ — สถานที่ (การ์ดตามกำหนดการ) / ความรู้ทั่วไป / คลังศัพท์ (การ์ดค้นหาได้)
- **Guest — `Itinerary.jsx` เดิม:** item ที่มีบทความผูก → แตะขยายดูรายละเอียด + รูปได้ทันที
- **Staff — `GuideBuilder.jsx`:** CRUD บทความ (โครงเดียวกับ ItineraryBuilder) + จัดการ phrasebook ในหน้าเดียวกัน + toggle publish
- **Offline:** cache บทความ + ศัพท์ตอนเปิดครั้งแรก — อ่านบนรถที่เน็ตหลุดได้
- **i18n:** ใช้โครง th/en/zh ที่มี — phrasebook รองรับได้ทั้งทัวร์คนไทย (ศัพท์ท้องถิ่น) และ inbound จีน (ศัพท์ไทย + pinyin) ด้วยตารางเดียวกัน

### 3.4 Supplier Contacts (~0.5–1 วัน)

**Schema — `suppliers` (⚠️ scope ที่ `org_id` ไม่ใช่ tour_id — คลังกลางใช้ซ้ำข้ามทริป):**

| คอลัมน์ | รายละเอียด |
|---|---|
| `id`, `org_id` | uuid PK, FK → org |
| `name`, `category` | ชื่อ + `hotel` / `restaurant` / `transport` / `attraction` / `shop` / `other` |
| `contact_person`, `phone`, `line_id` | ผู้ติดต่อ + ช่องทาง |
| `address`, `notes` | ที่อยู่ + โน้ต ("ห้องเก่า อาหารดี") |
| `rating` | 1–5 ภายในองค์กร |
| `is_active` | ยังใช้อยู่/เลิกใช้ |

**Schema — `tour_suppliers`:** junction (`tour_id`, `supplier_id`) — บันทึกว่าทริปไหนใช้เจ้าไหน

- **Staff — `SupplierManager.jsx`:** CRUD + filter หมวด + ค้นหา + ปุ่มโทร/LINE + ให้ rating/โน้ตหลังทริป
- **จุดที่เกินระดับ "สมุดเบอร์":** ผูกกับทริป + rating → ทริปหน้า clone รายชื่อเจ้าที่เวิร์คได้ทันที (สอดคล้อง multi-tour ใน 4B)
- Guest ไม่เห็นหน้านี้เลย

### 3.5 Expense Tracker (~1 วัน)

**Schema — `expenses`:**

| คอลัมน์ | รายละเอียด |
|---|---|
| `id`, `tour_id` | uuid PK, FK |
| `amount` | จำนวนเงิน |
| `category` | `food` / `transport` / `accommodation` / `entrance` / `tip` / `misc` |
| `description` | รายละเอียด |
| `receipt_url` | รูปใบเสร็จ (nullable, Storage + บีบอัด client) |
| `paid_by` | FK → staff (คนจ่าย) |
| `expense_date`, `created_by` | วันที่จ่าย + คนบันทึก |

- **Staff — `ExpenseTracker.jsx`:** ฟอร์มบันทึกเร็ว mobile-first (จำนวน + หมวด + ถ่ายรูปใบเสร็จ) / ลิสต์ filter หมวด/วัน/คนจ่าย / การ์ดสรุปรวมทั้งทริป + แยกหมวด / **export CSV**
- **Offline (สำคัญ):** ใช้ `offlineQueue.js` — บันทึกหน้างานแล้ว sync ทีหลัง เพราะจุดจ่ายเงินมักเน็ตแย่
- **ไม่ทำจนกว่าลูกค้าขอ:** งบเทียบแผน, อนุมัติหลายขั้น, หลายสกุลเงิน

---

## 4. 🔵 Phase 4B — แทร็ค SaaS (หลังทริป, ทำตามลำดับห้ามข้าม)

### 4.1 Tour Builder + Dashboard (สำคัญสุด — เปลี่ยน "แอปทริปเดียว" เป็น "product")
ปัญหาจริงคือ `ACTIVE_TOUR_ID` / `ACTIVE_ORG_ID` hardcode ใน `constants.js`
- [ ] หน้า "สร้างทริปใหม่" + ตัวเลือกทริป (tour switcher)
- [ ] **Clone ทริปเดิมเป็น template** — ฟอร์ม/กำหนดการ/ผังรถ/คู่มือทริป/supplier list (บริษัททัวร์จัดทริปซ้ำรูปแบบเดิมบ่อย = จุดขายหลัก)
- [ ] Dashboard รวมต่อทริป: เช็คอิน/ห้อง/กระเป๋า/อาหาร/SOS ในหน้าเดียว
- [ ] Archive ทริปจบ + **ปุ่มลบข้อมูลส่วนตัว** (location/รูป/responses) — PDPA + เป็นจุดขาย

### 4.2 Auth + RLS + Multi-tenant + Billing (ตามลำดับ)
1. [ ] **Supabase Auth จริง** แทน PIN screen-gate (PIN ปัจจุบันยิง API ตรงได้ — ขายไม่ได้เด็ดขาด)
2. [ ] **RLS ทุกตาราง** scope ด้วย org_id
3. [ ] ตาราง `orgs` / `memberships`
4. [ ] **Billing — เริ่มเก็บเงินมือ/โอนต่อทริป** อย่าลงทุน Stripe/Omise recurring จนมีลูกค้าจ่ายจริง 2–3 ราย
5. [ ] Vercel Pro ($20/เดือน/user)

### 4.3 ทำต่อเมื่อลูกค้าขอ
- Multi-language เต็มระบบ — เฉพาะ*ฝั่ง guest*ก่อน (Register, Itinerary, Broadcast, MyRoom, TripGuide, /bag) ฝั่ง staff คงไทยจนมีลูกค้าที่ทีมงานไม่ใช่คนไทย
- Expense Tracker ขั้นสูง (งบเทียบแผน, หลายสกุลเงิน)

### 4.4 ❌ ตัดออกแล้ว (ตัดสินใจ ก.ค. 2026)
- **Sound Effect Panel / Kahoot** — มีบิงโกแล้ว, Kahoot จริงใช้ฟรีได้, เพิ่ม maintenance โดยไม่ใช่ differentiator
- **Currency / Weather / แปลภาษา** — มือถือทำได้เอง, ต้องพึ่ง API ภายนอก (คีย์/ค่าใช้จ่าย/rate limit), ไม่มีใครซื้อแอปทัวร์เพราะสิ่งนี้

---

## 5. งานด้านดีไซน์ (คงเดิมจาก v2.2)

- [ ] Design tokens ใน Tailwind config (สี, typography, spacing, radius)
- [ ] มาตรฐาน component กลาง (มี `Button.jsx`, `Card.jsx`, `BottomSheet.jsx` แล้ว ยังไม่มี token กลาง)
- [ ] Mobile-first หน้างาน: ปุ่มใหญ่ contrast สูง อ่านกลางแดด
- รอแอปนิ่ง: empty states, ภาพประกอบ, animation

---

## 6. ลำดับงานแนะนำใน Cowork (รอบถัดไป)

1. **SOS + เบอร์ฉุกเฉิน** (schema 2 ตาราง + SOS.jsx + SOSMonitor.jsx + seed เบอร์ default)
2. **Feedback** (form_type + rating field + Feedback.jsx + FeedbackSummary.jsx)
3. **คู่มือทริป** (schema 2 ตาราง + TripGuide.jsx + GuideBuilder.jsx + ผูก Itinerary)
4. **Supplier Contacts** (schema 2 ตาราง + SupplierManager.jsx)
5. **Expense Tracker** (schema + ExpenseTracker.jsx + offline queue)
6. กรอกเนื้อหาจริง: บทความคู่มือ, ศัพท์, เบอร์ฉุกเฉินต่อทริป
7. ทดสอบ offline ทุกระบบใหม่ (โดยเฉพาะ SOS) บนมือถือจริง
8. หลังทริป → เริ่ม Phase 4B ตาม Section 4

---

## 7. จุดที่ต้องระวัง (เพิ่มจาก v2.2)

1. **หน้า SOS ห้ามพังตอนออฟไลน์** — ทดสอบโหมดเครื่องบิน + เปิดหน้า SOS ให้ได้ก่อนทริป
2. **iOS ไม่มี push ตอนแอปปิด** — ทีมงานอย่างน้อย 1 คนต้องเปิด SOSMonitor ค้างไว้ตลอด + ตั้งกติกาว่าใคร
3. **เนื้อหาคู่มือทริปต้องอยู่ใน DB เท่านั้น** — ห้าม hardcode ในโค้ดเด็ดขาด
4. **ตารางใหม่ทุกตารางใส่ tour_id (suppliers ใช้ org_id)** — เตรียมทาง RLS/multi-tenant
5. ข้อระวังเดิมจาก v2.2 ยังจริงทุกข้อ: PDPA, thermal จางแดด, Vercel Hobby, html5-qrcode iOS

---

*เอกสารนี้เป็น living document — v2.2 เก็บไว้เป็นประวัติ ใช้ v2.3 เป็นหลักตั้งแต่นี้*
