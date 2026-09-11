import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession } from '../../lib/staffSession'
import { getQuizPin, saveQuizPin } from '../../lib/quizPin'
import {
  fetchWordsSet, saveWordsQuestion, deleteWordsQuestion, tryAnswer,
} from '../../lib/wordsHost'
import {
  MAX_CELLS, applyOpened, canHide, maskCells, resplit, validateCells,
  shuffleCells, shuffleTiles, samePoolLetters, validateShuffle, maskShuffle, poolTiles,
} from '../../lib/wordsMask'
import { wordGame, useGameT } from '../../lib/wordGames'
import WordBoard, { MarksOnly } from '../../components/words/WordBoard'
import ShufflePool from '../../components/words/ShufflePool'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// สร้าง/แก้ชุดคำของเกม What Words และ Word Shuffle (game = 'words' | 'shuffle')
//
// สองเกมต่างกันที่หน้านี้หน้าเดียว — ขั้นที่ 2 ของฟอร์ม:
//   What Words   แตะเลือกตัวที่จะซ่อน
//   Word Shuffle ระบบสลับตัวให้เอง + ปุ่มสลับใหม่ (เจ้าของโปรเจกต์เลือก 12 ก.ย. 2026)
//     ทุกตัวถูกซ่อน · กองที่สลับแล้วเก็บลง DB ตามที่เห็นในพรีวิว ทุกจอจึงเห็นลำดับเดียวกัน
//
// ต้องใส่ PIN ก่อนเข้า เพราะหน้านี้อ่านตัวที่ซ่อน ซึ่งอยู่ใน quiz_keys ที่ปิดจาก anon
//
// ลำดับบนฟอร์มตั้งใจเรียงตามที่คนสร้างข้อคิดจริง:
//   หมวดหมู่ → พิมพ์คำ → แตะตัวที่จะซ่อน → ดูพรีวิวแบบที่ลูกทัวร์เห็น → คำที่ยอมรับเพิ่ม
// พรีวิวใช้ WordBoard ตัวเดียวกับจอจริง — เห็นอะไรตรงนี้ ลูกทัวร์ก็เห็นแบบนั้น

// ตัวอย่างหมวดที่ใช้บ่อยบนรถทัวร์ — กดแล้วเติมให้ ไม่บังคับ พิมพ์เองได้
const CATEGORY_SUGGEST = ['เทศกาล', 'อาหาร', 'ขนมไทย', 'สถานที่ท่องเที่ยว', 'จังหวัด', 'สัตว์', 'ผลไม้', 'สำนวนไทย']

// สีพื้นปุ่มตัวที่ซ่อน — ต้องทึบและตรงกับสีที่ MarksOnly ใช้ทับตัวฐาน
const HIDDEN_BG = '#e5e7eb'

function emptyDraft() {
  return {
    question_id: null,
    category: '',
    text: '',
    cells: [],
    answer_aliases: [],
    explain: '',
    time_limit_sec: 90,
    pool: null,
  }
}

