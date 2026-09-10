import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession } from '../../lib/staffSession'
import { getQuizPin, saveQuizPin } from '../../lib/quizPin'
import { fetchTilesSet, saveTilesQuestion, tryAnswer } from '../../lib/tileHost'
import {
  uploadQuizMedia,
  TILE_IMAGE_WIDTH, TILE_IMAGE_QUALITY,
  COVER_IMAGE_WIDTH, COVER_IMAGE_QUALITY,
} from '../../lib/quizMedia'
import { GRID_PRESETS, MAX_STEP, tileCount, tileShapeWarning } from '../../lib/tileGrid'
import TileBoard from '../../components/tiles/TileBoard'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// ⚠️ cropperjs หนักและมีแต่หน้านี้ที่ใช้ — ต้องผ่าน lazy เท่านั้น
//    และต้องกัน chunk นี้ออกจาก workbox precache ด้วย (ดู vite.config.js)
//    ลืมข้อหลังแล้วลูกทัวร์ 40 คนจะโหลดไลบรารีแต่งรูปบน 4G โดยไม่มีอะไรฟ้อง
const ImageCropper = lazy(() => import('../../components/common/ImageCropper.jsx'))

// สร้าง/แก้ชุดเกมเปิดแผ่นป้าย
//
// ต้องใส่ PIN ก่อนเข้า เพราะหน้านี้อ่านเฉลยและ URL ภาพจริง ซึ่งอยู่ใน quiz_keys
// ที่ปิดจาก anon — สตาฟกับลูกทัวร์ใช้ anon key ตัวเดียวกัน
//
// ★ ลำดับการกรอกตั้งใจให้ "ภาพมาก่อนกริด" เพราะกริดที่เหมาะขึ้นกับสัดส่วนภาพ
//   และพรีวิวกระดานจริงอยู่ติดกับปุ่มเลือกกริด คนสร้างข้อจะเห็นผลทันทีที่กด

function emptyDraft() {
  return {
    question_id: null,
    question_text: '',
    time_limit_sec: 300,
    grid_rows: 3,
    grid_cols: 4,
    open_step: 1,
    cover_image_url: null,
    crop_x: 0, crop_y: 0, crop_w: 1, crop_h: 1,
    tile_image_url: null,
    correct_text: '',
    answer_aliases: [],
    explain: '',
  }
}

