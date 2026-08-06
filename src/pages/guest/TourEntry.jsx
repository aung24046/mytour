import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { supabase } from '../../lib/supabase'
import { listGuestSessions } from '../../lib/guestSession'
import { tourPath } from '../../lib/tourPath'
import LegacyTourRedirect from '../../components/common/LegacyTourRedirect'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'

// หน้าแรกของแอป — เครื่องเดียวอยู่ได้หลายทริป จึงต้องถามก่อนว่าจะเข้าทริปไหน
//
// เครื่องที่เคยลงทะเบียนแค่ทริปเดียว (หรือยังไม่เคยเลย) → เด้งไปทริปเดิมทันที
// เพื่อให้พฤติกรรมเหมือนก่อนมี multi-tour ทุกประการ
export default function TourEntry() {
  const navigate = useNavigate()

  const [sessions] = useState(() => listGuestSessions())
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(true)

  const [codeInput, setCodeInput] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)

  useEffect(() => {
    if (sessions.length < 2) {
      setLoading(false)
      return
    }

    let alive = true
    supabase
      .from('tours')
      .select('id, name, join_code, status, start_date, end_date')
      .in('id', sessions.map((s) => s.tourId))
      .then(({ data, error }) => {
        if (!alive) return
        if (error) console.error('[TourEntry] โหลดรายชื่อทริปไม่สำเร็จ', error)
        setTours(data ?? [])
        setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [sessions])

  async function handleJoin(e) {
    e.preventDefault()
    const code = codeInput.trim().toUpperCase()
    if (!code) return

    setJoining(true)
    setJoinError(null)

    const { data, error } = await supabase
      .from('tours')
      .select('join_code, status')
      .ilike('join_code', code)
      .eq('is_template', false)
      .maybeSingle()

    setJoining(false)

    if (error) {
      console.error('[TourEntry] ค้นหารหัสทริปไม่สำเร็จ', error)
      setJoinError('เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง')
      return
    }
    if (!data) {
      setJoinError('ไม่พบรหัสนี้ ตรวจสอบกับทีมงานอีกครั้ง')
      return
    }

    navigate(tourPath(data.join_code))
  }

  // เคยเข้าทริปเดียว หรือยังไม่เคยเลย → พฤติกรรมเดิม
  if (sessions.length < 2) {
    return <LegacyTourRedirect />
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-neutral-text" />
      </div>
    )
  }

  const sorted = sessions
    .map((s) => ({ ...s, tour: tours.find((t) => t.id === s.tourId) }))
    .filter((s) => s.tour)

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-xl font-semibold text-ink">เลือกทริปของคุณ</h1>
      <p className="mt-1 text-sm text-ink-muted">เครื่องนี้ลงทะเบียนไว้ {sorted.length} ทริป</p>

      <div className="mt-5 space-y-3">
        {sorted.map(({ tourId, tour }) => (
          <button
            key={tourId}
            type="button"
            onClick={() => navigate(tourPath(tour.join_code))}
            className="w-full text-left"
          >
            <Card className="transition active:scale-[0.99]">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{tour.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    รหัส {tour.join_code}
                    {tour.start_date ? ` · ${tour.start_date}` : ''}
                  </p>
                </div>
                {tour.status === 'archived' && (
                  <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-muted">
                    จบแล้ว
                  </span>
                )}
              </div>
            </Card>
          </button>
        ))}
      </div>

      <form onSubmit={handleJoin} className="mt-8">
        <p className="mb-2 text-sm font-medium text-neutral-text">เข้าทริปใหม่ด้วยรหัส</p>
        <div className="flex gap-2">
          <TextField
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="เช่น JPN102"
            autoCapitalize="characters"
            className="flex-1"
          />
          <Button type="submit" fullWidth={false} disabled={joining || !codeInput.trim()}>
            {joining ? 'กำลังค้นหา…' : 'เข้าทริป'}
          </Button>
        </div>
        {joinError && <p className="mt-2 text-sm text-rose-600">{joinError}</p>}
      </form>
    </div>
  )
}
