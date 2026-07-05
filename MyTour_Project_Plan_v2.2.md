# MyTour — แผนพัฒนา v2.2

> **เอกสารนี้สำหรับ:** อัพเดตงานต่อใน Claude Cowork
> **สถานะปัจจุบัน:** Phase 0, Phase 1, Phase 1.5, Tour Builder, Staff Auth, Deploy เสร็จหมดแล้ว — เหลือ Luggage/Wristband/Print (Section 4) เป็นงานใหญ่ก้อนเดียวที่ยังไม่เริ่ม
> **อัปเดตล่าสุด:** กรกฎาคม 2026
> **Supabase Project ID:** `iirhnjoqpwwwdgoghnkc` (17 ตาราง ยืนยันแล้ว)
> **Deploy:** https://mytour-iota.vercel.app (Vercel Hobby plan — ฟรี เพียงพอสำหรับทริป 80 คน)

---

## 📋 Changelog v2.1 → v2.2

เอกสาร v2.1 ระบุว่า Phase 1.5 ทั้งหมดยังค้าง — ตรวจสอบกับโค้ดจริงแล้วพบว่า **เสร็จหมดทุกข้อ** ตั้งแต่รอบก่อนหน้า นอกจากนี้ยังมีงานอีกก้อนใหญ่ที่ทำเสร็จไปแล้วแต่เอกสาร v2.1 ยังไม่เคยพูดถึงเลย (staff auth, GuestManager, ระบบกู้คืนข้อมูลข้ามเครื่อง, ผังห้อง/รถบัส, บิงโก, location, PWA, deploy จริง)

เอกสารนี้ (v2.2) จึงเขียนสถานะใหม่ทั้งหมดให้ตรงกับของจริง ส่วน **Section 4 (กระเป๋า/wristband/print) ยังคงเป็นงานที่ค้างจริง** — ยังไม่ได้เริ่มเลยสักบรรทัด

---

## 1. สถานะงานที่เสร็จแล้ว ✅ (อัพเดตทั้งหมด)

### Core MVP
- ✅ **Register.jsx** — dynamic form renderer (อ่าน field จาก DB) + **ระบบกู้คืนข้อมูลข้ามเครื่อง** (🆕 ไม่เคยอยู่ใน v2.1): ค้นหาด้วยเบอร์โทร หรือสแกน QR เดิม เพื่อผูก guest_id เข้าเครื่องใหม่ + auto-redirect ถ้าเครื่องนี้เคยลงทะเบียนแล้ว
- ✅ **CheckIn.jsx** — รายชื่อเช็คอินฝั่ง staff + filter ตามรถบัส + QR scan (html5-qrcode) + offline queue/cache
- ✅ **MyQR.jsx** — QR ส่วนตัวลูกทัวร์
- ✅ **Itinerary.jsx** — แผนการเดินทางฝั่ง guest
- ✅ **Broadcast.jsx** — ประกาศด่วน + แสดงผลฝั่ง guest (Realtime)
- ✅ **MyRoom.jsx** — ห้องพักฝั่ง guest
- ✅ **BingoCard.jsx / ShareLocation.jsx** — เกมบิงโกและแชร์พิกัดฝั่ง guest
- ✅ Guest identity persist ข้ามหน้า (localStorage helper `guestSession.js`)
- ✅ Shared constants/config (`ACTIVE_TOUR_ID`, `ACTIVE_ORG_ID`), common UI components, i18n (th/en/zh)

### Tour Builder
- ✅ **FormBuilder.jsx** — staff ออกแบบฟอร์มลงทะเบียนเองได้ + `field_purpose` ครบ (phone/emergency_contact/dietary/medical/generic)
- ✅ Schema: `form_fields` + `guest_form_responses`
- ✅ **ItineraryBuilder.jsx** — จัดการกำหนดการ
- ✅ **SeatMap.jsx** — ผังที่นั่ง + สร้าง/ตั้งค่า/ลบรถบัส + disable seat
- ✅ **RoomMap.jsx** — จัดการโรงแรม/ห้องพัก + filter ตามชั้น/ประเภทห้อง + ค้นหา + layout กระชับ
- ✅ **BingoHost.jsx** — สร้างห้องเกมหลายห้อง (แยกตามรถบัส) + manual input + ดูสถานะผู้เล่นพร้อม/ไม่พร้อม
- ✅ **LocationMonitor.jsx** — ขอ/ดูพิกัดลูกทัวร์แบบ session

