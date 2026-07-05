/** @type {import('tailwindcss').Config} */

// Design tokens — รวมค่าสี/spacing/radius ที่ใช้กระจายอยู่ทั่วแอปให้มาอยู่จุดเดียว
// ธีม "Travel สดใส": โทนฟ้า–เขียวมิ้นท์ (ท้องทะเล/ท้องฟ้า) เป็นสีหลัก + ส้มพีชเป็นสีเน้น
// หลักการ: ตั้งชื่อ token ตาม "หน้าที่การใช้งาน" (brand, surface, danger, ...)
// ไม่ใช่ตามชื่อสี Tailwind ดิบๆ เพื่อให้ปรับธีมทีเดียวได้จากจุดเดียว
// หมายเหตุ: remap สเกล `sky` ให้เป็นโทน ocean ด้วย เพราะหลายหน้ายังใช้ sky-500/600/50 ตรงๆ
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0891b2', // cyan-600 — ฟ้าทะเลสดใส
          hover: '#0e7490', // cyan-700
          light: '#cffafe', // cyan-100
          lighter: '#ecfeff', // cyan-50
          deep: '#155e75', // cyan-800 — สำหรับ header เข้ม
        },
        accent: {
          DEFAULT: '#f97362', // ส้มพีช/คอรัล — สีเน้น/ไฮไลต์
          hover: '#ef5a48',
          bg: '#fff1ee',
          text: '#c23b2c',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f6f9fb', // ฟ้าอมเทาอ่อนมาก
          sunken: '#eef4f7',
        },
        ink: {
          DEFAULT: '#0f2b35', // navy อมเขียว แทน gray-900 ให้เข้าธีม
          muted: '#5b7580',
          faint: '#93a7b0',
        },
        success: {
          DEFAULT: '#16a34a', // green-600
          bg: '#dcfce7', // green-100
          text: '#15803d', // green-700
        },
        warning: {
          DEFAULT: '#d97706', // amber-600
          bg: '#fef3c7', // amber-100
          text: '#b45309', // amber-700
        },
        danger: {
          DEFAULT: '#dc2626', // red-600
          bg: '#fee2e2', // red-100/50
          text: '#b91c1c', // red-700
        },
        neutral: {
          bg: '#eef4f7', // ฟ้าเทาอ่อน
          text: '#3d5560',
        },
        // remap สเกล sky ทั้งชุด → โทน ocean (cyan) เพื่อให้โค้ดเก่าที่ hardcode sky-* เข้าธีมอัตโนมัติ
        sky: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Noto Sans Thai"', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', '"Noto Sans Thai"', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #22d3ee 0%, #0891b2 55%, #0e7490 100%)',
        'brand-soft': 'linear-gradient(135deg, #ecfeff 0%, #f6f9fb 100%)',
        'app': 'radial-gradient(1200px 500px at 100% -10%, #cffafe 0%, transparent 55%), radial-gradient(900px 500px at -10% 0%, #e0f7fa 0%, transparent 50%), linear-gradient(180deg, #f6f9fb 0%, #eef4f7 100%)',
      },
      borderRadius: {
        card: '1.25rem', // rounded-2xl+
        control: '0.875rem', // rounded-xl
        pill: '9999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,43,53,0.04), 0 10px 30px -18px rgba(8,145,178,0.28)',
        'card-hover': '0 2px 6px rgba(15,43,53,0.06), 0 18px 40px -20px rgba(8,145,178,0.40)',
        brand: '0 8px 20px -8px rgba(8,145,178,0.55)',
        accent: '0 8px 20px -8px rgba(249,115,98,0.5)',
      },
      spacing: {
        18: '4.5rem',
      },
    },
  },
  plugins: [],
}
