import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId } from '../../lib/guestSession'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import GuestNav from '../../components/common/GuestNav'

const GRID_SIZE = 5
const FREE_INDEX = 12 // center cell (row 2, col 2) — ช่องฟรี ตามกติกาบิงโกทั่วไป
const MAX_NUMBER = 75

function generateCardNumbers() {
  // สุ่มเลข 1-75 ไม่ซ้ำ 24 ตัว (ไม่รวมช่องฟรีตรงกลาง)
  const pool = Array.from({ length: MAX_NUMBER }, (_, i) => i + 1)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const chosen = pool.slice(0, 24)
  const numbers = []
  let ci = 0
  for (let i = 0; i < 25; i++) {
    if (i === FREE_INDEX) {
      numbers.push(0) // 0 = ช่องฟรี
    } else {
      numbers.push(chosen[ci])
      ci++
    }
  }
  return numbers
}

function checkBingo(numbers, markedSet) {
  const isMarked = (idx) => numbers[idx] === 0 || markedSet.has(numbers[idx])

  const lines = []
  for (let r = 0; r < GRID_SIZE; r++) {
    lines.push([0, 1, 2, 3, 4].map((c) => r * GRID_SIZE + c))
  }
  for (let c = 0; c < GRID_SIZE; c++) {
    lines.push([0, 1, 2, 3, 4].map((r) => r * GRID_SIZE + c))
  }
  lines.push([0, 6, 12, 18, 24])
  lines.push([4, 8, 12, 16, 20])

  return lines.some((line) => line.every(isMarked))
}

