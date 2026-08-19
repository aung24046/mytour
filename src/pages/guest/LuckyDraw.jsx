import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId, useTourPath } from '../../lib/TourContext'
import { getGuestId } from '../../lib/guestSession'
import { currentPrize, drawPool } from '../../lib/luckyDraw'
import { pickActiveRoomId, useDrawRoom } from '../../lib/useDrawRoom'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import GuestNav from '../../components/common/GuestNav'
import BackButton from '../../components/common/BackButton'
import Icon from '../../components/common/Icon'
import DrawStage from '../../components/draw/DrawStage'
import DrawReveal from '../../components/draw/DrawReveal'
import DrawWinner from '../../components/draw/DrawWinner'

// หน้าลูกทัวร์ของเกมสุ่มรายชื่อ
//
// จุดสำคัญ: มือถือเล่นอนิเมชันแบบเดียวกับจอใหญ่ในจังหวะเดียวกัน
// ถ้าโชว์แค่ผลลัพธ์ คนที่ก้มดูมือถือจะรู้ผลก่อนคนที่มองจอ แล้วเสียความลุ้นทั้งห้อง
//
// แท็บ "ของฉัน" ตอบคำถามเดียวที่ลูกทัวร์ถามจริง — ฉันได้อะไรหรือยัง

