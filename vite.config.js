import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // ฟอนต์เอกสารต้อง precache ด้วย — หัวหน้าทัวร์อาจสั่งพิมพ์ตอนไม่มีเน็ต
      includeAssets: ['icons/favicon.ico', 'icons/apple-touch-icon.png', 'fonts/*.woff2'],
      manifest: {
        name: 'MyTour',
        short_name: 'MyTour',
        description: 'แอปจัดการทัวร์และดูแลลูกทัวร์หน้างาน',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // ★ กัน chunk ของ cropperjs ออกจาก precache
        //
        //   globPatterns ข้างล่างจับ **/*.js ทั้งหมด ซึ่งรวม chunk ที่ lazy ไว้ด้วย
        //   แปลว่าถ้าไม่มีบรรทัดนี้ service worker จะดาวน์โหลดไลบรารีแต่งรูปให้
        //   ลูกทัวร์ 40 คนบนรถตั้งแต่เปิดแอปครั้งแรก ทั้งที่มีแต่สตาฟใน TilesBuilder
        //   เท่านั้นที่ได้ใช้ — และจะไม่มีอะไรฟ้อง เพราะแอปทำงานปกติทุกอย่าง
        //   แค่ทุกคนโหลดหนักขึ้นเงียบๆ
        //
        //   ต้องมาคู่กับ manualChunks ข้างล่าง (ตั้งชื่อ chunk ให้จับได้)
        //   และ React.lazy ใน TilesBuilder.jsx — ขาดอย่างใดอย่างหนึ่งก็ไม่ได้ผล
        globIgnores: ['**/image-cropper-*.js', '**/image-cropper-*.css'],
        // App shell + static assets precached for offline load.
        // Supabase API calls are NOT cached here — CheckIn/Itinerary/MyRoom
        // already handle their own offline fallback via localStorage (offlineCache.js).
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        navigateFallbackDenylist: [/^\/staff/], // staff routes need fresh data, don't serve stale app-shell fallback for deep links
        // ★ ลบ precache ของเวอร์ชันเก่าทิ้งทุกครั้งที่ service worker ใหม่ทำงาน
        //   ไม่งั้น index.html เก่าค้างอยู่แล้วชี้ไปหา chunk ที่ถูกลบไปแล้วตอน deploy ใหม่
        //   (อาการ: จอขาว "Failed to fetch dynamically imported module" — ดู src/lib/lazyRoute.js)
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // แยก cropperjs ออกเป็น chunk ชื่อคงที่ เพื่อให้ globIgnores ข้างบนจับได้
        // ชื่อต้องขึ้นต้นด้วย image-cropper- เท่านั้น ถ้าเปลี่ยนตรงนี้ต้องไปแก้ที่นั่นด้วย
        manualChunks(id) {
          // รวม "ตัวคอมโพเนนต์" เข้ามาใน chunk เดียวกับไลบรารีด้วย
          // ไม่งั้น rollup ตั้งชื่อ chunk ของคอมโพเนนต์ว่า ImageCropper-*.js (ตัว I ใหญ่)
          // ซึ่ง globIgnores ที่เขียนว่า image-cropper-* จับไม่ได้ เพราะ glob แยกตัวพิมพ์ใหญ่เล็ก
          // ผลคือมี chunk หลุดเข้า precache ทั้งที่ดูเผินๆ เหมือนกันไว้แล้ว (ยืนยันด้วยการ build จริง)
          // ก้อนเดียว = ยามด่านเดียว = ไม่มีช่องให้พลาด
          if (
            id.includes('cropperjs') ||
            id.includes('react-cropper') ||
            id.includes('ImageCropper')
          ) {
            return 'image-cropper'
          }
          return undefined
        },
      },
    },
  },
})
