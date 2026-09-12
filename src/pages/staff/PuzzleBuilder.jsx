import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession } from '../../lib/staffSession'
import { getQuizPin, saveQuizPin } from '../../lib/quizPin'
import { fetchPuzzleSet, savePuzzle, tryAnswer } from '../../lib/puzzleHost'
import {
  uploadQuizMedia,
  CLUE_IMAGE_WIDTH,
  CLUE_IMAGE_QUALITY,
  ANSWER_IMAGE_WIDTH,
  ANSWER_IMAGE_QUALITY,
} from '../../lib/quizMedia'
import { MAX_CLUES, validateClues } from '../../lib/puzzleLayout'
import ClueBoard from '../../components/puzzle/ClueBoard'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// สร้าง/แก้ชุดปริศนาใบ้คำ
//
// ต้องใส่ PIN ก่อนเข้า เพราะหน้านี้อ่านเฉลย ซึ่งอยู่ใน quiz_keys ที่ปิดจาก anon
// สตาฟกับลูกทัวร์ใช้ anon key ตัวเดียวกัน ถ้าไม่ตรวจอะไรเลยลูกทัวร์ก็เปิดดูได้
//
// สิ่งที่ตั้งใจให้อยู่ "ติดกัน" บนหน้าจอ ไม่ใช่ซ่อนใน 'ตั้งค่าขั้นสูง':
//   ช่องคำตอบ ↔ ช่องคำที่ยอมรับเพิ่ม
//   คนสร้างข้อ "กาละแม" ต้องนึกถึง "กะละแม" ตอนนั้นเลย ไม่ใช่ตอนยืนอยู่หน้าไมค์

// จำนวนพยางค์ = ป้ายบนจอใหญ่ ("3 พยางค์") — ตั้งเองด้วยปุ่มเดียว
// ★ เดิมต้องพิมพ์คำตอบซ้ำแบบแยกพยางค์ ("ภู-กระ-ดึง") ให้ระบบนับเอง
//   เจ้าของโปรเจกต์บอกว่าเสียเวลากรอกโดยไม่ได้อะไรกลับมา (12 ก.ย. 2026) — เลิกใช้ช่องนั้น
const SYLLABLE_OPTIONS = [1, 2, 3, 4, 5, 6]

function emptyDraft() {
  return {
    question_id: null,
    question_text: '',
    syllable_count: 3,
    time_limit_sec: 90,
    clues: [],
    correct_text: '',
    answer_aliases: [],
    answer_image_url: null,
    hints: [],
    explain: '',
  }
}

