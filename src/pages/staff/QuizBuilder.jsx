import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession, useActiveOrgId } from '../../lib/staffSession'
import { can } from '../../lib/permissions'
import { deleteSet, updateSetMeta } from '../../lib/quizHost'
import { getQuizPin, saveQuizPin } from '../../lib/quizPin'
import OptionShape from '../../components/quiz/OptionShape'
import { optionStyles } from '../../lib/quizStyle'
import {
  uploadQuizMedia,
  removeQuizMedia,
  removeQuizMediaMany,
  MAX_VIDEO_SECONDS,
} from '../../lib/quizMedia'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// หน้าสร้างชุดคำถาม — โครงเดียวกับ FormBuilder (เพิ่ม/ลบ/เลื่อนขึ้นลง/พรีวิว)
//
// ต่างจาก FormBuilder ตรงที่ "เขียนตรงไม่ได้" ทุกอย่างต้องผ่าน RPC
// เพราะเฉลยอยู่ในตาราง quiz_keys ที่ REST อ่านและเขียนไม่ได้เลย
// ค่าผ่านทางคือ PIN ของทีมงาน — ตัวเดียวกับที่ใช้ล็อกอิน
//
// ทำไมต้องถาม PIN ซ้ำทั้งที่ล็อกอินแล้ว:
//   session ที่เก็บใน localStorage ไม่มี PIN อยู่ (ตั้งใจ) และแอปทั้งใบใช้ anon key
//   ตัวเดียวกับลูกทัวร์ ถ้า RPC ไม่ตรวจอะไรเลย ลูกทัวร์ก็เรียกดูเฉลยได้เหมือนกัน

// ข้อเดาตัวเลขต้องให้เวลามากกว่าข้ออื่นมาก: กดปุ่มใช้ 1-3 วิ แต่พิมพ์เลขใช้ 8-20 วิ
// (ยังกดปิดรับก่อนหมดเวลาได้อยู่ดี 45 วิเป็นแค่เพดาน)
const DEFAULT_TIME = { mcq: 20, tf: 15, numeric: 45 }

const EMPTY = {
  id: null,
  kind: 'mcq',
  text: '',
  options: ['', '', '', ''],
  correct_index: 0,
  correct_number: '',
  numeric_unit: '',
  time_limit_sec: 20,
  explain: '',
  media_url: '',
  media_kind: null,
  original_media_url: '',
}

function PinGate({ onUnlock, t }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  return (
    <div className="mx-auto max-w-md px-4 pt-10 text-center">
      <Icon name="lock" size={32} className="mx-auto text-ink-faint" />
      <p className="mt-3 text-base font-extrabold text-ink">{t('staff.quiz.pinTitle')}</p>
      <p className="mt-1 text-sm text-ink-muted">{t('staff.quiz.pinHint')}</p>
      <input
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        className="mt-4 w-full rounded-control border border-line bg-surface px-4 py-3 text-center text-2xl font-black tracking-[0.4em] text-ink outline-none focus:border-brand"
      />
      {error && <p className="mt-2 text-sm font-semibold text-danger-text">{error}</p>}
      <div className="mt-3">
        <Button
          disabled={!pin.trim()}
          onClick={async () => {
            const ok = await onUnlock(pin.trim())
            if (!ok) setError(t('staff.quiz.pinWrong'))
          }}
        >
          {t('common.confirm')}
        </Button>
      </div>
    </div>
  )
}

