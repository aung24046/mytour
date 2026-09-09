import { useCallback, useEffect, useMemo, useState } from 'react'

import { supabase } from './supabase'

// ตรรกะ "ทีม" ของฝั่งลูกทัวร์ — ใช้ร่วมกันทุกเกมที่วิ่งบนเครื่องยนต์ควิซ
//
// ★ ย้ายออกมาจาก guest/Quiz.jsx เมื่อ 10 ก.ย. 2026 ตอนเกมเปิดแผ่นป้ายต้องใช้ด้วย
//
// realtime ของ quiz_teams ทำให้ทุกคนเห็นทีมใหม่โผล่ทันทีที่มีคนสร้าง
// ถ้าไม่มี จะมีคนตั้งทีมชื่อซ้ำกันเพราะไม่เห็นของคนอื่น แล้วเจอ error งงๆ
//
// ⚠️ จำนวนสมาชิกไม่ได้มาทาง realtime (quiz_players ตั้งใจไม่ publish — 40 คน
//    กดพร้อมกัน = 40 event ยิงใส่ทุกเครื่อง) จึง poll เบาๆ เฉพาะตอนอยู่ห้องรอ
export function useQuizTeams({ sessionId, teamMode, sessionState, player, setPlayer, onError }) {
  const [teams, setTeams] = useState([])
  const [teamBusy, setTeamBusy] = useState(false)

  const loadTeams = useCallback(async () => {
    if (!sessionId || !teamMode) return
    const { data } = await supabase.rpc('quiz_team_leaderboard', { p_session_id: sessionId })
    setTeams(data ?? [])
  }, [sessionId, teamMode])

  useEffect(() => {
    if (!teamMode || !sessionId) return undefined
    loadTeams()

    const ch = supabase
      .channel(`quiz-teams-${sessionId}-${Math.random().toString(36).slice(2, 7)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'quiz_teams', filter: `session_id=eq.${sessionId}` },
        () => loadTeams()
      )
      .subscribe()

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && sessionState === 'lobby') loadTeams()
    }, 5000)

    return () => {
      supabase.removeChannel(ch)
      clearInterval(timer)
    }
  }, [sessionId, teamMode, sessionState, loadTeams])

  const createTeam = useCallback(
    async (name) => {
      if (!player?.id) return
      setTeamBusy(true)
      onError?.('')
      const { error: err } = await supabase.rpc('quiz_create_team', {
        p_session_id: sessionId,
        p_player_id: player.id,
        p_name: name,
      })
      setTeamBusy(false)
      if (err) {
        onError?.(err.message)
        return
      }
      // อ่านแถวตัวเองใหม่ ไม่เดาค่า team_id เอง — ฝั่ง DB เป็นคนตัดสินว่าเข้าทีมไหน
      const { data: me } = await supabase
        .from('quiz_players')
        .select('*')
        .eq('id', player.id)
        .maybeSingle()
      if (me) setPlayer?.(me)
      loadTeams()
    },
    [sessionId, player?.id, loadTeams, setPlayer, onError]
  )

  const joinTeam = useCallback(
    async (teamId) => {
      if (!player?.id) return
      setTeamBusy(true)
      onError?.('')
      const { data, error: err } = await supabase.rpc('quiz_join_team', {
        p_session_id: sessionId,
        p_player_id: player.id,
        p_team_id: teamId,
      })
      setTeamBusy(false)
      if (err) onError?.(err.message)
      else {
        setPlayer?.(Array.isArray(data) ? data[0] : data)
        loadTeams()
      }
    },
    [sessionId, player?.id, loadTeams, setPlayer, onError]
  )

  // team_id ของ player อาจเก่า (ตั้ง 'pending' ไว้ตอนสร้างทีม) — เชื่อ teams เป็นหลัก
  const myTeam = useMemo(() => {
    if (!player?.id) return null
    return teams.find((tm) => tm.id === player.team_id) ?? null
  }, [teams, player?.team_id, player?.id])

  return { teams, myTeam, teamBusy, createTeam, joinTeam, reloadTeams: loadTeams }
}
