import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useActiveTourId } from '../../lib/staffSession'
import { currentPrize, drawPool } from '../../lib/luckyDraw'
import { getTheme } from '../../lib/drawStage'
import { primeDrawSound, playFanfare } from '../../lib/drawSound'
import { pickActiveRoomId, useDrawRoom } from '../../lib/useDrawRoom'
import DrawStage from '../../components/draw/DrawStage'
import DrawReveal from '../../components/draw/DrawReveal'
import DrawWinner from '../../components/draw/DrawWinner'

// จอใหญ่ — เปิดบนเครื่องที่ต่อโปรเจกเตอร์หรือทีวีในรถ
//
// หน้านี้ "ไม่มีปุ่มสั่งงาน" โดยตั้งใจ ทุกอย่างสั่งจากมือถือทีมงาน
// เพราะคนที่ยืนอยู่หน้าเวทีคือคนถือไมค์ ไม่ใช่คนที่ยืนอยู่ข้างโน้ตบุ๊ก

export default function LuckyDrawStage() {
  const sessionTourId = useActiveTourId()
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const [roomId, setRoomId] = useState(params.get('room'))
  const [guests, setGuests] = useState([])
  const [celebrate, setCelebrate] = useState(false)
  const [armed, setArmed] = useState(false)

  const { room, prizes, results, winners, phase, loading, finishReveal } = useDrawRoom(
    sessionTourId,
    roomId
  )

  // หน้านี้เปิดบนโน้ตบุ๊กที่ไม่ได้ล็อกอินได้ (ดู route ใน App.jsx) ตอนนั้น
  // staffSession เป็น null → ต้องเอา tour_id จากตัวห้องแทน ไม่งั้นรายชื่อลูกทัวร์ว่าง
  // แล้วอนิเมชันแบบคัดออกจะเหลือแค่ผู้ชนะกะพริบอยู่คนเดียว
  const tourId = room?.tour_id ?? sessionTourId

  // หาห้องเองได้เฉพาะตอนรู้ทริปจาก session — เปิดจากลิงก์ต้องมี ?room= มาให้
  useEffect(() => {
    if (roomId || !sessionTourId) return
    pickActiveRoomId(sessionTourId).then((id) => setRoomId(id))
  }, [sessionTourId, roomId])

  useEffect(() => {
    if (!tourId) return
    supabase
      .from('guests')
      .select('id, name, nickname, bus_id, check_in_status')
      .eq('tour_id', tourId)
      .then(({ data }) => setGuests(data ?? []))
  }, [tourId])

  const pool = useMemo(() => (room ? drawPool(room, guests, results) : []), [room, guests, results])
  const prize = useMemo(() => (room ? currentPrize(room, prizes) : null), [room, prizes])
  const theme = getTheme(room?.stage_theme)

  // ⚠️ ชื่อรางวัลตอนเฉลยต้องมาจากผลของ "รอบนี้" ไม่ใช่ currentPrize()
  //    เพราะ commit() หัก qty_left ไปตั้งแต่ตอนกดสุ่ม ถ้าเพิ่งจ่ายชิ้นสุดท้าย
  //    currentPrize() จะเลื่อนไปรางวัลถัดไปแล้ว = จอใหญ่ประกาศชื่อรางวัลผิด
  //    (โหมดต้องยืนยันก่อนบันทึกจะยังไม่มีแถว → ตกไปใช้ prize ซึ่งตอนนั้นยังถูกอยู่)
  const roundPrizeName = useMemo(() => {
    const rn = room?.round_no
    if (rn == null) return null
    for (let i = results.length - 1; i >= 0; i -= 1) {
      if (results[i].round_no === rn && results[i].prize_name) return results[i].prize_name
    }
    return null
  }, [results, room?.round_no])

  const onRevealDone = useCallback(() => {
    finishReveal()
    setCelebrate(false)
    // ปล่อยคอนเฟตตี้หลังเฉลยหนึ่งเฟรม ไม่งั้น canvas ยังไม่ได้ขนาดจริง
    requestAnimationFrame(() => {
      setCelebrate(true)
      playFanfare()
    })
  }, [finishReveal])

  // อนิเมชันตอนสุ่มยังไม่ควรมีคอนเฟตตี้ค้างจากรอบก่อน
  useEffect(() => {
    if (phase === 'drawing') setCelebrate(false)
  }, [phase])

  const winnerList = useMemo(
    () =>
      (phase === 'idle' ? [] : winners).map((w) => ({
        id: w.id,
        name: w.name,
        nickname: w.nickname || w.name,
      })),
    [winners, phase]
  )

  const lastSaved = results[results.length - 1]
  const seq = results.length + (phase === 'reveal' && lastSaved ? 0 : 1)

  if (loading) {
    return (
      <DrawStage themeKey={room?.stage_theme} status={t('common.loading')}>
        <span />
      </DrawStage>
    )
  }

  if (!room) {
    return (
      <DrawStage themeKey="led" status={t('staff.luckyDraw.stageNoRoom')}>
        <span />
      </DrawStage>
    )
  }

  const status =
    phase === 'drawing'
      ? t('staff.luckyDraw.stageDrawing')
      : phase === 'reveal'
        ? winnerList.length > 1
          ? t('staff.luckyDraw.winnersN', { count: winnerList.length })
          : t('staff.luckyDraw.winner')
        : t('staff.luckyDraw.stageWaiting')

  return (
    <div
      onClick={() => {
        // เบราว์เซอร์บล็อกเสียงจนกว่าจะมีการแตะจอ — หน้านี้ไม่มีปุ่มอื่นให้แตะ
        if (!armed) {
          primeDrawSound()
          setArmed(true)
        }
      }}
      role="presentation"
    >
      <DrawStage
        themeKey={room.stage_theme}
        roomName={room.name}
        status={status}
        prizeName={prize?.name}
        prizeLeft={prize?.qty_left}
        celebrate={celebrate}
        footLeft={t('staff.luckyDraw.fromPool', { count: pool.length })}
        footMid={room.round_seed ? `${t('staff.luckyDraw.seed')} ${room.round_seed}` : ''}
        footRight={`${t('staff.luckyDraw.round')} ${room.round_no ?? 0}`}
      >
        {phase === 'drawing' && winnerList.length > 0 && (
          <DrawReveal
            key={`${room.round_no}-${room.drawn_at}`}
            anim={room.reveal_animation}
            pool={pool}
            winners={winnerList}
            themeKey={room.stage_theme}
            fx={armed}
            onDone={onRevealDone}
          />
        )}

        {phase === 'reveal' && winnerList.length > 0 && (
          <DrawWinner
            winners={winnerList}
            prizeName={roundPrizeName ?? prize?.name}
            seq={seq}
            themeKey={room.stage_theme}
          />
        )}

        {/* เปิดจอทีหลังหรือรีเฟรชกลางงาน — ต้องยังเห็นผลรอบล่าสุด ไม่ใช่หน้าว่าง */}
        {phase === 'idle' && lastSaved && (
          <DrawWinner
            winners={[{ id: lastSaved.guest_id, name: lastSaved.full_name, nickname: lastSaved.display_name }]}
            prizeName={lastSaved.prize_name}
            seq={results.length}
            themeKey={room.stage_theme}
          />
        )}

        {phase === 'idle' && !lastSaved && (
          <p style={{ opacity: 0.4, fontSize: 'clamp(18px,2.4vw,28px)', lineHeight: 1.6, color: theme.ink }}>
            {t('staff.luckyDraw.stageHint')}
          </p>
        )}
      </DrawStage>
    </div>
  )
}