export default function QuizBuilder() {
  const { setId } = useParams()
  const { t } = useTranslation()
  const session = getStaffSession()
  const staffId = session?.staff?.id ?? null
  const navigate = useNavigate()
  const orgId = useActiveOrgId()

  const [pin, setPin] = useState(() => getQuizPin())
  const [unlocked, setUnlocked] = useState(false)
  const [set, setSet] = useState(null)
  const [questions, setQuestions] = useState([])
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [destinations, setDestinations] = useState([])
  const [deleting, setDeleting] = useState(false)
  const [savedAt, setSavedAt] = useState(0)

  const loadSet = useCallback(async () => {
    const { data } = await supabase
      .from('quiz_sets')
      .select('id, title, description, lang, default_time_limit, streak_bonus, destination_id, is_archived')
      .eq('id', setId)
      .maybeSingle()
    setSet(data ?? null)
  }, [setId])

  const loadQuestions = useCallback(
    async (thePin) => {
      const { data, error: err } = await supabase.rpc('quiz_set_for_edit', {
        p_set_id: setId,
        p_staff_id: staffId,
        p_pin: thePin,
      })
      if (err) return false
      setQuestions(data ?? [])
      return true
    },
    [setId, staffId]
  )

  useEffect(() => {
    loadSet()
  }, [loadSet])

  useEffect(() => {
    supabase
      .from('destinations')
      .select('id, name')
      .eq('org_id', orgId)
      .order('name')
      .then(({ data }) => setDestinations(data ?? []))
  }, [orgId])

  // มี PIN ค้างจากหน้าอื่นในแท็บเดียวกัน → ลองใช้เลย ไม่ต้องถามซ้ำ
  useEffect(() => {
    if (!pin || unlocked) return
    loadQuestions(pin).then((ok) => setUnlocked(ok))
  }, [pin, unlocked, loadQuestions])

  async function handleUnlock(value) {
    const ok = await loadQuestions(value)
    if (!ok) return false
    saveQuizPin(value)
    setPin(value)
    setUnlocked(true)
    return true
  }

  function startNew() {
    setError('')
    setEditing({ ...EMPTY, options: ['', '', '', ''] })
  }

  function startEdit(q) {
    setError('')
    setEditing({
      id: q.question_id,
      kind: q.kind,
      text: q.question_text ?? '',
      options:
        q.kind === 'tf'
          ? ['', '']
          : [...(q.options ?? []), '', '', '', ''].slice(0, 4),
      correct_index: q.correct_index ?? 0,
      correct_number: q.correct_number ?? '',
      numeric_unit: q.numeric_unit ?? '',
      time_limit_sec: q.time_limit_sec ?? 20,
      explain: q.explain ?? '',
      media_url: q.media_url ?? '',
      media_kind: q.media_kind ?? null,
      original_media_url: q.media_url ?? '',
    })
  }

  async function save() {
    if (!editing) return
    setSaving(true)
    setError('')

    // ⚠️ ต้อง map index ใหม่หลังตัดช่องว่างทิ้ง
    //    correct_index ที่เก็บใน state เป็นตำแหน่งในอาร์เรย์ 4 ช่องเดิม
    //    ถ้าสตาฟกรอก A, เว้น B, C, D แล้วเลือก D (index 3) เป็นคำตอบ
    //    opts ที่ส่งไปจะยาวแค่ 3 → เฉลยชี้ออกนอกอาร์เรย์ = ทั้งห้องตอบผิดหมดทั้งข้อ
    const kept =
      editing.kind === 'mcq'
        ? editing.options.map((o, i) => ({ o, i })).filter(({ o }) => o.trim() !== '')
        : []
    const opts = kept.map(({ o }) => o)
    const correctIndex =
      editing.kind === 'mcq'
        ? kept.findIndex(({ i }) => i === Number(editing.correct_index))
        : Number(editing.correct_index)

    if (editing.kind === 'mcq' && opts.length < 2) {
      setError(t('staff.quiz.needTwoOptions'))
      setSaving(false)
      return
    }

    // เลือกเฉลยค้างไว้ที่ช่องที่ปล่อยว่าง — ต้องบอกตรงนี้ ไม่ใช่ปล่อยให้บันทึกเฉลยผิด
    if (editing.kind === 'mcq' && correctIndex < 0) {
      setError(t('staff.quiz.pickCorrectOption'))
      setSaving(false)
      return
    }

    const { error: err } = await supabase.rpc('quiz_upsert_question', {
      p_staff_id: staffId,
      p_pin: pin,
      p_set_id: setId,
      p_question_id: editing.id,
      p_kind: editing.kind,
      p_text: editing.text,
      p_options: opts,
      p_correct_index: editing.kind === 'numeric' ? null : correctIndex,
      p_correct_number: editing.kind === 'numeric' ? Number(editing.correct_number) : null,
      p_numeric_unit: editing.numeric_unit,
      p_time_limit_sec: Number(editing.time_limit_sec),
      p_points_factor: 1,
      p_media_url: editing.media_url,
      p_media_kind: editing.media_url ? editing.media_kind ?? 'image' : null,
      p_explain: editing.explain,
      p_sort_order: editing.id ? null : questions.length,
    })

    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }

    // ลบไฟล์เก่าหลังบันทึกสำเร็จเท่านั้น — ถ้าลบตอนกดเปลี่ยนรูป แล้วผู้ใช้กดยกเลิก
    // ข้อเดิมจะเหลือ URL ที่ชี้ไปไฟล์ที่ไม่มีอยู่แล้ว
    if (editing.original_media_url && editing.original_media_url !== editing.media_url) {
      removeQuizMedia(editing.original_media_url)
    }

    setEditing(null)
    loadQuestions(pin)
  }

  async function handleFile(file) {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const { kind, url } = await uploadQuizMedia(setId, file)
      setEditing((s) => ({ ...s, media_url: url, media_kind: kind }))
    } catch (err) {
      setError(
        t(`staff.quiz.mediaErr.${err.code ?? 'upload'}`, {
          seconds: err.seconds ?? MAX_VIDEO_SECONDS,
          defaultValue: err.message,
        })
      )
    } finally {
      setUploading(false)
    }
  }

  async function remove(questionId) {
    await supabase.rpc('quiz_delete_question', {
      p_staff_id: staffId,
      p_pin: pin,
      p_question_id: questionId,
    })
    loadQuestions(pin)
  }

  async function move(index, dir) {
    const next = [...questions]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setQuestions(next)
    await supabase.rpc('quiz_reorder_questions', {
      p_staff_id: staffId,
      p_pin: pin,
      p_ids: next.map((q) => q.question_id),
    })
  }

  async function handleDeleteSet() {
    const label = set?.title || t('staff.quiz.builderTitle')
    if (!window.confirm(t('staff.quiz.deleteConfirm', { title: label, n: questions.length }))) {
      return
    }

    setDeleting(true)
    setError('')
    try {
      const res = await deleteSet({ staffId, pin, setId })

      if (res?.status === 'in_use') {
        // ไม่ใช่ error — ชุดนี้เคยเล่นไปแล้ว รายงานหลังเกมยังต้องใช้คำถามอยู่
        // เสนอทางที่ถูกต้องแทนการปล่อยให้ผู้ใช้ค้าง
        if (window.confirm(t('staff.quiz.deleteInUse', { n: res.sessions }))) {
          await saveSetMeta({ is_archived: true })
          navigate('/staff/quiz')
        }
        return
      }

      if (res?.status === 'not_found') {
        navigate('/staff/quiz')
        return
      }

      // ลบไฟล์สื่อตามหลัง ไม่งั้นรูปกลายเป็นไฟล์กำพร้าที่กินโควตา Storage ไปเรื่อยๆ
      await removeQuizMediaMany(res?.media ?? [])
      navigate('/staff/quiz')
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setDeleting(false)
    }
  }

  // เดิมยิง UPDATE แล้วไม่ดูผลเลย — ถ้าเขียนไม่ผ่านผู้ใช้จะเห็นชื่อใหม่บนจอ
  // (เพราะ setSet ไปแล้ว) แต่พอ refresh กลับเป็นชื่อเดิม = "แก้ชื่อไม่ได้"
  // ตอนนี้บันทึกจริงก่อน ค่อยอัปเดตจอ และขึ้น error ให้เห็นเมื่อพลาด
  async function saveSetMeta(patch) {
    const before = set
    setSet((s) => ({ ...s, ...patch }))
    setError('')
    try {
      await updateSetMeta(setId, patch)
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(0), 2000)
    } catch (err) {
      setSet(before)
      setError(
        err.message === 'SET_UPDATE_BLOCKED'
          ? t('staff.quiz.setSaveBlocked')
          : err.message ?? String(err)
      )
    }
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen bg-canvas">
        <StaffHeader title={t('staff.quiz.builderTitle')} icon="game" backTo="/staff/quiz" />
        <PinGate onUnlock={handleUnlock} t={t} />
      </div>
    )
  }

  const styles = optionStyles(editing?.kind)

  return (
    <div className="min-h-screen bg-canvas pb-20">
      <StaffHeader
        title={set?.title ?? t('staff.quiz.builderTitle')}
        subtitle={t('staff.quiz.questionCount', { n: questions.length })}
        icon="game"
        backTo="/staff/quiz"
      />

      <div className="mx-auto max-w-md space-y-4 px-4 pt-4">
        {error && (
          <p className="rounded-control bg-danger-bg px-3 py-2 text-sm font-semibold text-danger-text">
            {error}
          </p>
        )}

        {/* ── ชื่อชุด ─────────────────────────────────────────── */}
        <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-card">
          <div className="flex items-center justify-between">
            <label
              htmlFor="quiz-set-title"
              className="text-xs font-extrabold uppercase tracking-wide text-ink-muted"
            >
              {t('staff.quiz.setNameLabel')}
            </label>
            {savedAt > 0 && (
              <span className="flex items-center gap-1 text-xs font-bold text-success-text">
                <Icon name="check" size={13} />
                {t('common.saved')}
              </span>
            )}
          </div>

          {/* เดิมเป็นช่องไร้กรอบที่ดูเหมือนหัวข้อ ไม่มีใครรู้ว่าพิมพ์ทับได้
              และบันทึกตอน blur อย่างเดียว — บนมือถือกดปุ่ม back ก่อน blur = ชื่อหาย
              จึงเพิ่ม Enter เพื่อบันทึกทันที และทำให้หน้าตาเป็น "ช่องกรอก" จริงๆ */}
          <input
            id="quiz-set-title"
            value={set?.title ?? ''}
            placeholder={t('staff.quiz.setNamePlaceholder')}
            onChange={(e) => setSet((s) => ({ ...s, title: e.target.value }))}
            onBlur={(e) => saveSetMeta({ title: e.target.value.trim() || t('staff.quiz.newSetName') })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className="mt-1 w-full rounded-control border border-line bg-surface px-3 py-2 text-lg font-extrabold text-ink outline-none focus:border-brand"
          />
          <input
            value={set?.description ?? ''}
            placeholder={t('staff.quiz.setDescPlaceholder')}
            onChange={(e) => setSet((s) => ({ ...s, description: e.target.value }))}
            onBlur={(e) => saveSetMeta({ description: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className="mt-2 w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
          />

          {/* ผูกกับปลายทาง — ชุด "รู้จักญี่ปุ่นแค่ไหน" ควรโผล่เฉพาะตอนทำทริปญี่ปุ่น
              ไม่ใช่ปนอยู่ในรายการเดียวกับชุดเกาหลีจนหาไม่เจอตอนคลังโตขึ้น */}
          <select
            value={set?.destination_id ?? ''}
            onChange={(e) => saveSetMeta({ destination_id: e.target.value || null })}
            className="mt-2 w-full rounded-control border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none"
          >
            <option value="">{t('staff.quiz.anyDestination')}</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <label className="mt-2 flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={set?.is_archived ?? false}
              onChange={(e) => saveSetMeta({ is_archived: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            <span className="text-sm text-ink-muted">{t('staff.quiz.archiveSet')}</span>
          </label>
        </div>

        {/* ── รายการข้อ ───────────────────────────────────────── */}
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div
              key={q.question_id}
              className="rounded-2xl border border-line bg-surface p-3.5 shadow-card"
            >
              <div className="flex items-start gap-2">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-surface-sunken text-xs font-black text-ink-muted">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink">
                    {q.question_text || t('staff.quiz.untitled')}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-faint">
                    {t(`quiz.kind.${q.kind}`)} · {q.time_limit_sec}s
                    {q.kind === 'numeric'
                      ? ` · ${q.correct_number ?? '-'}`
                      : ` · ${String.fromCharCode(65 + (q.correct_index ?? 0))}`}
                  </span>
                </span>
                <span className="flex flex-none gap-0.5">
                  <button
                    type="button"
                    aria-label={t('common.moveUp')}
                    onClick={() => move(i, -1)}
                    className="rounded-full p-1.5 text-ink-faint hover:bg-surface-sunken"
                  >
                    <Icon name="chevronRight" size={16} className="-rotate-90" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('common.moveDown')}
                    onClick={() => move(i, 1)}
                    className="rounded-full p-1.5 text-ink-faint hover:bg-surface-sunken"
                  >
                    <Icon name="chevronRight" size={16} className="rotate-90" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('common.edit')}
                    onClick={() => startEdit(q)}
                    className="rounded-full p-1.5 text-ink-muted hover:bg-surface-sunken"
                  >
                    <Icon name="edit" size={16} />
                  </button>
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    onClick={() => remove(q.question_id)}
                    className="rounded-full p-1.5 text-ink-faint hover:bg-danger-bg hover:text-danger-text"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>

        {!editing && (
          <Button variant="secondary" onClick={startNew}>
            <Icon name="plus" size={18} />
            {t('staff.quiz.addQuestion')}
          </Button>
        )}

        {/* ── โซนอันตราย ─────────────────────────────────────────
            วางท้ายสุดและแยกเส้นออกมา เพื่อไม่ให้อยู่ในระยะนิ้วโป้งเดียวกับ
            ปุ่มที่ใช้บ่อย — สตาฟกดหน้านี้ตอนรีบ ไม่ควรพลาดไปโดนปุ่มลบทั้งชุด

            สิทธิ์ใช้ quiz.edit ตัวเดียวกับที่ใช้เปิดหน้านี้ ไม่ใช่ quiz.define
            เคยตั้งเป็น quiz.define (แอดมินบริษัท) ด้วยเหตุผลว่า "ชุดใช้ร่วมกันทุกทริป"
            แต่มันไม่ได้ป้องกันอะไรจริง — คนที่เข้าหน้านี้ได้ลบคำถามทีละข้อจนหมดชุด
            และเปลี่ยนชื่อชุดได้อยู่แล้ว ห้ามเฉพาะปุ่ม "ลบทั้งชุด" จึงมีแต่ทำให้งง
            ตัวป้องกันที่มีความหมายจริงคือกฎ "ชุดที่เคยเล่นแล้วลบไม่ได้" (ดู quiz_delete_set)
            ซึ่งกันของที่เสียหายจริง (รายงานหลังเกม) ไม่ใช่กันตามตำแหน่งคน */}
        {!editing && can(session, 'quiz.edit') && (
          <div className="mt-8 border-t border-line pt-4">
            <button
              type="button"
              disabled={deleting}
              onClick={handleDeleteSet}
              className="flex w-full items-center justify-center gap-2 rounded-control py-3 text-sm font-bold text-danger-text transition active:scale-[0.98] hover:bg-danger-bg disabled:opacity-50"
            >
              <Icon name="trash" size={16} />
              {t('staff.quiz.deleteSet')}
            </button>
          </div>
        )}

        {/* ── ฟอร์มแก้ไขข้อ ───────────────────────────────────── */}
        {editing && (
          <div className="space-y-3 rounded-2xl border border-brand-light bg-surface p-4 shadow-card">
            <div className="flex gap-1.5">
              {['mcq', 'tf', 'numeric'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() =>
                    setEditing((e) => ({
                      ...e,
                      kind: k,
                      correct_index: 0,
                      time_limit_sec: DEFAULT_TIME[k],
                    }))
                  }
                  className={`flex-1 rounded-control px-2 py-2 text-xs font-bold transition ${
                    editing.kind === k
                      ? 'bg-brand text-white'
                      : 'bg-surface-sunken text-ink-muted'
                  }`}
                >
                  {t(`quiz.kind.${k}`)}
                </button>
              ))}
            </div>

            <textarea
              value={editing.text}
              onChange={(e) => setEditing((s) => ({ ...s, text: e.target.value }))}
              rows={2}
              placeholder={t('staff.quiz.questionPlaceholder')}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-base font-semibold text-ink outline-none focus:border-brand"
            />

            {editing.kind === 'mcq' && (
              <div className="space-y-1.5">
                {editing.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing((s) => ({ ...s, correct_index: i }))}
                      aria-label={t('staff.quiz.markCorrect')}
                      className={`flex h-9 w-9 flex-none items-center justify-center rounded-control text-lg text-white ${
                        Number(editing.correct_index) === i ? 'ring-4 ring-success' : ''
                      }`}
                      style={{ background: (styles[i] ?? styles[0]).color }}
                    >
                      <OptionShape shape={(styles[i] ?? styles[0]).shape} size={20} />
                    </button>
                    <input
                      value={opt}
                      onChange={(e) =>
                        setEditing((s) => {
                          const next = [...s.options]
                          next[i] = e.target.value
                          return { ...s, options: next }
                        })
                      }
                      className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                    />
                  </div>
                ))}
                <p className="text-xs text-ink-faint">{t('staff.quiz.tapToMarkCorrect')}</p>
              </div>
            )}

            {editing.kind === 'tf' && (
              <div className="flex gap-2">
                {[t('quiz.true'), t('quiz.false')].map((label, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setEditing((s) => ({ ...s, correct_index: i }))}
                    className={`flex-1 rounded-control px-3 py-3 text-base font-extrabold text-white ${
                      Number(editing.correct_index) === i ? 'ring-4 ring-success' : ''
                    }`}
                    style={{ background: (styles[i] ?? styles[0]).color }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {editing.kind === 'numeric' && (
              <div className="flex gap-2">
                <input
                  type="number"
                  value={editing.correct_number}
                  onChange={(e) => setEditing((s) => ({ ...s, correct_number: e.target.value }))}
                  placeholder={t('staff.quiz.correctNumber')}
                  className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2 text-base font-bold text-ink outline-none focus:border-brand"
                />
                <input
                  value={editing.numeric_unit}
                  onChange={(e) => setEditing((s) => ({ ...s, numeric_unit: e.target.value }))}
                  placeholder={t('staff.quiz.unit')}
                  className="w-24 flex-none rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="flex-1 text-sm font-semibold text-ink-muted">
                {t('staff.quiz.timeLimit')}
              </label>
              <input
                type="number"
                min={5}
                max={300}
                value={editing.time_limit_sec}
                onChange={(e) => setEditing((s) => ({ ...s, time_limit_sec: e.target.value }))}
                className="w-20 rounded-control border border-line bg-surface px-3 py-2 text-center text-sm font-bold text-ink outline-none"
              />
            </div>

            {/* สื่อประกอบคำถาม — อัปโหลดเข้าถัง quiz-media ไม่ใช่วางลิงก์แล้ว */}
            <div className="rounded-control border border-line bg-surface p-3">
              {editing.media_url ? (
                <div className="space-y-2">
                  {editing.media_kind === 'video' ? (
                    <video
                      src={editing.media_url}
                      controls
                      muted
                      playsInline
                      className="max-h-40 w-full rounded-lg bg-black object-contain"
                    />
                  ) : (
                    <img
                      src={editing.media_url}
                      alt=""
                      className="max-h-40 w-full rounded-lg object-contain"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setEditing((s) => ({ ...s, media_url: '', media_kind: null }))}
                    className="flex items-center gap-1 text-sm font-bold text-danger-text"
                  >
                    <Icon name="trash" size={15} />
                    {t('staff.quiz.removeMedia')}
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink-muted">
                  <Icon name="plus" size={16} />
                  {uploading ? t('staff.quiz.uploading') : t('staff.quiz.addMedia')}
                  <input
                    type="file"
                    accept="image/*,video/mp4,video/webm"
                    disabled={uploading}
                    onChange={(e) => {
                      handleFile(e.target.files?.[0])
                      e.target.value = ''
                    }}
                    className="hidden"
                  />
                </label>
              )}
              <p className="mt-1.5 text-xs text-ink-faint">{t('staff.quiz.mediaHint')}</p>
            </div>

            <input
              value={editing.explain}
              onChange={(e) => setEditing((s) => ({ ...s, explain: e.target.value }))}
              placeholder={t('staff.quiz.explainPlaceholder')}
              className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
            />

            <div className="flex gap-2">
              <Button className="flex-1" disabled={saving} onClick={save}>
                {t('common.save')}
              </Button>
              <Button variant="ghost" fullWidth={false} onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
