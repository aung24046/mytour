import { Suspense } from 'react'
import { Routes, Route, Outlet, Navigate, useLocation } from 'react-router-dom'

// Guest pages
import TourEntry from './pages/guest/TourEntry.jsx'
import Register from './pages/guest/Register.jsx'
import Itinerary from './pages/guest/Itinerary.jsx'
import MyQR from './pages/guest/MyQR.jsx'
import MyRoom from './pages/guest/MyRoom.jsx'
import MySeat from './pages/guest/MySeat.jsx'
import BingoCard from './pages/guest/BingoCard.jsx'
import GuestGames from './pages/guest/Games.jsx'
import GuestLuckyDraw from './pages/guest/LuckyDraw.jsx'
import GuestQuiz from './pages/guest/Quiz.jsx'
import GuestPuzzle from './pages/guest/Puzzle.jsx'
import GuestTiles from './pages/guest/Tiles.jsx'
import GuestWords from './pages/guest/Words.jsx'
import ShareLocation from './pages/guest/ShareLocation.jsx'
import BagLookup from './pages/guest/BagLookup.jsx'
import SOS from './pages/guest/SOS.jsx'
import TripGuide from './pages/guest/TripGuide.jsx'
import Feedback from './pages/guest/Feedback.jsx'
import EditProfile from './pages/guest/EditProfile.jsx'

// Staff pages
import Login from './pages/staff/Login.jsx'
import Dashboard from './pages/staff/Dashboard.jsx'
import CheckIn from './pages/staff/CheckIn.jsx'
import Broadcast from './pages/staff/Broadcast.jsx'
import BroadcastShortcuts from './pages/staff/BroadcastShortcuts.jsx'
import SeatMap from './pages/staff/SeatMap.jsx'
import RoomMap from './pages/staff/RoomMap.jsx'
import LocationMonitor from './pages/staff/LocationMonitor.jsx'
import BingoHost from './pages/staff/BingoHost.jsx'
import Games from './pages/staff/Games.jsx'
import FormBuilder from './pages/staff/FormBuilder.jsx'
import ItineraryBuilder from './pages/staff/ItineraryBuilder.jsx'
import DietarySummary from './pages/staff/DietarySummary.jsx'
import StaffManager from './pages/staff/StaffManager.jsx'
import GuestManager from './pages/staff/GuestManager.jsx'
import LuggageManager from './pages/staff/LuggageManager.jsx'
import Labels from './pages/staff/docs/Labels.jsx'
import SOSMonitor from './pages/staff/SOSMonitor.jsx'
import GuideBuilder from './pages/staff/GuideBuilder.jsx'
import FeedbackSummary from './pages/staff/FeedbackSummary.jsx'
import ExpenseTracker from './pages/staff/ExpenseTracker.jsx'
import SupplierManager from './pages/staff/SupplierManager.jsx'
import TourManager from './pages/staff/TourManager.jsx'
import CompanyProfile from './pages/staff/CompanyProfile.jsx'
import DocumentHub from './pages/staff/DocumentHub.jsx'
import RoomingList from './pages/staff/docs/RoomingList.jsx'
import GuestManifest from './pages/staff/docs/GuestManifest.jsx'
import SeatManifest from './pages/staff/docs/SeatManifest.jsx'
import DietarySheet from './pages/staff/docs/DietarySheet.jsx'
import ItineraryBooklet from './pages/staff/docs/ItineraryBooklet.jsx'
import EmergencyCard from './pages/staff/docs/EmergencyCard.jsx'
import ExpenseReport from './pages/staff/docs/ExpenseReport.jsx'
import FeedbackReport from './pages/staff/docs/FeedbackReport.jsx'
import FeedbackFormPrint from './pages/staff/docs/FeedbackFormPrint.jsx'
import { lazyRoute } from './lib/lazyRoute'
import RouteBoundary from './components/common/RouteBoundary.jsx'
import JoinPoster from './pages/staff/docs/JoinPoster.jsx'
import SignatureSheet from './pages/staff/docs/SignatureSheet.jsx'
import NameTag from './pages/staff/docs/NameTag.jsx'


