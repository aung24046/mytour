import { Component } from 'react'

import { reloadForNewVersion } from '../../lib/lazyRoute'
import Button from './Button'

// กันจอขาวเวลาหน้าที่โหลดแบบ lazy พัง (ปกติคือแอปถูก deploy ใหม่ระหว่างใช้งาน — ดู lazyRoute.js)
//
// lazyRoute พยายามรีโหลดให้เองหนึ่งครั้งแล้ว ถ้ายังไม่ผ่าน (เช่น เน็ตหลุด หรือไฟล์ยังไม่ขึ้นเซิร์ฟเวอร์)
// ต้องมีอะไรให้คนหน้างานกดต่อได้ ไม่ใช่จอขาวเปล่าๆ กลางงานเลี้ยง
export default class RouteBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="mx-auto max-w-md space-y-3 p-8 text-center">
        <p className="text-base font-extrabold text-ink">เปิดหน้านี้ไม่สำเร็จ</p>
        <p className="text-sm text-ink-muted">
          แอปเพิ่งอัปเดตเวอร์ชันใหม่ กดปุ่มข้างล่างเพื่อโหลดแอปใหม่แล้วลองอีกครั้ง
        </p>
        <Button onClick={() => reloadForNewVersion()}>โหลดแอปใหม่</Button>
      </div>
    )
  }
}
