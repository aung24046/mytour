import { useEffect, useRef } from 'react'

import { getTheme } from '../../lib/drawStage'

// พื้นเวทีของทั้งจอโปรเจกเตอร์และกล่องถ่ายทอดสดในมือถือลูกทัวร์
//
// ลายเซ็นของแต่ละธีมอยู่ตรงนี้ที่เดียว จอใหญ่กับมือถือจะได้หน้าตาตรงกัน
// สีไม่ผูกกับ token ธีมบริษัท เพราะนี่คือ "เวที" ต้องอ่านออกจากท้ายห้องมืด

function Confetti({ colors, fire }) {
  const ref = useRef(null)
  const parts = useRef([])
  const raf = useRef(null)

  useEffect(() => {
    if (!fire) return undefined
    const cv = ref.current
    if (!cv) return undefined
    const box = cv.getBoundingClientRect()
    cv.width = box.width
    cv.height = box.height
    const cx = cv.getContext('2d')

    for (let i = 0; i < 130; i += 1) {
      parts.current.push({
        x: cv.width / 2 + (Math.random() - 0.5) * 180,
        y: cv.height * 0.5,
        vx: (Math.random() - 0.5) * 15,
        vy: -Math.random() * 16 - 5,
        s: 5 + Math.random() * 7,
        c: colors[i % colors.length],
        r: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.4,
      })
    }

    const loop = () => {
      cx.clearRect(0, 0, cv.width, cv.height)
      parts.current = parts.current.filter((p) => p.y < cv.height + 40)
      parts.current.forEach((p) => {
        p.vy += 0.42
        p.x += p.vx
        p.y += p.vy
        p.r += p.vr
        p.vx *= 0.99
        cx.save()
        cx.translate(p.x, p.y)
        cx.rotate(p.r)
        cx.fillStyle = p.c
        cx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.62)
        cx.restore()
      })
      raf.current = parts.current.length ? requestAnimationFrame(loop) : null
      if (!raf.current) cx.clearRect(0, 0, cv.width, cv.height)
    }
    raf.current = requestAnimationFrame(loop)

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = null
      parts.current = []
    }
  }, [fire, colors])

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-[6]" />
}

/** ลายพื้นหลังเฉพาะธีม — วางเป็นชั้นล่างสุด ไม่รับคลิก */
function ThemeLayer({ theme }) {
  const base = { position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }

  if (theme.key === 'led') {
    return (
      <>
        <span
          style={{
            ...base,
            backgroundImage: 'radial-gradient(rgba(120,160,180,.13) 1.1px, transparent 1.2px)',
            backgroundSize: '11px 11px',
          }}
        />
        <span
          style={{
            ...base,
            zIndex: 1,
            opacity: 0.5,
            background: `repeating-linear-gradient(90deg,${theme.gold} 0 12px,transparent 12px 34px) top/100% 3px no-repeat,
                         repeating-linear-gradient(90deg,${theme.gold} 0 12px,transparent 12px 34px) bottom/100% 3px no-repeat`,
            animation: 'mt-march 1.1s linear infinite',
          }}
        />
      </>
    )
  }
  if (theme.key === 'board') {
    return (
      <>
        <span
          style={{
            ...base,
            backgroundImage: 'repeating-linear-gradient(0deg,rgba(255,255,255,.028) 0 1px,transparent 1px 46px)',
          }}
        />
        <span style={{ ...base, zIndex: 1, borderTop: `2px solid ${theme.accent}` }} />
      </>
    )
  }
  if (theme.key === 'emerald') {
    return (
      <>
        <span style={{ ...base, inset: 15, zIndex: 1, border: ' 1px solid rgba(212,175,55,.5)' }} />
        <span style={{ ...base, inset: 22, zIndex: 1, border: '1px solid rgba(212,175,55,.16)' }} />
      </>
    )
  }
  if (theme.key === 'sky') {
    return (
      <>
        <span
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '118%',
            paddingTop: '78%',
            transform: 'translate(-50%,-50%)',
            borderRadius: '50%',
            zIndex: 0,
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse,rgba(29,127,216,.20) 0%,rgba(29,127,216,.09) 42%,transparent 68%)',
          }}
        />
        <span
          style={{
            ...base,
            opacity: 0.5,
            background: 'repeating-linear-gradient(122deg,rgba(255,255,255,.55) 0 42px,transparent 42px 128px)',
          }}
        />
      </>
    )
  }
  if (theme.key === 'grid') {
    return (
      <>
        <span
          style={{
            ...base,
            backgroundImage:
              'repeating-linear-gradient(0deg,rgba(26,26,24,.07) 0 1px,transparent 1px 26px),repeating-linear-gradient(90deg,rgba(26,26,24,.07) 0 1px,transparent 1px 26px)',
          }}
        />
        <span style={{ ...base, inset: 18, zIndex: 1, border: '1px solid rgba(26,26,24,.22)' }} />
      </>
    )
  }
  // candy
  return (
    <span
      style={{
        ...base,
        background: `radial-gradient(circle 120px at 12% 22%,rgba(224,65,122,.13),transparent 70%),
                     radial-gradient(circle 90px at 86% 16%,rgba(240,160,60,.16),transparent 70%),
                     radial-gradient(circle 150px at 78% 88%,rgba(93,199,175,.16),transparent 70%),
                     radial-gradient(circle 70px at 22% 82%,rgba(224,65,122,.10),transparent 70%)`,
      }}
    />
  )
}