// ── หน้าเกมฝั่งทีมงาน โหลดตอนเปิดใช้ (React.lazy) ─────────────────────
// ★ 11 ก.ย. 2026: ไฟล์ index-*.js ก้อนหลักโตจน build ล้ม — vite-plugin-pwa ไม่ยอม precache
//   ไฟล์ที่ใหญ่เกิน 2 MiB แล้วโยน error (ก่อนเพิ่มเกม What Words เหลือที่ว่างแค่ ~6 KB)
//   หน้าเหล่านี้มีแต่สตาฟที่เปิด ลูกทัวร์ 40 คนบนรถไม่ควรต้องโหลดมาตั้งแต่หน้าแรก
// ⚠️ chunk ที่แยกออกไปยังถูก precache ตาม globPatterns (**/*.js) — ออฟไลน์ใช้ได้เหมือนเดิม
//    ส่วนไลบรารีแต่งรูปยังแยกเป็น image-cropper-* และถูกกันออกจาก precache ตามเดิม
//    (TilesBuilder เป็น lazy chunk แล้ว แต่ ImageCropper ข้างในยังถูก manualChunks ดูดไปก้อนนั้น)
// เกมใหม่ที่เพิ่มวันหลัง ให้ประกาศแบบนี้ ไม่ใช่ import ตรงๆ
const LuckyDraw = lazyRoute(() => import('./pages/staff/LuckyDraw.jsx'))
const LuckyDrawStage = lazyRoute(() => import('./pages/staff/LuckyDrawStage.jsx'))
const QuizManager = lazyRoute(() => import('./pages/staff/QuizManager.jsx'))
const QuizBuilder = lazyRoute(() => import('./pages/staff/QuizBuilder.jsx'))
const QuizHost = lazyRoute(() => import('./pages/staff/QuizHost.jsx'))
const QuizStage = lazyRoute(() => import('./pages/staff/QuizStage.jsx'))
const QuizReport = lazyRoute(() => import('./pages/staff/QuizReport.jsx'))
const PuzzleManager = lazyRoute(() => import('./pages/staff/PuzzleManager.jsx'))
const PuzzleBuilder = lazyRoute(() => import('./pages/staff/PuzzleBuilder.jsx'))
const PuzzleHost = lazyRoute(() => import('./pages/staff/PuzzleHost.jsx'))
const PuzzleStage = lazyRoute(() => import('./pages/staff/PuzzleStage.jsx'))
const TilesManager = lazyRoute(() => import('./pages/staff/TilesManager.jsx'))
const TilesBuilder = lazyRoute(() => import('./pages/staff/TilesBuilder.jsx'))
const TilesHost = lazyRoute(() => import('./pages/staff/TilesHost.jsx'))
const TilesStage = lazyRoute(() => import('./pages/staff/TilesStage.jsx'))
const WordsManager = lazyRoute(() => import('./pages/staff/WordsManager.jsx'))
const WordsBuilder = lazyRoute(() => import('./pages/staff/WordsBuilder.jsx'))
const WordsHost = lazyRoute(() => import('./pages/staff/WordsHost.jsx'))
const WordsStage = lazyRoute(() => import('./pages/staff/WordsStage.jsx'))

import RequireRole from './components/common/RequireRole.jsx'
import LegacyTourRedirect from './components/common/LegacyTourRedirect.jsx'
import HomeButton from './components/common/HomeButton.jsx'
import { resolveHomeButton, HOME_BUTTON_SPACE } from './lib/homeButton.js'
import { TourProvider, useTour, TOUR_STATUS } from './lib/TourContext.jsx'
import { getActiveTourId, useActiveOrgId } from './lib/staffSession.js'
import { useOrgTheme } from './lib/useOrgTheme.js'
import { ColorModeContext, useColorMode } from './lib/colorMode.js'

// ---------------------------------------------------------------------
// Layout ฝั่งลูกทัวร์ — resolve /t/:code เป็น tour_id ให้ทุกหน้าลูกใต้มัน
// ---------------------------------------------------------------------
function TourGate() {
  const { status, tour, orgId } = useTour()

  // ธีมของบริษัทเจ้าของทริป — orgId ยังเป็น null ระหว่างโหลด hook จัดการเอง
  useOrgTheme(orgId)

  if (status === TOUR_STATUS.LOADING) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-neutral-text" />
      </div>
    )
  }

  if (status === TOUR_STATUS.NOT_FOUND) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold text-ink">ไม่พบทริปนี้</p>
        <p className="mt-2 text-sm text-ink-muted">
          รหัสทริปอาจพิมพ์ผิด หรือทริปถูกลบไปแล้ว — ตรวจสอบกับทีมงานอีกครั้ง
        </p>
        <a
          href="/join"
          className="mt-6 inline-block rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white"
        >
          กรอกรหัสทริปใหม่
        </a>
      </div>
    )
  }

  if (status === TOUR_STATUS.ERROR) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold text-ink">เชื่อมต่อไม่ได้</p>
        <p className="mt-2 text-sm text-ink-muted">ตรวจสอบสัญญาณอินเทอร์เน็ตแล้วลองใหม่</p>
      </div>
    )
  }

  return (
    <>
      {tour?.status === 'archived' && (
        <div className="bg-warning-bg px-4 py-2 text-center text-sm text-warning-text">
          ทริปนี้จบแล้ว — ดูข้อมูลย้อนหลังได้ แต่แก้ไขไม่ได้
        </div>
      )}
      <Outlet />
    </>
  )
}

