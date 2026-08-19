import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession, useActiveTourId, useActiveOrgId } from '../../lib/staffSession'
import { can } from '../../lib/permissions'
import { startSession, setSessionState, getHostToken, cloneSet } from '../../lib/quizHost'
import { STAGE_SKIN_LIST } from '../../lib/quizStyle'
import { getQuizPin, saveQuizPin } from '../../lib/quizPin'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// หน้ารวมควิซของทีมงาน — 2 ส่วนในหน้าเดียว (โครงเดียวกับ BingoHost ตอนยังไม่มีเกม)
//   1. ห้องที่เปิดอยู่ — เข้าไปคุมต่อ หรือปิดทิ้ง
//   2. คลังชุดคำถาม — สร้างห้องจากชุดไหนก็ได้
//
// รถ 2 คันเล่นพร้อมกัน = สร้าง 2 ห้อง ใส่รถคนละคัน ไม่ต้องมีโหมดพิเศษอะไร

const SCREEN_MODES = ['projector', 'bus_tv', 'none']

export default function QuizManager() {
  const tourId = useActiveTourId()
  const orgId = useActiveOrgId()
  const session = getStaffSession()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [rooms, setRooms] = useState([])
  const [sets, setSets] = useState([])
  const [buses, setBuses] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [creatingFor, setCreatingFor] = useState(null)
  const [form, setForm] = useState({
    name: '', busId: '', screenMode: 'projector', stageTheme: 'day', teamMode: false, teamSizeLimit: 0,
  })
  const [error, setError] = useState('')
  const [destinations, setDestinations] = useState([])
  const [destFilter, setDestFilter] = useState('')
  const [history, setHistory] = useState([])

  // ชุดที่ไม่ผูกปลายทาง (destination_id = null) ต้องเห็นเสมอ
  // เพราะเป็นชุดกลางแบบ "ความรู้ทั่วไป" ที่ใช้ได้ทุกทริป
  const visibleSets = destFilter
    ? sets.filter((s) => !s.destination_id || s.destination_id === destFilter)
    : sets

  const load = useCallback(async () => {
    if (!tourId) return

    const [{ data: roomRows }, { data: setRows }, { data: busRows }] = await Promise.all([
      supabase
        .from('quiz_sessions')
        .select('id, name, set_id, bus_id, state, current_index, screen_mode, created_at')
        .eq('tour_id', tourId)
        .neq('state', 'finished')
        .order('created_at', { ascending: false }),
      supabase
        .from('quiz_sets')
        .select('id, title, description, lang, default_time_limit, destination_id')
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false }),
      supabase.from('buses').select('id, name').eq('tour_id', tourId).order('name'),
    ])

    // ห้องที่จบแล้ว — เก็บไว้ดูรายงานย้อนหลัง ไม่ปนกับห้องที่กำลังเล่น
    supabase
      .from('quiz_sessions')
      .select('id, name, ended_at, set_id, team_mode')
      .eq('tour_id', tourId)
      .eq('state', 'finished')
      .order('ended_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setHistory(data ?? []))

    supabase
      .from('destinations')
      .select('id, name')
      .eq('org_id', orgId)
      .order('name')
      .then(({ data }) => setDestinations(data ?? []))

    setRooms(roomRows ?? [])
    setSets(setRows ?? [])
    setBuses(busRows ?? [])
    setLoading(false)

    // จำนวนคนในแต่ละห้อง — ยิงทีเดียวแล้วนับฝั่ง client ถูกกว่ายิงต่อห้อง
    const ids = (roomRows ?? []).map((r) => r.id)
    if (ids.length) {
      const { data: players } = await supabase
        .from('quiz_players')
        .select('session_id')
        .in('session_id', ids)
      const tally = {}
      for (const p of players ?? []) tally[p.session_id] = (tally[p.session_id] ?? 0) + 1
      setCounts(tally)
    }
  }, [tourId, orgId])

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 10000)
    return () => clearInterval(timer)
  }, [load])

  async function handleCreateRoom(set) {
    setError('')
    try {
      const row = await startSession({
        tourId,
        setId: set.id,
        name: form.name || set.title,
        busId: form.busId || null,
        screenMode: form.screenMode,
        stageTheme: form.stageTheme,
        staffId: session?.staff?.id ?? null,
        teamMode: form.teamMode,
        teamSizeLimit: Number(form.teamSizeLimit) || 0,
      })
      navigate(`/staff/quiz/host/${row.session_id}`)
    } catch (err) {
      setError(err.message ?? String(err))
    }
  }

  async function handleClose(room) {
    setError('')
    try {
      // ต้องมี token ของห้องนั้นถึงจะสั่งได้ — คนละเครื่องกับคนสร้างห้องจะปิดไม่ได้
      if (!getHostToken(room.id)) {
        setError(t('staff.quiz.noToken'))
        return
      }
      await setSessionState(room.id, 'finished')
      load()
    } catch (err) {
      setError(err.message ?? String(err))
    }
  }

  // clone ต้องใช้ PIN เพราะต้องก็อป "เฉลย" ซึ่งอยู่ในตารางที่ปิดจาก anon
  async function handleClone(set) {
    setError('')
    let pin = getQuizPin()
    if (!pin) {
      pin = window.prompt(t('staff.quiz.pinTitle'))
      if (!pin) return
    }
    try {
      const newId = await cloneSet({
        staffId: session?.staff?.id ?? null,
        pin,
        setId: set.id,
        title: null,
      })
      saveQuizPin(pin)
      navigate(`/staff/quiz/builder/${newId}`)
    } catch (err) {
      setError(err.message ?? String(err))
    }
  }

  async function handleNewSet() {
    const { data, error: err } = await supabase
      .from('quiz_sets')
      .insert({ org_id: orgId, title: t('staff.quiz.newSetName'), created_by: session?.staff?.id ?? null })
      .select('id')
      .single()
    if (err) {
      setError(err.message)
      return
    }
    navigate(`/staff/quiz/builder/${data.id}`)
  }

  return (
    <div className="min-h-screen bg-canvas pb-16">
      <StaffHeader
        title={t('staff.quiz.title')}
        subtitle={t('staff.quiz.subtitle')}
        icon="game"
        backTo="/staff/games"
      />

      <div className="mx-auto max-w-md space-y-6 px-4 pt-4">
        {error && (
          <p className="rounded-control bg-danger-bg px-3 py-2 text-sm font-semibold text-danger-text">
            {error}
          </p>
        )}

        {/* ── ห้องที่เปิดอยู่ ─────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-muted">
            {t('staff.quiz.openRooms')}
          </h2>

          {loading ? (
            <p className="mt-2 text-sm text-ink-muted">{t('common.loading')}</p>
          ) : rooms.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-ink-muted">
              {t('staff.quiz.noRoom')}
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className="rounded-2xl border border-line bg-surface p-3.5 shadow-card"
                >
                  <div className="flex items-center gap-2">
                    <span className="block h-2 w-2 animate-pulse rounded-full bg-success" />
                    <span className="min-w-0 flex-1 truncate text-base font-extrabold text-ink">
                      {room.name}
                    </span>
                    <span className="flex-none text-xs font-bold text-ink-muted">
                      {counts[room.id] ?? 0} {t('staff.quiz.players')}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-ink-muted">
                    {t(`staff.quiz.state.${room.state}`)}
                    {room.bus_id
                      ? ` · ${buses.find((b) => b.id === room.bus_id)?.name ?? ''}`
                      : ''}
                  </p>

                  <div className="mt-2.5 flex gap-2">
                    <Button
                      fullWidth={false}
                      className="flex-1"
                      onClick={() => navigate(`/staff/quiz/host/${room.id}`)}
                    >
                      {t('staff.quiz.enterHost')}
                    </Button>
                    <Button
                      fullWidth={false}
                      variant="ghost"
                      className="flex-none"
                      onClick={() => handleClose(room)}
                    >
                      {t('staff.quiz.closeRoom')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── คลังชุดคำถาม ────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-muted">
              {t('staff.quiz.library')}
            </h2>
            {can(session, 'quiz.edit') && (
              <button
                type="button"
                onClick={handleNewSet}
                className="flex items-center gap-1 text-sm font-bold text-brand"
              >
                <Icon name="plus" size={16} />
                {t('staff.quiz.newSet')}
              </button>
            )}
          </div>

          {destinations.length > 0 && (
            <select
              value={destFilter}
              onChange={(e) => setDestFilter(e.target.value)}
              className="mt-2 w-full rounded-control border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none"
            >
              <option value="">{t('staff.quiz.allDestinations')}</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}

          {visibleSets.length === 0 ? (
            <p className="mt-2 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-ink-muted">
              {t('staff.quiz.noSet')}
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {visibleSets.map((set) => (
                <div
                  key={set.id}
                  className="rounded-2xl border border-line bg-surface p-3.5 shadow-card"
                >
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-extrabold text-ink">{set.title}</span>
                      {set.description && (
                        <span className="mt-0.5 block text-xs text-ink-muted">
                          {set.description}
                        </span>
                      )}
                    </span>
                    {can(session, 'quiz.edit') && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleClone(set)}
                          className="flex-none rounded-full p-1.5 text-ink-muted hover:bg-surface-sunken"
                          aria-label={t('staff.quiz.cloneSet')}
                          title={t('staff.quiz.cloneSet')}
                        >
                          <Icon name="copy" size={18} />
                        </button>
                        <Link
                          to={`/staff/quiz/builder/${set.id}`}
                          className="flex-none rounded-full p-1.5 text-ink-muted hover:bg-surface-sunken"
                          aria-label={t('common.edit')}
                        >
                          <Icon name="edit" size={18} />
                        </Link>
                      </>
                    )}
                  </div>

                  {creatingFor === set.id ? (
                    <div className="mt-3 space-y-2 rounded-xl bg-surface-sunken p-3">
                      <input
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder={set.title}
                        className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-brand"
                      />

                      <select
                        value={form.busId}
                        onChange={(e) => setForm((f) => ({ ...f, busId: e.target.value }))}
                        className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink outline-none"
                      >
                        <option value="">{t('staff.quiz.allBuses')}</option>
                        {buses.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>

                      <div className="flex gap-1.5">
                        {SCREEN_MODES.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, screenMode: mode }))}
                            className={`flex-1 rounded-control px-2 py-2 text-xs font-bold transition ${
                              form.screenMode === mode
                                ? 'bg-brand text-white'
                                : 'bg-surface text-ink-muted ring-1 ring-inset ring-line'
                            }`}
                          >
                            {t(`staff.quiz.screen.${mode}`)}
                          </button>
                        ))}
                      </div>

                      {/* สกินจอเวที — ซ่อนเมื่อเลือก "ไม่มีจอใหญ่" เพราะไม่มีจอให้แต่ง */}
                      {form.screenMode !== 'none' && (
                        <div className="flex gap-1.5">
                          {STAGE_SKIN_LIST.map((skin) => (
                            <button
                              key={skin.key}
                              type="button"
                              onClick={() => setForm((f) => ({ ...f, stageTheme: skin.key }))}
                              className={`flex flex-1 items-center justify-center gap-1.5 rounded-control px-2 py-2 text-xs font-bold transition ${
                                form.stageTheme === skin.key
                                  ? 'bg-brand text-white'
                                  : 'bg-surface text-ink-muted ring-1 ring-inset ring-line'
                              }`}
                            >
                              <span
                                className="h-2.5 w-2.5 flex-none rounded-full"
                                style={{ background: skin.accent }}
                              />
                              {t(`staff.quiz.stageTheme.${skin.key}`)}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* โหมดทีม — ลูกทัวร์ตั้งทีมกันเองในห้องรอ ทีมงานไม่ต้องจัดให้ */}
                      <label className="flex items-center gap-2.5 rounded-control bg-surface px-3 py-2">
                        <input
                          type="checkbox"
                          checked={form.teamMode}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, teamMode: e.target.checked }))
                          }
                          className="h-4 w-4 accent-brand"
                        />
                        <span className="flex-1 text-sm font-bold text-ink">
                          {t('staff.quiz.teamMode')}
                        </span>
                      </label>

                      {form.teamMode && (
                        <div className="space-y-1.5 rounded-control bg-surface px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="flex-1 text-sm text-ink-muted">
                              {t('staff.quiz.teamSizeLimit')}
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={99}
                              value={form.teamSizeLimit}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, teamSizeLimit: e.target.value }))
                              }
                              className="w-16 rounded-control border border-line bg-surface px-2 py-1.5 text-center text-sm font-bold text-ink outline-none"
                            />
                          </div>
                          <p className="text-xs text-ink-faint">{t('staff.quiz.teamHint')}</p>
                        </div>
                      )}

                      <div className="flex gap-2 pt-1">
                        <Button className="flex-1" onClick={() => handleCreateRoom(set)}>
                          {t('staff.quiz.createRoom')}
                        </Button>
                        <Button
                          variant="ghost"
                          fullWidth={false}
                          onClick={() => setCreatingFor(null)}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setForm({
                            name: '',
                            busId: '',
                            screenMode: 'projector',
                            stageTheme: 'day',
                            teamMode: false,
                            teamSizeLimit: 0,
                          })
                          setCreatingFor(set.id)
                        }}
                      >
                        {t('staff.quiz.openRoomFrom')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── ห้องที่จบแล้ว ───────────────────────────────────── */}
        {history.length > 0 && (
          <section>
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink-muted">
              {t('staff.quiz.history')}
            </h2>
            <div className="mt-2 space-y-1.5">
              {history.map((room) => (
                <Link
                  key={room.id}
                  to={`/staff/quiz/report/${room.id}`}
                  className="flex items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-card"
                >
                  <Icon name="fileText" size={18} className="flex-none text-ink-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">{room.name}</span>
                    <span className="text-xs text-ink-faint">
                      {room.ended_at ? new Date(room.ended_at).toLocaleString() : ''}
                    </span>
                  </span>
                  <Icon name="chevronRight" size={16} className="flex-none text-ink-faint" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
