// โหมดสว่าง/มืด — ตั้งค่าต่อเครื่อง ไม่ใช่ต่อบริษัท
//
// ต่างจากธีมสีตรงที่ธีมคือ "แบรนด์ของบริษัท" (owner คุม)
// ส่วนโหมดมืดคือ "ความชอบของคนใช้" จึงเก็บใน localStorage ของเครื่องนั้น
// ลูกทัวร์คนหนึ่งเปิดโหมดมืดไม่ควรทำให้คนทั้งทริปเห็นจอมืดตาม
//
// ค่าเริ่มต้น = ตามการตั้งค่าของเครื่อง (prefers-color-scheme)
// เพราะคนส่วนใหญ่ตั้งค่านั้นไว้แล้วและคาดหวังให้แอปทำตาม

import { createContext, useContext, useEffect, useState } from 'react'

// ⚠️ ค่านี้และตรรกะ resolveMode() ถูกเขียนซ้ำในสคริปต์เล็กๆ ที่ index.html
//    ซึ่งจำเป็นต้องรันก่อน React เพื่อกันจอขาวแวบตอนเปิดแอปในโหมดมืด
//    ถ้าแก้ตรงนี้ ต้องไปแก้ที่ index.html ด้วย
const STORAGE_KEY = 'mytour_color_mode'

// แชร์โหมดให้ทั้งแอปเห็นค่าเดียวกัน — ถ้าแต่ละหน้าเรียก useColorMode() เอง
// จะได้ state คนละก้อน กดสวิตช์แล้วธีมบริษัทจะไม่รู้ว่าต้องคำนวณเฉดใหม่
export const ColorModeContext = createContext(null)

/** อ่านโหมดที่ใช้อยู่ — ปลอดภัยแม้เรียกนอก Provider (คืน 'light') */
export function useMode() {
  return useContext(ColorModeContext)?.mode ?? 'light'
}

/** 'light' | 'dark' | 'system' */
export function getStoredPreference() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

/** โหมดที่ใช้จริงตอนนี้ — แปลง 'system' เป็นค่าจริงแล้ว */
export function resolveMode(preference = getStoredPreference()) {
  if (preference === 'light' || preference === 'dark') return preference
  return systemPrefersDark() ? 'dark' : 'light'
}

/** เขียน data-mode ลง <html> — CSS ใน index.css อ่านค่านี้ */
export function applyMode(mode) {
  const root = document.documentElement
  if (mode === 'dark') root.setAttribute('data-mode', 'dark')
  else root.removeAttribute('data-mode')
  // ให้ช่องกรอกและแถบเลื่อนของเบราว์เซอร์เปลี่ยนตามด้วย
  root.style.colorScheme = mode === 'dark' ? 'dark' : 'light'
}

export function storePreference(preference) {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // localStorage ถูกบล็อก — ยังใช้งานได้ในรอบนี้ แค่ไม่จำข้ามครั้ง
  }
}

/**
 * ตัวจัดการโหมดสีสำหรับทั้งแอป
 * คืน { mode, preference, setPreference } — mode คือค่าที่ใช้จริง ('light'|'dark')
 */
export function useColorMode() {
  const [preference, setPref] = useState(getStoredPreference)
  const [mode, setMode] = useState(() => resolveMode(getStoredPreference()))

  useEffect(() => {
    const next = resolveMode(preference)
    setMode(next)
    applyMode(next)
  }, [preference])

  // ผู้ใช้เลือก 'ตามระบบ' แล้วสลับโหมดของเครื่องระหว่างใช้งาน — ต้องเปลี่ยนตามทันที
  useEffect(() => {
    if (preference !== 'system' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const next = resolveMode('system')
      setMode(next)
      applyMode(next)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [preference])

  function setPreference(next) {
    setPref(next)
    storePreference(next)
  }

  return { mode, preference, setPreference }
}
