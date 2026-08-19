// ตรรกะ "ปุ่มหน้าหลักแบบลอยต้องโผล่ไหม" — แยกออกมาจาก component เพราะมีคนใช้ 2 ที่:
//   1. HomeButton.jsx  — ตัวปุ่มเอง
//   2. App.jsx         — เว้นที่ว่างล่างจอให้ปุ่ม จะได้ไม่ทับเนื้อหาแถวสุดท้าย
//
// เดิม App.jsx ไม่รู้ว่าปุ่มโผล่อยู่หรือเปล่า แต่ละหน้าจึงต้องไล่ใส่ pb-28 กันเอง
// ซึ่งมีแค่ 3 หน้าที่ทำ อีก 20 กว่าหน้าเลยโดนปุ่มบังแถวล่างสุดมาตลอด

// หน้าลูกทัวร์ที่ไม่ต้องมีปุ่มลอย — มีแถบเมนูล่างอยู่แล้ว หรือเป็นหน้าแรกเอง
// เทียบเป็น "หน้าอะไร" ไม่ใช่ path เต็ม เพราะหน้า guest มี prefix /t/:code
const HIDE_GUEST_PAGES = [
  '', // หน้าแรกของทริป
  'itinerary',
  'my-qr',
  'my-room',
  'my-seat',
  'bingo',
  // ส่วนเกม — มีปุ่มย้อนกลับบนหัวเรื่องแล้ว (BackButton) และปุ่มลอยไปทับ
  // แถบเมนูล่าง/ปุ่มในเกมด้วย
  'games',
  'lucky-draw',
  'quiz',
  'share-location',
  'trip-guide',
  'feedback',
  'edit-profile',
  'sos',
]
const HIDE_EXACT = ['/', '/join', '/staff', '/staff/login']

/**
 * @returns {{ visible: boolean, target: string }}
 */
export function resolveHomeButton(pathname = '/') {
  // ฝั่งทีมงานใช้ StaffHeader (แถบหัวเรื่องแบบ sticky) ที่มีปุ่มย้อนกลับในตัวแล้ว
  // ปุ่มลอยจึงไม่ต้องโผล่ซ้ำ — และนี่คือต้นเหตุของอาการ "ปุ่มบังข้อความ" เกือบทั้งหมด
  if (pathname.startsWith('/staff')) return { visible: false, target: '/staff' }

  if (HIDE_EXACT.includes(pathname)) return { visible: false, target: '/' }

  // /t/:code/<sub> → เอา <sub> มาเทียบ
  const tourMatch = /^\/t\/([^/]+)(?:\/(.*))?$/.exec(pathname)
  if (tourMatch && HIDE_GUEST_PAGES.includes(tourMatch[2] ?? '')) {
    return { visible: false, target: `/t/${tourMatch[1]}` }
  }

  return { visible: true, target: tourMatch ? `/t/${tourMatch[1]}` : '/' }
}

// ความสูงที่ปุ่มกินจริง (สูง ~48px + ระยะห่างล่าง 16px + เผื่อ safe area ของ iPhone)
export const HOME_BUTTON_SPACE = 'calc(4.75rem + env(safe-area-inset-bottom))'