export default function PuzzleBuilder() {
  const { setId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const staffSession = getStaffSession()
  const staffId = staffSession?.staff?.id ?? null

  const [pin, setPin] = useState(getQuizPin())
  const [pinInput, setPinInput] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [setMeta, setSetMeta] = useState(null)
  const [items, setItems] = useState([])
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testWord, setTestWord] = useState('')
  const [testResult, setTestResult] = useState(null)

  const load = useCallback(
    async (usePin) => {
      setError('')
      try {
        const rows = await fetchPuzzleSet({ setId, staffId, pin: usePin })
        setItems(rows)
        setUnlocked(true)
        saveQuizPin(usePin)
        setPin(usePin)
      } catch (err) {
        setUnlocked(false)
        setError(err.message ?? String(err))
      }
    },
    [setId, staffId]
  )

  useEffect(() => {
    supabase
      .from('quiz_sets')
      .select('id, title, description, game_kind, solve_limit')
      .eq('id', setId)
      .maybeSingle()
      .then(({ data }) => setSetMeta(data ?? null))
  }, [setId])

  useEffect(() => {
    if (pin) load(pin)
  }, [pin, load])

  function patch(next) {
    setDraft((d) => ({ ...d, ...next }))
    setTestResult(null)
  }

  /**
   * ค่าระดับ "ชุด" ไม่ใช่ระดับข้อ — เก็บที่ quiz_sets แถวเดียว
   * โควตาคนตอบถูกต้องเท่ากันทั้งชุด ไม่งั้นคนเล่นต้องเดาเองว่าข้อนี้ยังทันไหม
   */
  async function saveSolveLimit(value) {
    const next = value === '' ? null : Number(value)
    setSetMeta((m) => ({ ...m, solve_limit: next }))
    setError('')
    const { error: err } = await supabase
      .from('quiz_sets')
      .update({ solve_limit: next })
      .eq('id', setId)
    if (err) setError(err.message)
  }

  async function handleClueFile(index, file) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const { url } = await uploadQuizMedia(setId, file, {
        maxWidth: CLUE_IMAGE_WIDTH,
        quality: CLUE_IMAGE_QUALITY,
      })
      const clues = [...draft.clues]
      clues[index] = { ...clues[index], clue_kind: 'image', body: url }
      patch({ clues })
    } catch (err) {
      setError(t(`staff.quiz.mediaErr.${err.code ?? 'upload'}`, { defaultValue: String(err.message) }))
    } finally {
      setBusy(false)
    }
  }

  async function handleAnswerImage(file) {
    if (!file) return
    setBusy(true)
    try {
      const { url } = await uploadQuizMedia(setId, file, {
        maxWidth: ANSWER_IMAGE_WIDTH,
        quality: ANSWER_IMAGE_QUALITY,
      })
      patch({ answer_image_url: url })
    } catch (err) {
      setError(t(`staff.quiz.mediaErr.${err.code ?? 'upload'}`, { defaultValue: String(err.message) }))
    } finally {
      setBusy(false)
    }
  }

  function addClue(kind) {
    if (draft.clues.length >= MAX_CLUES) return
    patch({ clues: [...draft.clues, { clue_kind: kind, body: '' }] })
  }

  function moveClue(index, delta) {
    const clues = [...draft.clues]
    const to = index + delta
    if (to < 0 || to >= clues.length) return
    ;[clues[index], clues[to]] = [clues[to], clues[index]]
    patch({ clues })
  }

  async function handleSave() {
    setError('')
    const clueError = validateClues(draft.clues)
    if (clueError) {
      setError(clueError)
      return
    }
    if (!draft.correct_text.trim()) {
      setError(t('puzzle.builder.needAnswer'))
      return
    }

    setBusy(true)
    try {
      await savePuzzle({
        staffId,
        pin,
        setId,
        questionId: draft.question_id,
        text: draft.question_text,
        syllableCount: Number(draft.syllable_count) || 1,
        timeLimitSec: Number(draft.time_limit_sec) || 90,
        clues: draft.clues
          .filter((c) => (c.body ?? '').trim() !== '')
          .map((c) => ({ kind: c.clue_kind, body: c.body, label: '' })),
        answer: draft.correct_text,
        answerSplit: '',
        aliases: (draft.answer_aliases ?? []).filter((x) => (x ?? '').trim() !== ''),
        answerImageUrl: draft.answer_image_url,
        hints: (draft.hints ?? []).map((h) => (h ?? '').trim()).filter(Boolean),
        explain: draft.explain,
        sortOrder: draft.question_id
          ? items.findIndex((i) => i.question_id === draft.question_id)
          : items.length,
      })
      setDraft(null)
      load(pin)
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    setTestResult(null)
    const hit = await tryAnswer(draft.correct_text, draft.answer_aliases, testWord)
    setTestResult(hit)
  }

  // ── ยังไม่ปลดล็อก ───────────────────────────────────────────────
  if (!unlocked) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <StaffHeader icon="lock" title={t('puzzle.builder.title')} subtitle={setMeta?.title ?? ''} />
        <div className="mx-auto max-w-md space-y-3 p-4">
          <p className="text-sm text-ink-muted">{t('puzzle.builder.pinWhy')}</p>
          <input
            type="password"
            inputMode="numeric"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder={t('staff.quiz.pinTitle')}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2.5"
          />
          {error && <p className="text-sm text-danger-text">{error}</p>}
          <Button onClick={() => load(pinInput)}>{t('common.confirm')}</Button>
        </div>
      </div>
    )
  }

  // ── แก้ข้อ ──────────────────────────────────────────────────────
  if (draft) {
    return (
      <div className="min-h-screen bg-surface-muted pb-32">
        {/* ย้อนกลับจากฟอร์มแก้ข้อ = กลับไปรายการข้อ (เหมือนปุ่มยกเลิก) ไม่ใช่ออกจากชุด */}
        <StaffHeader
          icon="edit"
          title={t('puzzle.builder.editItem')}
          subtitle={setMeta?.title ?? ''}
          onBack={() => setDraft(null)}
        />

        <div className="mx-auto max-w-md space-y-5 p-4">
          {error && (
            <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
          )}

          {/* รูปใบ้ */}
          <section>
            <h2 className="mb-1 text-sm font-bold text-ink">
              {t('puzzle.builder.clues', { n: draft.clues.length, max: MAX_CLUES })}
            </h2>
            <p className="mb-2 text-xs text-ink-faint">{t('puzzle.builder.cluesHint')}</p>

            <ul className="space-y-2">
              {draft.clues.map((clue, i) => (
                <li key={i} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ink-faint">{i + 1}</span>

                    {clue.clue_kind === 'image' ? (
                      clue.body ? (
                        <img
                          src={clue.body}
                          alt=""
                          className="h-14 w-14 rounded-lg object-contain ring-1 ring-line"
                        />
                      ) : (
                        <label className="flex h-14 flex-1 cursor-pointer items-center justify-center rounded-lg border border-dashed border-line-strong text-xs text-ink-faint">
                          {t('puzzle.builder.pickImage')}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleClueFile(i, e.target.files?.[0])}
                          />
                        </label>
                      )
                    ) : (
                      <input
                        value={clue.body}
                        onChange={(e) => {
                          const clues = [...draft.clues]
                          clues[i] = { ...clue, body: e.target.value }
                          patch({ clues })
                        }}
                        placeholder={t('puzzle.builder.wordClue')}
                        className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-center text-xl"
                      />
                    )}

                    <button type="button" onClick={() => moveClue(i, -1)} className="p-1">
                      <span className="text-sm font-bold text-ink-faint">↑</span>
                    </button>
                    <button type="button" onClick={() => moveClue(i, 1)} className="p-1">
                      <span className="text-sm font-bold text-ink-faint">↓</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => patch({ clues: draft.clues.filter((_, k) => k !== i) })}
                      className="p-1 text-danger-text"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {draft.clues.length < MAX_CLUES && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  fullWidth={false}
                  className="px-3 py-2 text-sm"
                  onClick={() => addClue('image')}
                >
                  + {t('puzzle.builder.addImage')}
                </Button>
                <Button
                  variant="secondary"
                  fullWidth={false}
                  className="px-3 py-2 text-sm"
                  onClick={() => addClue('text')}
                >
                  + {t('puzzle.builder.addWord')}
                </Button>
              </div>
            )}
          </section>

          {/* คำตอบ + คำที่ยอมรับเพิ่ม — ต้องอยู่ติดกันเสมอ */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">{t('puzzle.builder.answer')}</h2>
            <input
              value={draft.correct_text}
              onChange={(e) => patch({ correct_text: e.target.value })}
              placeholder="ภูกระดึง"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 font-bold"
            />

            {/* จำนวนพยางค์ — ป้ายบนจอใหญ่ใช้ค่านี้ตรงๆ */}
            <label className="block pt-1 text-xs font-bold text-ink-muted">
              {t('puzzle.builder.syllableCount')}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SYLLABLE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => patch({ syllable_count: n })}
                  className={`h-10 w-10 rounded-xl border text-sm font-bold ${
                    Number(draft.syllable_count) === n
                      ? 'border-brand bg-brand text-white'
                      : 'border-line bg-surface text-ink'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-faint">{t('puzzle.builder.syllableHint')}</p>

            <label className="block text-xs font-bold text-ink-muted">
              {t('puzzle.builder.aliases')}
            </label>
            <p className="text-xs text-ink-faint">{t('puzzle.builder.aliasesHint')}</p>
            <input
              value={(draft.answer_aliases ?? []).join(', ')}
              onChange={(e) =>
                patch({ answer_aliases: e.target.value.split(',').map((x) => x.trim()) })
              }
              placeholder="กะละแม, ขนมกาละแม"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2"
            />

            {/* ทดลองตรวจ — วิธีเดียวที่จะรู้ตัวก่อนขึ้นเวทีว่าเฉลยของตัวเองตรวจไม่ผ่าน */}
            <div className="flex gap-2">
              <input
                value={testWord}
                onChange={(e) => setTestWord(e.target.value)}
                placeholder={t('puzzle.builder.testPlaceholder')}
                className="flex-1 rounded-xl border border-line bg-surface px-3 py-2"
              />
              <Button
                variant="secondary"
                fullWidth={false}
                className="px-3 py-2 text-sm"
                onClick={handleTest}
              >
                {t('puzzle.builder.test')}
              </Button>
            </div>
            {testResult !== null && (
              <p className={`text-sm font-bold ${testResult ? 'text-success-text' : 'text-danger-text'}`}>
                {testResult ? t('puzzle.builder.testPass') : t('puzzle.builder.testFail')}
              </p>
            )}
          </section>

          {/* ที่มาของคำตอบ — ขึ้นบนจอใหญ่ตอนเฉลย แทนการแยกพยางค์แบบเดิม */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">{t('puzzle.builder.explain')}</h2>
            <p className="text-xs text-ink-faint">{t('puzzle.builder.explainHint')}</p>
            <textarea
              rows={2}
              value={draft.explain ?? ''}
              onChange={(e) => patch({ explain: e.target.value })}
              placeholder={t('puzzle.builder.explainPlaceholder')}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2"
            />
          </section>

          {/* คำใบ้ 1-3 ขั้น */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">{t('puzzle.builder.hints')}</h2>
            <p className="text-xs text-ink-faint">{t('puzzle.builder.hintsHint')}</p>
            {[0, 1, 2].map((i) =>
              i === 0 || (draft.hints ?? []).length > i - 1 ? (
                <input
                  key={i}
                  value={draft.hints?.[i] ?? ''}
                  onChange={(e) => {
                    const hints = [...(draft.hints ?? [])]
                    hints[i] = e.target.value
                    patch({ hints })
                  }}
                  placeholder={t('puzzle.builder.hintPlaceholder', { n: i + 1 })}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2"
                />
              ) : null
            )}
          </section>

          {/* ภาพเฉลย + เวลา */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">{t('puzzle.builder.answerImage')}</h2>
            {draft.answer_image_url ? (
              <div className="flex items-center gap-2">
                <img
                  src={draft.answer_image_url}
                  alt=""
                  className="h-20 w-32 rounded-lg object-cover ring-1 ring-line"
                />
                <Button
                  variant="ghost"
                  fullWidth={false}
                  className="px-3 py-2 text-sm"
                  onClick={() => patch({ answer_image_url: null })}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ) : (
              <label className="flex h-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-line-strong text-xs text-ink-faint">
                {t('puzzle.builder.pickImage')}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleAnswerImage(e.target.files?.[0])}
                />
              </label>
            )}

            <label className="block text-xs font-bold text-ink-muted">
              {t('puzzle.builder.timeLimit')}
            </label>
            <input
              type="number"
              min={20}
              max={300}
              value={draft.time_limit_sec}
              onChange={(e) => patch({ time_limit_sec: e.target.value })}
              className="w-28 rounded-xl border border-line bg-surface px-3 py-2"
            />
          </section>

          {/* พรีวิว — ใช้ ClueBoard ตัวเดียวกับจอจริง */}
          <section>
            <h2 className="mb-2 text-sm font-bold text-ink">{t('puzzle.builder.preview')}</h2>
            <div className="rounded-2xl border-[3px] border-ink bg-white p-3">
              <p className="mb-2 text-center text-sm font-black text-neutral-900">
                {t('puzzle.syllables', { n: draft.syllable_count })}
              </p>
              <ClueBoard clues={draft.clues} surface="phone" cellHeight="88px" />
            </div>
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 flex gap-2 border-t border-line bg-surface p-3">
          <Button onClick={handleSave} disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="ghost" fullWidth={false} className="px-4" onClick={() => setDraft(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  // ── รายการข้อ ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface-muted pb-24">
      <StaffHeader
        icon="edit"
        title={t('puzzle.builder.title')}
        subtitle={setMeta?.title ?? ''}
      />

      <div className="mx-auto max-w-md space-y-3 p-4">
        {error && (
          <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
        )}

        {/* ── ตั้งค่าของทั้งชุด ─────────────────────────────────── */}
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-sm font-bold text-ink">{t('puzzle.builder.setSettings')}</h2>

          <label className="mt-3 block text-sm font-bold text-ink" htmlFor="solve-limit">
            {t('puzzle.builder.solveLimit')}
          </label>
          <p className="mb-1.5 text-xs text-ink-faint">{t('puzzle.builder.solveLimitHint')}</p>
          <select
            id="solve-limit"
            value={setMeta?.solve_limit == null ? '' : String(setMeta.solve_limit)}
            onChange={(e) => saveSolveLimit(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
          >
            {[1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={String(n)}>
                {t('puzzle.builder.solveLimitN', { n })}
              </option>
            ))}
            <option value="">{t('puzzle.builder.solveLimitOff')}</option>
          </select>
        </section>

        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-faint">
            {t('puzzle.builder.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, i) => (
              <li
                key={item.question_id}
                className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-card"
              >
                <span className="text-xs font-bold text-ink-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{item.correct_text}</p>
                  <p className="text-xs text-ink-muted">
                    {t('puzzle.builder.itemMeta', {
                      clues: (item.clues ?? []).length,
                      syllables: item.syllable_count,
                      hints: (item.hints ?? []).length,
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  className="p-2"
                  onClick={() =>
                    setDraft({
                      ...emptyDraft(),
                      ...item,
                      clues: (item.clues ?? []).map((c) => ({ clue_kind: c.kind, body: c.body })),
                      hints: (item.hints ?? []).map((h) => h.body ?? ''),
                      answer_aliases: item.answer_aliases ?? [],
                    })
                  }
                >
                  <Icon name="edit" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button onClick={() => setDraft(emptyDraft())}>+ {t('puzzle.builder.addItem')}</Button>
        <Button variant="ghost" onClick={() => navigate('/staff/puzzle')}>
          {t('common.back')}
        </Button>
      </div>
    </div>
  )
}
