import { getTheme, graphemes } from '../../lib/drawStage'

// หน้าประกาศผู้ชนะ
//
// ชื่อเล่นคือชื่อหลัก ตัวใหญ่สุด — เพราะบนรถทัวร์ทุกคนเรียกกันด้วยชื่อเล่น
// ชื่อจริงเป็นบรรทัดรองไว้ยืนยันตัวตนตอนรับของ
//
// ⚠️ line-height ของชื่อต้องไม่ต่ำกว่า 1.6 — สระซ้อนสองชั้นแบบ "ปิ๊ก"
//    ล้นกรอบตัวอักษรขึ้นไปราว .3em ถ้าบีบกว่านี้จะไปชนบรรทัดบน

const NAME_LH = 1.62

function Flaps({ text, size, sub, theme }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: sub ? 3 : 4, justifyContent: 'center', perspective: 600 }}>
      {graphemes(text).map((ch, i) =>
        ch.trim() === '' ? (
          <span key={`sp-${i}`} style={{ display: 'inline-block', minWidth: '.34em' }} />
        ) : (
          <span
            key={`${ch}-${i}`}
            style={{
              display: 'inline-block',
              minWidth: '1.16em',
              textAlign: 'center',
              padding: sub ? '3px 7px' : '4px 13px',
              background: sub ? '#1b1f26' : '#22272f',
              color: sub ? theme.muted : theme.ink,
              borderRadius: 2,
              position: 'relative',
              fontFamily: theme.disp,
              fontSize: size,
              fontWeight: sub ? 500 : 600,
              lineHeight: NAME_LH,
              animation: `mt-flap .34s cubic-bezier(.3,1.15,.5,1) both`,
              animationDelay: `${i * (sub ? 34 : 55)}ms`,
              transformOrigin: '50% 0',
            }}
          >
            {ch}
          </span>
        )
      )}
    </div>
  )
}

export default function DrawWinner({ winners, prizeName, seq, themeKey, mini = false }) {
  const theme = getTheme(themeKey)
  if (!winners?.length) return null

  const many = winners.length > 1
  const w = winners[0]
  const eyebrow = many
    ? `ผู้โชคดี ${winners.length} คน${prizeName ? ` · ${prizeName}` : ''}`
    : `ผู้โชคดีลำดับที่ ${String(seq ?? 1).padStart(2, '0')}`

  if (mini) {
    return (
      <div style={{ textAlign: 'center' }}>
        {many ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(84px,1fr))', gap: 6 }}>
            {winners.map((p, i) => (
              <div
                key={p.id ?? i}
                style={{
                  border: `1px solid ${theme.light ? 'rgba(0,0,0,.14)' : 'rgba(255,255,255,.16)'}`,
                  borderRadius: theme.radius,
                  padding: '8px 6px',
                }}
              >
                <span style={{ display: 'block', fontSize: 8.5, letterSpacing: '.16em', opacity: 0.45 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <b style={{ display: 'block', fontFamily: theme.disp, fontSize: 16, fontWeight: 800, lineHeight: NAME_LH }}>
                  {p.nickname || p.name}
                </b>
                <span style={{ display: 'block', fontSize: 9, opacity: 0.55 }}>{p.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ fontFamily: theme.disp, fontSize: 26, fontWeight: 800, lineHeight: NAME_LH }}>
              {w.nickname || w.name}
            </div>
            <div style={{ fontSize: 11.5, opacity: 0.55 }}>{w.name}</div>
          </>
        )}
        {prizeName && !many && (
          <div style={{ fontSize: 10, color: theme.gold, letterSpacing: '.1em', marginTop: 7 }}>{prizeName}</div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
      <div
        style={{
          fontSize: 'clamp(11px,1.1vw,13px)',
          letterSpacing: '.34em',
          textTransform: 'uppercase',
          opacity: 0.42,
        }}
      >
        {eyebrow}
      </div>

      {many ? (
        <div
          style={{
            marginTop: 'clamp(16px,2.6vw,38px)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(238px,1fr))',
            gap: 13,
            width: '100%',
          }}
        >
          {winners.map((p, i) => (
            <div
              key={p.id ?? i}
              style={{
                padding: '18px 14px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                borderRadius: theme.radius,
                background: theme.light ? 'rgba(255,255,255,.62)' : 'rgba(255,255,255,.09)',
                border: `1px solid ${theme.light ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.17)'}`,
                animation: 'mt-pop .42s cubic-bezier(.2,1.3,.5,1) both',
                animationDelay: `${i * 190}ms`,
              }}
            >
              <span style={{ fontSize: 11, letterSpacing: '.2em', opacity: 0.4, marginBottom: 9 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <b
                style={{
                  fontFamily: theme.disp,
                  fontSize: 'clamp(26px,3.2vw,44px)',
                  fontWeight: 800,
                  lineHeight: NAME_LH,
                  letterSpacing: '-.03em',
                }}
              >
                {p.nickname || p.name}
              </b>
              <span style={{ fontSize: 'clamp(12.5px,1.3vw,16px)', opacity: 0.55, marginTop: 7 }}>{p.name}</span>
            </div>
          ))}
        </div>
      ) : theme.flap ? (
        <div style={{ marginTop: 'clamp(16px,2.6vw,38px)' }}>
          <Flaps text={w.nickname || w.name} size="clamp(40px,8.6vw,96px)" theme={theme} />
          <div style={{ marginTop: 9 }}>
            <Flaps text={w.name} size="clamp(18px,3vw,36px)" sub theme={theme} />
          </div>
        </div>
      ) : (
        <div style={{ animation: 'mt-pop .5s cubic-bezier(.2,1.35,.5,1)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'clamp(20px,3.4vw,52px)',
              width: '100%',
              marginTop: 'clamp(16px,2.6vw,38px)',
            }}
          >
            <span style={{ flex: 1, height: 1, background: 'currentColor', opacity: 0.18 }} />
            <span
              style={{
                fontFamily: theme.disp,
                fontSize: 'clamp(58px,11.5vw,152px)',
                fontWeight: 800,
                letterSpacing: '-.045em',
                lineHeight: NAME_LH,
                whiteSpace: 'nowrap',
              }}
            >
              {w.nickname || w.name}
            </span>
            <span style={{ flex: 1, height: 1, background: 'currentColor', opacity: 0.18 }} />
          </div>
          <div
            style={{
              fontSize: 'clamp(20px,2.5vw,36px)',
              fontWeight: 500,
              opacity: 0.55,
              marginTop: 'clamp(4px,.6vw,10px)',
              lineHeight: 1.6,
            }}
          >
            {w.name}
          </div>
        </div>
      )}
    </div>
  )
}