### Phase 1.5 (v2.1 บอกว่ายังค้าง — ✅ **เสร็จจริงหมดแล้ว**)
- ✅ `field_purpose` ใน form_fields + FormBuilder รองรับเต็มรูปแบบ
- ✅ **Dashboard ยอดคน** — การ์ดสรุป "มาแล้ว X/Y" + รายชื่อคนขาดพร้อมปุ่มโทร (`tel:`)
- ✅ **CheckIn filter ตามรถบัส/กลุ่ม**
- ✅ เบอร์โทรเป็น `tel:` link ทุกจุด (Dashboard, CheckIn, GuestManager, MyRoom)
- ✅ **DietarySummary.jsx** — สรุปข้อจำกัดอาหาร/สุขภาพ จัดกลุ่มตามคำตอบ สำหรับส่งร้านอาหาร/โรงแรม
- ✅ **Offline resilience** — `offlineCache.js` (cache รายชื่อ) + `offlineQueue.js` (คิวเช็คอิน sync อัตโนมัติเมื่อกลับมาออนไลน์) ใช้งานจริงใน CheckIn.jsx

### 🆕 Staff Auth + จัดการทีมงาน (ทำเสร็จ ยังไม่เคยอยู่ใน v2.1)
- ✅ **Login.jsx** — เลือกชื่อ + กรอก PIN 4 หลัก (ผ่าน RPC `verify_staff_pin` ไม่ส่ง PIN ดิบขึ้น client)
- ✅ **StaffAuthGuard.jsx** — คุมทุกหน้า staff ให้ต้อง login ก่อน (เป็น screen-gate ระดับ UI ตามที่ตกลงกับผู้ใช้ไว้ — **ไม่ใช่ RLS ระดับ database**, ยังมีความเสี่ยงถ้ามีคนรู้เทคนิคยิง API ตรง เป็นข้อจำกัดที่ผู้ใช้รับทราบและเลือกแล้ว)
- ✅ **StaffManager.jsx** — เพิ่ม/ลบ/แก้ไขทีมงานที่ login ได้

### 🆕 GuestManager.jsx (ทำเสร็จ ยังไม่เคยอยู่ใน v2.1)
- ✅ ดูข้อมูลลงทะเบียนครบทุกฟิลด์ของลูกทัวร์ทุกคน (ทั้ง core field และ custom field จาก FormBuilder) + ค้นหา
- ✅ **โหมดแก้ไข** — แก้ไขข้อมูลลูกทัวร์ได้ทุกฟิลด์ รองรับกรณีฟอร์มมีคำถามเพิ่ม/เปลี่ยนแปลงหลังลงทะเบียนไปแล้ว (ใช้ upsert แบบ `(guest_id, field_id)` unique constraint)
- ✅ ปุ่มโทร + ปุ่มลบข้อมูลลูกทัวร์

### 🆕 PWA + Deploy (ทำเสร็จ ยังไม่เคยอยู่ใน v2.1)
- ✅ manifest.json + service worker (`vite-plugin-pwa`) + ไอคอน 192/512
- ✅ Deploy ขึ้น Vercel จริงแล้ว (`mytour-iota.vercel.app`) — env vars ตั้งค่าครบ, `vercel.json` SPA rewrite ป้องกัน 404 บน React Router routes
- ⚠️ ยังไม่ได้รับ report ผลทดสอบจริงบนมือถือจากผู้ใช้ (ลงทะเบียน, สแกน QR, ติดตั้งเป็นแอป, แชร์พิกัด) — เป็น manual test ที่ user ต้องทำเอง

---

## 2. ⚠️ ประเด็นที่ต้องจำไว้ (ยังไม่เปลี่ยนจาก v2.1)

1. ข้อมูลอ่อนไหวอยู่ใน `guest_form_responses` / `guests` — RLS ปัจจุบันเปิด public read/write ทุกตาราง (`qual: true`) ตามการตัดสินใจที่ยืนยันแล้วว่าจะใช้ screen-gate เท่านั้นไม่ทำ RLS จริง เหมาะกับทริปทดลอง 80 คน **แต่ถ้าจะขยายเป็น SaaS ขายจริง ต้องกลับมาทำ RLS ก่อน**
2. Vercel Hobby plan: deploy ได้ 100 ครั้ง/วัน, bandwidth 100GB/เดือน — เกินพอสำหรับสเกลปัจจุบัน แต่ **ห้ามใช้เชิงพาณิชย์** ตาม ToS ถ้าจะขายจริงต้องอัป Pro

