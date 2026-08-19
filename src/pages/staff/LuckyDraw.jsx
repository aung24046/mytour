import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useActiveTourId } from '../../lib/staffSession'
import {
  animationFor, buildResultRows, currentPrize, drawPool, makeSeed,
  pickWinners, reconcilePrizeQty, visibleMembers,
} from '../../lib/luckyDraw'
import { ANIM_KEYS, THEME_LIST } from '../../lib/drawStage'
import { primeDrawSound } from '../../lib/drawSound'
import Icon from '../../components/common/Icon'
import StaffHeader from '../../components/common/StaffHeader'

// หน้าคุมเกมสุ่มรายชื่อของทีมงาน
//
// ออกแบบให้ใช้มือเดียวบนมือถือ เพราะสตาฟถือไมค์อีกมือระหว่างยืนบนรถ:
//   • ปุ่มสุ่มอยู่ล่างสุดในระยะนิ้วโป้ง แตะครั้งเดียวถึง
//   • ของที่ต้องปรับบ่อย (จำนวนคน รูปแบบการเฉลย ธีม) อยู่ในแท็บสุ่มเลย ไม่ต้องสลับแท็บ
//   • ของที่ตั้งครั้งเดียว (ห้อง กติกา) อยู่แท็บตั้งค่า
//
// จอใหญ่กับมือถือลูกทัวร์ไม่ได้คุยกับหน้านี้ตรงๆ — ทุกอย่างวิ่งผ่าน draw_rooms
// ทีมงานกดสุ่ม = เขียน pending + round_no ลงแถวห้อง แล้วอีกสองฝั่งรับ realtime ไปเล่นเอง

const TABS = [
  { key: 'draw', icon: 'bolt' },
  { key: 'list', icon: 'people' },
  { key: 'prizes', icon: 'gift' },
  { key: 'history', icon: 'clock' },
  { key: 'settings', icon: 'settings' },
]

const ROOM_COLS =
  'id, tour_id, name, filter_kind, filter_bus, custom_name, custom_ids, excluded_ids, nicknames, extras,' +
  ' checkin_only, no_repeat, need_confirm, use_prizes, draw_count, reveal_animation, stage_theme,' +
  ' round_no, round_seed, pending, pending_prize_id, drawn_at, current_prize_id, status'