export default function LuckyDraw() {
  const tourId = useTourId()
  const tp = useTourPath()
  const { t } = useTranslation()
  const guestId = getGuestId(tourId)

  const [roomId, setRoomId] = useState(null)
  const [rooms, setRooms] = useState([])
  const [guests, setGuests] = useState([])
  const [tab, setTab] = useState('live')
  const [alert, setAlert] = useState(false)

  const { room, prizes, results, winners, phase, loading, finishReveal } = useDrawRoom(tourId, roomId)

  useEffect(() => {
    if (!tourId) return
    supabase
      .from('draw_rooms')
      .select('id, name')
      .eq('tour_id', tourId)
      .eq('status', 'open')
      .order('created_at')
      .then(({ data }) => setRooms(data ?? []))
    supabase
      .from('guests')
      .select('id, name, nickname, bus_id, check_in_status')
      .eq('tour_id', tourId)
      .then(({ data }) => setGuests(data ?? []))
    pickActiveRoomId(tourId).then((id) => setRoomId((prev) => prev ?? id))
  }, [tourId])

  const pool = useMemo(() => (room ? drawPool(room, guests, results) : []), [room, guests, results])
  const prize = useMemo(() => (room ? currentPrize(room, prizes) : null), [room, prizes])

  // ⚠️ ชื่อรางวัลตอนเฉลยต้องมาจากผลของ "รอบนี้" ไม่ใช่ currentPrize()
  //    เพราะ commit() หัก qty_left ไปตั้งแต่ตอนกดสุ่ม ถ้าเพิ่งจ่ายชิ้นสุดท้าย
  //    currentPrize() จะเลื่อนไปรางวัลถัดไปแล้ว = ประกาศชื่อรางวัลผิด
  //    (โหมดต้องยืนยันก่อนบันทึกจะยังไม่มีแถว → ตกไปใช้ prize ซึ่งตอนนั้นยังถูกอยู่)
  const roundPrizeName = useMemo(() => {
    const rn = room?.round_no
    if (rn == null) return null
    for (let i = results.length - 1; i >= 0; i -= 1) {
      if (results[i].round_no === rn && results[i].prize_name) return results[i].prize_name
    }
    return null
  }, [results, room?.round_no])

  const winnerList = useMemo(
    () =>
      (phase === 'idle' ? [] : winners).map((w) => ({
        id: w.id,
        name: w.name,
        nickname: w.nickname || w.name,
      })),
    [winners, phase]
  )

  const isMe = useCallback((w) => guestId && w.id === guestId, [guestId])
  const myWins = useMemo(() => results.filter((r) => r.guest_id === guestId), [results, guestId])
  const pendingMe = phase !== 'idle' && winnerList.some(isMe)

  useEffect(() => {
    if (!pendingMe) return
    setAlert(true)
    try {
      navigator.vibrate?.([200, 80, 200])
    } catch {
      // iOS Safari ไม่มี vibrate
    }
  }, [pendingMe])

  const me = guests.find((g) => g.id === guestId)
  const lastResult = results[results.length - 1]

  if (loading) {
    return (
      <div className="mx-auto max-w-md px-4 pb-28 pt-4">
        <p className="py-10 text-center text-sm text-ink-muted">{t('common.loading')}</p>
        <GuestNav active="games" />
      </div>
    )
  }

  const liveTab = (
    <>
      {rooms.length > 1 && (
        <select
          value={roomId ?? ''}
          onChange={(e) => setRoomId(e.target.value)}
          className="mb-2.5 w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink"
        >
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {t('guest.luckyDraw.roomLabel', { room: r.name })}
            </option>
          ))}
        </select>
      )}

      <DrawStage
        mini
        themeKey={room?.stage_theme}
        status={
          phase === 'drawing'
            ? t('guest.luckyDraw.drawing')
            : phase === 'reveal'
              ? t('guest.luckyDraw.result')
              : t('guest.luckyDraw.waiting')
        }
      >
        {phase === 'drawing' && winnerList.length > 0 && (
          <DrawReveal
            key={`${room?.round_no}-${room?.drawn_at}`}
            anim={room?.reveal_animation}
            pool={pool}
            winners={winnerList}
            themeKey={room?.stage_theme}
            mini
            fx={false}
            onDone={finishReveal}
          />
        )}
        {phase === 'reveal' && winnerList.length > 0 && (
          <DrawWinner
            winners={winnerList}
            prizeName={roundPrizeName ?? prize?.name}
            themeKey={room?.stage_theme}
            mini
          />
        )}
        {/* เพิ่งเปิดหน้าเข้ามากลางงาน — โชว์ผลรอบล่าสุดแทนหน้าว่าง */}
        {phase === 'idle' && lastResult && (
          <DrawWinner
            winners={[{ id: lastResult.guest_id, name: lastResult.full_name, nickname: lastResult.display_name }]}
            prizeName={lastResult.prize_name}
            themeKey={room?.stage_theme}
            mini
          />
        )}
        {phase === 'idle' && !lastResult && (
          <p className="py-4 text-xs leading-relaxed opacity-60">{t('guest.luckyDraw.idleHint')}</p>
        )}
      </DrawStage>

      {results.length > 0 && (
        <div className="mt-2.5 rounded-card border border-line bg-surface p-3">
          <p className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[.15em] text-ink-faint">
            <span>{t('guest.luckyDraw.allWinners')}</span>
            <span>{results.length}</span>
          </p>
          {/* เรียงจากคนแรกไปคนล่าสุด และมีเลขลำดับนำหน้าเสมอ
              ตอนสุ่มหลายคนพร้อมกัน ลูกทัวร์ต้องเทียบกับที่ประกาศบนจอได้ว่าใครคือลำดับที่เท่าไหร่
              เดิมตัดเหลือ 6 ชื่อ ทำให้รอบที่สุ่มทีละหลายคนหายไปครึ่งรายการ */}
          <div className="max-h-64 overflow-auto">
            {results.map((r, i) => (
              <div
                key={r.id}
                className={`flex items-center gap-2.5 border-b border-line py-1.5 text-[12.5px] last:border-0 ${
                  r.guest_id === guestId ? 'font-bold text-brand' : ''
                }`}
              >
                <span className="w-5 flex-none text-[10px] tabular-nums text-ink-faint">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.display_name}</span>
                {r.prize_name && (
                  <span className="flex-none text-[10px] font-bold text-warning-text">
                    {r.prize_name.split('·')[0].trim()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )

  const mineTab = (
    <>
      <div className="rounded-card border border-line bg-surface p-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[12px] bg-brand text-sm font-extrabold text-white">
            {(me?.nickname || me?.name || '—').slice(0, 2)}
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-extrabold leading-tight text-ink">
              {me?.nickname || me?.name || t('guest.luckyDraw.you')}
            </span>
            <span className="block truncate text-[11px] text-ink-faint">{me?.name}</span>
          </span>
        </div>

        <div
          className={`mt-3 flex items-center gap-2 rounded-control px-3 py-2.5 text-[12.5px] font-semibold ${
            myWins.length
              ? 'bg-success-bg text-success-text'
              : pendingMe
                ? 'bg-warning-bg text-warning-text'
                : 'bg-surface-sunken text-ink-faint'
          }`}
        >
          {myWins.length
            ? t('guest.luckyDraw.youWon', { count: myWins.length })
            : pendingMe
              ? t('guest.luckyDraw.youArePicked')
              : t('guest.luckyDraw.notYet')}
        </div>

        {myWins.map((w) => (
          <div
            key={w.id}
            className="mt-1.5 flex items-center gap-2 rounded-control border border-warning/50 px-3 py-2 text-xs font-bold text-warning-text"
          >
            <Icon name="gift" size={15} />
            {w.prize_name || t('guest.luckyDraw.activityPick')}
          </div>
        ))}
      </div>

      {room && (
        <div className="mt-2.5 rounded-card border border-line bg-surface p-3.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.15em] text-ink-faint">
            {t('guest.luckyDraw.watching')}
          </p>
          <p className="text-sm font-bold text-ink">{room.name}</p>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">
            {t('guest.luckyDraw.roomStat', {
              drawn: results.length,
              prizes: prizes.filter((p) => p.qty_left > 0).length,
            })}
          </p>
        </div>
      )}
    </>
  )

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <AnnouncementBanner />
      <div className="flex items-center gap-2">
        <BackButton to={tp('games')} />
        <h1 className="text-2xl font-extrabold text-ink">{t('guest.luckyDraw.title')}</h1>
      </div>

      <div className="mt-3 flex border-b border-line">
        {['live', 'mine'].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setTab(k)
              if (k === 'mine') setAlert(false)
            }}
            className={`relative flex-1 border-b-2 pb-2 text-[12.5px] font-semibold transition ${
              tab === k ? 'border-brand text-ink' : 'border-transparent text-ink-faint'
            }`}
          >
            {t(`guest.luckyDraw.tab.${k}`)}
            {k === 'mine' && alert && tab !== 'mine' && (
              <span className="absolute right-4 top-0 h-1.5 w-1.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>

      <div className="mt-3">{tab === 'live' ? liveTab : mineTab}</div>

      <GuestNav active="games" />
    </div>
  )
}