---

## 3. แผนงานที่เหลือ (อัพเดต — เหลือ Luggage เป็นก้อนหลัก)

### 🟡 Phase 2 — กระเป๋า + Print (งานหลักที่เหลือ ยังไม่เริ่ม)
- [ ] **ระบบจัดการกระเป๋า** (รายละเอียด Section 4) — schema `luggage` (ตารางที่ 18), LuggageManager.jsx
- [ ] **หน้า Print & Export** (tag กระเป๋า + wristband)
- [ ] **หน้า public `/bag/{tag_code}`** — โชว์แค่ชื่อเล่น+รูป ห้ามโชว์ข้อมูลส่วนตัว
- [ ] **Wristband QR ลูกทัวร์** — ใช้ `qr_token` เดิม ไม่ต้องแก้ schema

### 🟢 Phase 3 — ทดสอบก่อนทริปจริง (⚠️ ควรเริ่มคู่ขนานกับ Phase 2)
- [ ] **ทดสอบสแกน QR (html5-qrcode) บน iPhone จริง** — ความเสี่ยงอันดับ 1 ที่ยังไม่ได้ทดสอบบนอุปกรณ์จริง
- [ ] ทดสอบ Add to Home Screen บน iOS + Android
- [ ] ทดสอบพิมพ์จริง: ต่อ D520BT + driver → พิมพ์จากหน้า print → สแกน tag ที่พิมพ์ออกมา (ครบ loop)
- [ ] ทดสอบความทน: แปะ tag กระเป๋า + ใส่สายรัดจริง 1 วัน เช็คว่า QR ยังสแกนได้
- [ ] ซ้อมโหลด: ทีมงาน 20 คนเปิดพร้อมกัน (ทดสอบ staff PIN login หลายคนพร้อมกันด้วย)
- [ ] เตรียม QR/ลิงก์เข้าทริป 80 คน
- [ ] แผนสำรองกระดาษ 1 ชุด
- [ ] ทดสอบ end-to-end บนมือถือจริงตาม checklist: ลงทะเบียน → กู้คืนข้อมูลข้ามเครื่อง (เบอร์โทร + QR scan) → staff PIN login → GuestManager ดู/แก้ไข → เช็คอิน

### 🔵 Phase 4 — หลังทริป (ตัดสินใจจาก feedback)
- Expense Tracker, Feedback form, Supplier Contacts
- Multi-language เต็มระบบ / Multi-tenant + billing
- RLS จริงถ้าจะขยายเป็น SaaS

---

## 4. ระบบจัดการกระเป๋า + Wristband (คงเดิมจาก v2.1 — ยังไม่เริ่มทำ)

### 4.1 หลักการ: "พิมพ์ QR ก่อน — ผูกเจ้าของทีหลัง" (แบบ luggage tag สายการบิน)

- **ก่อนทริป:** gen tag เปล่า ~150 ดวง (แถวใน DB สถานะ `unassigned`) → batch พิมพ์สติกเกอร์
- **หน้างาน:** staff แปะ tag → สแกน → ระบบเห็นว่าว่าง → ฟอร์ม: ค้นชื่อลูกทัวร์ + ถ่ายรูปกระเป๋า → ผูกเสร็จใน ~20 วิ/ใบ
- **หลังจากนั้น:** ใครสแกน = เห็นว่าของใคร
- ข้อดี: สตาฟหลายคนทำขนานกันได้ ไม่คอขวดที่เครื่องพิมพ์ / เครื่องพิมพ์พกไปหน้างานไว้พิมพ์ **tag ทดแทน** เมื่อหลุด/เปียก/กระเป๋างอกกลางทริป
- ระบบรองรับ flow "ผูกก่อนพิมพ์" ด้วย (พิมพ์เดี่ยวหลังผูกเจ้าของ) — schema เดียวกันรองรับทั้งคู่

### 4.2 Schema: ตาราง `luggage` (ตารางที่ 18 — ยืนยันแล้วว่ายังไม่มีตารางนี้ในฐานข้อมูลปัจจุบัน)

