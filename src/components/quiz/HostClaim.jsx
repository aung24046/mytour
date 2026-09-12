import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { claimHostToken } from '../../lib/quizHost'
import { getStaffSession } from '../../lib/staffSession'
import { getQuizPin, saveQuizPin } from '../../lib/quizPin'
import Icon from '../common/Icon'
import Button from '../common/Button'

// จอ "เครื่องนี้ยังไม่มีสิทธิ์คุมห้องนี้" ของทุกเกม — ใส่ PIN แล้วคุมต่อได้เลย
//
// ★ 12 ก.ย. 2026: เดิมจอนี้เป็นทางตัน บอกว่าไม่มีสิทธิ์แล้วจบ
//   ทั้งที่คนที่ยืนอยู่หน้าจอคือคนเปิดห้องเอง แค่คนละเครื่อง/ล้างแคช/เปลี่ยนเบราว์เซอร์
//   ตอนนี้ใส่ PIN ทีมงาน (ตัวเดียวกับที่ใช้แก้ชุดคำถาม) แล้วได้ token ของห้องกลับมาทันที
export default function HostClaim({ sessionId, onClaimed }) {
  const { t } = useTranslation()
  const staffId = getStaffSession()?.staff?.id ?? null
  const [pin, setPin] = useState(getQuizPin() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const autoRef = useRef(false)

  // ★ PIN ที่เครื่องนี้จำไว้ (จากการแก้ชุดคำถาม) ลองให้เองก่อนหนึ่งครั้ง
  //   คนคุมเกมส่วนใหญ่ใส่ PIN ไปแล้วตอนสร้างชุด — ไม่ควรต้องใส่ซ้ำเพราะแค่เปลี่ยนเครื่อง
  useEffect(() => {
    if (autoRef.current) return
    autoRef.current = true
    const saved = getQuizPin()
    if (!saved || !sessionId) return
    setBusy(true)
    claimHostToken({ sessionId, staffId, pin: saved })
      .then((token) => onClaimed?.(token))
      .catch(() => {})
      .finally(() => setBusy(false))
    // ตั้งใจให้ทำงานครั้งเดียวตอนเปิดจอ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  async function claim() {
    const value = pin.trim()
    if (!value) return
    setBusy(true)
    setError('')
    try {
      const token = await claimHostToken({ sessionId, staffId, pin: value })
      saveQuizPin(value)
      onClaimed?.(token)
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-3 p-6 text-center">
      <Icon name="lock" size={36} className="mx-auto text-ink-faint" />
      <p className="text-base font-extrabold text-ink">{t('staff.quiz.noToken')}</p>
      <p className="text-sm text-ink-muted">{t('staff.quiz.claimHint')}</p>

      <input
        type="password"
        inputMode="numeric"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') claim()
        }}
        placeholder={t('staff.quiz.pinTitle')}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-center"
      />
      {error && <p className="text-sm text-danger-text">{error}</p>}
      <Button onClick={claim} disabled={busy || !pin.trim()}>
        {busy ? t('common.loading') : t('staff.quiz.claimBtn')}
      </Button>
    </div>
  )
}
