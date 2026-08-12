import { fetchAllRows } from '../fetchAll.js'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — ได้ ${JSON.stringify(a)}`)

// จำลอง query builder ของ supabase-js เท่าที่ fetchAllRows ใช้
function makeFakeTable(rows, { onRequest } = {}) {
  return () => {
    const state = {}
    const builder = {
      order(column, { ascending }) {
        state.order = { column, ascending }
        return builder
      },
      range(from, to) {
        onRequest?.({ from, to, order: state.order })
        const sorted = [...rows].sort((a, b) =>
          String(a[state.order.column]).localeCompare(String(b[state.order.column]))
        )
        return Promise.resolve({ data: sorted.slice(from, to + 1), error: null })
      },
      then(resolve) {
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      },
    }
    return builder
  }
}

const rows = Array.from({ length: 2350 }, (_, i) => ({
  id: String(i).padStart(5, '0'),
  value: `v${i}`,
}))

console.log('── ดึงครบทุกแถวแม้เกินเพดาน 1000')
const requests = []
const { data, error } = await fetchAllRows(makeFakeTable(rows, { onRequest: (r) => requests.push(r) }))
ok(error === null, 'ไม่มี error')
eq(data.length, 2350, 'ได้ครบทุกแถว')
eq(new Set(data.map((r) => r.id)).size, 2350, 'ไม่มีแถวซ้ำ')
eq(requests.map((r) => r.from), [0, 1000, 2000], 'ขอทีละ 1000 แถวจนหมด')
eq(requests[0].order, { column: 'id', ascending: true }, 'เรียงด้วย id เสมอ')

console.log('── ข้อมูลพอดีหน้าเดียว')
const small = await fetchAllRows(makeFakeTable(rows.slice(0, 40)))
eq(small.data.length, 40, 'ได้ครบ')

console.log('── ข้อมูลเต็มหน้าพอดี (ต้องขออีกหน้าเพื่อยืนยันว่าหมด)')
const exact = []
const full = await fetchAllRows(makeFakeTable(rows.slice(0, 1000), { onRequest: (r) => exact.push(r.from) }))
eq(full.data.length, 1000, 'ได้ครบ 1000')
eq(exact, [0, 1000], 'ขอหน้าที่สองเพื่อยืนยันว่าไม่มีต่อ')

console.log('── error กลางคัน')
const broken = () => ({
  order() { return this },
  range() { return Promise.resolve({ data: null, error: { message: 'boom' } }) },
})
const bad = await fetchAllRows(broken)
ok(bad.error !== null, 'ส่ง error กลับให้คนเรียกตัดสินใจ')

console.log(fail === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${fail} ข้อ`)
process.exit(fail === 0 ? 0 : 1)