| คอลัมน์ | รายละเอียด |
|---|---|
| `id` | uuid PK |
| `tour_id` | FK → tours |
| `tag_code` | token สั้น unique เช่น `K7F3AB` (สิ่งที่อยู่ใน QR) |
| `guest_id` | FK → guests, **nullable** (null = tag ยังว่าง) |
| `photo_url` | รูปจาก Supabase Storage |
| `status` | `unassigned` / `tagged` / `loaded` / `delivered` / `returned` |
| `last_scanned_at`, `last_location_note` | เช่น "รถคัน 1", "ล็อบบี้โรงแรม" |

- ลูกทัวร์ 1 คนหลายใบ = หลายแถวชี้ guest_id เดียวกัน
- **Storage:** bucket สำหรับรูปกระเป๋า + **บีบอัดฝั่ง client ก่อนอัพโหลด** (canvas ย่อ ~800px, quality 0.7 → ~100KB/รูป)

### 4.3 หน้า LuggageManager.jsx (ฝั่ง staff)

- **Tag Generator:** กรอกจำนวน → insert N แถว unassigned → ไปหน้า print/export
- **โหมดผูกเจ้าของ:** สแกน tag ว่าง → ค้นชื่อ (reuse ตรรกะค้นหาแบบ GuestManager) + ถ่ายรูป → บันทึก
- **โหมดโหลดขึ้นรถ (loading checklist):** สแกนรัว ๆ เปลี่ยน status เป็น `loaded` อัตโนมัติ → Dashboard โชว์ "โหลดแล้ว 143/150 ขาด 7 ใบ ของใคร" — ตอบคำถาม "กระเป๋าครบยัง?" ก่อนรถออก
- **ลิสต์ + filter** ตาม status/รถ/เจ้าของ

**หน้า public `/bag/{tag_code}`:** คนทั่วไปสแกนเห็นแค่ **ชื่อเล่น + รูปกระเป๋า** (พอยืนยันว่า "ใช่ของฉัน") — **ห้ามโชว์เบอร์โทร/ชื่อเต็ม** เพราะ QR อยู่บนกระเป๋าในที่สาธารณะ / staff ที่ login เห็นข้อมูลเต็ม
**ฝั่ง guest:** ไม่ต้องมีหน้าใหม่ แค่แสดงกระเป๋าตัวเอง (จำนวน+รูป) ในหน้าโปรไฟล์ — อาจต่อยอดจากหน้า MyQR/MyRoom ที่มีอยู่แล้ว

### 4.4 Wristband QR ลูกทัวร์

- ใช้ `qr_token` ที่มีอยู่แล้วใน `guests` — QR บนสายรัด = ตัวเดียวกับหน้า MyQR ระบบ CheckIn สแกนได้ทันทีโดยไม่ต้องแก้อะไร
- แก้ปัญหา: มือถือแบตหมด, ผู้สูงอายุ/เด็กไม่ถนัดเปิดแอป, เช็คอินขึ้นรถเร็วขึ้นมาก
- **วิธีทำ:** พิมพ์สติกเกอร์กันน้ำ (~30×20mm, QR ≥15mm + ชื่อเล่น) แปะบน**สายรัด Tyvek เปล่า** (แบบงานอีเวนต์ ราคาถูก หาซื้อง่าย) — D520BT ไม่รับ media สายรัดโดยตรง
- URL บนสายรัดเปิดหน้าที่ไม่โชว์ข้อมูลส่วนตัว (หลักเดียวกับ tag กระเป๋า) การเช็คอินเกิดเฉพาะเมื่อ staff ที่ login สแกน

### 4.5 หน้า Print & Export (ใช้ร่วมกัน 2 งาน)

- Route `/staff/print` เลือกโหมด: tag กระเป๋า / wristband ลูกทัวร์
- Render label ขนาดจริงด้วย CSS: `@page { size: <กว้าง>mm <สูง>mm; margin: 0 }` — **ต้อง lock ขนาดหลังได้ label จริงมาแล้ว**
- ปุ่ม: พิมพ์เดี่ยว / พิมพ์ชุด (batch) / **Export CSV** (ชื่อ + URL) เผื่อพิมพ์ผ่านแอป Labelife หรือเครื่องอื่นในอนาคต
- ใช้ `qrcode.react` ที่มีอยู่แล้ว (ใช้ใน MyQR.jsx) ไม่เพิ่ม dependency
- **สำคัญ:** QR ต้องชี้ URL ที่ token มีอยู่ใน DB แล้วเสมอ ห้าม gen เลขลอย ๆ จากแอปเครื่องพิมพ์

