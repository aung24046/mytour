import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { cloneSet, updateSetMeta } from '../../lib/quizHost'
import { getQuizPin, saveQuizPin } from '../../lib/quizPin'
import Icon from '../common/Icon'

// หัวการ์ดของ "ชุดคำถาม" ในคลังของแต่ละเกม — ชื่อชุด + ปุ่ม เปลี่ยนชื่อ · ทำสำเนา · แก้ไข
//
// ★ 12 ก.ย. 2026 เจ้าของโปรเจกต์: ขอให้คลังชุดของทุกเกมทำได้เท่าควิซ
//   เดิมมีแต่ปุ่ม "แก้ไข" — เปลี่ยนชื่อต้องเข้าไปในชุด ส่วนทำสำเนาไม่มีเลย
//   ทั้งที่ RPC quiz_clone_set รองรับทุกเกมอยู่แล้ว (ก็อป quiz_puzzle / quiz_tiles / quiz_words ให้ครบ)
//
// กติกาเรื่องสิทธิ์ที่ยกมาจากหน้าควิซทั้งดุ้น:
//   · เปลี่ยนชื่อ = แก้แค่ชื่อชุด ไม่แตะเฉลย จึงไม่ต้องใช้ PIN (RLS เป็นคนกัน)
//   · ทำสำเนา = ต้องก็อปเฉลยซึ่งอยู่ในตารางที่ปิดจาก anon จึงต้องมี PIN
//   · RLS ปฏิเสธจะไม่เป็น error แต่คืน 0 แถว — updateSetMeta โยน SET_UPDATE_BLOCKED ให้
export default function SetCardHead({
  set,
  staffId,
  canEdit = true,
  builderBase,          // เช่น '/staff/puzzle/builder' — ลิงก์แก้ไขและปลายทางหลังทำสำเนา
  meta = null,          // บรรทัดใต้ชื่อ (คำอธิบาย/โหมดของชุด) แล้วแต่เกม
  onRenamed,            // (setId, title) => void — ให้หน้ารวมอัปเดตรายการในมือ
  onCloned,             // (newSetId) => void — ปกติคือ navigate ไปหน้าแก้ชุดใหม่
  onError,
}) {
  const { t } = useTranslation()
  const [renaming, setRenaming] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    const title = text.trim()
    if (!title || title === set.title) {
      setRenaming(false)
      return
    }
    setBusy(true)
    try {
      await updateSetMeta(set.id, { title })
      onRenamed?.(set.id, title)
      setRenaming(false)
    } catch (err) {
      onError?.(
        err.message === 'SET_UPDATE_BLOCKED'
          ? t('staff.quiz.setSaveBlocked')
          : err.message ?? String(err)
      )
    } finally {
      setBusy(false)
    }
  }

  async function clone() {
    let pin = getQuizPin()
    if (!pin) {
      pin = window.prompt(t('staff.quiz.pinTitle'))
      if (!pin) return
    }
    setBusy(true)
    try {
      const newId = await cloneSet({ staffId, pin, setId: set.id, title: null })
      saveQuizPin(pin)
      onCloned?.(newId)
    } catch (err) {
      onError?.(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  if (renaming) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setRenaming(false)
          }}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-base font-bold text-ink outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="flex-none rounded-full bg-brand p-2 text-white"
          aria-label={t('common.save')}
        >
          <Icon name="check" size={16} />
        </button>
        <button
          type="button"
          onClick={() => setRenaming(false)}
          className="flex-none rounded-full px-2 py-1 text-sm font-semibold text-ink-muted hover:bg-surface-sunken"
        >
          {t('common.cancel')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-1">
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-ink">{set.title}</span>
        {meta}
      </span>

      {canEdit && (
        <>
          {/* เปลี่ยนชื่อ — แยกจากปุ่มดินสอที่พาไปแก้ "คำถาม" (ต้องใส่ PIN) */}
          <button
            type="button"
            onClick={() => {
              setText(set.title ?? '')
              setRenaming(true)
            }}
            className="flex-none rounded-full p-1.5 text-ink-muted hover:bg-surface-sunken"
            aria-label={t('staff.quiz.renameSet')}
            title={t('staff.quiz.renameSet')}
          >
            <Icon name="notes" size={18} />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={clone}
            className="flex-none rounded-full p-1.5 text-ink-muted hover:bg-surface-sunken disabled:opacity-50"
            aria-label={t('staff.quiz.cloneSet')}
            title={t('staff.quiz.cloneSet')}
          >
            <Icon name="copy" size={18} />
          </button>
          <Link
            to={`${builderBase}/${set.id}`}
            className="flex-none rounded-full p-1.5 text-ink-muted hover:bg-surface-sunken"
            aria-label={t('staff.quiz.editQuestions')}
            title={t('staff.quiz.editQuestions')}
          >
            <Icon name="edit" size={18} />
          </Link>
        </>
      )}
    </div>
  )
}
