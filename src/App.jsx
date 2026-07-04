import { Routes, Route } from 'react-router-dom'

// Guest pages
import Register from './pages/guest/Register.jsx'
import Itinerary from './pages/guest/Itinerary.jsx'
import MyQR from './pages/guest/MyQR.jsx'
import MyRoom from './pages/guest/MyRoom.jsx'
import BingoCard from './pages/guest/BingoCard.jsx'
import ShareLocation from './pages/guest/ShareLocation.jsx'

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
import StaffAuthGuard from './components/common/StaffAuthGuard.jsx'

function App() {
  return (
    <Routes>
      {/* Guest routes — เข้าผ่านลิงก์/QR เฉพาะทริป */}
      <Route path="/" element={<Register />} />
      <Route path="/itinerary" element={<Itinerary />} />
      <Route path="/my-qr" element={<MyQR />} />
      <Route path="/my-room" element={<MyRoom />} />
      <Route path="/bingo" element={<BingoCard />} />
      <Route path="/share-location" element={<ShareLocation />} />

      {/* Staff routes — เข้าได้เฉพาะหลัง login ด้วย PIN (ยกเว้นหน้า login เอง) */}
      <Route path="/staff/login" element={<Login />} />
      <Route
        path="/staff"
        element={
          <StaffAuthGuard>
            <Dashboard />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/check-in"
        element={
          <StaffAuthGuard>
            <CheckIn />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/broadcast"
        element={
          <StaffAuthGuard>
            <Broadcast />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/seat-map"
        element={
          <StaffAuthGuard>
            <SeatMap />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/room-map"
        element={
          <StaffAuthGuard>
            <RoomMap />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/location-monitor"
        element={
          <StaffAuthGuard>
            <LocationMonitor />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/bingo-host"
        element={
          <StaffAuthGuard>
            <BingoHost />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/form-builder"
        element={
          <StaffAuthGuard>
            <FormBuilder />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/itinerary-builder"
        element={
          <StaffAuthGuard>
            <ItineraryBuilder />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/dietary-summary"
        element={
          <StaffAuthGuard>
            <DietarySummary />
          </StaffAuthGuard>
        }
      />
      <Route
        path="/staff/staff-manager"
        element={
          <StaffAuthGuard>
            <StaffManager />
          </StaffAuthGuard>
        }
      />
    </Routes>
  )
}

export default App