export default function TilesBuilder() {
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
  const [preview, setPreview] = useState('closed')   // closed | open
  const [testWord, setTestWord] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testedOnce, setTestedOnce] = useState(false)
  const [confirmUntested, setConfirmUntested] = useState(false)
  const [cropping, setCropping] = useState(null)     // { file } | { src }

  const crop = draft
    ? { x: draft.crop_x, y: draft.crop_y, w: draft.crop_w, h: draft.crop_h }
    : null

  const load = useCallback(
    async (usePin) => {
      setError('')
      try {
        const rows = await fetchTilesSet({ setId, staffId, pin: usePin })
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
      .select('id, title, description, game_kind, answer_mode, attempt_limit')
      .eq('id', setId)
      .maybeSingle()
      .then(({ data }) => setSetMeta(data ?? null))
  }, [setId])

  useEffect(() => {
    if (pin) load(pin)
  }, [pin, load])

  // อ่านสัดส่วนจากไฟล์จริง — ใช้สองอย่าง: เตือนรูปทรงแผ่น และเก็บลง DB ตอนบันทึก
  useEffect(() => {
    const url = draft?.tile_image_url
    if (!url) return undefined
    if (draft?._aspect) return undefined     // วัดไปแล้ว ไม่ต้องโหลดซ้ำ
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (alive && img.naturalHeight) {
        setDraft((d) => (d ? { ...d, _aspect: img.naturalWidth / img.naturalHeight } : d))
      }
    }
    img.src = url
    return () => { alive = false }
  }, [draft?.tile_image_url])

  const imgAspectWarning = useMemo(
    () =>
      draft
        ? tileShapeWarning(draft._aspect ?? draft.image_aspect, draft.grid_rows, draft.grid_cols, crop)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft?._aspect, draft?.image_aspect, draft?.grid_rows, draft?.grid_cols,
     draft?.crop_x, draft?.crop_y, draft?.crop_w, draft?.crop_h]
  )

  function patch(next) {
    setDraft((d) => ({ ...d, ...next }))
    setTestResult(null)
    setConfirmUntested(false)
  }

  // ── ภาพหลัก: เลือกไฟล์ → ครอปก่อน → ค่อยอัป ───────────────────────
  function pickImage(file) {
    if (!file) return
    setCropping({ file })
  }

  async function handleCropDone({ crop: c, baked }) {
    const source = cropping
    setCropping(null)
    setBusy(true)
    setError('')
    try {
      // baked = ผู้ใช้หมุนภาพ กรอบแสดงเป็นสี่เหลี่ยมในพิกัดเดิมไม่ได้ ต้องอัปไฟล์ที่อบแล้ว
      // ไม่ baked = เก็บแค่ตัวเลข ปรับกรอบใหม่ทีหลังได้โดยไม่ต้องหาไฟล์ต้นฉบับอีก
      if (baked || source?.file) {
        const { url } = await uploadQuizMedia(setId, baked ?? source.file, {
          maxWidth: TILE_IMAGE_WIDTH,
          quality: TILE_IMAGE_QUALITY,
        })
        patch({ tile_image_url: url, crop_x: c.x, crop_y: c.y, crop_w: c.w, crop_h: c.h, _aspect: null })
      } else {
        patch({ crop_x: c.x, crop_y: c.y, crop_w: c.w, crop_h: c.h })
      }
    } catch (err) {
      setError(t(`staff.quiz.mediaErr.${err.code ?? 'upload'}`, { defaultValue: String(err.message) }))
    } finally {
      setBusy(false)
    }
  }

  async function handleCoverImage(file) {
    if (!file) return
    setBusy(true)
    try {
      const { url } = await uploadQuizMedia(setId, file, {
        maxWidth: COVER_IMAGE_WIDTH,
        quality: COVER_IMAGE_QUALITY,
      })
      patch({ cover_image_url: url })
    } catch (err) {
      setError(t(`staff.quiz.mediaErr.${err.code ?? 'upload'}`, { defaultValue: String(err.message) }))
    } finally {
      setBusy(false)
    }
  }

  async function runTest() {
    const ok = await tryAnswer(draft.correct_text, draft.answer_aliases, testWord)
    setTestResult(ok)
    setTestedOnce(true)
  }

  // ── ตั้งค่าระดับชุด ────────────────────────────────────────────────
  async function patchSet(next) {
    setSetMeta((m) => ({ ...m, ...next }))
    await supabase.from('quiz_sets').update(next).eq('id', setId)
  }

  async function handleSave() {
    setError('')
    if (!draft.tile_image_url) {
      setError(t('tiles.builder.needImage'))
      return
    }
    if (!draft.correct_text.trim()) {
      setError(t('tiles.builder.needAnswer'))
      return
    }

    // ★ ตื๊อให้ทดสอบคำตอบก่อน — ไม่ใช่ของประดับ
    //   เกมนี้คนแรกที่ถูกจบข้อทันที คนที่รู้คำตอบแต่สะกดไม่ตรงจะแพ้ให้คนที่พิมพ์ตรงกว่า
    //   และข้อจบก่อนคนคุมเกมจะได้เห็น feed ด้วยซ้ำ — แก้ที่ต้นทางได้ที่เดียวคือตรงนี้
    if (!testedOnce && draft.answer_aliases.length === 0 && !confirmUntested) {
      setConfirmUntested(true)
      return
    }

    setBusy(true)
    try {
      await saveTilesQuestion({
        staffId, pin, setId,
        questionId: draft.question_id,
        text: draft.question_text,
        timeLimitSec: draft.time_limit_sec,
        gridRows: draft.grid_rows,
        gridCols: draft.grid_cols,
        openStep: draft.open_step,
        coverImageUrl: draft.cover_image_url,
        crop: { x: draft.crop_x, y: draft.crop_y, w: draft.crop_w, h: draft.crop_h },
        imageUrl: draft.tile_image_url,
        answer: draft.correct_text,
        aliases: draft.answer_aliases,
        explain: draft.explain,
        sortOrder: draft.question_id
          ? items.find((i) => i.question_id === draft.question_id)?.sort_order ?? 0
          : items.length,
        // ★ สัดส่วนภาพต้องถูกเก็บลง DB ไม่งั้นมือถือลูกทัวร์คำนวณรูปทรงกระดานไม่ได้
        //   แล้วจะได้กระดานคนละรูปทรงกับโปรเจกเตอร์ (ดู TileBoard)
        imageAspect: draft._aspect ?? draft.image_aspect ?? null,
      })
      setDraft(null)
      setTestedOnce(false)
      await load(pin)
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(questionId) {
    setBusy(true)
    try {
      await supabase.rpc('quiz_delete_question', {
        p_staff_id: staffId, p_pin: pin, p_question_id: questionId,
      })
      await load(pin)
    } catch (err) {
      setError(err.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  // ── หน้าใส่ PIN ────────────────────────────────────────────────────
  if (!unlocked) {
    return (
      <div className="min-h-screen bg-surface-muted">
        <StaffHeader icon="game" title={t('tiles.title')} subtitle={setMeta?.title ?? ''} />
        <div className="mx-auto max-w-md space-y-3 p-4">
          <p className="text-sm font-bold text-ink">{t('staff.quiz.pinTitle')}</p>
          <p className="text-sm text-ink-muted">{t('staff.quiz.pinHint')}</p>
          <input
            type="password" inputMode="numeric" autoFocus
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-2"
          />
          {error && <p className="text-sm text-danger-text">{error}</p>}
          <Button onClick={() => load(pinInput)}>{t('common.confirm')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      {/* กำลังแก้ข้อ = ย้อนกลับไปรายการข้อ (เหมือนปุ่มยกเลิก) ไม่ใช่ออกจากชุด */}
      <StaffHeader icon="game" title={setMeta?.title ?? t('tiles.title')}
                   subtitle={t('tiles.builder.subtitle', { count: items.length })}
                   onBack={draft ? () => { setDraft(null); setConfirmUntested(false) } : undefined} />

      <div className="mx-auto max-w-md space-y-5 p-4">
        {error && <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>}

        {/* ── ตั้งค่าระดับชุด ───────────────────────────────── */}
        {setMeta && !draft && (
          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-sm font-bold text-ink-muted">{t('tiles.builder.setSettings')}</h2>

            <label className="block">
              <span className="text-xs font-semibold text-ink-muted">{t('tiles.builder.answerMode')}</span>
              <select
                value={setMeta.answer_mode ?? 'type'}
                onChange={(e) => patchSet({ answer_mode: e.target.value })}
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
              >
                <option value="type">{t('tiles.builder.modeType')}</option>
                <option value="none">{t('tiles.builder.modeNone')}</option>
              </select>
            </label>

            {setMeta.answer_mode !== 'none' && (
              <label className="block">
                <span className="text-xs font-semibold text-ink-muted">{t('tiles.builder.attemptLimit')}</span>
                <select
                  value={setMeta.attempt_limit ?? ''}
                  onChange={(e) =>
                    patchSet({ attempt_limit: e.target.value === '' ? null : Number(e.target.value) })}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                >
                  <option value="">{t('tiles.builder.unlimited')}</option>
                  {[1, 2, 3, 5, 8, 10].map((n) => (
                    <option key={n} value={n}>{t('tiles.builder.nTries', { n })}</option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink-faint">{t('tiles.builder.attemptHint')}</span>
              </label>
            )}
          </section>
        )}

        {/* ── รายการข้อ ─────────────────────────────────────── */}
        {!draft && (
          <section className="space-y-2.5">
            {items.map((it, i) => (
              <div key={it.question_id} className="rounded-2xl border border-line bg-surface p-3 shadow-card">
                <div className="flex items-center gap-3">
                  <div className="w-20 shrink-0">
                    <TileBoard
                      rows={it.grid_rows} cols={it.grid_cols}
                      crop={{ x: it.crop_x, y: it.crop_y, w: it.crop_w, h: it.crop_h }}
                      imageUrl={it.tile_image_url}
                      imageAspect={it.image_aspect}
                      coverImageUrl={it.cover_image_url}
                      revealed={Array.from({ length: tileCount(it.grid_rows, it.grid_cols) }, (_, k) => k + 1)}
                      showNumbers={false}
                      animate={false}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-ink">{i + 1}. {it.correct_text}</p>
                    <p className="text-xs text-ink-muted">
                      {t('tiles.builder.itemMeta', {
                        grid: `${it.grid_rows}×${it.grid_cols}`,
                        aliases: it.answer_aliases?.length ?? 0,
                      })}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button fullWidth={false} variant="ghost" className="px-3 py-1.5 text-sm"
                          onClick={() => { setDraft({ ...it }); setTestedOnce(false); setPreview('closed') }}>
                    {t('common.edit')}
                  </Button>
                  <Button fullWidth={false} variant="ghost" className="px-3 py-1.5 text-sm text-danger-text"
                          onClick={() => handleDelete(it.question_id)}>
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => { setDraft(emptyDraft()); setTestedOnce(false); setPreview('closed') }}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong p-4 text-sm font-bold text-ink-muted"
            >
              <Icon name="plus" size={18} />
              {t('tiles.builder.addQuestion')}
            </button>

            <Button variant="ghost" onClick={() => navigate('/staff/tiles')}>{t('common.back')}</Button>
          </section>
        )}

        {/* ── ฟอร์มแก้ข้อ ───────────────────────────────────── */}
        {draft && (
          <section className="space-y-4">
            {/* 1. ภาพ */}
            <div className="space-y-2 rounded-2xl border border-line bg-surface p-4 shadow-card">
              <h2 className="text-sm font-bold text-ink-muted">{t('tiles.builder.image')}</h2>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-3 text-sm font-semibold text-ink-muted">
                <Icon name="expand" size={18} />
                {draft.tile_image_url ? t('tiles.builder.changeImage') : t('tiles.builder.pickImage')}
                <input type="file" accept="image/*" className="hidden"
                       onChange={(e) => pickImage(e.target.files?.[0])} />
              </label>
              {draft.tile_image_url && (
                <Button variant="ghost" className="text-sm"
                        onClick={() => setCropping({ src: draft.tile_image_url })}>
                  {t('tiles.builder.recrop')}
                </Button>
              )}
            </div>

            {/* 2. กริด + พรีวิว */}
            {draft.tile_image_url && (
              <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
                <h2 className="text-sm font-bold text-ink-muted">{t('tiles.builder.grid')}</h2>
                <div className="flex flex-wrap gap-2">
                  {GRID_PRESETS.map((g) => {
                    const on = draft.grid_rows === g.rows && draft.grid_cols === g.cols
                    return (
                      <button key={g.label} type="button"
                              onClick={() => patch({ grid_rows: g.rows, grid_cols: g.cols })}
                              className={[
                                'rounded-full px-3 py-1.5 text-sm font-semibold transition',
                                on ? 'bg-brand text-white' : 'bg-neutral-bg text-ink-muted',
                              ].join(' ')}>
                        {g.label}
                      </button>
                    )
                  })}
                </div>

                <label className="block">
                  <span className="text-xs font-semibold text-ink-muted">{t('tiles.builder.openStep')}</span>
                  <select value={draft.open_step}
                          onChange={(e) => patch({ open_step: Number(e.target.value) })}
                          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                    {Array.from({ length: MAX_STEP }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{t('tiles.builder.nTiles', { n })}</option>
                    ))}
                  </select>
                </label>

                {/* พรีวิวกระดานจริง — component เดียวกับจอเวที
                    พรีวิวที่ไม่ตรงของจริงแย่กว่าไม่มีพรีวิว */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    {['closed', 'open'].map((m) => (
                      <button key={m} type="button" onClick={() => setPreview(m)}
                              className={[
                                'rounded-full px-3 py-1 text-xs font-semibold',
                                preview === m ? 'bg-ink text-white' : 'bg-neutral-bg text-ink-muted',
                              ].join(' ')}>
                        {t(`tiles.builder.preview.${m}`)}
                      </button>
                    ))}
                  </div>
                  <TileBoard
                    rows={draft.grid_rows} cols={draft.grid_cols} crop={crop}
                    imageUrl={draft.tile_image_url}
                    imageAspect={draft._aspect ?? draft.image_aspect}
                    coverImageUrl={draft.cover_image_url}
                    revealed={preview === 'open'
                      ? Array.from({ length: tileCount(draft.grid_rows, draft.grid_cols) }, (_, k) => k + 1)
                      : []}
                    animate={false}
                  />
                  {imgAspectWarning && (
                    <p className="rounded-xl bg-warning-bg px-3 py-2 text-xs text-warning-text">
                      {t(`tiles.builder.shapeWarn.${imgAspectWarning}`)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 3. ภาพตอนปิด */}
            <div className="space-y-2 rounded-2xl border border-line bg-surface p-4 shadow-card">
              <h2 className="text-sm font-bold text-ink-muted">{t('tiles.builder.cover')}</h2>
              <p className="text-xs text-ink-faint">{t('tiles.builder.coverHint')}</p>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-3 text-sm font-semibold text-ink-muted">
                <Icon name="expand" size={18} />
                {draft.cover_image_url ? t('tiles.builder.changeCover') : t('tiles.builder.pickCover')}
                <input type="file" accept="image/*" className="hidden"
                       onChange={(e) => handleCoverImage(e.target.files?.[0])} />
              </label>
              {draft.cover_image_url && (
                <Button variant="ghost" className="text-sm" onClick={() => patch({ cover_image_url: null })}>
                  {t('tiles.builder.removeCover')}
                </Button>
              )}
            </div>

            {/* 4. คำตอบ */}
            <div className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
              <h2 className="text-sm font-bold text-ink-muted">{t('tiles.builder.answerSection')}</h2>

              <label className="block">
                <span className="text-xs font-semibold text-ink-muted">{t('tiles.builder.questionText')}</span>
                <input value={draft.question_text}
                       onChange={(e) => patch({ question_text: e.target.value })}
                       placeholder={t('tiles.builder.questionPlaceholder')}
                       className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-ink-muted">{t('tiles.builder.answer')}</span>
                <input value={draft.correct_text}
                       onChange={(e) => patch({ correct_text: e.target.value })}
                       className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
              </label>

              {/* ช่องคำที่ยอมรับเพิ่ม ต้องอยู่ติดกับช่องคำตอบเสมอ ไม่ซ่อนใน "ขั้นสูง"
                  คนสร้างข้อต้องนึกถึงคำที่สะกดต่างตอนนั้นเลย ไม่ใช่ตอนยืนอยู่หน้าไมค์ */}
              <label className="block">
                <span className="text-xs font-semibold text-ink-muted">{t('tiles.builder.aliases')}</span>
                <input
                  value={draft.answer_aliases.join(', ')}
                  onChange={(e) => patch({
                    answer_aliases: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
                  })}
                  placeholder={t('tiles.builder.aliasesPlaceholder')}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs text-ink-faint">{t('tiles.builder.aliasesHint')}</span>
              </label>

              {/* ทดสอบคำตอบ — ใช้ normalize ตัวเดียวกับ server จึงได้ผลตรงกับตอนเล่นจริง */}
              <div className="rounded-xl bg-neutral-bg p-3">
                <span className="text-xs font-semibold text-ink-muted">{t('tiles.builder.testAnswer')}</span>
                <div className="mt-1 flex gap-2">
                  <input value={testWord} onChange={(e) => setTestWord(e.target.value)}
                         placeholder={t('tiles.builder.testPlaceholder')}
                         className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
                  <Button fullWidth={false} variant="secondary" className="px-3 py-2 text-sm"
                          onClick={runTest} disabled={!draft.correct_text.trim() || !testWord.trim()}>
                    {t('tiles.builder.testRun')}
                  </Button>
                </div>
                {testResult !== null && (
                  <p className={`mt-2 text-sm font-semibold ${testResult ? 'text-success-text' : 'text-danger-text'}`}>
                    {testResult ? t('tiles.builder.testPass') : t('tiles.builder.testFail')}
                  </p>
                )}
              </div>

              <label className="block">
                <span className="text-xs font-semibold text-ink-muted">{t('tiles.builder.explain')}</span>
                <input value={draft.explain}
                       onChange={(e) => patch({ explain: e.target.value })}
                       className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
              </label>
            </div>

            {confirmUntested && (
              <p className="rounded-xl bg-warning-bg px-3 py-2 text-sm text-warning-text">
                {t('tiles.builder.untestedWarn')}
              </p>
            )}

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={busy}>
                {confirmUntested ? t('tiles.builder.saveAnyway') : t('common.save')}
              </Button>
              <Button variant="ghost" onClick={() => { setDraft(null); setConfirmUntested(false) }}>
                {t('common.cancel')}
              </Button>
            </div>
          </section>
        )}
      </div>

      {cropping && (
        <Suspense fallback={<div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/95 text-white">{t('common.loading')}</div>}>
          <ImageCropper
            file={cropping.file ?? null}
            src={cropping.src ?? null}
            initialCrop={cropping.src ? crop : null}
            title={t('tiles.builder.cropTitle')}
            onCancel={() => setCropping(null)}
            onDone={handleCropDone}
          />
        </Suspense>
      )}
    </div>
  )
}
