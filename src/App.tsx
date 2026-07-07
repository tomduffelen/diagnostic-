import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useStore } from './store'
import SetupScreen from './pages/SetupScreen'
import LoginScreen from './pages/LoginScreen'
import HomeScreen from './pages/HomeScreen'
import DiagnosticScreen from './pages/DiagnosticScreen'
import ResultsScreen from './pages/ResultsScreen'
import CoursesScreen from './pages/CoursesScreen'
import SkillMapScreen from './pages/SkillMapScreen'
import JourneyScreen from './pages/JourneyScreen'
import DebugScreen from './pages/DebugScreen'

const REQUIRED_VARS = [
  'VITE_TOTARA_URL',
  'VITE_TOTARA_CLIENT_ID',
  'VITE_TOTARA_CLIENT_SECRET',
  'VITE_ANTHROPIC_API_KEY',
]

// React Router doesn't reset scroll position on client-side navigation
// (only full page loads do that by default) -- without this, landing on
// a new page can leave you scrolled to wherever the previous page was.
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  const missing = REQUIRED_VARS.filter((key) => !import.meta.env[key])
  const currentUser = useStore((s) => s.currentUser)

  if (missing.length > 0) {
    return <SetupScreen missing={missing} />
  }

  if (!currentUser) {
    return <LoginScreen />
  }

  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/diagnostic" element={<DiagnosticScreen />} />
        <Route path="/results" element={<ResultsScreen />} />
        <Route path="/courses" element={<CoursesScreen />} />
        <Route path="/skillmap" element={<SkillMapScreen />} />
        <Route path="/journey" element={<JourneyScreen />} />
        <Route path="/debug" element={<DebugScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
