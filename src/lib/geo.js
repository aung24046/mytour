// เครื่องมือช่วยเรื่องพิกัด — ใช้ตอน "จัดเรียงอัตโนมัติ" ในคู่มือทริป (GuideBuilder.jsx)
// ไม่มีช่อง lat/lng แยก — แกะพิกัดจากลิงก์ Google Maps ที่ staff กรอกไว้อยู่แล้วในช่อง maps_url

// รูปแบบลิงก์ Google Maps ที่พบพิกัดได้บ่อย:
//   .../@13.123,100.456,15z            (ลิงก์จากแอป/เว็บตอนกดปักหมุด)
//   ...!3d13.123!4d100.456              (ลิงก์ embed / แชร์บางแบบ)
//   ...?q=13.123,100.456                (ลิงก์ q=)
//   ...?ll=13.123,100.456               (ลิงก์เก่า)
// ลิงก์แบบย่อ (goo.gl/maps, maps.app.goo.gl) ไม่มีพิกัดอยู่ในตัว URL เอง — แกะไม่ได้
export function parseLatLngFromMapsUrl(url) {
  if (!url) return null
  const patterns = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
  ]
  for (const re of patterns) {
    const m = url.match(re)
    if (m) {
      const lat = parseFloat(m[1])
      const lng = parseFloat(m[2])
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng }
    }
  }
  return null
}

// ระยะทางเส้นตรงระหว่างสองพิกัด (กม.) — คร่าวๆ พอสำหรับจัดลำดับ ไม่ใช่ระยะทางถนนจริง
export function haversineDistanceKm(a, b) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  return 2 * R * Math.asin(Math.sqrt(h))
}

// จัดลำดับแบบ nearest-neighbor: เริ่มจากรายการแรกในลิสต์เดิม (ตำแหน่งปัจจุบันของอันบนสุด)
// แล้ววิ่งหาอันที่ใกล้ที่สุดถัดไปเรื่อยๆ — เหมาะกับเรียงจุดเที่ยวตามเส้นทางคร่าวๆ
// getPoint(item) ต้องคืนค่า { lat, lng }
export function nearestNeighborOrder(items, getPoint) {
  if (items.length <= 2) return [...items]
  const remaining = [...items]
  const ordered = [remaining.shift()]

  while (remaining.length > 0) {
    const currentPoint = getPoint(ordered[ordered.length - 1])
    let bestIdx = 0
    let bestDist = Infinity
    remaining.forEach((item, idx) => {
      const d = haversineDistanceKm(currentPoint, getPoint(item))
      if (d < bestDist) {
        bestDist = d
        bestIdx = idx
      }
    })
    ordered.push(remaining.splice(bestIdx, 1)[0])
  }
  return ordered
}