**ประมาณงาน:** schema + LuggageManager + print page ≈ 1.5–2 วันใน Cowork (ไม่เปลี่ยนจาก v2.1)

---

## 5. งานด้านดีไซน์

**ทำ design system เบา ๆ ตอนนี้ / polish ละเอียดท้าย Phase 3**

ยังไม่ได้ทำเป็นทางการ (ระบบปัจจุบันใช้ Tailwind utility class กระจายในแต่ละไฟล์ ไม่มี design token กลาง):
- [ ] Design tokens ใน Tailwind config (สี, typography, spacing, radius)
- [ ] มาตรฐาน component: ปุ่ม, card, bottom sheet, input, badge สถานะ (ปัจจุบันมี `Button.jsx`, `Card.jsx`, `BottomSheet.jsx` แล้วแต่ยังไม่ได้ทำ token กลาง)
- [ ] Mobile-first หน้างาน: ปุ่มใหญ่ contrast สูง อ่านได้กลางแดด
- [ ] ไอคอนแอป — ✅ ทำแล้ว (192×192, 512×512)

รอแอปนิ่ง: empty states, ภาพประกอบ, animation

---

## 6. สิ่งที่ต้องเตรียม (Assets & Config)

- [x] ชื่อทริป + กำหนดการจริง (ผ่าน ItineraryBuilder ✅)
- [ ] รายชื่อทีมงาน 20 คน + role + แบ่งกลุ่มตามรถ (โครงสร้างรองรับแล้วผ่าน StaffManager + SeatMap แต่ยังไม่ได้กรอกข้อมูลจริง)
- [ ] ตั้งค่ารถบัสจริง (ผ่าน Bus Config UI ✅ พร้อมใช้ แต่ยังไม่ได้กรอกข้อมูลจริง)
- [ ] ข้อมูลโรงแรม + จำนวนห้อง (ผ่าน RoomMap ✅ พร้อมใช้ แต่ยังไม่ได้กรอกข้อมูลจริง)
- [x] ไอคอนแอป
- [ ] **Label สติกเกอร์ thermal แบบกันน้ำ/กันขีดข่วน:**
  - Tag กระเป๋า: ~40×30mm หรือ 50×30mm (QR ~22mm + ชื่อเล่น + เลขลำดับ) — สั่งเผื่อ ~200 ดวง
  - Wristband: ~30×20mm (QR ≥15mm + ชื่อเล่น) — สั่งเผื่อ ~120 ดวง
  - เลือกเกรดกันน้ำ/กัน UV (thermal โดยตรงจางเมื่อโดนแดด)
- [ ] **สายรัดข้อมือ Tyvek เปล่า** ~100 เส้น (เผื่อ 80 คน + สำรอง)
- [ ] **ติดตั้ง driver AIMO D520BT** บนโน้ตบุ๊กที่จะใช้พิมพ์ + ทดสอบพิมพ์จากเว็บ

---

## 7. ข้อกำหนดเครื่องพิมพ์ (คงเดิมจาก v2.1)

### เครื่องหลัก: AIMO D520BT
- **USB → system printer เต็มรูปแบบ:** ต่อ USB กับคอม (Windows/Mac/ChromeOS) + ติดตั้ง driver → สั่งพิมพ์จากหน้าเว็บด้วย `window.print()` ได้ตรง ๆ ไม่ต้องผ่านแอป
- **Bluetooth ผูกกับแอป Labelife เท่านั้น** (pair ในแอป ไม่ใช่ OS) → พิมพ์จากมือถือผ่าน BT ต้องผ่านแอป
- สเปค: label กว้าง 1"–4.6", ความเร็วสูงสุด 150mm/s (~72 label/นาที) — batch 150 ดวงจบในไม่กี่นาที