function Sw({ on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`relative h-6 w-11 flex-none rounded-pill transition ${on ? 'bg-success' : 'bg-line-strong'}`}
    >
      <span
        className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-all ${
          on ? 'left-[23px]' : 'left-[3px]'
        }`}
      />
    </button>
  )
}

/** ผู้ชนะหลายคนในรอบเดียว — ต้องเห็นครบทุกชื่อพร้อมเลขลำดับ ไม่ใช่โชว์คนสุดท้ายคนเดียว */
function WinnerRows({ rows }) {
  return (
    <div className="mt-1.5 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
      {rows.map((r, i) => (
        <div key={r.id ?? `${r.display_name}-${i}`} className="rounded-[11px] bg-white/10 px-2 py-1.5">
          <span className="block text-[8.5px] tracking-[.16em] opacity-50">{String(i + 1).padStart(2, '0')}</span>
          <span className="block text-[17px] font-bold leading-[1.62]">{r.display_name}</span>
          <span className="block truncate text-[10px] opacity-60">{r.full_name}</span>
        </div>
      ))}
    </div>
  )
}

function Row({ title, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

const CARD = 'rounded-card border border-line bg-surface p-3'
const LBL = 'mb-2 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[.15em] text-ink-faint'
const LI = 'mb-1.5 flex items-center gap-2.5 rounded-control border border-line bg-surface p-2.5 text-left'
const LI_ON = 'mb-1.5 flex items-center gap-2.5 rounded-control border-[1.5px] border-brand bg-brand-lighter p-2.5 text-left'
const INPUT =
  'min-w-0 flex-1 rounded-[10px] border border-line-strong bg-surface px-2.5 py-2 text-[12.5px] font-semibold text-ink focus:border-brand focus:outline-none'

export default function LuckyDraw() {
  const tourId = useActiveTourId()
  const { t } = useTranslation()

  const [rooms, setRooms] = useState([])
  const [roomId, setRoomId] = useState(null)
  const [guests, setGuests] = useState([])
  const [buses, setBuses] = useState([])
  const [prizes, setPrizes] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // เก็บ error ไว้แสดงจริง — เดิมถ้าโหลดห้องไม่สำเร็จหน้าจะค้างที่ "กำลังโหลด" ตลอดกาล
  // โดยไม่บอกอะไรเลย ซึ่งหาสาเหตุยากมากตอนอยู่หน้างาน
  const [error, setError] = useState(null)

  const [tab, setTab] = useState('draw')
  const [editPrize, setEditPrize] = useState(null)
  const [editPerson, setEditPerson] = useState(null)
  const [editRoom, setEditRoom] = useState(null)
  const [draft, setDraft] = useState({})

  const room = useMemo(() => rooms.find((r) => r.id === roomId) ?? null, [rooms, roomId])

  /* ── โหลดข้อมูล ─────────────────────────────────────────── */
  const loadRooms = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('draw_rooms')
      .select(ROOM_COLS)
      .eq('tour_id', tourId)
      .eq('status', 'open')
      .order('created_at')
    if (err) {
      setError(err)
      return null
    }
    const list = data ?? []
    setRooms(list)
    setRoomId((prev) => (prev && list.some((r) => r.id === prev) ? prev : (list[0]?.id ?? null)))
    return list
  }, [tourId])

  useEffect(() => {
    if (!tourId) return undefined
    let cancelled = false

    async function boot() {
      setLoading(true)
      setError(null)
      const [guestsRes, busesRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, name, nickname, bus_id, check_in_status')
          .eq('tour_id', tourId)
          .order('name'),
        supabase.from('buses').select('id, name').eq('tour_id', tourId).order('name'),
      ])
      if (cancelled) return
      setGuests(guestsRes.data ?? [])
      setBuses(busesRes.data ?? [])

      const list = await loadRooms()
      if (cancelled) return
      if (list === null) {
        setLoading(false)
        return
      }

      // ทริปที่ยังไม่เคยเล่น — สร้างห้องแรกให้เลย ไม่ต้องให้ผู้ใช้เดาว่าต้องกดอะไรก่อน
      if (list.length === 0) {
        const { data, error: err } = await supabase
          .from('draw_rooms')
          .insert({ tour_id: tourId, name: t('staff.luckyDraw.firstRoom') })
          .select(ROOM_COLS)
          .single()
        if (cancelled) return
        if (err) setError(err)
        else if (data) {
          setRooms([data])
          setRoomId(data.id)
        }
      }
      if (!cancelled) setLoading(false)
    }

    boot()
    return () => {
      cancelled = true
    }
  }, [tourId, loadRooms, t])

  useEffect(() => {
    if (!roomId) return undefined
    let cancelled = false

    async function load() {
      const [pz, rs] = await Promise.all([
        supabase.from('draw_prizes').select('*').eq('room_id', roomId).order('sort_order'),
        supabase.from('draw_results').select('*').eq('room_id', roomId).order('created_at'),
      ])
      if (cancelled) return
      setPrizes(pz.data ?? [])
      setResults(rs.data ?? [])
    }

    load()
    return () => {
      cancelled = true
    }
  }, [roomId])

  /* ── ค่าที่คำนวณจาก lib กลาง (จอใหญ่กับลูกทัวร์ใช้ตัวเดียวกัน) ── */
  const pool = useMemo(() => (room ? drawPool(room, guests, results) : []), [room, guests, results])
  const visible = useMemo(() => (room ? visibleMembers(room, guests) : []), [room, guests])
  const prize = useMemo(() => (room ? currentPrize(room, prizes) : null), [room, prizes])
  const count = room?.draw_count ?? 1
  const need = Math.max(1, count)

  // ผลของ "รอบล่าสุด" ไม่ใช่แค่แถวสุดท้าย — สุ่มทีเดียวหลายคนจะได้หลายแถวในรอบเดียวกัน
  const lastRound = useMemo(() => {
    if (results.length === 0) return []
    const no = results[results.length - 1].round_no
    return results.filter((r) => r.round_no === no).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  }, [results])

  const patchRoom = useCallback(
    async (patch) => {
      if (!room) return
      setRooms((prev) => prev.map((r) => (r.id === room.id ? { ...r, ...patch } : r)))
      await supabase.from('draw_rooms').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', room.id)
    },
    [room]
  )

  /* ── สุ่ม ────────────────────────────────────────────────── */
  async function handleDraw(isReroll = false) {
    if (!room || busy || pool.length < 1) return
    setBusy(true)
    primeDrawSound()
    const winners = pickWinners(pool, need)
    const seed = makeSeed()
    const payload = winners.map((w) => ({ id: w.id, name: w.name, nickname: w.nickname, isExtra: w.isExtra }))
    await patchRoom({
      pending: payload,
      pending_prize_id: prize?.id ?? null,
      round_no: (room.round_no ?? 0) + 1,
      round_seed: seed,
      drawn_at: new Date().toISOString(),
    })
    // ไม่ต้องยืนยัน = บันทึกทันทีหลังอนิเมชันจบพอดี (จอใหญ่เล่นอยู่ ~7-8 วิ)
    if (!room.need_confirm || need > 1) {
      await commit({ winners, seed, isReroll, roundNo: (room.round_no ?? 0) + 1 })
    }
    setBusy(false)
  }

  async function commit({ winners, seed, isReroll, roundNo } = {}) {
    if (!room) return
    const list =
      winners ??
      (room.pending ?? []).map((p) => ({ id: p.id, name: p.name, nickname: p.nickname, isExtra: p.isExtra }))
    if (list.length === 0) return

    const rows = buildResultRows(list, {
      room,
      prize: prize ? { ...prize } : null,
      roundNo: roundNo ?? room.round_no ?? 0,
      seed: seed ?? room.round_seed,
      isReroll,
    })

    // หักจำนวนรางวัลผ่าน RPC — ทีมงานสองคนกดยืนยันพร้อมกันแล้วของชิ้นสุดท้ายต้องไม่ถูกจ่ายซ้ำ
    const claimed = []
    for (const r of rows) {
      if (!r.prize_id) {
        claimed.push(r)
        continue
      }
      const { data: left, error: claimErr } = await supabase.rpc('draw_claim_prize', {
        p_prize_id: r.prize_id,
      })
      // ถ้า RPC error ตัว data จะเป็น undefined ไม่ใช่ null — เทียบด้วย === null
      // จะบันทึกว่าจ่ายรางวัลไปแล้วทั้งที่ qty_left ไม่ได้ถูกหัก = ของเกินสต็อก
      const got = !claimErr && left != null
      claimed.push(got ? r : { ...r, prize_id: null, prize_name: null })
    }

    const { data } = await supabase.from('draw_results').insert(claimed).select()
    setResults((prev) => [...prev, ...(data ?? [])])
    await patchRoom({ pending: null, pending_prize_id: null })
    const { data: pz } = await supabase.from('draw_prizes').select('*').eq('room_id', room.id).order('sort_order')
    setPrizes(pz ?? [])
  }

  async function undo() {
    const last = results[results.length - 1]
    if (!last) return
    await supabase.from('draw_results').delete().eq('id', last.id)
    if (last.prize_id) {
      const p = prizes.find((x) => x.id === last.prize_id)
      if (p && p.qty_left < p.qty) {
        await supabase.from('draw_prizes').update({ qty_left: p.qty_left + 1 }).eq('id', p.id)
        setPrizes((prev) => prev.map((x) => (x.id === p.id ? { ...x, qty_left: x.qty_left + 1 } : x)))
      }
    }
    setResults((prev) => prev.slice(0, -1))
  }

  async function resetRoom() {
    if (!room || !window.confirm(t('staff.luckyDraw.confirmReset'))) return
    await supabase.from('draw_results').delete().eq('room_id', room.id)
    await Promise.all(prizes.map((p) => supabase.from('draw_prizes').update({ qty_left: p.qty }).eq('id', p.id)))
    setResults([])
    setPrizes((prev) => prev.map((p) => ({ ...p, qty_left: p.qty })))
    await patchRoom({ pending: null, pending_prize_id: null, round_no: 0, round_seed: null })
  }

  /* ── ตัวช่วยแก้รายชื่อ / รางวัล / ห้อง ─────────────────────── */
  const toggleMember = (id) => {
    if (!room) return
    if (room.filter_kind === 'custom') {
      const set = new Set(room.custom_ids ?? [])
      set.has(id) ? set.delete(id) : set.add(id)
      patchRoom({ custom_ids: [...set] })
    } else {
      const set = new Set(room.excluded_ids ?? [])
      set.has(id) ? set.delete(id) : set.add(id)
      patchRoom({ excluded_ids: [...set] })
    }
  }

  const selectAll = (on) => {
    if (!room) return
    const ids = visible.map((p) => p.id)
    if (room.filter_kind === 'custom') {
      patchRoom({ custom_ids: on ? ids : [] })
    } else {
      const keep = new Set(room.excluded_ids ?? [])
      ids.forEach((id) => (on ? keep.delete(id) : keep.add(id)))
      patchRoom({ excluded_ids: [...keep] })
    }
  }

  if (loading || !room) {
    // ตารางยังไม่ถูกสร้าง (ยังไม่ได้รัน migration) — PostgREST ตอบ 42P01/404
    // บอกให้ตรงๆ ดีกว่าปล่อยให้เดาว่าทำไมหน้าไม่ขึ้น
    const missingTable = error?.code === '42P01' || /draw_rooms/.test(error?.message ?? '')
    return (
      <div className="min-h-screen bg-surface-muted">
        <StaffHeader icon="bolt" title={t('staff.luckyDraw.title')} backTo="/staff/games" />
        <div className="mx-auto max-w-md p-6 text-center">
          {loading && !error ? (
            <p className="text-sm text-ink-muted">{t('common.loading')}</p>
          ) : (
            <>
              <p className="text-sm font-semibold text-ink">
                {missingTable ? t('staff.luckyDraw.errNoTable') : t('staff.luckyDraw.errLoad')}
              </p>
              {error?.message && (
                <p className="mt-2 break-words text-xs text-ink-faint">{error.message}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setLoading(true)
                  loadRooms().then(() => setLoading(false))
                }}
                className="mt-5 rounded-control bg-brand px-5 py-2.5 text-sm font-semibold text-white"
              >
                {t('staff.luckyDraw.retry')}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  const theme = THEME_LIST.find((x) => x.key === room.stage_theme) ?? THEME_LIST[0]
  const isCustom = room.filter_kind === 'custom'
  const pending = room.pending ?? null

  /* ── แท็บสุ่ม ───────────────────────────────────────────── */
  const drawTab = (
    <>
      <div className={CARD}>
        <p className={LBL}>{t('staff.luckyDraw.ready')}</p>
        <div className="flex items-baseline gap-2.5">
          <b className="text-[33px] font-semibold leading-none text-brand">{pool.length}</b>
          <span className="text-xs leading-snug text-ink-muted">
            {t('staff.luckyDraw.inRoom', { room: room.name })}
            <br />
            <span className="text-ink-faint">
              {count > 1 ? t('staff.luckyDraw.perDraw', { count }) : t('staff.luckyDraw.oneAtATime')}
              {room.checkin_only ? ` · ${t('staff.luckyDraw.checkedInOnly')}` : ''}
            </span>
          </span>
        </div>
        <div className="mt-3">
          {prize ? (
            <span className="inline-flex items-center gap-2 rounded-pill border border-warning/50 bg-warning-bg px-3 py-1.5 text-xs font-bold text-warning-text">
              <Icon name="gift" size={14} />
              {prize.name} · {t('staff.luckyDraw.left', { count: prize.qty_left })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-pill bg-surface-sunken px-3 py-1.5 text-xs font-bold text-ink-faint">
              {t('staff.luckyDraw.noPrizeMode')}
            </span>
          )}
        </div>
      </div>

      <div className={CARD}>
        <p className={LBL}>{t('staff.luckyDraw.howMany')}</p>
        <div className="flex gap-1.5 rounded-control bg-surface-sunken p-1">
          {[1, 0].map((one) => (
            <button
              key={one}
              type="button"
              onClick={() => patchRoom({ draw_count: one ? 1 : Math.max(2, count), reveal_animation: one ? room.reveal_animation : 'elim' })}
              className={`flex-1 rounded-[10px] py-2 text-[12.5px] font-semibold transition ${
                (count === 1) === Boolean(one) ? 'bg-surface text-ink shadow-card' : 'text-ink-muted'
              }`}
            >
              {one ? t('staff.luckyDraw.modeOne') : t('staff.luckyDraw.modeMany')}
            </button>
          ))}
        </div>

        {count > 1 && (
          <div className="mt-2.5 flex items-center justify-between text-[12.5px] font-semibold">
            <span>{t('staff.luckyDraw.count')}</span>
            <div className="flex items-center gap-1 rounded-control bg-surface-sunken p-1">
              <button type="button" className="h-8 w-8 rounded-[8px] bg-surface text-lg shadow-card" onClick={() => patchRoom({ draw_count: Math.max(2, count - 1) })}>−</button>
              <span className="w-8 text-center text-[15px] font-semibold">{count}</span>
              <button type="button" className="h-8 w-8 rounded-[8px] bg-surface text-lg shadow-card" onClick={() => patchRoom({ draw_count: Math.min(20, count + 1) })}>+</button>
            </div>
          </div>
        )}

        <p className={`${LBL} mt-4`}>{t('staff.luckyDraw.revealStyle')}</p>
        <div className="flex gap-1.5 rounded-control bg-surface-sunken p-1">
          {ANIM_KEYS.map((k) => {
            const locked = count > 1 && k !== 'elim'
            return (
              <button
                key={k}
                type="button"
                disabled={locked}
                onClick={() => patchRoom({ reveal_animation: animationFor(count, k) })}
                className={`flex-1 rounded-[10px] py-2 text-[12.5px] font-semibold transition disabled:opacity-30 ${
                  room.reveal_animation === k ? 'bg-surface text-ink shadow-card' : 'text-ink-muted'
                }`}
              >
                {t(`staff.luckyDraw.anim.${k}`)}
              </button>
            )
          })}
        </div>
        {count > 1 && <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('staff.luckyDraw.animLocked')}</p>}
      </div>

      {pending ? (
        <div className="rounded-card bg-gradient-to-b from-[#1b4f86] to-[#0e2b4c] p-4 text-center text-white">
          <p className="text-[9px] font-semibold uppercase tracking-[.18em] opacity-60">{t('staff.luckyDraw.awaitConfirm')}</p>
          {pending.length > 1 ? (
            <WinnerRows rows={pending.map((p) => ({ display_name: p.nickname || p.name, full_name: p.name }))} />
          ) : (
            <>
              <p className="text-[32px] font-bold leading-[1.62]">{pending[0]?.nickname || pending[0]?.name}</p>
              <p className="text-[11.5px] opacity-65">{pending[0]?.name}</p>
            </>
          )}
          {prize && <p className="mt-1.5 text-[10px] tracking-[.08em] text-[#ffc76b]">{prize.name}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => commit()} className="flex-1 rounded-[11px] bg-success py-2.5 text-[12.5px] font-bold text-white">
              {t('staff.luckyDraw.confirmYes')}
            </button>
            <button type="button" onClick={() => handleDraw(true)} className="flex-1 rounded-[11px] bg-white/15 py-2.5 text-[12.5px] font-bold text-white">
              {t('staff.luckyDraw.confirmNo')}
            </button>
          </div>
        </div>
      ) : lastRound.length > 0 ? (
        <div className="rounded-card bg-gradient-to-b from-[#1b4f86] to-[#0e2b4c] p-4 text-center text-white">
          <p className="text-[9px] font-semibold uppercase tracking-[.18em] opacity-60">
            {lastRound.length > 1
              ? t('staff.luckyDraw.winnersN', { count: lastRound.length })
              : t('staff.luckyDraw.winner')}
          </p>
          {lastRound.length > 1 ? (
            <WinnerRows rows={lastRound} />
          ) : (
            <>
              <p className="text-[32px] font-bold leading-[1.62]">{lastRound[0].display_name}</p>
              <p className="text-[11.5px] opacity-65">{lastRound[0].full_name}</p>
            </>
          )}
          {lastRound[0].prize_name && (
            <p className="mt-1.5 text-[10px] tracking-[.08em] text-[#ffc76b]">{lastRound[0].prize_name}</p>
          )}
        </div>
      ) : (
        <div className={`${CARD} text-center text-xs leading-relaxed text-ink-faint`}>
          {t('staff.luckyDraw.emptyDraw')}
        </div>
      )}

      <button
        type="button"
        disabled={busy || pool.length < need || Boolean(pending)}
        onClick={() => handleDraw(false)}
        className="mt-auto flex w-full items-center justify-center gap-2.5 rounded-card bg-brand py-4 text-[17px] font-extrabold text-white shadow-brand disabled:bg-line-strong disabled:text-ink-faint disabled:shadow-none"
      >
        <Icon name="bolt" size={19} />
        {pending
          ? t('staff.luckyDraw.awaitConfirm')
          : count > 1
            ? t('staff.luckyDraw.drawN', { count })
            : t('staff.luckyDraw.drawGo')}
      </button>
    </>
  )

  /* ── แท็บรายชื่อ ────────────────────────────────────────── */
  const listTab = (
    <>
      <div className={CARD}>
        <p className={LBL}>{t('staff.luckyDraw.filter')}</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { k: 'all', label: t('staff.luckyDraw.filterAll'), on: room.filter_kind === 'all' },
            ...buses.map((b) => ({
              k: `bus:${b.id}`,
              label: b.name,
              on: room.filter_kind === 'bus' && room.filter_bus === b.id,
            })),
            { k: 'custom', label: room.custom_name, on: isCustom, edit: true },
          ].map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => {
                if (c.k === 'all') patchRoom({ filter_kind: 'all', filter_bus: null })
                else if (c.k === 'custom') patchRoom({ filter_kind: 'custom' })
                else patchRoom({ filter_kind: 'bus', filter_bus: c.k.slice(4) })
              }}
              className={`flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-xs font-semibold transition ${
                c.on ? 'border-brand bg-brand text-white' : 'border-line-strong text-ink-muted'
              }`}
            >
              {c.label}
              {c.edit && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation()
                    patchRoom({ filter_kind: 'custom' })
                    setDraft({ customName: room.custom_name })
                    setEditRoom('filter')
                  }}
                  className="opacity-75"
                >
                  ✎
                </span>
              )}
            </button>
          ))}
        </div>

        {editRoom === 'filter' && (
          <div className="mt-2 flex gap-1.5">
            <input
              className={INPUT}
              value={draft.customName ?? ''}
              onChange={(e) => setDraft({ customName: e.target.value })}
              placeholder={t('staff.luckyDraw.groupName')}
            />
            <button
              type="button"
              className="rounded-[10px] border border-line-strong px-3 text-[12.5px] font-bold text-brand"
              onClick={() => {
                if (draft.customName?.trim()) patchRoom({ custom_name: draft.customName.trim() })
                setEditRoom(null)
              }}
            >
              {t('common.save')}
            </button>
          </div>
        )}

        <div className="mt-3">
          <Row title={t('staff.luckyDraw.checkinOnly')} hint={t('staff.luckyDraw.checkinOnlyHint')}>
            <Sw on={room.checkin_only} onClick={() => patchRoom({ checkin_only: !room.checkin_only })} />
          </Row>
        </div>
      </div>

      <div className={CARD}>
        <p className={LBL}>
          <span>
            {isCustom ? t('staff.luckyDraw.pickMembers') : t('staff.luckyDraw.inPool')} {pool.length} / {visible.length}
          </span>
          <span className="normal-case tracking-normal">
            <button type="button" className="font-bold text-brand" onClick={() => selectAll(true)}>
              {t('staff.luckyDraw.selectAll')}
            </button>
            {' · '}
            <button type="button" className="font-bold text-brand" onClick={() => selectAll(false)}>
              {t('staff.luckyDraw.clearAll')}
            </button>
          </span>
        </p>

        {(isCustom ? visibleMembers({ ...room, filter_kind: 'all' }, guests) : visible).map((p) => {
          const on = isCustom ? (room.custom_ids ?? []).includes(p.id) : !(room.excluded_ids ?? []).includes(p.id)
          if (editPerson === p.id) {
            return (
              <div key={p.id} className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-control border-[1.5px] border-brand bg-brand-lighter p-2.5">
                <input
                  className={INPUT}
                  value={draft.nickname ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, nickname: e.target.value }))}
                  placeholder={t('staff.luckyDraw.stageName')}
                />
                <div className="flex w-full gap-1.5">
                  <button
                    type="button"
                    className="flex-1 rounded-[10px] bg-brand py-2 text-xs font-bold text-white"
                    onClick={() => {
                      const nicks = { ...(room.nicknames ?? {}) }
                      if (draft.nickname?.trim()) nicks[p.id] = draft.nickname.trim()
                      else delete nicks[p.id]
                      patchRoom({ nicknames: nicks })
                      setEditPerson(null)
                    }}
                  >
                    {t('common.save')}
                  </button>
                  <button type="button" className="flex-1 rounded-[10px] border border-line-strong py-2 text-xs font-bold text-ink-muted" onClick={() => setEditPerson(null)}>
                    {t('common.cancel')}
                  </button>
                  {p.isExtra && (
                    <button
                      type="button"
                      className="flex-1 rounded-[10px] border border-danger/40 py-2 text-xs font-bold text-danger-text"
                      onClick={() => {
                        patchRoom({ extras: (room.extras ?? []).filter((x) => x.id !== p.id) })
                        setEditPerson(null)
                      }}
                    >
                      {t('common.delete')}
                    </button>
                  )}
                </div>
              </div>
            )
          }
          return (
            <div key={p.id} className={on ? LI_ON : LI}>
              <button type="button" onClick={() => toggleMember(p.id)} className="flex min-w-0 flex-1 items-center gap-2.5">
                <span
                  className={`flex h-[19px] w-[19px] flex-none items-center justify-center rounded-[6px] border-[1.5px] ${
                    on ? 'border-brand bg-brand text-white' : 'border-line-strong'
                  }`}
                >
                  {on && <Icon name="check" size={12} />}
                </span>
                <span className={`min-w-0 flex-1 text-left ${on ? '' : 'opacity-40'}`}>
                  <span className={`block text-[13px] font-semibold ${on ? '' : 'line-through'}`}>{p.nickname}</span>
                  <span className="block truncate text-[10.5px] text-ink-faint">{p.name}</span>
                </span>
              </button>
              {p.isExtra && <span className="rounded-pill bg-surface-sunken px-1.5 py-0.5 text-[9.5px] font-bold text-ink-faint">{t('staff.luckyDraw.addedTag')}</span>}
              {!p.isExtra && !p.checkedIn && <span className="rounded-pill bg-surface-sunken px-1.5 py-0.5 text-[9.5px] font-bold text-ink-faint">{t('staff.luckyDraw.notCheckedIn')}</span>}
              <button
                type="button"
                className="px-1 text-ink-faint"
                onClick={() => {
                  setDraft({ nickname: p.nickname })
                  setEditPerson(p.id)
                }}
              >
                ✎
              </button>
            </div>
          )
        })}

        <div className="mt-2 flex gap-1.5">
          <input
            className={INPUT}
            value={draft.newPerson ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, newPerson: e.target.value }))}
            placeholder={t('staff.luckyDraw.addOutsider')}
          />
          <button
            type="button"
            className="rounded-[10px] border border-line-strong px-3 text-[12.5px] font-bold text-brand"
            onClick={() => {
              const name = (draft.newPerson ?? '').trim()
              if (!name) return
              const id = `x${Date.now().toString(36)}`
              const extras = [...(room.extras ?? []), { id, name }]
              const patch = { extras }
              if (isCustom) patch.custom_ids = [...(room.custom_ids ?? []), id]
              patchRoom(patch)
              setDraft((d) => ({ ...d, newPerson: '' }))
            }}
          >
            {t('common.add')}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('staff.luckyDraw.listHint')}</p>
      </div>
    </>
  )

  /* ── แท็บรางวัล ─────────────────────────────────────────── */
  const prizeTab = (
    <div className={CARD}>
      <Row title={t('staff.luckyDraw.usePrizes')} hint={room.use_prizes ? t('staff.luckyDraw.usePrizesOn') : t('staff.luckyDraw.usePrizesOff')}>
        <Sw on={room.use_prizes} onClick={() => patchRoom({ use_prizes: !room.use_prizes })} />
      </Row>

      <div className={`mt-3 ${room.use_prizes ? '' : 'pointer-events-none opacity-40'}`}>
        {prizes.map((p) =>
          editPrize === p.id ? (
            <div key={p.id} className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-control border-[1.5px] border-brand bg-brand-lighter p-2.5">
              <input className={INPUT} value={draft.name ?? ''} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              <div className="flex flex-none items-center gap-1 rounded-[9px] bg-surface-sunken p-0.5">
                <button type="button" className="h-7 w-7 rounded-[7px] bg-surface" onClick={() => setDraft((d) => ({ ...d, qty: Math.max(1, (d.qty ?? 1) - 1) }))}>−</button>
                <span className="w-5 text-center text-xs font-semibold">{draft.qty ?? 1}</span>
                <button type="button" className="h-7 w-7 rounded-[7px] bg-surface" onClick={() => setDraft((d) => ({ ...d, qty: Math.min(99, (d.qty ?? 1) + 1) }))}>+</button>
              </div>
              <div className="flex w-full gap-1.5">
                <button
                  type="button"
                  className="flex-1 rounded-[10px] bg-brand py-2 text-xs font-bold text-white"
                  onClick={async () => {
                    const next = reconcilePrizeQty(p, draft.qty ?? p.qty)
                    const patch = { ...next, name: (draft.name ?? p.name).trim() || p.name }
                    await supabase.from('draw_prizes').update(patch).eq('id', p.id)
                    setPrizes((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))
                    setEditPrize(null)
                  }}
                >
                  {t('common.save')}
                </button>
                <button type="button" className="flex-1 rounded-[10px] border border-line-strong py-2 text-xs font-bold text-ink-muted" onClick={() => setEditPrize(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-[10px] border border-danger/40 py-2 text-xs font-bold text-danger-text"
                  onClick={async () => {
                    await supabase.from('draw_prizes').delete().eq('id', p.id)
                    setPrizes((prev) => prev.filter((x) => x.id !== p.id))
                    if (room.current_prize_id === p.id) patchRoom({ current_prize_id: null })
                    setEditPrize(null)
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ) : (
            <div key={p.id} className={`${prize?.id === p.id ? LI_ON : LI} ${p.qty_left === 0 ? 'opacity-45' : ''}`}>
              <button type="button" onClick={() => patchRoom({ current_prize_id: p.id })} className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className={`flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full border-[1.5px] ${prize?.id === p.id ? 'border-brand' : 'border-line-strong'}`}>
                  {prize?.id === p.id && <span className="h-2 w-2 rounded-full bg-brand" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold">{p.name}</span>
              </button>
              <span className="text-[10.5px] text-ink-faint">
                {p.qty_left === 0 ? t('staff.luckyDraw.soldOut') : `${p.qty_left}/${p.qty}`}
              </span>
              <button
                type="button"
                className="px-1 text-ink-faint"
                onClick={() => {
                  setDraft({ name: p.name, qty: p.qty })
                  setEditPrize(p.id)
                }}
              >
                ✎
              </button>
            </div>
          )
        )}

        <div className="mt-2 flex gap-1.5">
          <input
            className={INPUT}
            value={draft.newPrize ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, newPrize: e.target.value }))}
            placeholder={t('staff.luckyDraw.newPrize')}
          />
          <button
            type="button"
            className="rounded-[10px] border border-line-strong px-3 text-[12.5px] font-bold text-brand"
            onClick={async () => {
              const name = (draft.newPrize ?? '').trim()
              if (!name) return
              const { data } = await supabase
                .from('draw_prizes')
                .insert({ room_id: room.id, name, qty: 1, qty_left: 1, sort_order: prizes.length })
                .select()
                .single()
              if (data) setPrizes((prev) => [...prev, data])
              setDraft((d) => ({ ...d, newPrize: '' }))
            }}
          >
            {t('common.add')}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('staff.luckyDraw.prizeHint')}</p>
      </div>
    </div>
  )

  /* ── แท็บประวัติ ────────────────────────────────────────── */
  const historyTab = (
    <div className={CARD}>
      <p className={LBL}>
        <span>{t('staff.luckyDraw.winnersIn', { room: room.name })}</span>
        <span>{results.length}</span>
      </p>
      {results.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-faint">{t('staff.luckyDraw.emptyHistory')}</p>
      ) : (
        [...results].reverse().map((r, i) => (
          <div key={r.id} className="flex items-center gap-2.5 border-b border-line py-2 text-[12.5px] last:border-0">
            <span className="w-4 text-[10px] text-ink-faint">{String(results.length - i).padStart(2, '0')}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{r.display_name}</span>
              <span className="block truncate text-[10.5px] text-ink-faint">{r.full_name}</span>
            </span>
            {r.prize_name && <span className="text-[10px] font-bold text-warning-text">{r.prize_name.split('·')[0].trim()}</span>}
          </div>
        ))
      )}
      <div className="mt-2.5 flex gap-1.5">
        <button type="button" onClick={undo} className="flex-1 rounded-control border border-line-strong py-2 text-[11.5px] font-semibold text-ink-muted">
          {t('staff.luckyDraw.undo')}
        </button>
        <button type="button" onClick={resetRoom} className="flex-1 rounded-control border border-line-strong py-2 text-[11.5px] font-semibold text-danger-text">
          {t('staff.luckyDraw.resetRoom')}
        </button>
      </div>
    </div>
  )

  /* ── แท็บตั้งค่า ────────────────────────────────────────── */
  const settingsTab = (
    <>
      <div className={CARD}>
        <p className={LBL}>{t('staff.luckyDraw.rooms')}</p>
        {rooms.map((r) =>
          editRoom === r.id ? (
            <div key={r.id} className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-control border-[1.5px] border-brand bg-brand-lighter p-2.5">
              <input className={INPUT} value={draft.roomName ?? ''} onChange={(e) => setDraft((d) => ({ ...d, roomName: e.target.value }))} />
              <div className="flex w-full gap-1.5">
                <button
                  type="button"
                  className="flex-1 rounded-[10px] bg-brand py-2 text-xs font-bold text-white"
                  onClick={async () => {
                    const name = (draft.roomName ?? '').trim()
                    if (name) {
                      await supabase.from('draw_rooms').update({ name }).eq('id', r.id)
                      setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, name } : x)))
                    }
                    setEditRoom(null)
                  }}
                >
                  {t('common.save')}
                </button>
                <button type="button" className="flex-1 rounded-[10px] border border-line-strong py-2 text-xs font-bold text-ink-muted" onClick={() => setEditRoom(null)}>
                  {t('common.cancel')}
                </button>
                {rooms.length > 1 && (
                  <button
                    type="button"
                    className="flex-1 rounded-[10px] border border-danger/40 py-2 text-xs font-bold text-danger-text"
                    onClick={async () => {
                      await supabase.from('draw_rooms').update({ status: 'archived' }).eq('id', r.id)
                      const left = rooms.filter((x) => x.id !== r.id)
                      setRooms(left)
                      if (roomId === r.id) setRoomId(left[0]?.id ?? null)
                      setEditRoom(null)
                    }}
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div key={r.id} className={r.id === roomId ? LI_ON : LI}>
              <button type="button" onClick={() => setRoomId(r.id)} className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className={`flex h-[17px] w-[17px] flex-none items-center justify-center rounded-full border-[1.5px] ${r.id === roomId ? 'border-brand' : 'border-line-strong'}`}>
                  {r.id === roomId && <span className="h-2 w-2 rounded-full bg-brand" />}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-[13px] font-semibold">{r.name}</span>
                  <span className="block text-[10.5px] text-ink-faint">{t('staff.luckyDraw.roundsDone', { count: r.round_no ?? 0 })}</span>
                </span>
              </button>
              <button
                type="button"
                className="px-1 text-ink-faint"
                onClick={() => {
                  setDraft({ roomName: r.name })
                  setEditRoom(r.id)
                }}
              >
                ✎
              </button>
            </div>
          )
        )}

        <div className="mt-2 flex gap-1.5">
          <input
            className={INPUT}
            value={draft.newRoom ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, newRoom: e.target.value }))}
            placeholder={t('staff.luckyDraw.newRoom')}
          />
          <button
            type="button"
            className="rounded-[10px] border border-line-strong px-3 text-[12.5px] font-bold text-brand"
            onClick={async () => {
              const name = (draft.newRoom ?? '').trim()
              if (!name) return
              const { data } = await supabase.from('draw_rooms').insert({ tour_id: tourId, name }).select(ROOM_COLS).single()
              if (data) {
                setRooms((prev) => [...prev, data])
                setRoomId(data.id)
              }
              setDraft((d) => ({ ...d, newRoom: '' }))
            }}
          >
            {t('common.add')}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-ink-faint">{t('staff.luckyDraw.roomHint')}</p>
      </div>

      <div className={CARD}>
        <p className={LBL}>{t('staff.luckyDraw.rules')}</p>
        <Row title={t('staff.luckyDraw.noRepeat')} hint={t('staff.luckyDraw.noRepeatHint')}>
          <Sw on={room.no_repeat} onClick={() => patchRoom({ no_repeat: !room.no_repeat })} />
        </Row>
        <Row title={t('staff.luckyDraw.needConfirm')} hint={t('staff.luckyDraw.needConfirmHint')}>
          <Sw on={room.need_confirm} onClick={() => patchRoom({ need_confirm: !room.need_confirm })} />
        </Row>
      </div>
    </>
  )

  const body = { draw: drawTab, list: listTab, prizes: prizeTab, history: historyTab, settings: settingsTab }[tab]

  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <StaffHeader
        icon="bolt"
        title={t(`staff.luckyDraw.tab.${tab}`)}
        subtitle={`${room.name} · ${t('staff.luckyDraw.inPoolShort', { count: pool.length })}`}
        backTo="/staff/games"
        actions={
          tab === 'draw' ? (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-[34px] items-center gap-1.5 rounded-[10px] bg-surface-sunken pl-2 pr-1.5">
                <span className="h-[11px] w-[11px] flex-none rounded-full" style={{ background: theme.swatch }} />
                <select
                  value={room.stage_theme}
                  onChange={(e) => patchRoom({ stage_theme: e.target.value })}
                  className="max-w-[112px] appearance-none bg-transparent py-0 pl-0 pr-1 text-xs font-semibold text-ink focus:outline-none"
                >
                  {THEME_LIST.map((x) => (
                    <option key={x.key} value={x.key}>
                      {t(`staff.luckyDraw.theme.${x.key}`)}
                    </option>
                  ))}
                </select>
              </span>
              <a
                href={`/staff/lucky-draw/stage?room=${room.id}`}
                target="_blank"
                rel="noreferrer"
                title={t('staff.luckyDraw.openStage')}
                className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-surface-sunken text-ink-muted"
              >
                <Icon name="expand" size={16} />
              </a>
            </div>
          ) : null
        }
      />

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-2.5 p-3 pb-24">{body}</div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-md">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => {
                setTab(x.key)
                setEditPrize(null)
                setEditPerson(null)
                setEditRoom(null)
              }}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[9.5px] font-semibold ${
                tab === x.key ? 'text-brand' : 'text-ink-faint'
              }`}
            >
              <Icon name={x.icon} size={18} filled={tab === x.key} />
              {t(`staff.luckyDraw.tab.${x.key}`)}
              {x.key === 'history' && results.length > 0 && (
                <span className="absolute right-[calc(50%-19px)] top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-pill bg-accent px-1 text-[8.5px] text-white">
                  {results.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
