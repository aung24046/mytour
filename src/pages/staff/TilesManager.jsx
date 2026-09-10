import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { getStaffSession, useActiveTourId, useActiveOrgId } from '../../lib/staffSession'
import { startSession, setSessionState, getHostToken } from '../../lib/quizHost'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import StaffHeader from '../../components/common/StaffHeader'

// หน้ารวมเกมเปิดแผ่นป้ายของทีมงาน — โครงเดียวกับ QuizManager / PuzzleManager
//
// ทุก query ต้องกรอง game_kind = 'tiles' เพราะใช้ตารางร่วมกับอีกสองเกม
// ลืมที่เดียว = ชุดของเกมอื่นโผล่มาปน แล้วจะดูเหมือนข้อมูลเสียมากกว่าดูเหมือนบั๊ก

const SCREEN_MODES = ['projector', 'bus_tv', 'none']

export default function TilesManager() {
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
  const [form, setForm] = useState({
    name: '', busId: '', screenMode: 'projector', teamMode: false, teamSizeLimit: 0,
  })
  const [newSetName, setNewSetName] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!tourId) return

    const [{ data: roomRows }, { data: setRows }, { data: busRows }] = await Promise.all([
      supabase
        .from('quiz_sessions')
        .select('id, name, set_id, bus_id, state, current_index, screen_mode, created_at')
        .eq('tour_id', tourId)
        .eq('game_kind', 'tiles')
        .neq('state', 'finished')
        .order('created_at', { ascending: false }),
      supabase
        .from('quiz_sets')
        .select('id, title, description, answer_mode, attempt_limit')
        .eq('org_id', orgId)
        .eq('game_kind', 'tiles')
        .eq('is_archived', false)
        .order('created_at', { ascending: false }),
      supabase.from('buses').select('id, name').eq('tour_id', tourId).order('name'),
    ])

    setRooms(roomRows ?? [])
    setSets(setRows ?? [])
    setBuses(busRows ?? [])
    setLoading(false)

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
      const row = await startSession({
        tourId,
        setId: set.id,
        name: form.name || set.title,
        busId: form.busId || null,
        screenMode: form.screenMode,
        staffId: staffSession?.staff?.id ?? null,
        teamMode: form.teamMode,
        teamSizeLimit: form.teamSizeLimit,
      })
      navigate(`/staff/tiles/host/${row.session_id}`)
    } catch (err) {
      setError(err.message ?? String(err))
    }
  }

  async function handleClose(room) {
    setError('')
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
    const title = (newSetName ?? '').trim() || t('tiles.manager.newSetName')
    setError('')
    const { data, error: err } = await supabase
      .from('quiz_sets')
      .insert({
        org_id: orgId,
        title,
        game_kind: 'tiles',
        answer_mode: 'type',
        // ปริศนามักเป็น "ทายว่าเพื่อนคนไหน" / "ผลไม้อะไร" ซึ่งคำตอบแคบมาก
        // ถ้าเดาได้ไม่จำกัดจะไล่เดาจนถูกได้ — 3 ครั้งเป็นค่าเริ่มต้นที่แก้ได้
        attempt_limit: 3,
        // เกมนี้คนคุมเกมกำหนดจังหวะเอง ไม่นับถอยหลัง 300 คือกันข้อค้างเฉยๆ
        default_time_limit: 300,
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
    navigate(`/staff/tiles/builder/${data.id}`)
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <StaffHeader icon="game" title={t('tiles.title')} subtitle={t('tiles.manager.subtitle')} />

      <div className="mx-auto max-w-md space-y-5 p-4">
        {error && (
          <p className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger-text">{error}</p>
        )}

        <section>
          <h2 className="mb-2 text-sm font-bold text-ink-muted">{t('tiles.manager.openRooms')}</h2>
          {loading ? (
            <p className="text-sm text-ink-faint">{t('common.loading')}</p>
          ) : rooms.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong p-4 text-sm text-ink-faint">
              {t('tiles.manager.noRooms')}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {rooms.map((room) => (
                <li key={room.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                  <p className="font-bold text-ink">{room.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {t('tiles.manager.roomMeta', {
                      players: counts[room.id] ?? 0,
                      index: Math.max(room.current_index + 1, 0),
                    })}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      fullWidth={false}
                      className="px-3 py-2 text-sm"
                      onClick={() => navigate(`/staff/tiles/host/${room.id}`)}
                    >
                      {t('tiles.manager.enterRoom')}
                    </Button>
                    <Button variant="ghost" fullWidth={false} className="px-3 py-2 text-sm" onClick={() => handleClose(room)}>
                      {t('tiles.manager.closeRoom')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-ink-muted">{t('tiles.manager.library')}</h2>

          <ul className="space-y-2.5">
            {sets.map((set) => (
              <li key={set.id} className="rounded-2xl border border-line bg-surface p-4 shadow-card">
                <p className="font-bold text-ink">{set.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {set.answer_mode === 'none'
                    ? t('tiles.manager.modeNone')
                    : t('tiles.manager.modeType', {
                        limit: set.attempt_limit ?? t('tiles.manager.unlimited'),
                      })}
                </p>

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
                        <option value="">{t('tiles.manager.allBuses')}</option>
                        {buses.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    )}
                    <select
                      value={form.screenMode}
                      onChange={(e) => setForm({ ...form, screenMode: e.target.value })}
                      className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                    >
                      {SCREEN_MODES.map((m) => (
                        <option key={m} value={m}>{t(`tiles.manager.screen.${m}`)}</option>
                      ))}
                    </select>

                    {/* เล่นเป็นทีม — ลูกทัวร์ตั้งทีมกันเองในห้องรอ
                        คะแนนทีม = คะแนนรวมของสมาชิก (quiz_team_leaderboard เรียงด้วย total_score)
                        เกมนี้คนแรกที่ตอบถูกจบข้อ คะแนนรวมจึงเท่ากับจำนวนข้อที่ทีมชนะ
                        (เดิมเป็นค่าเฉลี่ยปัดเศษ → ทีม 3 คนชนะ 1 ข้อขึ้นเป็น 0 · เปลี่ยน 11 ก.ย. 2026) */}
                    <label className="flex items-center gap-2 rounded-xl bg-neutral-bg px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.teamMode}
                        onChange={(e) => setForm({ ...form, teamMode: e.target.checked })}
                        className="h-4 w-4"
                      />
                      <span className="font-semibold text-ink">{t('tiles.manager.teamMode')}</span>
                    </label>

                    {form.teamMode && (
                      <>
                        <select
                          value={form.teamSizeLimit}
                          onChange={(e) => setForm({ ...form, teamSizeLimit: Number(e.target.value) })}
                          className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
                        >
                          <option value={0}>{t('tiles.manager.teamSizeFree')}</option>
                          {[2, 3, 4, 5, 6, 8].map((n) => (
                            <option key={n} value={n}>
                              {t('tiles.manager.teamSize')} {n}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-ink-faint">{t('tiles.manager.teamHint')}</p>
                      </>
                    )}

                    {/* ★ ไม่มีจอใหญ่ = ต้องส่งภาพให้มือถือทุกเครื่อง ไม่งั้นเล่นไม่ได้เลย
                        ซึ่งแปลว่าคนที่ตั้งใจแคะจะเห็นภาพเต็มได้
                        บอกให้รู้ตัว ดีกว่าปิดฟีเจอร์เงียบๆ หรือปล่อยรั่วเงียบๆ */}
                    {form.screenMode === 'none' && (
                      <p className="rounded-xl bg-warning-bg px-3 py-2 text-xs text-warning-text">
                        {t('tiles.manager.leakWarning')}
                      </p>
                    )}

                    <div className="flex gap-2">
                      <Button fullWidth={false} className="px-3 py-2 text-sm" onClick={() => handleCreateRoom(set)}>
                        {t('tiles.manager.createRoom')}
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
                        setForm({
                          name: '', busId: '', screenMode: 'projector',
                          teamMode: false, teamSizeLimit: 0,
                        })
                        setCreatingFor(set.id)
                      }}
                    >
                      {t('tiles.manager.openRoomFrom')}
                    </Button>
                    <Button
                      fullWidth={false} className="px-3 py-2 text-sm" variant="ghost"
                      onClick={() => navigate(`/staff/tiles/builder/${set.id}`)}
                    >
                      {t('tiles.manager.edit')}
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
              {t('tiles.manager.newSet')}
            </button>
          ) : (
            <div className="mt-3 space-y-2 rounded-2xl border border-line bg-surface p-4">
              <input
                autoFocus
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                placeholder={t('tiles.manager.newSetName')}
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
