// ทริป/องค์กรตั้งต้น — เหลือไว้เป็น fallback ระหว่างทยอย migrate ไป multi-tour
//
// ⚠️ อย่า import ค่าพวกนี้ในโค้ดใหม่
//    ฝั่งลูกทัวร์  → useTourId() จาก lib/TourContext.jsx
//    ฝั่งทีมงาน   → useActiveTourId() จาก lib/staffSession.js
//
// ACTIVE_TOUR_ID / ACTIVE_ORG_ID ถูกลบแล้ว (Design v2 §8 ก้อน 8) — ไม่มีไฟล์ไหนใช้อีก

/** ทริปแรกของระบบ — ใช้เฉพาะ redirect ลิงก์/QR เก่าที่ไม่มี /t/:code และเป็นค่า fallback */
export const LEGACY_TOUR_ID = '00000000-0000-0000-0000-000000000002'
export const LEGACY_ORG_ID = '00000000-0000-0000-0000-000000000001'
