import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId } from '../../lib/TourContext'
import { getGuestId } from '../../lib/guestSession'
import { playWinAlert, primeWinAlert } from '../../lib/winAlert'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import GuestNav from '../../components/common/GuestNav'

const GRID_SIZE = 5
const FREE_INDEX = 12 // center cell (row 2, col 2) — ช่องฟรี ตามกติกาบิงโกทั่วไป
const MAX_NUMBER = 75

const CARD_COLUMNS = 'id, numbers, marked_numbers, has_bingo, bingo_claimed_at, is_confirmed, win_status, win_line'

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
  const tourId = useTourId()
  const { t } = useTranslation()
  const guestId = getGuestId(tourId)

  const [games, setGames] = useState([])
  const [activeGameId, setActiveGameId] = useState(null)
  const [loadingGames, setLoadingGames] = useState(true)

  const [card, setCard] = useState(null)
  const [loadingCard, setLoadingCard] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [actionError, setActionError] = useState(null)

  const [editingIdx, setEditingIdx] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // เรามีการเขียนของตัวเองค้างอยู่กี่ครั้ง — ระหว่างนั้นห้าม realtime มาทับ state
  // ไม่งั้นช่องที่เพิ่งกดจะ "เด้งกลับ" เพราะ payload เก่ามาถึงทีหลัง
  const inFlightRef = useRef(0)
  // จำสถานะชนะครั้งก่อน เพื่อเล่นเสียงเฉพาะตอนเปลี่ยนเป็นชนะ ไม่ใช่ทุก render
  const wonBeforeRef = useRef(false)

  // silent = โหลดเบื้องหลัง ไม่ต้องขึ้น "กำลังโหลด"
  // นี่คือหัวใจของการแก้อาการกระพริบ: เดิม realtime ทุก event เรียกฟังก์ชันนี้
  // แบบไม่ silent → ทั้งหน้าถูกแทนด้วยข้อความ "กำลังโหลด" ทุกครั้งที่โฮสต์ประกาศเลข
  const loadGames = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoadingGames(true)
      const { data } = await supabase
        .from('bingo_games')
        .select('id, name, status, called_numbers')
        .eq('tour_id', tourId)
        .in('status', ['waiting', 'playing'])
        .order('created_at', { ascending: true })

      setGames(data ?? [])
      setActiveGameId((prev) => (prev && data?.some((g) => g.id === prev) ? prev : (data?.[0]?.id ?? null)))
      if (!silent) setLoadingGames(false)
    },
    [tourId]
  )

  const activeGame = games.find((g) => g.id === activeGameId) ?? null

  const loadCard = useCallback(
    async (gameId, { silent = false } = {}) => {
      if (!gameId || !guestId) {
        setCard(null)
        setLoadingCard(false)
        return
      }
      if (!silent) setLoadingCard(true)

      const { data: existing } = await supabase
        .from('bingo_cards')
        .select(CARD_COLUMNS)
        .eq('game_id', gameId)
        .eq('guest_id', guestId)
        .maybeSingle()

      if (existing) {
        setCard(existing)
        if (!silent) setLoadingCard(false)
        return
      }

      // bingo_ensure_card เป็น upsert ฝั่ง DB (unique game_id+guest_id)
      // เดิมเป็น select-then-insert ซึ่งถ้าถูกเรียกซ้อนกันจะสร้างการ์ดซ้ำได้
      const { data: created } = await supabase.rpc('bingo_ensure_card', {
        p_game_id: gameId,
        p_guest_id: guestId,
        p_numbers: generateCardNumbers(),
      })

      if (created) setCard(created)
      if (!silent) setLoadingCard(false)
    },
    [guestId]
  )

  useEffect(() => {
    loadGames()

    const channel = supabase
      .channel(`bingo-games-guest-${tourId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bingo_games', filter: `tour_id=eq.${tourId}` },
        (payload) => {
          // เลขที่ประกาศใหม่มาครบใน payload อยู่แล้ว — merge ตรงๆ ไม่ต้อง refetch
          // ประหยัด round-trip และไม่ทำให้ทั้งหน้า re-mount
          if (payload.eventType === 'UPDATE' && payload.new?.id) {
            setGames((prev) => {
              const found = prev.some((g) => g.id === payload.new.id)
              if (!found) {
                loadGames({ silent: true })
                return prev
              }
              // เกมที่จบแล้วต้องหลุดจากรายการ
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

  // เกมหายไป (จบเกม) → เลือกเกมที่เหลือให้อัตโนมัติ
  useEffect(() => {
    if (activeGameId && !games.some((g) => g.id === activeGameId)) {
      setActiveGameId(games[0]?.id ?? null)
    }
  }, [games, activeGameId])

  useEffect(() => {
    if (!activeGameId) {
      setCard(null)
      setLoadingCard(false)
      return
    }
    loadCard(activeGameId)
  }, [activeGameId, loadCard])

  useEffect(() => {
    if (!guestId) return

    // เดิม filter เป็น game_id → ฟังการ์ดของ "ทุกคน" ในเกม
    // ผู้เล่น 20 คนกดมาร์กคนละครั้ง = ทุกเครื่องยิงโหลดใหม่ 20 รอบ นั่นคือต้นเหตุกระพริบ
    // ตอนนี้ฟังเฉพาะการ์ดของตัวเอง (ข้ามเกมได้ ไม่ต้อง resubscribe ตอนสลับห้อง)
    const cardChannel = supabase
      .channel(`bingo-card-guest-${guestId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bingo_cards', filter: `guest_id=eq.${guestId}` },
        (payload) => {
          const row = payload.new
          if (!row?.id) return
          if (inFlightRef.current > 0) return // การเขียนของเราเองยังไม่จบ อย่าเพิ่งทับ
          setCard((prev) => (prev && prev.id === row.id ? { ...prev, ...row } : prev))
        }
      )
      .subscribe()

    return () => supabase.removeChannel(cardChannel)
  }, [guestId])

  const calledSet = useMemo(() => new Set(activeGame?.called_numbers ?? []), [activeGame])
  const markedSet = useMemo(() => new Set(card?.marked_numbers ?? []), [card])

  const hasBingoNow = useMemo(() => {
    if (!card || !card.is_confirmed) return false
    return checkBingo(card.numbers, markedSet)
  }, [card, markedSet])

  // เล่นเสียงตอนชนะ — เฉพาะตอนเปลี่ยนสถานะ
  useEffect(() => {
    const won = Boolean(card?.has_bingo)
    if (won && !wonBeforeRef.current) playWinAlert()
    wonBeforeRef.current = won
  }, [card?.has_bingo])

  async function persistNumbers(nextNumbers) {
    if (!card) return
    setSaving(true)
    inFlightRef.current += 1
    setCard((prev) => (prev ? { ...prev, numbers: nextNumbers } : prev))
    const { error } = await supabase
      .from('bingo_cards')
      .update({ numbers: nextNumbers })
      .eq('id', card.id)
    inFlightRef.current -= 1
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
    inFlightRef.current += 1

    const { error } = await supabase
      .from('bingo_cards')
      .update({ is_confirmed: true })
      .eq('id', card.id)

    if (!error) {
      setCard((prev) => (prev ? { ...prev, is_confirmed: true } : prev))
    }
    inFlightRef.current -= 1
    setConfirming(false)
  }

  async function toggleMark(number) {
    if (!card || !card.is_confirmed || number === 0) return
    if (!calledSet.has(number)) return // ทำเครื่องหมายได้เฉพาะเลขที่ประกาศแล้ว

    primeWinAlert() // ปลดล็อกเสียงตั้งแต่แตะครั้งแรก เผื่อชนะทีหลัง
    const previous = card.marked_numbers ?? []
    const isMarked = markedSet.has(number)
    const nextMarked = isMarked ? previous.filter((n) => n !== number) : [...previous, number]

    setCard((prev) => (prev ? { ...prev, marked_numbers: nextMarked } : prev))
    inFlightRef.current += 1

    // RPC toggle ฝั่ง DB — atomic กันเคสแตะรัวๆ แล้วสถานะเพี้ยน
    const { data, error } = await supabase.rpc('bingo_toggle_mark', {
      p_card_id: card.id,
      p_number: number,
    })
    inFlightRef.current -= 1

    if (error) {
      setCard((prev) => (prev ? { ...prev, marked_numbers: previous } : prev)) // ย้อนกลับ
      return
    }
    if (Array.isArray(data)) {
      setCard((prev) => (prev ? { ...prev, marked_numbers: data } : prev))
    }
  }

  async function claimBingo() {
    if (!card || card.has_bingo) return
    setClaiming(true)
    setActionError(null)
    inFlightRef.current += 1

    // เซิร์ฟเวอร์ตรวจแถวที่ชนะเอง — client ส่งแค่ id
    const { data, error } = await supabase.rpc('bingo_claim', { p_card_id: card.id })
    inFlightRef.current -= 1

    if (error) {
      setActionError(t('guest.bingo.claimFailed'))
    } else if (data) {
      setCard((prev) => (prev ? { ...prev, ...data } : data))
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

          {loadingGames && <p className="text-ink-muted">{t('common.loading')}</p>}

          {!loadingGames && games.length === 0 && (
            <Card>
              <p className="text-ink-muted">{t('guest.bingo.noGame')}</p>
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
                        activeGameId === g.id ? 'bg-brand text-white' : 'bg-surface-sunken text-neutral-text'
                      }`}
                    >
                      {g.name || t('guest.bingo.unnamedRoom')}
                    </button>
                  ))}
                </div>
              )}

              {loadingCard && <p className="text-ink-muted">{t('common.loading')}</p>}

              {!loadingCard && card && (
                <>
                  {!card.is_confirmed && (
                    <Card className="mb-3 bg-brand-lighter">
                      <p className="text-sm font-medium text-brand-hover">
                        {t('guest.bingo.editModeHint')}
                      </p>
                    </Card>
                  )}

                  {card.is_confirmed && card.has_bingo && (
                    <Card className="mb-3 bg-warning-bg text-center">
                      <p className="text-lg font-bold text-warning-text">
                        🎉 {t('guest.bingo.youWon')}
                      </p>
                      <p className="mt-1 text-sm text-warning-text/80">
                        {card.win_status === 'confirmed'
                          ? t('guest.bingo.winConfirmed')
                          : t('guest.bingo.winPending')}
                      </p>
                    </Card>
                  )}

                  {card.win_status === 'rejected' && !card.has_bingo && (
                    <Card className="mb-3 bg-surface-muted text-center">
                      <p className="text-sm font-medium text-ink-muted">
                        {t('guest.bingo.winRejected')}
                      </p>
                    </Card>
                  )}

                  {card.is_confirmed && !card.has_bingo && hasBingoNow && (
                    <Card className="mb-3 text-center">
                      <p className="mb-2 font-semibold text-brand-hover">
                        {t('guest.bingo.youHaveBingo')}
                      </p>
                      <button
                        onClick={claimBingo}
                        disabled={claiming}
                        className="w-full rounded-xl bg-warning px-4 py-3 text-base font-bold text-on-warning active:scale-[0.98] disabled:opacity-50"
                      >
                        {claiming ? t('guest.register.submitting') : t('guest.bingo.claimBingo')}
                      </button>
                      {actionError && (
                        <p className="mt-2 text-sm text-danger">{actionError}</p>
                      )}
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
                              className="aspect-square rounded-lg border-2 border-brand text-center text-sm font-bold"
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
                                  ? 'bg-brand text-white'
                                  : isCalled
                                    ? 'bg-surface text-ink ring-1 ring-brand'
                                    : 'bg-surface-sunken text-ink-faint'
                                : isFree
                                  ? 'bg-surface-sunken text-ink-faint'
                                  : 'bg-surface text-ink ring-1 ring-line-strong active:bg-surface-muted'
                            }`}
                          >
                            {isFree ? t('guest.bingo.free') : num}
                          </button>
                        )
                      })}
                    </div>
                  </Card>

                  {editError && (
                    <p className="mt-2 text-center text-sm text-danger">{editError}</p>
                  )}

                  {!card.is_confirmed ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <button
                        onClick={shuffleCard}
                        disabled={saving}
                        className="w-full rounded-xl bg-surface-sunken px-4 py-3 text-base font-semibold text-neutral-text active:scale-[0.98] disabled:opacity-50"
                      >
                        {t('guest.bingo.shuffle')}
                      </button>
                      <button
                        onClick={confirmCard}
                        disabled={confirming || saving}
                        className="w-full rounded-xl bg-brand px-4 py-3 text-base font-bold text-white active:scale-[0.98] disabled:opacity-50"
                      >
                        {confirming ? t('guest.register.submitting') : t('guest.bingo.confirmCard')}
                      </button>
                      <p className="text-center text-xs text-ink-faint">
                        {t('guest.bingo.editHint')}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-center text-xs text-ink-faint">
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
