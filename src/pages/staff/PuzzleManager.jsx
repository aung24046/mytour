import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession, useActiveTourId, useActiveOrgId } from '../../lib/staffSession'
import { startSession, setSessionState, getHostToken } from '../../lib/quizHost'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// หน้ารวมเกมปริศนาใบ้คำของทีมงาน — โครงเดียวกับ QuizManager
//   1. ห้องที่เปิดอยู่ — เข้าไปคุมต่อ หรือปิดทิ้ง
//   2. คลังชุดปริศนา — สร้างห้องจากชุดไหนก็ได้
//
// ทุก query ต้องกรอง game_kind = 'puzzle' เพราะใช้ตารางร่วมกับควิซ
// ถ้าลืม ชุดควิซจะมาโผล่ที่นี่แล้วกดสร้างห้องได้ทั้งที่หน้าจอคนละแบบ

const SCREEN_MODES = ['projector', 'bus_tv', 'none']

export default function PuzzleManager() {
  const tourId = useActiveTourId()
  const orgId = useActiveOrgId()
  const staffSession = getStaffSession()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [rooms, setRooms] = useState([])
  const [sets, setSets] = useState([])
  const [buses, setBuses] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [creatingFor, setCreatingFor] = useState(null)
  const [form, setForm] = useState({ name: '', busId: '', screenMode: 'projector' })
  const [newSetName, setNewSetName] = useState(null) // null = ยังไม่ได้กดสร้าง
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!tourId) return

    const [{ data: roomRows }, { data: setRows }, { data: busRows }] = await Promise.all([
      supabase
        .from('quiz_sessions')
        .select('id, name, set_id, bus_id, state, current_index, screen_mode, created_at')
        .eq('tour_id', tourId)
        .eq('game_kind', 'puzzle')
        .neq('state', 'finished')
        .order('created_at', { ascending: false }),
      supabase
        .from('quiz_sets')
        .select('id, title, description, default_time_limit')
        .eq('org_id', orgId)
        .eq('game_kind', 'puzzle')
        .eq('is_archived', false)
        .order('created_at', { ascending: false }),
      supabase.from('buses').select('id, name').eq('tour_id', tourId).order('name'),
    ])

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
      // game_kind / stage_theme ถูกคัดจากชุดฝั่ง DB ไม่ใช่ส่งมาจากที่นี่
      // (ดู quiz_start_session ใน 20260826_word_puzzle.sql)
      const row = await startSession({
        tourId,
        setId: set.id,
        name: form.name || set.title,
        busId: form.busId || null,
        screenMode: form.screenMode,
        staffId: staffSession?.staff?.id ?? null,
      })
      navigate(`/staff/puzzle/host/${row.session_id}`)
    } catch (err) {
      setError(err.message ?? String(err))
    }
  }

  async function handleClose(room) {
    setError('')
    // ต้องมี token ของห้องนั้นถึงจะสั่งได้ — คนละเครื่องกับคนสร้างห้องจะปิดไม่ได้
    if (!getHostToken(room.id)) {
      setError(t('staff.quiz.noToken'))
      return
    }
    try {
      await setSessionState(room.id, 'finished')
      load()
    } catch (err) {
      setError(err.message ?? String(err))
    }
  }

  async function handleNewSet() {
    const title = (newSetName ?? '').trim() || t('puzzle.manager.newSetName')
    setError('')
    const { data, error: err } = await supabase
      .from('quiz_sets')
      .insert({
        org_id: orgId,
        title,
        game_kind: 'puzzle',
        // เกมนี้คิดคำ + พิมพ์ไทยบนรถที่โยก คนละเรื่องกับกดปุ่มสี่สี
        default_time_limit: 90,
        // โบนัสถูกติดกันของควิซให้ +100/+200 ซึ่งบนสเกล 1 คะแนนคือชนะขาดตั้งแต่ต้นเกม
        streak_bonus: false,
        created_by: staffSession?.staff?.id ?? null,
      })
      .select('id')
      .single()
    if (err) {
      setError(err.message)
      return
    }
    setNewSetName(null)
    navigate(`/staff/puzzle/builder/${data.id}`)
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <StaffHeader icon="game" title={t('puzzle.title')} subtitle={t('puzzle.manager.subtitle')} />

      <div className="mx-auto max-w-md space-y-5 p-4">
        {error && (
          <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
        )}

        {/* ── ห้องที่เปิดอยู่ ─────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-bold text-ink-muted">{t('puzzle.manager.openRooms')}</h2>
          {loading ? (
            <p className="text-sm text-ink-faint">{t('common.loading')}</p>
          ) : rooms.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-faint">
              {t('puzzle.manager.noRooms')}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {rooms.map((room) => (
                <li
                  key={room.id}
                  className="rounded-2xl border border-line bg-surface p-4 shadow-card"
                >
                  <p className="font-bold text-ink">{room.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {t('puzzle.manager.roomMeta', {
                      players: counts[room.id] ?? 0,
                      index: Math.max(room.current_index + 1, 0),
                    })}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      fullWidth={false}
                      className="px-3 py-2 text-sm"
                      onClick={() => navigate(`/staff/puzzle/host/${room.id}`)}
                    >
                      {t('puzzle.manager.enterRoom')}
                    </Button>
                    <Button variant="ghost" fullWidth={false} className="px-3 py-2 text-sm" onClick={() => handleClose(room)}>
                      {t('puzzle.manager.closeRoom')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── คลังชุดปริศนา ───────────────────────────────────── */}
        <section>
          <h2 className="mb-2 text-sm font-bold text-ink-muted">{t('puzzle.manager.library')}</h2>

          <ul className="space-y-2.5">
            {sets.map((set) => (
              <li key={set.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                <p className="font-bold text-ink">{set.title}</p>
                {set.description ? (
                  <p className="mt-0.5 text-xs text-ink-muted">{set.description}</p>
                ) : null}

                {creatingFor === set.id ? (
                  <div className="mt-3 space-y-2">
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder={set.title}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                    />
                    {buses.length > 0 && (
                      <select
                        value={form.busId}
                        onChange={(e) => setForm({ ...form, busId: e.target.value })}
                        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                      >
                        <option value="">{t('puzzle.manager.allBuses')}</option>
                        {buses.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <select
                      value={form.screenMode}
                      onChange={(e) => setForm({ ...form, screenMode: e.target.value })}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                    >
                      {SCREEN_MODES.map((m) => (
                        <option key={m} value={m}>
                          {t(`puzzle.manager.screen.${m}`)}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <Button fullWidth={false} className="px-3 py-2 text-sm" onClick={() => handleCreateRoom(set)}>
                        {t('puzzle.manager.createRoom')}
                      </Button>
                      <Button variant="ghost" fullWidth={false} className="px-3 py-2 text-sm" onClick={() => setCreatingFor(null)}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <Button
                      fullWidth={false} className="px-3 py-2 text-sm"
                      onClick={() => {
                        setForm({ name: '', busId: '', screenMode: 'projector' })
                        setCreatingFor(set.id)
                      }}
                    >
                      {t('puzzle.manager.openRoomFrom')}
                    </Button>
                    <Button
                      fullWidth={false} className="px-3 py-2 text-sm"
                      variant="ghost"
                      onClick={() => navigate(`/staff/puzzle/builder/${set.id}`)}
                    >
                      {t('puzzle.manager.edit')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {newSetName === null ? (
            <button
              type="button"
              onClick={() => setNewSetName('')}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong p-4 text-sm font-bold text-ink-muted"
            >
              <Icon name="plus" size={18} />
              {t('puzzle.manager.newSet')}
            </button>
          ) : (
            <div className="mt-3 space-y-2 rounded-2xl border border-line bg-surface p-4">
              <input
                autoFocus
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder={t('puzzle.manager.newSetName')}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button fullWidth={false} className="px-3 py-2 text-sm" onClick={handleNewSet}>
                  {t('common.save')}
                </Button>
                <Button variant="ghost" fullWidth={false} className="px-3 py-2 text-sm" onClick={() => setNewSetName(null)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
