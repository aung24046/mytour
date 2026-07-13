import { useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

const SCANNER_ELEMENT_ID = 'mytour-qr-scanner'

// เปิดกล้องสแกน QR โดยใช้ html5-qrcode — ต้องทดสอบบนมือถือจริง (Android ก่อน, iOS ทีหลัง)
// เพราะพฤติกรรมขอ permission กล้องต่างกันไปตาม browser/OS
export default function QrScanner({ onScan, onError }) {
  const scannerRef = useRef(null)
  const hasScannedRef = useRef(false)

  // เก็บ callback ล่าสุดไว้ใน ref เพื่อไม่ให้กล้อง start/stop ใหม่ทุกครั้งที่ parent re-render
  // (สำคัญตอนเปิดจากปุ่มลัดแดชบอร์ด ที่หน้า CheckIn ยิง state รัวหลายรอบตอน mount)
  const onScanRef = useRef(onScan)
  const onErrorRef = useRef(onError)
  onScanRef.current = onScan
  onErrorRef.current = onError

  useEffect(() => {
    hasScannedRef.current = false
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID)
    scannerRef.current = scanner

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          if (hasScannedRef.current) return
          hasScannedRef.current = true
          onScanRef.current?.(decodedText)
        },
        () => {
          // decode error ต่อเฟรม (ไม่เจอ QR) — เกิดขึ้นปกติทุกเฟรมที่ยังไม่เจอ ไม่ต้องแจ้งเตือน
        }
      )
      .catch((err) => {
        console.error('[QrScanner] failed to start camera', err)
        onErrorRef.current?.(err)
      })

    return () => {
      const runningScanner = scannerRef.current
      scannerRef.current = null
      if (runningScanner) {
        runningScanner
          .stop()
          .then(() => runningScanner.clear())
          .catch(() => {
            // เคยเจอ race condition ตอน component unmount เร็วกว่ากล้อง start เสร็จ — เพิกเฉยได้
          })
      }
    }
    // start กล้องครั้งเดียวตอน mount — ใช้ ref อ่าน callback ล่าสุด
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div id={SCANNER_ELEMENT_ID} className="w-full overflow-hidden rounded-2xl" />
}
