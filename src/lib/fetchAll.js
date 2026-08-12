// ดึงข้อมูลจาก Supabase ให้ครบทุกแถว
//
// ⚠️ บั๊กที่ไฟล์นี้แก้ (ส.ค. 2569): PostgREST ของ Supabase จำกัดผลลัพธ์ต่อคำขอไว้ 1000 แถว
//    (ค่า db-max-rows) และถ้าคำสั่งไม่มี ORDER BY ฐานข้อมูลจะคืนแถวชุดไหนก็ได้
//
//    ตาราง guest_form_responses ของทริปจริงมี 1481 แถว โค้ดเดิมดึงทั้งตารางรวดเดียว
//    จึงได้มา 1000 แถว "แบบสุ่มชุด" ทุกครั้ง → เอกสารบางใบเปิดรอบแรกข้อมูลหาย
//    เปิดใหม่อีกรอบกลับมี เพราะได้ชุด 1000 แถวคนละชุด
//
//    อาการนี้จะโผล่อีกเมื่อทริปโตขึ้น ทุกที่ที่ดึง "ทั้งตาราง" จึงต้องผ่านตัวช่วยนี้
//
// วิธีใช้ — ส่ง "ฟังก์ชันสร้าง query" เข้ามา เพราะ query ของ supabase-js ใช้ซ้ำไม่ได้
//
//   const rows = await fetchAllRows(
//     () => supabase.from('guest_form_responses').select('guest_id, field_id, value'),
//     { orderBy: 'field_id' }
//   )

const PAGE_SIZE = 1000

/**
 * @param {() => import('@supabase/supabase-js').PostgrestFilterBuilder} makeQuery
 * @param {{ orderBy?: string, pageSize?: number }} options
 *        ⚠️ orderBy ต้องเป็นคอลัมน์ที่ "ไม่ซ้ำกัน" (primary key) เท่านั้น
 *        ถ้าเรียงด้วยคอลัมน์ที่มีค่าซ้ำได้ ลำดับของแถวที่ค่าเท่ากันจะไม่คงที่ระหว่างคำขอ
 *        แถวตรงรอยต่อของหน้าจะตกหล่นหรือซ้ำได้ — ซึ่งคืออาการเดียวกับบั๊กที่ไฟล์นี้แก้
 * @returns {Promise<{ data: any[], error: any }>}
 */
export async function fetchAllRows(makeQuery, { orderBy = 'id', pageSize = PAGE_SIZE } = {}) {
  const out = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery()
      .order(orderBy, { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) return { data: out, error }

    out.push(...(data ?? []))

    // ได้ไม่เต็มหน้า = หมดแล้ว
    if (!data || data.length < pageSize) return { data: out, error: null }

    // กันวนไม่รู้จบถ้าเซิร์ฟเวอร์ทำตัวแปลก — ทริปใหญ่สุดที่เป็นไปได้ยังห่างจากนี้มาก
    if (out.length > 100000) {
      console.warn('[fetchAllRows] หยุดที่ 100,000 แถว — ตรวจสอบ query ว่ากรองถูกหรือยัง')
      return { data: out, error: null }
    }
  }
}