export default function WordsBuilder({ game: gameKey = 'words' }) {
  const G = wordGame(gameKey)
  const { setId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const tw = useGameT(G)
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
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = useCallback(
    async (usePin) => {
      setError('')
      try {
        const rows = await fetchWordsSet({ setId, staffId, pin: usePin })
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
      .select('id, title, description, game_kind, solve_limit, answer_mode')
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
    // แก้ฟอร์มแล้ว error เดิม ("ต้องแตะซ่อนอย่างน้อย 1 ตัว") ต้องหายไป ไม่งั้นค้างทั้งที่แก้แล้ว
    setError('')
  }

  // ค่าระดับชุด — เหมือน PuzzleBuilder ทุกอย่าง
  async function saveSolveLimit(value) {
    const next = value === '' ? null : Number(value)
    setSetMeta((m) => ({ ...m, solve_limit: next }))
    setError('')
    const { error: err } = await supabase.from('quiz_sets').update({ solve_limit: next }).eq('id', setId)
    if (err) setError(err.message)
  }

  // วิธีตอบ — เหมือนเกมเปิดแผ่นป้าย: พิมพ์ตอบในมือถือ หรือ ไม่ต้องตอบ เปิดให้ดูเฉยๆ
  async function saveAnswerMode(value) {
    const next = value === 'none' ? 'none' : 'type'
    setSetMeta((m) => ({ ...m, answer_mode: next }))
    setError('')
    const { error: err } = await supabase.from('quiz_sets').update({ answer_mode: next }).eq('id', setId)
    if (err) setError(err.message)
  }

  function toggleHide(index) {
    const cells = draft.cells.map((x, i) => (i === index && canHide(x) ? { ...x, h: !x.h } : x))
    patch({ cells })
  }

  // Word Shuffle: พิมพ์คำใหม่ = สลับใหม่ให้เลย · ตัวชุดเดิม (เช่น ลบแล้วพิมพ์กลับ) = คงกองเดิมไว้
  function changeAnswer(text) {
    if (!G.shuffle) {
      patch({ text, cells: resplit(text, draft.cells) })
      return
    }
    const cells = shuffleCells(text)
    const keep = draft.pool && samePoolLetters(draft.pool, cells) && !validateShuffle(cells, draft.pool)
    patch({ text, cells, pool: keep ? draft.pool : shuffleTiles(cells) })
  }

  const previewCells = useMemo(
    () => applyOpened(G.shuffle ? maskShuffle(draft?.cells ?? []) : maskCells(draft?.cells ?? []), []),
    [draft?.cells, G.shuffle]
  )
  const hiddenCount = (draft?.cells ?? []).filter((x) => x.h).length

  async function handleSave() {
    setError('')
    if (!draft.category.trim()) {
      setError(tw('builder.err.needCategory'))
      return
    }
    const cellError = G.shuffle ? validateShuffle(draft.cells, draft.pool) : validateCells(draft.cells)
    if (cellError) {
      setError(tw(`builder.err.${cellError}`, { max: MAX_CELLS }))
      return
    }

    setBusy(true)
    try {
      await saveWordsQuestion({
        staffId,
        pin,
        setId,
        questionId: draft.question_id,
        timeLimitSec: Number(draft.time_limit_sec) || 90,
        category: draft.category.trim(),
        cells: draft.cells,
        aliases: (draft.answer_aliases ?? []).map((x) => (x ?? '').trim()).filter(Boolean),
        explain: draft.explain,
        sortOrder: draft.question_id
          ? items.findIndex((i) => i.question_id === draft.question_id)
          : items.length,
        pool: G.shuffle ? draft.pool : undefined,
      })
      setDraft(null)
      load(pin)
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(questionId) {
    if (confirmDelete !== questionId) {
      setConfirmDelete(questionId)
      return
    }
    setBusy(true)
    setError('')
    try {
      await deleteWordsQuestion({ staffId, pin, questionId })
      setConfirmDelete(null)
      await load(pin)
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    setTestResult(null)
    const answer = draft.cells.map((x) => `${x.c}${x.m}`).join('')
    setTestResult(await tryAnswer(answer, draft.answer_aliases, testWord))
  }

  // ── ยังไม่ปลดล็อก ───────────────────────────────────────────────
  if (!unlocked) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <StaffHeader icon="lock" title={tw('builder.title')} subtitle={setMeta?.title ?? ''} />
        <div className="mx-auto max-w-md space-y-3 p-4">
          <p className="text-sm text-ink-muted">{tw('builder.pinWhy')}</p>
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
          title={tw('builder.editItem')}
          subtitle={setMeta?.title ?? ''}
          onBack={() => setDraft(null)}
        />

        <div className="mx-auto max-w-md space-y-5 p-4">
          {error && (
            <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
          )}

          {/* 1. หมวดหมู่ */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">{tw('builder.category')}</h2>
            <p className="text-xs text-ink-faint">{tw('builder.categoryHint')}</p>
            <input
              value={draft.category}
              onChange={(e) => patch({ category: e.target.value })}
              maxLength={40}
              placeholder={tw('builder.categoryPlaceholder')}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 font-bold"
            />
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_SUGGEST.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => patch({ category: c })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    draft.category === c ? 'bg-brand text-white' : 'bg-surface-sunken text-ink-muted'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </section>

          {/* 2. คำตอบ + แตะตัวที่จะซ่อน */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-ink">{tw('builder.answer')}</h2>
            <input
              value={draft.text}
              onChange={(e) => changeAnswer(e.target.value)}
              placeholder={G.answerPlaceholder}
              autoComplete="off"
              spellCheck="false"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-lg font-bold"
            />

            {!G.shuffle && draft.cells.length > 0 && (
              <>
                <p className="text-xs text-ink-faint">{tw('builder.tapToHide')}</p>
                <div className="flex flex-wrap gap-1.5" data-testid="hide-picker">
                  {draft.cells.map((cell, i) =>
                    cell.c === ' ' ? (
                      <span key={i} className="w-3" />
                    ) : (
                      // ★ ช่องที่ซ่อนต้องหน้าตาเหมือนที่ลูกทัวร์เห็น: ซ่อนแค่ตัวฐาน สระ/วรรณยุกต์ยังอยู่
                      //   เดิมขีดฆ่าทั้ง "ปี" จนเจ้าของโปรเจกต์เข้าใจว่า ี ถูกซ่อนไปด้วย (11 ก.ย. 2026)
                      //   ตัวที่ซ่อนโชว์เป็นป้ายเล็กมุมล่าง ให้คนสร้างข้อรู้ว่าช่องนี้คือตัวอะไร
                      //   ⚠️ ห้ามใส่ transition สีพื้น — ระหว่างเปลี่ยนสี สีที่ทับตัวฐานไม่ตรงพื้น จะเห็นเงา "อ" แวบหนึ่ง
                      <button
                        key={i}
                        type="button"
                        disabled={!canHide(cell)}
                        onClick={() => toggleHide(i)}
                        aria-pressed={cell.h}
                        aria-label={cell.h ? tw('builder.hiddenLetter', { c: cell.c }) : `${cell.c}${cell.m}`}
                        className={`relative flex h-14 min-w-[3rem] items-end justify-center rounded-xl border-2 px-2 pb-1 text-2xl font-extrabold leading-[1.9] transition-transform active:scale-95 ${
                          cell.h ? 'border-gray-400 text-gray-900' : 'border-line bg-surface text-ink'
                        }`}
                        style={cell.h ? { background: HIDDEN_BG } : undefined}
                      >
                        {cell.h ? (
                          <>
                            <MarksOnly marks={cell.m} bg={HIDDEN_BG} ink="#111827" />
                            <span className="absolute bottom-1 right-1.5 text-xs font-bold leading-none text-gray-500">
                              {cell.c}
                            </span>
                          </>
                        ) : (
                          `${cell.c}${cell.m}`
                        )}
                      </button>
                    )
                  )}
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={hiddenCount ? 'font-bold text-ink' : 'font-bold text-warning-text'}>
                    {tw('builder.hiddenCount', { n: hiddenCount })}
                  </span>
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      className="font-semibold text-ink-muted underline"
                      onClick={() => patch({ cells: draft.cells.map((x) => ({ ...x, h: false })) })}
                    >
                      {tw('builder.clearHidden')}
                    </button>
                  )}
                </div>
              </>
            )}
          </section>

          {/* 3. พรีวิว — WordBoard ตัวเดียวกับมือถือลูกทัวร์ */}
          {draft.cells.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-bold text-ink">{tw('builder.preview')}</h2>
              <div className="rounded-2xl border-[3px] border-ink bg-white px-2 py-3 text-neutral-900">
                {draft.category.trim() && (
                  <p className="mb-1 text-center text-sm font-black">
                    {tw('category', { name: draft.category.trim() })}
                  </p>
                )}
                <WordBoard cells={previewCells} surface="phone" className="text-neutral-900" />
                {G.shuffle && draft.pool && (
                  <ShufflePool tiles={poolTiles(draft.pool)} boardCells={previewCells} surface="phone" className="mt-3" />
                )}
              </div>
              {/* Word Shuffle: ไม่ชอบลำดับที่ได้ → สลับใหม่ได้เรื่อยๆ (ลำดับใหม่ไม่ตรงคำตอบเสมอ) */}
              {G.shuffle && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-faint">
                    {tw('builder.tileCount', { n: (draft.pool ?? []).length })}
                  </span>
                  <Button
                    variant="secondary"
                    fullWidth={false}
                    className="px-3 py-2 text-sm"
                    onClick={() => patch({ pool: shuffleTiles(draft.cells) })}
                  >
                    <Icon name="shuffle" size={16} />
                    {tw('builder.reshuffle')}
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* 4. คำที่ยอมรับเพิ่ม + ทดลองตรวจ — ต้องอยู่ติดคำตอบเสมอ */}
          <section className="space-y-2">
            <label className="block text-sm font-bold text-ink">{tw('builder.aliases')}</label>
            <p className="text-xs text-ink-faint">{tw('builder.aliasesHint')}</p>
            <input
              value={(draft.answer_aliases ?? []).join(', ')}
              onChange={(e) => patch({ answer_aliases: e.target.value.split(',').map((x) => x.trimStart()) })}
              placeholder={G.aliasesPlaceholder}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2"
            />
            <div className="flex gap-2">
              <input
                value={testWord}
                onChange={(e) => setTestWord(e.target.value)}
                placeholder={tw('builder.testPlaceholder')}
                className="flex-1 rounded-xl border border-line bg-surface px-3 py-2"
              />
              <Button
                variant="secondary"
                fullWidth={false}
                className="px-3 py-2 text-sm"
                disabled={!draft.cells.length || !testWord.trim()}
                onClick={handleTest}
              >
                {tw('builder.test')}
              </Button>
            </div>
            {testResult !== null && (
              <p className={`text-sm font-bold ${testResult ? 'text-success-text' : 'text-danger-text'}`}>
                {testResult ? tw('builder.testPass') : tw('builder.testFail')}
              </p>
            )}
          </section>

          {/* 5. คำอธิบายตอนเฉลย + เวลา */}
          <section className="space-y-2">
            <label className="block text-sm font-bold text-ink">{tw('builder.explain')}</label>
            <input
              value={draft.explain}
              onChange={(e) => patch({ explain: e.target.value })}
              placeholder={tw('builder.explainPlaceholder')}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2"
            />
            <label className="block text-xs font-bold text-ink-muted">{tw('builder.timeLimit')}</label>
            <input
              type="number"
              min={20}
              max={300}
              value={draft.time_limit_sec}
              onChange={(e) => patch({ time_limit_sec: e.target.value })}
              className="w-28 rounded-xl border border-line bg-surface px-3 py-2"
            />
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
      <StaffHeader icon="edit" title={tw('builder.title')} subtitle={setMeta?.title ?? ''} />

      <div className="mx-auto max-w-md space-y-3 p-4">
        {error && (
          <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
        )}

        <section className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-sm font-bold text-ink">{tw('builder.setSettings')}</h2>
          <label className="mt-3 block text-sm font-bold text-ink" htmlFor="answer-mode">
            {tw('builder.answerMode')}
          </label>
          <select
            id="answer-mode"
            value={setMeta?.answer_mode === 'none' ? 'none' : 'type'}
            onChange={(e) => saveAnswerMode(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
          >
            <option value="type">{tw('builder.modeType')}</option>
            <option value="none">{tw('builder.modeNone')}</option>
          </select>
          {setMeta?.answer_mode === 'none' && (
            <p className="mt-1.5 text-xs text-ink-faint">{tw('builder.modeNoneHint')}</p>
          )}

          {/* ไม่ต้องตอบ = ไม่มีใครส่งคำตอบ — "ครบกี่คนแล้วเฉลย" ไม่มีความหมาย ซ่อนไปเลย */}
          {setMeta?.answer_mode !== 'none' && (
            <>
              <label className="mt-3 block text-sm font-bold text-ink" htmlFor="solve-limit">
                {tw('builder.solveLimit')}
              </label>
              <p className="mb-1.5 text-xs text-ink-faint">{tw('builder.solveLimitHint')}</p>
              <select
                id="solve-limit"
                value={setMeta?.solve_limit == null ? '' : String(setMeta.solve_limit)}
                onChange={(e) => saveSolveLimit(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
              >
                {[1, 2, 3, 5, 10].map((n) => (
                  <option key={n} value={String(n)}>
                    {tw('builder.solveLimitN', { n })}
                  </option>
                ))}
                <option value="">{tw('builder.solveLimitOff')}</option>
              </select>
            </>
          )}
        </section>

        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-faint">
            {tw('builder.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item, i) => (
              <li
                key={item.question_id}
                className="rounded-2xl border border-line bg-surface p-3 shadow-card"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-ink-faint">{i + 1}</span>
                  <span className="rounded-full bg-brand-lighter px-2 py-0.5 text-[11px] font-bold text-brand">
                    {item.category}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right text-sm font-bold text-ink">
                    {item.correct_text}
                  </span>
                </div>
                {/* รายการข้อโชว์โจทย์แบบที่ลูกทัวร์เห็น — Word Shuffle คือกองตัวสลับ (ช่องคำตอบว่างหมดไม่บอกอะไร) */}
                {G.shuffle ? (
                  <ShufflePool tiles={poolTiles(item.pool ?? [])} surface="mini" className="mt-2" />
                ) : (
                  <WordBoard
                    cells={applyOpened(maskCells(item.cells ?? []), [])}
                    surface="mini"
                    className="mt-1 text-ink"
                  />
                )}
                <div className="mt-2 flex gap-2">
                  <Button
                    fullWidth={false}
                    variant="secondary"
                    className="px-3 py-1.5 text-sm"
                    onClick={() => {
                      setConfirmDelete(null)
                      setDraft({
                        ...emptyDraft(),
                        question_id: item.question_id,
                        category: item.category ?? '',
                        text: item.correct_text ?? '',
                        cells: (item.cells ?? []).map((x) => ({ c: x.c, m: x.m ?? '', h: Boolean(x.h) })),
                        pool: item.pool ?? null,
                        answer_aliases: item.answer_aliases ?? [],
                        explain: item.explain ?? '',
                        time_limit_sec: item.time_limit_sec ?? 90,
                      })
                    }}
                  >
                    <Icon name="edit" size={16} />
                    {t('common.edit')}
                  </Button>
                  <Button
                    fullWidth={false}
                    variant="ghost"
                    className="px-3 py-1.5 text-sm text-danger-text"
                    disabled={busy}
                    onClick={() => handleDelete(item.question_id)}
                  >
                    {confirmDelete === item.question_id ? tw('builder.confirmDelete') : t('common.delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button
          onClick={() => {
            setConfirmDelete(null)
            setDraft(emptyDraft())
          }}
        >
          + {tw('builder.addItem')}
        </Button>
        <Button variant="ghost" onClick={() => navigate(G.base)}>
          {t('common.back')}
        </Button>
      </div>
    </div>
  )
}
