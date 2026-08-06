/** @type {import('tailwindcss').Config} */

// Design tokens — รวมค่าสี/spacing/radius ที่ใช้กระจายอยู่ทั่วแอปให้มาอยู่จุดเดียว
// หลักการ: ตั้งชื่อ token ตาม "หน้าที่การใช้งาน" (brand, surface, danger, ...)
// ไม่ใช่ตามชื่อสี Tailwind ดิบๆ เพื่อให้ปรับธีมทีเดียวได้จากจุดเดียว
//
// ⚠️ ค่าสีจริงไม่ได้อยู่ในไฟล์นี้ — อยู่ที่ `src/index.css` ในรูปตัวแปร CSS
//    ไฟล์นี้แค่ผูกชื่อ token เข้ากับตัวแปร เพื่อให้เปลี่ยนธีมได้ตอนรันไทม์
//    (บริษัททัวร์แต่ละรายใช้สีของตัวเอง — ดู MyTour_Theming_Design_v1.md)
//
// ⚠️ ตัวแปรต้องเก็บเป็น "เลขสามช่อง" เช่น `8 145 178` ห้ามเป็น #0891b2
//    เพราะโค้ดใช้ opacity modifier อยู่หลายสิบจุด (bg-success-bg/40, bg-brand-light/70)
//    ซึ่งต้องอาศัย <alpha-value> — ถ้าเก็บเป็น hex พวกนี้จะพังแบบเงียบๆ ไม่มี error
const c = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: c('brand'),
          hover: c('brand-hover'),
          light: c('brand-light'),
          lighter: c('brand-lighter'),
          deep: c('brand-deep'), // สำหรับ header เข้ม
        },
        accent: {
          DEFAULT: c('accent'), // สีเน้น/ไฮไลต์
          hover: c('accent-hover'),
          bg: c('accent-bg'),
          text: c('accent-text'),
        },
        surface: {
          DEFAULT: c('surface'),
          muted: c('surface-muted'),
          sunken: c('surface-sunken'),
        },
        ink: {
          DEFAULT: c('ink'),
          muted: c('ink-muted'),
          faint: c('ink-faint'),
        },
        // ── สีเชิงความหมาย — ธีมของบริษัทเปลี่ยนสามตัวนี้ไม่ได้ ──────────
        // เขียว = สำเร็จ, เหลือง = เตือน, แดง = อันตราย ต้องคงที่ทุกบริษัท
        // ยังทำเป็นตัวแปรเพื่อให้ dark mode ปรับได้ แต่ UI ฝั่ง owner ต้องไม่เปิดให้แก้
        success: {
          DEFAULT: c('success'),
          bg: c('success-bg'),
          text: c('success-text'),
        },
        warning: {
          DEFAULT: c('warning'),
          bg: c('warning-bg'),
          text: c('warning-text'),
          ink: c('warning-ink'), // ข้อความบนพื้นเตือนที่ต้องอ่านชัดที่สุด (ประกาศด่วน)
        },
        danger: {
          DEFAULT: c('danger'),
          bg: c('danger-bg'),
          text: c('danger-text'),
        },
        // ตัวหนังสือบนพื้นทึบที่ตัวขาวอ่านไม่ออก (ส้มพีช/เหลืองอำพัน)
        // ใช้คู่กับ bg-accent / bg-warning เสมอ — ห้ามใช้ text-white กับสองตัวนี้
        on: {
          accent: c('on-accent'),
          warning: c('on-warning'),
        },
        neutral: {
          bg: c('neutral-bg'),
          text: c('neutral-text'),
        },
        // เส้นขอบ/เส้นคั่น — เดิมกระจายอยู่ 3 แบบปนกัน (gray-*, black/10, ring-black/[0.04])
        // ทำให้เปลี่ยนธีมทีเดียวไม่ได้ รวมเหลือ 3 ระดับตามน้ำหนักที่ใช้จริง
        line: {
          subtle: c('line-subtle'), // เส้นคั่นในการ์ด
          DEFAULT: c('line'), // ขอบการ์ดทั่วไป
          strong: c('line-strong'), // ขอบช่องกรอก
        },
        // เดิมมี remap สเกล sky ทั้งชุด → โทน ocean เพื่อให้โค้ดที่ hardcode sky-* เข้าธีมอัตโนมัติ
        // ลบทิ้งแล้วเมื่อ ส.ค. 2569 หลังแทน sky-* ด้วย brand-* ครบทุกจุด
        // เหตุผลที่ต้องลบ: มันทำให้โค้ดที่ใช้สีผิดวิธี "ดูเหมือนถูก" — คนเขียนหน้าใหม่
        // จะ copy sky-600 ต่อไปเรื่อยๆ โดยไม่รู้ว่ากำลังข้าม token
        // ห้ามใส่กลับ ถ้าเจอ sky-* ในโค้ดใหม่ให้แก้เป็น brand-* แทน
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Noto Sans Thai"', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', '"Noto Sans Thai"', 'system-ui', 'sans-serif'],
      },
      // ── พื้นผิวแบน ─────────────────────────────────────────────────
      // เดิมสามตัวนี้เป็น gradient จริง (ไล่เฉด 3 สี + radial glow 2 ชั้น)
      // เปลี่ยนเป็นสีทึบเมื่อ ส.ค. 2569 เพราะไล่เฉดหนักๆ ทำให้ดูไม่เรียบร้อย
      //
      // ยังเก็บเป็น backgroundImage ไม่ใช่ backgroundColor เพื่อไม่ต้องไล่แก้
      // คลาส bg-brand-gradient ที่กระจายอยู่ 23 จุด — ถ้าวันหนึ่งอยากได้ไล่เฉดคืน
      // แก้ที่นี่ที่เดียวจบ
      backgroundImage: {
        'brand-gradient': 'linear-gradient(rgb(var(--c-brand)), rgb(var(--c-brand)))',
        'brand-soft': 'linear-gradient(rgb(var(--c-brand-lighter)), rgb(var(--c-brand-lighter)))',
        'app': 'linear-gradient(rgb(var(--c-surface-muted)), rgb(var(--c-surface-muted)))',
      },
      borderRadius: {
        card: '1.25rem', // rounded-2xl+
        control: '0.875rem', // rounded-xl
        pill: '9999px',
      },
      // ── เงา ────────────────────────────────────────────────────────
      // เดิมเป็นเงาฟุ้งกระจาย 20–40px ผสมสีแบรนด์ (เงาฟ้าเรืองๆ ใต้การ์ดและปุ่ม)
      // เปลี่ยนเป็นเส้นคมบางๆ เมื่อ ส.ค. 2569 — ความลึกมาจากเส้นขอบ ไม่ใช่จากเงา
      //
      // ทับสเกลของ Tailwind เองด้วย (sm/md/lg/xl/2xl/inner) ไม่งั้นหน้าที่ยังใช้
      // shadow-sm หรือ shadow-lg ตรงๆ จะยังฟุ้งอยู่ แล้วดูไม่เข้าพวกกับที่เหลือ
      boxShadow: {
        none: 'none',
        // เงาของการ์ด — แทบไม่เห็น ทำหน้าที่แค่แยกการ์ดออกจากพื้นหลัง
        card: '0 1px 2px rgb(var(--c-ink) / 0.06)',
        'card-hover': '0 2px 4px rgb(var(--c-ink) / 0.10)',
        // ปุ่มหลักไม่ต้องมีเงาเรืองแสง — สีทึบกับขนาดบอกความสำคัญได้อยู่แล้ว
        brand: 'none',
        accent: 'none',
        sm: '0 1px 2px rgb(var(--c-ink) / 0.05)',
        DEFAULT: '0 1px 2px rgb(var(--c-ink) / 0.06)',
        md: '0 2px 4px rgb(var(--c-ink) / 0.08)',
        lg: '0 4px 8px rgb(var(--c-ink) / 0.10)',
        xl: '0 6px 12px rgb(var(--c-ink) / 0.12)',
        '2xl': '0 8px 16px rgb(var(--c-ink) / 0.14)',
        inner: 'inset 0 1px 2px rgb(var(--c-ink) / 0.08)',
      },
      spacing: {
        18: '4.5rem',
      },
      keyframes: {
        // แจ้งเตือนผู้ชนะบิงโก — กะพริบเรียกสายตาไม่กี่วินาทีแล้วหยุด
        // ไม่ใช้ animate-pulse ของ Tailwind เพราะวนไม่จบ กวนตาระหว่างที่ staff ยังคุมเกมอยู่
        'flash-once': {
          '0%, 100%': { backgroundColor: 'rgb(255 251 235)' },
          '50%': { backgroundColor: 'rgb(253 230 138)' },
        },
      },
      animation: {
        'flash-once': 'flash-once 0.9s ease-in-out 3',
      },
    },
  },
  plugins: [],
}
