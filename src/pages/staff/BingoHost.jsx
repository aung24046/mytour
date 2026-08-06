import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useActiveTourId } from '../../lib/staffSession'
import { genderTextClass } from '../../lib/genderColor'
import { playWinAlert, primeWinAlert } from '../../lib/winAlert'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import StatusBadge from '../../components/common/StatusBadge'

const MAX_NUMBER = 75

const CARD_COLUMNS =
  'id, guest_id, marked_numbers, has_bingo, bingo_claimed_at, is_confirmed, win_status, win_line'

export default function BingoHost() {
  const tourId = useActiveTourId()
  const { t } = useTranslation()

  const [games, setGames] = useState([])
  const [activeGameId, setActiveGameId] = useState(null)
  const [loadingGames, setLoadingGames] = useState(true)

  const [showNewRoomForm, setShowNewRoomForm] = useState(false)
  const [newRoomName, setNewRoomName] = useState('')
  const [creatingRoom, setCreatingRoom] = useState(false)

  const [cards, setCards] = useState([])
  const [guests, setGuests] = useState([])

  const [manualNumber, setManualNumber] = useState('')
  const [manualError, setManualError] = useState(null)
  const [calling, setCalling] = useState(false)
  const [reviewingId, setReviewingId] = useState(null)

  // id ของผู้ชนะที่เคยเห็นแล้ว — ใช้ตัดสินว่า "รายใหม่" เพื่อเล่นเสียงครั้งเดียว
  const seenWinnersRef = useRef(new Set())
  const winnersInitializedRef = useRef(false)

  const loadGames = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoadingGames(true)
      const { data } = await supabase
        .from('bingo_games')
        .select('id, name, status, called_numbers, created_at')
        .eq('tour_id', tourId)
        .in('status', ['waiting', 'playing'])
        .order('created_at', { ascending: true })

      setGames(data ?? [])
      setActiveGameId((prev) =>
        prev && data?.some((g) => g.id === prev) ? prev : (data?.[0]?.id ?? null)
      )
      if (!silent) setLoadingGames(false)
    },
    [tourId]
  )

  const loadCards = useCallback(async (gameId) => {
    if (!gameId) {
      setCards([])
      return
    }
    const { data } = await supabase.from('bingo_cards').select(CARD_COLUMNS).eq('game_id', gameId)
    setCards(data ?? [])
  }, [])

  // guests แทบไม่เปลี่ยนระหว่างเกม — เดิมโหลดใหม่ทุกครั้งที่การ์ดใบไหนขยับ
  // ทำให้ทั้งรายชื่อ re-render ซ้ำๆ โดยไม่จำเป็น ตอนนี้แยกมาโหลดตาม tourId อย่างเดียว
  useEffect(() => {
    if (!tourId) return
    let cancelled = false
    supabase
      .from('guests')
      .select('id, name, nickname, gender')
      .eq('tour_id', tourId)
      .then(({ data }) => {
        if (!cancelled) setGuests(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [tourId])

  useEffect(() => {
    loadGames()

    const channel = supabase
      .channel(`bingo-games-host-${tourId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bingo_games', filter: `tour_id=eq.${tourId}` },
        (payload) => {
          if (payload.eventType === 'UPDATE' && payload.new?.id) {
            setGames((prev) => {
              if (!prev.some((g) => g.id === payload.new.id)) {
                loadGames({ silent: true })
                return prev
              }
              if (!['waiting', 'playing'].includes(payload.new.status)) {
                return prev.filter((g) => g.id !== payload.new.id)
              }
              return prev.map((g) => (g.id === payload.new.id ? { ...g, ...payload.new } : g))
            })
            return
          }
          loadGames({ silent: true })
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [tourId, loadGames])

  const activeGame = games.find((g) => g.id === activeGameId) ?? null

  useEffect(() => {
    if (activeGameId && !games.some((g) => g.id === activeGameId)) {
      setActiveGameId(games[0]?.id ?? null)
    }
  }, [games, activeGameId])

  useEffect(() => {
    if (!activeGameId) {
      setCards([])
      return
    }
    // เปลี่ยนห้อง = เริ่มนับผู้ชนะใหม่ ไม่งั้นเสียงจะดังรัวตอนสลับห้อง
    winnersInitializedRef.current = false
    seenWinnersRef.current = new Set()
    loadCards(activeGameId)

    // merge จาก payload แทนการโหลดตารางใหม่ทั้งใบทุก event
    const cardsChannel = supabase
      .channel(`bingo-cards-host-${activeGameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bingo_cards', filter: `game_id=eq.${activeGameId}` },
        (payload) => {
          if (payload.eventType === 'INSERT' && payload.new?.id) {
            setCards((prev) =>
              prev.some((c) => c.id === payload.new.id) ? prev : [...prev, payload.new]
            )
            return
          }
          if (payload.eventType === 'UPDATE' && payload.new?.id) {
            setCards((prev) => {
              if (!prev.some((c) => c.id === payload.new.id)) return [...prev, payload.new]
              return prev.map((c) => (c.id === payload.new.id ? { ...c, ...payload.new } : c))
            })
            return
          }
          loadCards(activeGameId)
        }
      )
      .subscribe()

    return () => supabase.removeChannel(cardsChannel)
  }, [activeGameId, loadCards])

  async function handleCreateRoom(e) {
    e.preventDefault()
    if (!newRoomName.trim()) return

    setCreatingRoom(true)
    const { data, error } = await supabase
      .from('bingo_games')
      .insert({
        tour_id: tourId,
        name: newRoomName.trim(),
        status: 'playing',
        called_numbers: [],
      })
      .select('id')
      .single()

    if (!error && data) {
      setNewRoomName('')
      setShowNewRoomForm(false)
      setActiveGameId(data.id)
      loadGames({ silent: true })
    }
    setCreatingRoom(false)
  }

  const remainingCount = useMemo(
    () => MAX_NUMBER - (activeGame?.called_numbers?.length ?? 0),
    [activeGame]
  )

  function applyCalledNumbers(gameId, nextCalled) {
    setGames((prev) => prev.map((g) => (g.id === gameId ? { ...g, called_numbers: nextCalled } : g)))
  }

  // สุ่มบนเซิร์ฟเวอร์ — เดิม client อ่าน called_numbers มาต่อท้ายแล้วเขียนกลับ
  // staff สองคนกดพร้อมกันจะเขียนทับกัน เลขหายไปหนึ่งตัวเงียบๆ
  async function callRandomNumber() {
    if (!activeGame || remainingCount <= 0) return
    primeWinAlert()
    setCalling(true)
    setManualError(null)

    const { data, error } = await supabase.rpc('bingo_call_random', { p_game_id: activeGame.id })
    const row = Array.isArray(data) ? data[0] : data
    if (!error && row?.called) applyCalledNumbers(activeGame.id, row.called)
    else if (error) setManualError(t('staff.bingoHost.callFailed'))

    setCalling(false)
  }

  async function callManualNumber(e) {
    e.preventDefault()
    if (!activeGame) return

    const num = Number(manualNumber)
    if (!Number.isInteger(num) || num < 1 || num > MAX_NUMBER) {
      setManualError(t('staff.bingoHost.manualErrorRange', { max: MAX_NUMBER }))
      return
    }
    if ((activeGame.called_numbers ?? []).includes(num)) {
      setManualError(t('staff.bingoHost.manualErrorDuplicate'))
      return
    }

    primeWinAlert()
    setManualError(null)
    setCalling(true)

    const { data, error } = await supabase.rpc('bingo_call_number', {
      p_game_id: activeGame.id,
      p_number: num,
    })

    if (error) {
      // เลขซ้ำอาจถูกประกาศโดย staff อีกคนพอดี — DB เป็นคนตัดสิน
      setManualError(
        error.message?.includes('BINGO_DUPLICATE')
          ? t('staff.bingoHost.manualErrorDuplicate')
          : t('staff.bingoHost.callFailed')
      )
    } else {
      if (Array.isArray(data)) applyCalledNumbers(activeGame.id, data)
      setManualNumber('')
    }
    setCalling(false)
  }

  async function endGame() {
    if (!activeGame) return
    const confirmed = window.confirm(t('staff.bingoHost.confirmEnd'))
    if (!confirmed) return

    const { error } = await supabase
      .from('bingo_games')
      .update({ status: 'finished' })
      .eq('id', activeGame.id)

    if (!error) {
      setActiveGameId(null)
      loadGames({ silent: true })
    }
  }

  async function reviewWin(cardId, approve) {
    setReviewingId(cardId)
    const { data, error } = await supabase.rpc('bingo_review_win', {
      p_card_id: cardId,
      p_approve: approve,
    })
    if (!error && data) {
      setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...data } : c)))
    }
    setReviewingId(null)
  }

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  function guestName(guestId) {
    const guest = guestById[guestId]
    return guest ? guest.nickname || guest.name : t('staff.locationMonitor.unknownGuest')
  }

  // เรียงตามเวลาที่กดบิงโก — เดิมไม่เรียงเลย พอมีหลายคนติดกันจะไม่รู้ว่าใครก่อน
  const winners = useMemo(
    () =>
      cards
        .filter((c) => c.has_bingo)
        .sort((a, b) => (a.bingo_claimed_at ?? '').localeCompare(b.bingo_claimed_at ?? '')),
    [cards]
  )

  const pendingWinners = useMemo(
    () => winners.filter((w) => w.win_status !== 'confirmed'),
    [winners]
  )

  // เด้งเสียง + สั่น ตอนมีผู้ชนะรายใหม่เท่านั้น
  useEffect(() => {
    const ids = winners.map((w) => w.id)
    if (!winnersInitializedRef.current) {
      // โหลดครั้งแรกของห้อง: ผู้ชนะที่มีอยู่แล้วไม่ใช่ "รายใหม่"
      seenWinnersRef.current = new Set(ids)
      winnersInitializedRef.current = true
      return
    }
    const fresh = ids.filter((id) => !seenWinnersRef.current.has(id))
    if (fresh.length > 0) {
      playWinAlert()
      for (const id of fresh) seenWinnersRef.current.add(id)
    }
  }, [winners])

  function winLineLabel(line) {
    if (!line) return null
    if (line.startsWith('row')) return t('staff.bingoHost.winLineRow', { n: line.slice(3) })
    if (line.startsWith('col')) return t('staff.bingoHost.winLineCol', { n: line.slice(3) })
    return t('staff.bingoHost.winLineDiag')
  }

  const participants = useMemo(
    () =>
      [...cards].sort((a, b) => {
        // ยังไม่พร้อมขึ้นก่อน เพื่อให้ staff เห็นชัดว่าใครยังไม่ยืนยันการ์ด
        if (a.is_confirmed === b.is_confirmed) return 0
        return a.is_confirmed ? 1 : -1
      }),
    [cards]
  )
  const readyCount = useMemo(() => cards.filter((c) => c.is_confirmed).length, [cards])

  const lastCalled =
    activeGame && activeGame.called_numbers && activeGame.called_numbers.length > 0
      ? activeGame.called_numbers[activeGame.called_numbers.length - 1]
      : null

  return (
    // pb-28 — เผื่อที่ให้ปุ่ม "หน้าหลัก" แบบลอยที่มุมซ้ายล่าง (HomeButton ใน App.jsx)
    // ไม่ให้ทับการ์ดใบล่างสุด
    <div className="min-h-screen bg-surface-muted p-4 pb-28">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold text-ink">{t('staff.bingoHost.title')}</h1>

        {loadingGames && <p className="mt-2 text-ink-muted">{t('common.loading')}</p>}

        {!loadingGames && (
          <>
            {/* Room selector — หลายกลุ่มเล่นพร้อมกันได้ เช่น Bus1, Bus2 */}
            <div className="mt-2 flex flex-wrap gap-2">
              {games.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGameId(g.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    activeGameId === g.id ? 'bg-brand text-white' : 'bg-surface-sunken text-neutral-text'
                  }`}
                >
                  {g.name || t('staff.bingoHost.unnamedRoom')}
                </button>
              ))}
              <button
                onClick={() => setShowNewRoomForm((v) => !v)}
                className="rounded-full border border-dashed border-line-strong px-3 py-1.5 text-sm font-medium text-ink-muted hover:border-brand hover:text-brand"
              >
                + {t('staff.bingoHost.addRoom')}
              </button>
            </div>

            {showNewRoomForm && (
              <Card className="mt-3">
                <form onSubmit={handleCreateRoom} className="flex flex-col gap-3">
                  <TextField
                    label={t('staff.bingoHost.roomName')}
                    placeholder={t('staff.bingoHost.roomNamePlaceholder')}
                    required
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={creatingRoom || !newRoomName.trim()}>
                      {creatingRoom ? t('guest.register.submitting') : t('staff.bingoHost.startGame')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setShowNewRoomForm(false)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            {games.length === 0 && !showNewRoomForm && (
              <p className="mt-4 text-sm text-ink-faint">{t('staff.bingoHost.noGame')}</p>
            )}

            {activeGame && (
              <>
                {/* แจ้งเตือนผู้ชนะ — อยู่บนสุดเพราะเป็นสิ่งที่ staff ต้องเห็นทันที
                    เดิมเป็นบรรทัดข้อความท้ายหน้า ต้องเลื่อนลงสุดถึงจะเห็น */}
                {pendingWinners.length > 0 && (
                  <Card className="mt-3 animate-flash-once border-2 border-warning bg-warning-bg">
                    <p className="mb-2 flex items-center gap-2 text-base font-bold text-warning-text">
                      <span aria-hidden="true">🎉</span>
                      {t('staff.bingoHost.newWinnerAlert', { count: pendingWinners.length })}
                    </p>
                    <div className="flex flex-col gap-2">
                      {pendingWinners.map((w, i) => (
                        <div
                          key={w.id}
                          className="rounded-xl bg-surface p-3 ring-1 ring-warning-bg"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span
                              className={`text-base font-bold ${genderTextClass(guestById[w.guest_id]?.gender) || 'text-ink'}`}
                            >
                              {i + 1}. {guestName(w.guest_id)}
                            </span>
                            <span className="shrink-0 text-xs text-ink-faint">
                              {w.bingo_claimed_at
                                ? new Date(w.bingo_claimed_at).toLocaleTimeString(undefined, {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })
                                : ''}
                            </span>
                          </div>
                          {w.win_line && (
                            <p className="mt-0.5 text-xs font-medium text-warning-text">
                              {t('staff.bingoHost.winLinePrefix')} {winLineLabel(w.win_line)}
                            </p>
                          )}
                          <div className="mt-2 flex gap-2">
                            <Button
                              fullWidth={false}
                              className="flex-1 py-2 text-sm"
                              disabled={reviewingId === w.id}
                              onClick={() => reviewWin(w.id, true)}
                            >
                              {t('staff.bingoHost.approveWin')}
                            </Button>
                            <Button
                              fullWidth={false}
                              variant="secondary"
                              className="flex-1 py-2 text-sm"
                              disabled={reviewingId === w.id}
                              onClick={() => reviewWin(w.id, false)}
                            >
                              {t('staff.bingoHost.rejectWin')}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                <Card className="mt-3 text-center">
                  <p className="text-sm font-medium text-ink-muted">{t('staff.bingoHost.lastCalled')}</p>
                  <p className="my-2 text-5xl font-bold text-brand">{lastCalled ?? '—'}</p>
                  <p className="text-xs text-ink-faint">
                    {t('staff.bingoHost.calledCount', {
                      count: activeGame.called_numbers?.length ?? 0,
                      total: MAX_NUMBER,
                    })}
                  </p>

                  <Button
                    className="mt-4"
                    onClick={callRandomNumber}
                    disabled={calling || remainingCount <= 0}
                  >
                    {remainingCount <= 0
                      ? t('staff.bingoHost.allCalled')
                      : t('staff.bingoHost.callNumber')}
                  </Button>

                  {/* Manual input — เผื่อให้ลูกทัวร์มีส่วนร่วมประกาศเลขเอง */}
                  <form onSubmit={callManualNumber} className="mt-3 flex gap-2">
                    <input
                      type="number"
                      min={1}
                      max={MAX_NUMBER}
                      value={manualNumber}
                      onChange={(e) => {
                        setManualNumber(e.target.value)
                        setManualError(null)
                      }}
                      placeholder={t('staff.bingoHost.manualPlaceholder')}
                      className="flex-1 rounded-xl border border-line-strong px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
                    />
                    <button
                      type="submit"
                      disabled={calling || !manualNumber}
                      className="shrink-0 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {t('staff.bingoHost.manualCall')}
                    </button>
                  </form>
                  {manualError && <p className="mt-1 text-sm text-danger">{manualError}</p>}

                  <Button variant="secondary" className="mt-3" onClick={endGame}>
                    {t('staff.bingoHost.endGame')}
                  </Button>
                </Card>

                <Card className="mt-3">
                  <p className="mb-2 text-sm font-semibold text-neutral-text">
                    {t('staff.bingoHost.calledHistory')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(activeGame.called_numbers ?? [])
                      .slice()
                      .reverse()
                      .map((n) => (
                        <span
                          key={n}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-sunken text-sm font-medium text-neutral-text"
                        >
                          {n}
                        </span>
                      ))}
                    {(activeGame.called_numbers ?? []).length === 0 && (
                      <p className="text-sm text-ink-faint">{t('staff.bingoHost.noneCalledYet')}</p>
                    )}
                  </div>
                </Card>

                <Card className="mt-3">
                  <p className="mb-2 text-sm font-semibold text-neutral-text">
                    {t('staff.bingoHost.winners', { count: winners.length })}
                  </p>
                  {winners.length === 0 && (
                    <p className="text-sm text-ink-faint">{t('staff.bingoHost.noWinnersYet')}</p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {winners.map((w, i) => (
                      <div key={w.id} className="flex items-center justify-between gap-2">
                        <span
                          className={`text-sm font-medium ${genderTextClass(guestById[w.guest_id]?.gender) || 'text-ink'}`}
                        >
                          {i + 1}. {guestName(w.guest_id)}
                        </span>
                        <StatusBadge tone={w.win_status === 'confirmed' ? 'success' : 'warning'}>
                          {w.win_status === 'confirmed'
                            ? t('staff.bingoHost.statusWinConfirmed')
                            : t('staff.bingoHost.statusWinPending')}
                        </StatusBadge>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="mt-3">
                  <p className="mb-2 text-sm font-semibold text-neutral-text">
                    {t('staff.bingoHost.participants', {
                      ready: readyCount,
                      total: participants.length,
                    })}
                  </p>
                  {participants.length === 0 && (
                    <p className="text-sm text-ink-faint">{t('staff.bingoHost.noParticipantsYet')}</p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {participants.map((p) => (
                      <div key={p.id} className="flex items-center justify-between">
                        <span
                          className={`text-sm font-medium ${genderTextClass(guestById[p.guest_id]?.gender) || 'text-ink'}`}
                        >
                          {guestName(p.guest_id)}
                        </span>
                        <StatusBadge tone={p.is_confirmed ? 'success' : 'warning'}>
                          {p.is_confirmed
                            ? t('staff.bingoHost.statusReady')
                            : t('staff.bingoHost.statusPreparing')}
                        </StatusBadge>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