export default function BingoCard() {
  const { t } = useTranslation()
  const guestId = getGuestId()

  const [games, setGames] = useState([])
  const [activeGameId, setActiveGameId] = useState(null)
  const [loadingGames, setLoadingGames] = useState(true)

  const [card, setCard] = useState(null)
  const [loadingCard, setLoadingCard] = useState(true)
  const [claiming, setClaiming] = useState(false)

  const [editingIdx, setEditingIdx] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function loadGames() {
    setLoadingGames(true)
    const { data } = await supabase
      .from('bingo_games')
      .select('id, name, status, called_numbers')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .in('status', ['waiting', 'playing'])
      .order('created_at', { ascending: true })

    setGames(data ?? [])
    setActiveGameId((prev) => prev ?? data?.[0]?.id ?? null)
    setLoadingGames(false)
  }

  const activeGame = games.find((g) => g.id === activeGameId) ?? null

  async function loadOrCreateCard(gameId) {
    if (!gameId || !guestId) {
      setCard(null)
      setLoadingCard(false)
      return
    }
    setLoadingCard(true)

    const { data: existing } = await supabase
      .from('bingo_cards')
      .select('id, numbers, marked_numbers, has_bingo, bingo_claimed_at, is_confirmed')
      .eq('game_id', gameId)
      .eq('guest_id', guestId)
      .maybeSingle()

    if (existing) {
      setCard(existing)
      setLoadingCard(false)
      return
    }

    const numbers = generateCardNumbers()
    const { data: created, error } = await supabase
      .from('bingo_cards')
      .insert({
        game_id: gameId,
        guest_id: guestId,
        numbers,
        marked_numbers: [],
        has_bingo: false,
        is_confirmed: false,
      })
      .select('id, numbers, marked_numbers, has_bingo, bingo_claimed_at, is_confirmed')
      .single()

    if (!error) setCard(created)
    setLoadingCard(false)
  }

  useEffect(() => {
    loadGames()

    const channel = supabase
      .channel(`bingo-games-guest-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bingo_games', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadGames()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!activeGameId) {
      setCard(null)
      setLoadingCard(false)
      return
    }
    loadOrCreateCard(activeGameId)

    const cardChannel = supabase
      .channel(`bingo-card-guest-${activeGameId}-${guestId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bingo_cards', filter: `game_id=eq.${activeGameId}` },
        () => loadOrCreateCard(activeGameId)
      )
      .subscribe()

    return () => supabase.removeChannel(cardChannel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGameId])

  const calledSet = useMemo(() => new Set(activeGame?.called_numbers ?? []), [activeGame])
  const markedSet = useMemo(() => new Set(card?.marked_numbers ?? []), [card])

  const hasBingoNow = useMemo(() => {
    if (!card || !card.is_confirmed) return false
    return checkBingo(card.numbers, markedSet)
  }, [card, markedSet])

  async function persistNumbers(nextNumbers) {
    if (!card) return
    setSaving(true)
    setCard((prev) => (prev ? { ...prev, numbers: nextNumbers } : prev))
    const { error } = await supabase
      .from('bingo_cards')
      .update({ numbers: nextNumbers })
      .eq('id', card.id)
    setSaving(false)
    return !error
  }

  async function shuffleCard() {
    if (!card || card.is_confirmed || saving) return
    await persistNumbers(generateCardNumbers())
  }

  function startEditCell(idx) {
    if (!card || card.is_confirmed || idx === FREE_INDEX) return
    setEditingIdx(idx)
    setEditValue(String(card.numbers[idx] ?? ''))
    setEditError(null)
  }

  async function saveEditCell() {
    if (!card || editingIdx === null) return

    const num = Number(editValue)
    if (!Number.isInteger(num) || num < 1 || num > MAX_NUMBER) {
      setEditError(t('guest.bingo.editErrorRange', { max: MAX_NUMBER }))
      return
    }
    const otherNumbers = card.numbers.filter((_, i) => i !== editingIdx)
    if (otherNumbers.includes(num)) {
      setEditError(t('guest.bingo.editErrorDuplicate'))
      return
    }

    const nextNumbers = [...card.numbers]
    nextNumbers[editingIdx] = num
    setEditingIdx(null)
    setEditError(null)
    await persistNumbers(nextNumbers)
  }

  function cancelEditCell() {
    setEditingIdx(null)
    setEditError(null)
  }

  async function confirmCard() {
    if (!card || card.is_confirmed) return
    setConfirming(true)

    const { error } = await supabase
      .from('bingo_cards')
      .update({ is_confirmed: true })
      .eq('id', card.id)

    if (!error) {
      setCard((prev) => (prev ? { ...prev, is_confirmed: true } : prev))
    }
    setConfirming(false)
  }

  async function toggleMark(number) {
    if (!card || !card.is_confirmed || number === 0) return
    if (!calledSet.has(number)) return // ทำเครื่องหมายได้เฉพาะเลขที่ประกาศแล้ว

    const isMarked = markedSet.has(number)
    const nextMarked = isMarked
      ? (card.marked_numbers ?? []).filter((n) => n !== number)
      : [...(card.marked_numbers ?? []), number]

    setCard((prev) => (prev ? { ...prev, marked_numbers: nextMarked } : prev))

    await supabase.from('bingo_cards').update({ marked_numbers: nextMarked }).eq('id', card.id)
  }

  async function claimBingo() {
    if (!card || card.has_bingo) return
    setClaiming(true)

    const { error } = await supabase
      .from('bingo_cards')
      .update({ has_bingo: true, bingo_claimed_at: new Date().toISOString() })
      .eq('id', card.id)

    if (!error) {
      setCard((prev) => (prev ? { ...prev, has_bingo: true } : prev))
    }
    setClaiming(false)
  }

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
            <span aria-hidden="true">🎯</span>{t('guest.bingo.title')}
          </h1>

          <GuestNav active="bingo" />

          {loadingGames && <p className="text-gray-500">{t('common.loading')}</p>}

          {!loadingGames && games.length === 0 && (
            <Card>
              <p className="text-gray-500">{t('guest.bingo.noGame')}</p>
            </Card>
          )}

          {!loadingGames && games.length > 0 && (
            <>
              {games.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {games.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => setActiveGameId(g.id)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                        activeGameId === g.id ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {g.name || t('guest.bingo.unnamedRoom')}
                    </button>
                  ))}
                </div>
              )}

              {loadingCard && <p className="text-gray-500">{t('common.loading')}</p>}

              {!loadingCard && card && (
                <>
                  {!card.is_confirmed && (
                    <Card className="mb-3 bg-sky-50">
                      <p className="text-sm font-medium text-sky-700">
                        {t('guest.bingo.editModeHint')}
                      </p>
                    </Card>
                  )}

                  {card.is_confirmed && card.has_bingo && (
                    <Card className="mb-3 bg-amber-50 text-center">
                      <p className="text-lg font-bold text-amber-700">
                        🎉 {t('guest.bingo.youWon')}
                      </p>
                    </Card>
                  )}

                  {card.is_confirmed && !card.has_bingo && hasBingoNow && (
                    <Card className="mb-3 text-center">
                      <p className="mb-2 font-semibold text-sky-700">
                        {t('guest.bingo.youHaveBingo')}
                      </p>
                      <button
                        onClick={claimBingo}
                        disabled={claiming}
                        className="w-full rounded-xl bg-amber-500 px-4 py-3 text-base font-bold text-white active:scale-[0.98] disabled:opacity-50"
                      >
                        {claiming ? t('guest.register.submitting') : t('guest.bingo.claimBingo')}
                      </button>
                    </Card>
                  )}

                  <Card>
                    <div className="grid grid-cols-5 gap-1.5">
                      {card.numbers.map((num, idx) => {
                        const isFree = num === 0
                        const isCalled = isFree || calledSet.has(num)
                        const isMarked = isFree || markedSet.has(num)
                        const isEditing = editingIdx === idx

                        if (!card.is_confirmed && isEditing) {
                          return (
                            <input
                              key={idx}
                              type="number"
                              min={1}
                              max={MAX_NUMBER}
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={saveEditCell}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditCell()
                                if (e.key === 'Escape') cancelEditCell()
                              }}
                              className="aspect-square rounded-lg border-2 border-sky-500 text-center text-sm font-bold"
                            />
                          )
                        }

                        return (
                          <button
                            key={idx}
                            onClick={() =>
                              card.is_confirmed ? toggleMark(num) : startEditCell(idx)
                            }
                            disabled={card.is_confirmed && (isFree || !isCalled)}
                            className={`aspect-square rounded-lg text-sm font-bold transition ${
                              card.is_confirmed
                                ? isMarked
                                  ? 'bg-sky-600 text-white'
                                  : isCalled
                                    ? 'bg-white text-gray-900 ring-1 ring-sky-300'
                                    : 'bg-gray-100 text-gray-400'
                                : isFree
                                  ? 'bg-gray-100 text-gray-400'
                                  : 'bg-white text-gray-900 ring-1 ring-gray-300 active:bg-gray-50'
                            }`}
                          >
                            {isFree ? t('guest.bingo.free') : num}
                          </button>
                        )
                      })}
                    </div>
                  </Card>

                  {editError && (
                    <p className="mt-2 text-center text-sm text-red-500">{editError}</p>
                  )}

                  {!card.is_confirmed ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        onClick={shuffleCard}
                        disabled={saving}
                        className="w-full rounded-xl bg-gray-100 px-4 py-3 text-base font-semibold text-gray-700 active:scale-[0.98] disabled:opacity-50"
                      >
                        {t('guest.bingo.shuffle')}
                      </button>
                      <button
                        onClick={confirmCard}
                        disabled={confirming || saving}
                        className="w-full rounded-xl bg-sky-600 px-4 py-3 text-base font-bold text-white active:scale-[0.98] disabled:opacity-50"
                      >
                        {confirming ? t('guest.register.submitting') : t('guest.bingo.confirmCard')}
                      </button>
                      <p className="text-center text-xs text-gray-400">
                        {t('guest.bingo.editHint')}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-center text-xs text-gray-400">
                      {t('guest.bingo.tapHint')}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