function GuestTourLayout() {
  return (
    <TourProvider>
      <TourGate />
    </TourProvider>
  )
}

// ---------------------------------------------------------------------
// Layout ฝั่งทีมงาน — tour_id มาจาก staffSession ไม่ใช่ URL
// ---------------------------------------------------------------------
function StaffTourLayout({ children }) {
  // ฝั่ง staff รู้ org จาก session ตั้งแต่ตอน login — ไม่ต้องรอ resolve ทริป
  // ตั้งใจให้ staff เห็นสีเดียวกับลูกทัวร์ จะได้คุยกันรู้เรื่องเวลามีปัญหาหน้างาน
  useOrgTheme(useActiveOrgId())
  return <TourProvider tourId={getActiveTourId()}>{children}</TourProvider>
}

/** ย่อ boilerplate ของ staff route */
function staffRoute(capability, element) {
  return (
    <RequireRole capability={capability}>
      <StaffTourLayout>{element}</StaffTourLayout>
    </RequireRole>
  )
}

/** ระหว่างโหลด chunk ของหน้าที่ lazy — วงหมุนเฉยๆ ไม่มีข้อความ (ยังไม่รู้ภาษา/ธีมของหน้า) */
function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="loading">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-line border-t-brand" />
    </div>
  )
}

function App() {
  // โหมดสว่าง/มืดต้องอยู่ระดับบนสุด เพราะทั้งธีมบริษัทและ UI ต้องเห็นค่าเดียวกัน
  const colorMode = useColorMode()

  // ปุ่มลอย "หน้าหลัก" เป็น position:fixed จึงไม่กินที่ในสายตา layout
  // ถ้าไม่จองที่ให้ตรงนี้ มันจะไปทับเนื้อหาแถวสุดท้ายของทุกหน้าที่ไม่ได้เผื่อ padding เอง
  // จองที่เดียวจบ ครอบหน้าที่ยังไม่ได้เขียนด้วย
  const { visible: homeButtonVisible } = resolveHomeButton(useLocation().pathname)

  return (
    <ColorModeContext.Provider value={colorMode}>
      <div style={homeButtonVisible ? { paddingBottom: HOME_BUTTON_SPACE } : undefined}>
      <RouteBoundary>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* ── หน้าแรก / เลือกทริป ───────────────────────────────── */}
        <Route path="/" element={<TourEntry />} />
        <Route path="/join" element={<TourEntry />} />

        {/* ── Guest: ทุกหน้าอยู่ใต้ /t/:code ─────────────────────── */}
        <Route path="/t/:code" element={<GuestTourLayout />}>
          <Route index element={<Register />} />
          <Route path="itinerary" element={<Itinerary />} />
          <Route path="my-qr" element={<MyQR />} />
          <Route path="my-room" element={<MyRoom />} />
          <Route path="my-seat" element={<MySeat />} />
          <Route path="games" element={<GuestGames />} />
          <Route path="lucky-draw" element={<GuestLuckyDraw />} />
          <Route path="quiz" element={<GuestQuiz />} />
          <Route path="puzzle" element={<GuestPuzzle />} />
          <Route path="tiles" element={<GuestTiles />} />
          <Route path="words" element={<GuestWords key="words" game="words" />} />
          {/* Word Shuffle ใช้หน้าเดียวกับ What Words — key แยกกัน ไม่งั้นสลับเกมแล้ว state ห้องเดิมค้าง */}
          <Route path="shuffle" element={<GuestWords key="shuffle" game="shuffle" />} />
          <Route path="bingo" element={<BingoCard />} />
          <Route path="share-location" element={<ShareLocation />} />
          <Route path="sos" element={<SOS />} />
          <Route path="trip-guide" element={<TripGuide />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="edit-profile" element={<EditProfile />} />
        </Route>

        {/* ── Legacy: QR/ลิงก์ที่แจกไปแล้วยังใช้ได้ ────────────────
            ห้ามลบจนกว่าจะแน่ใจว่าไม่มี QR เก่าหมุนเวียนอยู่ */}
        <Route path="/itinerary" element={<LegacyTourRedirect to="itinerary" />} />
        <Route path="/my-qr" element={<LegacyTourRedirect to="my-qr" />} />
        <Route path="/my-room" element={<LegacyTourRedirect to="my-room" />} />
        <Route path="/my-seat" element={<LegacyTourRedirect to="my-seat" />} />
        <Route path="/bingo" element={<LegacyTourRedirect to="bingo" />} />
        <Route path="/share-location" element={<LegacyTourRedirect to="share-location" />} />
        <Route path="/sos" element={<LegacyTourRedirect to="sos" />} />
        <Route path="/trip-guide" element={<LegacyTourRedirect to="trip-guide" />} />
        <Route path="/feedback" element={<LegacyTourRedirect to="feedback" />} />
        <Route path="/edit-profile" element={<LegacyTourRedirect to="edit-profile" />} />

        {/* ป้ายกระเป๋าหา tour_id เองจาก tag_code — ไม่ต้องมี :code */}
        <Route path="/bag/:tagCode" element={<BagLookup />} />

        {/* ── Staff ─────────────────────────────────────────────── */}
        <Route path="/staff/login" element={<Login />} />

        <Route path="/staff" element={staffRoute('dashboard.view', <Dashboard />)} />
        <Route path="/staff/admin" element={staffRoute('tour.create', <TourManager />)} />
        <Route path="/staff/check-in" element={staffRoute('checkin.use', <CheckIn />)} />
        <Route path="/staff/broadcast" element={staffRoute('broadcast.send', <Broadcast />)} />
        <Route
          path="/staff/broadcast/shortcuts"
          element={staffRoute('broadcast.send', <BroadcastShortcuts />)}
        />
        <Route path="/staff/seat-map" element={staffRoute('seat.edit', <SeatMap />)} />
        <Route path="/staff/room-map" element={staffRoute('room.edit', <RoomMap />)} />
        <Route
          path="/staff/location-monitor"
          element={staffRoute('location.monitor', <LocationMonitor />)}
        />
        {/* หน้ารวมเกม — บิงโกยังเข้าลิงก์ตรงได้เหมือนเดิม ของเก่าที่บุ๊กมาร์กไว้ไม่พัง */}
        <Route path="/staff/games" element={staffRoute('bingo.host', <Games />)} />
        <Route path="/staff/bingo-host" element={staffRoute('bingo.host', <BingoHost />)} />
        <Route path="/staff/lucky-draw" element={staffRoute('bingo.host', <LuckyDraw />)} />
        {/* จอโปรเจกเตอร์ — เปิดแท็บแยก ไม่มีปุ่มสั่งงาน สั่งจากมือถือทีมงานอย่างเดียว */}
        {/* จอเวทีสองหน้านี้ตั้งใจไม่มี RequireRole — เปิดบนโน้ตบุ๊กโรงแรมหรือจอในรถ
            ซึ่งไม่มีใครล็อกอินไว้ ถ้า guard ไว้จะโดน redirect ไป /staff/login
            แล้ว hash ที่พา token มา (stageUrl()) หายไปพร้อมกัน = ต้องกลับไปก็อปลิงก์ใหม่
            ทั้งสองหน้าไม่มีปุ่มสั่งงานแม้แต่ปุ่มเดียว และ RPC ที่แตะข้อมูลปิด
            ยังตรวจ token อยู่เหมือนเดิม */}
        <Route
          path="/staff/lucky-draw/stage"
          element={
            <StaffTourLayout>
              <LuckyDrawStage />
            </StaffTourLayout>
          }
        />
        <Route path="/staff/quiz" element={staffRoute('quiz.host', <QuizManager />)} />
        <Route path="/staff/quiz/builder/:setId" element={staffRoute('quiz.edit', <QuizBuilder />)} />
        <Route path="/staff/quiz/host/:sessionId" element={staffRoute('quiz.host', <QuizHost />)} />
        {/* จอใหญ่ — เปิดแท็บแยก รับ token ผ่าน #t= ไม่มีปุ่มสั่งงาน */}
        <Route
          path="/staff/quiz/stage/:sessionId"
          element={
            <StaffTourLayout>
              <QuizStage />
            </StaffTourLayout>
          }
        />
        <Route path="/staff/quiz/report/:sessionId" element={staffRoute('quiz.host', <QuizReport />)} />

        {/* ── ปริศนาใบ้คำ ─────────────────────────────────────
            เกมคนละใบกับควิซในสายตาผู้ใช้ แต่ใช้ตาราง/RPC ชุดเดียวกัน
            แยกกันด้วย quiz_sets.game_kind = 'puzzle' (ดู MyTour_WordPuzzle_Design_v1.md) */}
        <Route path="/staff/puzzle" element={staffRoute('puzzle.host', <PuzzleManager />)} />
        <Route
          path="/staff/puzzle/builder/:setId"
          element={staffRoute('puzzle.edit', <PuzzleBuilder />)}
        />
        <Route
          path="/staff/puzzle/host/:sessionId"
          element={staffRoute('puzzle.host', <PuzzleHost />)}
        />
        {/* จอใหญ่ — เปิดแท็บแยกบนโน้ตบุ๊กโรงแรม/จอในรถที่ไม่มีใครล็อกอิน
            เหตุผลเดียวกับ QuizStage: ถ้า guard ไว้จะโดน redirect แล้ว hash ที่พา token มาหายไปด้วย */}
        <Route
          path="/staff/puzzle/stage/:sessionId"
          element={
            <StaffTourLayout>
              <PuzzleStage />
            </StaffTourLayout>
          }
        />

        {/* ── เปิดแผ่นป้าย ────────────────────────────────────
            เกมที่สามบนเครื่องยนต์เดียวกัน แยกด้วย quiz_sets.game_kind = 'tiles'
            (ดู MyTour_TileReveal_Design_v1.md) */}
        <Route path="/staff/tiles" element={staffRoute('tiles.host', <TilesManager />)} />
        <Route
          path="/staff/tiles/builder/:setId"
          element={staffRoute('tiles.edit', <TilesBuilder />)}
        />
        <Route
          path="/staff/tiles/host/:sessionId"
          element={staffRoute('tiles.host', <TilesHost />)}
        />
        {/* จอใหญ่ไม่ guard ด้วยเหตุผลเดียวกับอีกสองเกม: redirect จะทำให้ hash ที่พา token มาหายไป */}
        <Route
          path="/staff/tiles/stage/:sessionId"
          element={
            <StaffTourLayout>
              <TilesStage />
            </StaffTourLayout>
          }
        />

        {/* ── What Words ──────────────────────────────────────
            เกมที่สี่บนเครื่องยนต์เดียวกัน แยกด้วย quiz_sets.game_kind = 'words'
            (ดู supabase/migrations/20260911b_what_words.sql) */}
        <Route path="/staff/words" element={staffRoute('words.host', <WordsManager key="words" game="words" />)} />
        <Route
          path="/staff/words/builder/:setId"
          element={staffRoute('words.edit', <WordsBuilder key="words" game="words" />)}
        />
        <Route
          path="/staff/words/host/:sessionId"
          element={staffRoute('words.host', <WordsHost key="words" game="words" />)}
        />
        {/* จอใหญ่ไม่ guard ด้วยเหตุผลเดียวกับอีกสามเกม: redirect จะทำให้ hash ที่พา token มาหายไป */}
        <Route
          path="/staff/words/stage/:sessionId"
          element={
            <StaffTourLayout>
              <WordsStage key="words" game="words" />
            </StaffTourLayout>
          }
        />

        {/* ── Word Shuffle ────────────────────────────────────
            เกมที่ห้า — หน้าจอชุดเดียวกับ What Words (ส่ง game="shuffle") แยกด้วย game_kind = 'shuffle'
            ข้อยังเป็นชนิด words (ดู supabase/migrations/20260912_word_shuffle.sql · lib/wordGames.js)
            ★ key ต่างกันทุกหน้า: React Router ใช้ component ตัวเดียวกันข้ามสองเกม
              ถ้าไม่ใส่ key สลับจาก /staff/words ไป /staff/shuffle แล้ว state (ฟอร์มเปิดห้อง ฯลฯ) จะติดมา */}
        <Route path="/staff/shuffle" element={staffRoute('shuffle.host', <WordsManager key="shuffle" game="shuffle" />)} />
        <Route
          path="/staff/shuffle/builder/:setId"
          element={staffRoute('shuffle.edit', <WordsBuilder key="shuffle" game="shuffle" />)}
        />
        <Route
          path="/staff/shuffle/host/:sessionId"
          element={staffRoute('shuffle.host', <WordsHost key="shuffle" game="shuffle" />)}
        />
        <Route
          path="/staff/shuffle/stage/:sessionId"
          element={
            <StaffTourLayout>
              <WordsStage key="shuffle" game="shuffle" />
            </StaffTourLayout>
          }
        />
        <Route path="/staff/form-builder" element={staffRoute('form.assign', <FormBuilder />)} />
        <Route
          path="/staff/itinerary-builder"
          element={staffRoute('itinerary.edit', <ItineraryBuilder />)}
        />
        <Route
          path="/staff/dietary-summary"
          element={staffRoute('guest.view', <DietarySummary />)}
        />
        <Route
          path="/staff/staff-manager"
          element={staffRoute('tourstaff.manage', <StaffManager />)}
        />
        <Route path="/staff/guest-manager" element={staffRoute('guest.view', <GuestManager />)} />
        <Route
          path="/staff/luggage-manager"
          element={staffRoute('luggage.use', <LuggageManager />)}
        />
        {/* ป้ายสติกเกอร์ย้ายไปอยู่ใต้ /staff/documents แล้ว (ส.ค. 2569)
            คงเส้นทางเดิมไว้เป็น redirect เพราะทีมงานอาจบุ๊กมาร์กไว้ */}
        <Route path="/staff/print" element={<Navigate to="/staff/documents/labels" replace />} />
        <Route path="/staff/documents/labels" element={staffRoute('print.export', <Labels />)} />

        {/* เอกสารรูปเล่ม A4/A5 — แยกจาก /staff/print ที่เป็นป้ายสติกเกอร์ */}
        <Route path="/staff/company-profile" element={staffRoute('org.profile', <CompanyProfile />)} />
        <Route path="/staff/documents" element={staffRoute('document.print', <DocumentHub />)} />
        <Route path="/staff/documents/rooming-list" element={staffRoute('document.print', <RoomingList />)} />
        <Route path="/staff/documents/guest-manifest" element={staffRoute('document.print', <GuestManifest />)} />
        <Route path="/staff/documents/seat-manifest" element={staffRoute('document.print', <SeatManifest />)} />
        <Route path="/staff/documents/dietary-sheet" element={staffRoute('document.print', <DietarySheet />)} />
        <Route path="/staff/documents/itinerary-booklet" element={staffRoute('document.print', <ItineraryBooklet />)} />
        <Route path="/staff/documents/emergency-card" element={staffRoute('document.print', <EmergencyCard />)} />
        <Route path="/staff/documents/expense-report" element={staffRoute('expense.edit', <ExpenseReport />)} />
        <Route path="/staff/documents/feedback-report" element={staffRoute('feedback.view', <FeedbackReport />)} />
        <Route path="/staff/documents/feedback-form" element={staffRoute('document.print', <FeedbackFormPrint />)} />
        {/* เอกสารหน้างาน (ส.ค. 2569) */}
        <Route path="/staff/documents/join-poster" element={staffRoute('document.print', <JoinPoster />)} />
        <Route path="/staff/documents/signature-sheet" element={staffRoute('document.print', <SignatureSheet />)} />
        <Route path="/staff/documents/name-tag" element={staffRoute('document.print', <NameTag />)} />
        <Route path="/staff/sos-monitor" element={staffRoute('sos.monitor', <SOSMonitor />)} />
        <Route path="/staff/guide-builder" element={staffRoute('guide.assign', <GuideBuilder />)} />
        <Route
          path="/staff/feedback-summary"
          element={staffRoute('feedback.view', <FeedbackSummary />)}
        />
        <Route
          path="/staff/expense-tracker"
          element={staffRoute('expense.edit', <ExpenseTracker />)}
        />
        <Route
          path="/staff/supplier-manager"
          element={staffRoute('supplier.assign', <SupplierManager />)}
        />
      </Routes>
      </Suspense>
      </RouteBoundary>
      </div>
      <HomeButton />
    </ColorModeContext.Provider>
  )
}

export default App
