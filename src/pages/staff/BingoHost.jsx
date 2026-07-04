import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'

const MAX_NUMBER = 75

export default function BingoHost() {
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

  async function loadGames() {
    setLoadingGames(true)
    const { data } = await supabase
      .from('bingo_games')
      .select('id, name, status, called_numbers, created_at')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .in('status', ['waiting', 'playing'])
      .order('created_at', { ascending: true })

    setGames(data ?? [])
    setActiveGameId((prev) => prev ?? data?.[0]?.id ?? null)
    setLoadingGames(false)
  }

  async function loadCardsAndGuests(gameId) {
    if (!gameId) {
      setCards([])
      return
    }
    const [cardsRes, guestsRes] = await Promise.all([
      supabase
        .from('bingo_cards')
        .select('id, guest_id, marked_numbers, has_bingo, bingo_claimed_at, is_confirmed')
        .eq('game_id', gameId),
      supabase.from('guests').select('id, name, nickname').eq('tour_id', ACTIVE_TOUR_ID),
    ])
    setCards(cardsRes.data ?? [])
    setGuests(guestsRes.data ?? [])
  }

  useEffect(() => {
    loadGames()

    const channel = supabase
      .channel(`bingo-games-host-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bingo_games', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadGames()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const activeGame = games.find((g) => g.id === activeGameId) ?? null

  useEffect(() => {
    if (!activeGameId) {
      setCards([])
      return
    }
    loadCardsAndGuests(activeGameId)

    const cardsChannel = supabase
      .channel(`bingo-cards-host-${activeGameId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bingo_cards', filter: `game_id=eq.${activeGameId}` },
        () => loadCardsAndGuests(activeGameId)
      )
      .subscribe()

    return () => supabase.removeChannel(cardsChannel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGameId])

  async function handleCreateRoom(e) {
    e.preventDefault()
    if (!newRoomName.trim()) return

    setCreatingRoom(true)
    const { data, error } = await supabase
      .from('bingo_games')
      .insert({
        tour_id: ACTIVE_TOUR_ID,
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
      loadGames()
    }
    setCreatingRoom(false)
  }

  const remainingNumbers = useMemo(() => {
    if (!activeGame) return []
    const called = new Set(activeGame.called_numbers ?? [])
    const all = []
    for (let n = 1; n <= MAX_NUMBER; n++) {
      if (!called.has(n)) all.push(n)
    }
    return all
  }, [activeGame])

  async function applyCalledNumber(nextNumber) {
    if (!activeGame) return
    const nextCalled = [...(activeGame.called_numbers ?? []), nextNumber]

    const { error } = await supabase
      .from('bingo_games')
      .update({ called_numbers: nextCalled })
      .eq('id', activeGame.id)

    if (!error) {
      setGames((prev) =>
        prev.map((g) => (g.id === activeGame.id ? { ...g, called_numbers: nextCalled } : g))
      )
    }
  }

  async function callRandomNumber() {
    if (!activeGame || remainingNumbers.length === 0) return
    setCalling(true)
    const nextNumber = remainingNumbers[Math.floor(Math.random() * remainingNumbers.length)]
    await applyCalledNumber(nextNumber)
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

    setManualError(null)
    setCalling(true)
    await applyCalledNumber(num)
    setManualNumber('')
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
      loadGames()
    }
  }

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const winners = useMemo(() => cards.filter((c) => c.has_bingo), [cards])

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
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold text-gray-900">{t('staff.bingoHost.title')}</h1>

        {loadingGames && <p className="mt-2 text-gray-500">{t('common.loading')}</p>}

        {!loadingGames && (
          <>
            {/* Room selector — หลายกลุ่มเล่นพร้อมกันได้ เช่น Bus1, Bus2 */}
            <div className="mt-2 flex flex-wrap gap-2">
              {games.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setActiveGameId(g.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    activeGameId === g.id ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {g.name || t('staff.bingoHost.unnamedRoom')}
                </button>
              ))}
              <button
                onClick={() => setShowNewRoomForm((v) => !v)}
                className="rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
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
              <p className="mt-4 text-sm text-gray-400">{t('staff.bingoHost.noGame')}</p>
            )}

            {activeGame && (
              <>
                <Card className="mt-3 text-center">
                  <p className="text-sm font-medium text-gray-500">{t('staff.bingoHost.lastCalled')}</p>
                  <p className="my-2 text-5xl font-bold text-sky-600">{lastCalled ?? '—'}</p>
                  <p className="text-xs text-gray-400">
                    {t('staff.bingoHost.calledCount', {
                      count: activeGame.called_numbers?.length ?? 0,
                      total: MAX_NUMBER,
                    })}
                  </p>

                  <Button
                    className="mt-4"
                    onClick={callRandomNumber}
                    disabled={calling || remainingNumbers.length === 0}
                  >
                    {remainingNumbers.length === 0
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
                      className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                    />
                    <button
                      type="submit"
                      disabled={calling || !manualNumber}
                      className="shrink-0 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {t('staff.bingoHost.manualCall')}
                    </button>
                  </form>
                  {manualError && <p className="mt-1 text-sm text-red-500">{manualError}</p>}

                  <Button variant="secondary" className="mt-3" onClick={endGame}>
                    {t('staff.bingoHost.endGame')}
                  </Button>
                </Card>

                <Card className="mt-3">
                  <p className="mb-2 text-sm font-semibold text-gray-700">
                    {t('staff.bingoHost.calledHistory')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(activeGame.called_numbers ?? [])
                      .slice()
                      .reverse()
                      .map((n) => (
                        <span
                          key={n}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-700"
                        >
                          {n}
                        </span>
                      ))}
                    {(activeGame.called_numbers ?? []).length === 0 && (
                      <p className="text-sm text-gray-400">{t('staff.bingoHost.noneCalledYet')}</p>
                    )}
                  </div>
                </Card>

                <Card className="mt-3">
                  <p className="mb-2 text-sm font-semibold text-gray-700">
                    {t('staff.bingoHost.participants', {
                      ready: readyCount,
                      total: participants.length,
                    })}
                  </p>
                  {participants.length === 0 && (
                    <p className="text-sm text-gray-400">{t('staff.bingoHost.noParticipantsYet')}</p>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {participants.map((p) => {
                      const guest = guestById[p.guest_id]
                      return (
                        <div key={p.id} className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">
                            {guest ? guest.nickname || guest.name : t('staff.locationMonitor.unknownGuest')}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              p.is_confirmed
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {p.is_confirmed
                              ? t('staff.bingoHost.statusReady')
                              : t('staff.bingoHost.statusPreparing')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </Card>

                <Card className="mt-3">
                  <p className="mb-2 text-sm font-semibold text-gray-700">
                    {t('staff.bingoHost.winners', { count: winners.length })}
                  </p>
                  {winners.length === 0 && (
                    <p className="text-sm text-gray-400">{t('staff.bingoHost.noWinnersYet')}</p>
                  )}
                  <div className="flex flex-col gap-1">
                    {winners.map((w) => {
                      const guest = guestById[w.guest_id]
                      return (
                        <p key={w.id} className="text-sm font-medium text-gray-900">
                          🎉{' '}
                          {guest ? guest.nickname || guest.name : t('staff.locationMonitor.unknownGuest')}
                        </p>
                      )
                    })}
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
