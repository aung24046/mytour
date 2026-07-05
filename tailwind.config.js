/** @type {import('tailwindcss').Config} */

// Design tokens — รวมค่าสี/spacing/radius ที่ใช้กระจายอยู่ทั่วแอปให้มาอยู่จุดเดียว
// (ตามที่ระบุใน MyTour_Project_Plan_v2.2.md Section 5)
// หลักการ: ตั้งชื่อ token ตาม "หน้าที่การใช้งาน" (brand, surface, danger, ...)
// ไม่ใช่ตามชื่อสี Tailwind ดิบๆ เพื่อให้ปรับธีมทีเดียวได้จากจุดเดียวในอนาคต
// ค่าปัจจุบันตั้งให้ตรงกับที่ใช้อยู่แล้วทั้งแอป (sky-600 เป็นสีหลัก, gray เป็นสีกลาง ฯลฯ)
// เพื่อไม่ให้เกิดการเปลี่ยนแปลงหน้าตาโดยไม่ตั้งใจตอน refactor
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0284c7', // sky-600
          hover: '#0369a1', // sky-700
          light: '#e0f2fe', // sky-100
          lighter: '#f0f9ff', // sky-50
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f9fafb', // gray-50
        },
        ink: {
          DEFAULT: '#111827', // gray-900
          muted: '#6b7280', // gray-500
          faint: '#9ca3af', // gray-400
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
          bg: '#f3f4f6', // gray-100
          text: '#374151', // gray-700
        },
      },
      borderRadius: {
        card: '1rem', // rounded-2xl
        control: '0.75rem', // rounded-xl
        pill: '9999px',
      },
      spacing: {
        18: '4.5rem',
      },
    },
  },
  plugins: [],
}