export default function DrawStage({
  themeKey,
  roomName,
  status,
  prizeName,
  prizeLeft,
  footLeft,
  footMid,
  footRight,
  celebrate = false,
  mini = false,
  children,
}) {
  const theme = getTheme(themeKey)

  return (
    <div
      style={{
        position: 'relative',
        background: theme.page,
        color: theme.ink,
        overflow: 'hidden',
        borderRadius: mini ? theme.radius : 0,
        minHeight: mini ? 190 : '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: mini ? '14px 12px' : '140px 30px 126px',
        textAlign: 'center',
        fontFamily: theme.disp,
      }}
    >
      <ThemeLayer theme={theme} />
      <Confetti colors={theme.confetti} fire={celebrate} />

      {/* หัวเวทีลอยไว้บน แถบล่างลอยไว้ล่าง — พื้นที่ตรงกลางจึงว่างจริง
          ชื่อผู้ชนะเลยอยู่กึ่งกลางจอพอดีไม่ว่าจะมีป้ายรางวัลหรือไม่ */}
      <div
        style={{
          position: mini ? 'static' : 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 3,
          padding: mini ? 0 : '26px 22px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginBottom: mini ? 8 : 0,
        }}
      >
        {!mini && roomName && (
          <div style={{ fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', opacity: 0.45 }}>
            {roomName}
          </div>
        )}
        <div
          style={{
            fontSize: mini ? 9 : 11.5,
            fontWeight: 600,
            letterSpacing: mini ? '.15em' : '.18em',
            textTransform: 'uppercase',
            opacity: 0.55,
            marginTop: mini ? 0 : 6,
            marginBottom: mini ? 0 : 14,
          }}
        >
          {status}
        </div>
        {prizeName && !mini && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 9,
              fontSize: 15,
              fontWeight: 700,
              padding: '8px 18px',
              borderRadius: 999,
              background: theme.light || theme.key === 'emerald' || theme.key === 'board' ? 'transparent' : theme.gold,
              border:
                theme.light || theme.key === 'emerald' || theme.key === 'board'
                  ? `1px solid ${theme.gold}`
                  : 'none',
              color: theme.light || theme.key === 'emerald' || theme.key === 'board' ? theme.gold : '#2b1c00',
            }}
          >
            {prizeName}
            {prizeLeft != null && <em style={{ fontStyle: 'normal', fontSize: 12, opacity: 0.7 }}>เหลือ {prizeLeft}</em>}
          </div>
        )}
      </div>

      <div style={{ position: 'relative', zIndex: 3, width: '100%', maxWidth: mini ? '100%' : 1000 }}>
        {children}
      </div>

      {!mini && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 3,
            padding: '13px 22px',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: 10.5,
            letterSpacing: '.05em',
            opacity: 0.45,
          }}
        >
          <span>{footLeft}</span>
          <span>{footMid}</span>
          <span>{footRight}</span>
        </div>
      )}
    </div>
  )
}