### Flow การพิมพ์
1. **Batch ล่วงหน้า (ก่อนทริป):** โน้ตบุ๊ก + USB → หน้า print ของระบบ → พิมพ์ tag กระเป๋า 150 + wristband 80 รวดเดียว
2. **พิมพ์สดหน้างาน (tag ทดแทน):** พกโน้ตบุ๊ก + สาย USB (เสถียรสุด) / ทางรอง: ปุ่ม "เซฟ QR เป็นรูป" → พิมพ์ผ่านแอป Labelife

### เครื่องสำรอง (ถ้าจะซื้อเพิ่ม — optional)
- **Xprinter XP-420B (~1,500–2,000฿):** มีศูนย์ไทย, driver Win/Mac, รองรับ label 25.4mm ขึ้นไป — เป็นเครื่องที่สองไว้แยกม้วน (เครื่องหนึ่งม้วนเล็ก อีกเครื่องม้วนใหญ่ ไม่ต้องสลับหน้างาน) + เป็นสำรอง
- ตัวเลือกอื่น: Xprinter XP-350B (~1,000–1,500฿ สำหรับ label เล็กอย่างเดียว), Brother QL-820NWB (~6,000–8,000฿ ถ้าต้องการ AirPrint พิมพ์จาก iPhone ตรง ๆ)

---

## 8. ลำดับงานแนะนำใน Cowork (รอบถัดไป) — อัพเดตตามสถานะจริง

1. **ทดสอบ QR scan บน iPhone จริงก่อนเลย** — ยังไม่เคยทดสอบบนอุปกรณ์จริง เสี่ยงสูงสุด
2. Schema `luggage` + Storage bucket + LuggageManager (Tag Generator → ผูกเจ้าของ → โหมดโหลดขึ้นรถ)
3. หน้า Print & Export (รอขนาด label จริงก่อน lock CSS) + หน้า public `/bag/{code}`
4. Wristband QR (ใช้ qr_token เดิม ไม่ต้องแก้ schema — ทำได้เร็ว)
5. Design tokens + ปรับ common components ให้ใช้ token กลาง
6. ทดสอบพิมพ์จริงครบ loop (D520BT + driver + label จริง)
7. ซ้อมโหลด: staff 20 คน login พร้อมกัน + กรอกข้อมูลจริง (ทีมงาน, รถบัส, โรงแรม)
8. ทดสอบ end-to-end เต็มระบบบนมือถือจริงตาม checklist ใน Section 3, Phase 3
9. เตรียมของจริงตาม Section 6 (label, สายรัด, driver)
10. แผนสำรองกระดาษ 1 ชุด

---

## 9. จุดที่ต้องระวัง

1. **html5-qrcode บน iOS Safari** — ความเสี่ยงอันดับ 1 ยังไม่เคยทดสอบบนอุปกรณ์จริง ทำก่อนเลย
2. **เน็ตหลุดหน้างาน** — CheckIn มี offline queue แล้ว ✅ / ฟีเจอร์อื่น (GuestManager, Luggage ที่จะสร้าง) ยังไม่มี offline fallback — ต้องคิดก่อนใช้งานจริงว่าถ้าเน็ตหลุดจะเกิดอะไรขึ้น
3. **RLS เปิด public ทุกตาราง** — เป็นการตัดสินใจที่ยืนยันแล้วสำหรับทริปทดลอง (screen-gate พอ) แต่ต้องกลับมาทำจริงก่อนขยายเป็น SaaS
4. **QR สาธารณะ (tag กระเป๋า/สายรัดที่จะสร้าง)** — หน้า public ห้ามมีชื่อเต็ม/เบอร์โทร
5. **ขนาด label ต้องได้ของจริงก่อนเขียน CSS print** — สั่ง label ก่อน แล้วค่อย lock `@page`
6. **Thermal จางเมื่อโดนแดด/เสียดสี** — ใช้ label เกรดกันน้ำ/UV + ทดสอบใส่จริง 1 วันก่อนทริป
7. **PWA push บน iOS จำกัด** — พึ่ง Realtime ตอนเปิดแอป
8. **PDPA** — consent ก่อนแชร์พิกัด + ลบ location/response/รูปกระเป๋าหลังจบทริป
9. **Vercel Hobby ห้ามใช้เชิงพาณิชย์** — พอสำหรับทริปทดลองนี้ ถ้าจะขายเป็น SaaS ต้องอัป Pro ($20/เดือน/user)

---

*เอกสารนี้เป็น living document — ปรับได้ตามสถานการณ์จริง*
