import { Routes, Route, Outlet } from 'react-router-dom'

// Guest pages
import TourEntry from './pages/guest/TourEntry.jsx'
import Register from './pages/guest/Register.jsx'
import Itinerary from './pages/guest/Itinerary.jsx'
import MyQR from './pages/guest/MyQR.jsx'
import MyRoom from './pages/guest/MyRoom.jsx'
import MySeat from './pages/guest/MySeat.jsx'
import BingoCard from './pages/guest/BingoCard.jsx'
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
import SeatMap from './pages/staff/SeatMap.jsx'
import RoomMap from './pages/staff/RoomMap.jsx'
import LocationMonitor from './pages/staff/LocationMonitor.jsx'
import BingoHost from './pages/staff/BingoHost.jsx'
import FormBuilder from './pages/staff/FormBuilder.jsx'
import ItineraryBuilder from './pages/staff/ItineraryBuilder.jsx'
import DietarySummary from './pages/staff/DietarySummary.jsx'
import StaffManager from './pages/staff/StaffManager.jsx'
import GuestManager from './pages/staff/GuestManager.jsx'
import LuggageManager from './pages/staff/LuggageManager.jsx'
import PrintExport from './pages/staff/PrintExport.jsx'
import SOSMonitor from './pages/staff/SOSMonitor.jsx'
import GuideBuilder from './pages/staff/GuideBuilder.jsx'
import FeedbackSummary from './pages/staff/FeedbackSummary.jsx'
import ExpenseTracker from './pages/staff/ExpenseTracker.jsx'
import SupplierManager from './pages/staff/SupplierManager.jsx'
import TourManager from './pages/staff/TourManager.jsx'

import RequireRole from './components/common/RequireRole.jsx'
import LegacyTourRedirect from './components/common/LegacyTourRedirect.jsx'
import HomeButton from './components/common/HomeButton.jsx'
import { TourProvider, useTour, TOUR_STATUS } from './lib/TourContext.jsx'
import { getActiveTourId } from './lib/staffSession.js'

// ---------------------------------------------------------------------
// Layout ฝั่งลูกทัวร์ — resolve /t/:code เป็น tour_id ให้ทุกหน้าลูกใต้มัน
// ---------------------------------------------------------------------
function TourGate() {
  const { status, tour } = useTour()

  if (status === TOUR_STATUS.LOADING) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
      </div>
    )
  }

  if (status === TOUR_STATUS.NOT_FOUND) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold text-slate-800">ไม่พบทริปนี้</p>
        <p className="mt-2 text-sm text-slate-500">
          รหัสทริปอาจพิมพ์ผิด หรือทริปถูกลบไปแล้ว — ตรวจสอบกับทีมงานอีกครั้ง
        </p>
        <a
          href="/join"
          className="mt-6 inline-block rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-medium text-white"
        >
          กรอกรหัสทริปใหม่
        </a>
      </div>
    )
  }

  if (status === TOUR_STATUS.ERROR) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold text-slate-800">เชื่อมต่อไม่ได้</p>
        <p className="mt-2 text-sm text-slate-500">ตรวจสอบสัญญาณอินเทอร์เน็ตแล้วลองใหม่</p>
      </div>
    )
  }

  return (
    <>
      {tour?.status === 'archived' && (
        <div className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">
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

function App() {
  return (
    <>
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
        <Route path="/staff/seat-map" element={staffRoute('seat.edit', <SeatMap />)} />
        <Route path="/staff/room-map" element={staffRoute('room.edit', <RoomMap />)} />
        <Route
          path="/staff/location-monitor"
          element={staffRoute('location.monitor', <LocationMonitor />)}
        />
        <Route path="/staff/bingo-host" element={staffRoute('bingo.host', <BingoHost />)} />
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
        <Route path="/staff/print" element={staffRoute('print.export', <PrintExport />)} />
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
      <HomeButton />
    </>
  )
}

export default App
