import { useState } from 'react'

import { teamStyle } from '../../lib/quizStyle'
import Icon from '../common/Icon'
import Button from '../common/Button'

// ห้องรอแบบทีม — ลูกทัวร์ตั้งทีมกันเอง
//
// ตั้งใจให้ "ใครกดเข้าทีมไหนก็ได้" ไม่มีเชิญ ไม่มีรหัส เพราะคนที่จะจับกลุ่มกัน
// เขานั่งข้างกันอยู่แล้ว คุยกันด้วยปากเร็วกว่าระบบเชิญใดๆ
//
// ผลที่ตามมาคือทีมจะขนาดไม่เท่ากันแน่นอน — คะแนนทีมจึงคิดเป็น "เฉลี่ยต่อคน"
// ไม่ใช่ผลรวม (ดู quiz_team_leaderboard) ไม่งั้นทีมใหญ่ชนะตั้งแต่ยังไม่เริ่มเล่น
//
// ★ ย้ายออกมาจาก guest/Quiz.jsx เมื่อ 10 ก.ย. 2026 ตอนเกมเปิดแผ่นป้ายต้องใช้ด้วย
//   ของแบบนี้ถ้าปล่อยให้มีสองสำเนา วันหลังแก้บั๊กจะแก้ที่เดียวแล้วอีกเกมยังพังอยู่
export default function TeamPicker({ teams, myTeamId, sizeLimit, onCreate, onJoin, busy, t }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-ink">{t('quiz.team.pick')}</p>

      <div className="space-y-2">
        {teams.map((team) => {
          const st = teamStyle(team.color_index)
          const mine = team.id === myTeamId
          const full = sizeLimit > 0 && team.member_count >= sizeLimit && !mine
          return (
            <button
              key={team.id}
              type="button"
              disabled={busy || full}
              onClick={() => onJoin(team.id)}
              className={`flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left transition active:scale-[0.99] disabled:opacity-40 ${
                mine ? 'border-transparent' : 'border-line bg-surface'
              }`}
              style={mine ? { background: st.color, color: 'white' } : undefined}
            >
              <span className="text-xl leading-none">{st.badge}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-extrabold">{team.name}</span>
                <span className={`text-xs ${mine ? 'opacity-80' : 'text-ink-muted'}`}>
                  {t('quiz.team.members', { n: team.member_count })}
                  {full ? ` · ${t('quiz.team.full')}` : ''}
                </span>
              </span>
              {mine && <Icon name="check" size={20} />}
            </button>
          )
        })}
      </div>

      {creating ? (
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            autoFocus
            placeholder={t('quiz.team.namePlaceholder')}
            className="min-w-0 flex-1 rounded-control border border-line bg-surface px-3 py-2.5 text-base font-bold text-ink outline-none focus:border-brand"
          />
          <Button
            fullWidth={false}
            disabled={!name.trim() || busy}
            onClick={() => {
              onCreate(name.trim())
              setName('')
              setCreating(false)
            }}
          >
            {t('quiz.team.create')}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} />
          {t('quiz.team.newTeam')}
        </Button>
      )}
    </div>
  )
}
