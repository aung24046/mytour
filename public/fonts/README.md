# ฟอนต์สำหรับเอกสาร export

ต้องวางไฟล์ `.woff2` 4 ไฟล์ในโฟลเดอร์นี้ **ด้วยมือ** ก่อนใช้งานฟีเจอร์พิมพ์เอกสาร

## ทำไมต้อง self-host ไม่ใช้ CDN

แอปเป็น PWA (`vite-plugin-pwa` + `lib/offlineCache.js`) หัวหน้าทัวร์อาจสั่งพิมพ์ตอนอยู่หน้างานที่ไม่มีเน็ต
ถ้าโหลดฟอนต์จาก `fonts.gstatic.com` เอกสารจะตกไปใช้ฟอนต์ระบบแทน ตัวอักษรไทยเพี้ยนและความกว้างคอลัมน์ที่คำนวณไว้ใน `lib/printProfiles.js` จะไม่ตรง

ไฟล์ในโฟลเดอร์ `public/` ถูก precache โดย workbox อัตโนมัติ (ดู `vite.config.js` → `workbox.globPatterns`)

## ไฟล์ที่ต้องมี

| ชื่อไฟล์ | ที่มา |
|---|---|
| `NotoSansThaiLooped-Regular.woff2` | [Noto Sans Thai Looped](https://fonts.google.com/noto/specimen/Noto+Sans+Thai+Looped) น้ำหนัก 400 |
| `NotoSansThaiLooped-Medium.woff2` | Noto Sans Thai Looped น้ำหนัก 500 |
| `GoogleSans-Regular.woff2` | [Google Sans](https://fonts.google.com/specimen/Google+Sans) น้ำหนัก 400 |
| `GoogleSans-Medium.woff2` | Google Sans น้ำหนัก 500 |

ทั้งสองตระกูลเป็น SIL Open Font License ใช้เชิงพาณิชย์ได้

> **ทำไมไม่ใช้ Google Sans กับภาษาไทยไปเลย:** Google Sans มีกลิฟไทยก็จริง
> แต่เป็นแบบ **ไม่มีหัว** ซึ่งไม่ตรงกับที่ต้องการ จึงให้ Noto Sans Thai Looped
> รับช่วงเฉพาะช่วง `U+0E00-0E7F` ผ่าน `unicode-range` ใน `src/index.css`
> ส่วนอักษรละตินกับตัวเลขตกไปที่ Google Sans ตามปกติ

## วิธีดาวน์โหลด

1. เปิดลิงก์ในตารางข้างบน กด **Get font** แล้ว **Download all** จะได้ไฟล์ `.ttf` หรือ variable font
2. แปลงเป็น `woff2` ด้วย [google/woff2](https://github.com/google/woff2) หรือเครื่องมือแปลงออนไลน์
3. เปลี่ยนชื่อไฟล์ให้ตรงกับตาราง แล้ววางในโฟลเดอร์นี้

ถ้าเป็น variable font ให้ instance ที่น้ำหนัก 400 กับ 500 ออกมาเป็นไฟล์แยก — subset ให้เหลือเฉพาะ
`U+0E00-0E7F` (ไทย) สำหรับ Noto และ `U+0000-00FF, U+2000-206F` (ละติน + เครื่องหมาย) สำหรับ Google Sans
จะลดขนาดไฟล์ได้มากและ precache เร็วขึ้น

หรือถ้าอยากใช้ variable font ทั้งก้อนโดยไม่ instance แยกไฟล์ ให้แก้ `@font-face` ใน `src/index.css`
เป็นไฟล์เดียวแล้วเปลี่ยน `font-weight: 400` เป็นช่วง `font-weight: 400 500`

## ใช้น้ำหนักไหนบ้าง

เอกสารใช้แค่ **400 ปกติ** และ **500 หัวตาราง/หัวข้อ** — ไม่ใช้ 600–700 เพราะหนาเกินในงานพิมพ์

## ตรวจว่าโหลดจริงหรือยัง

เปิด DevTools → Network → กรอง `Font` แล้วสั่งพิมพ์เอกสาร ควรเห็นไฟล์จาก `/fonts/` ไม่ใช่จาก `fonts.gstatic.com`

ระหว่างที่ยังไม่มีไฟล์ ระบบจะตกไปใช้ `Noto Sans Thai` จาก CDN ที่ `index.css` โหลดอยู่แล้ว
เอกสารยังพิมพ์ได้ แต่จะเป็นฟอนต์ไม่มีหัวและใช้ออฟไลน์ไม่ได้
