import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Course, JobAssignment, DirectReport } from './lib/totara'
import type { GapProfile, Message } from './lib/diagnostic'

export interface CurrentUser {
  id: string
  fullname: string
  email: string
  profileImageUrl?: string
}

export interface DiagnosticSubject {
  userId: string
  userName: string
  isManagerMode: boolean
}

interface AppState {
  currentUser: CurrentUser | null
  setCurrentUser: (user: CurrentUser | null) => void

  catalogue: Course[]
  setCatalogue: (courses: Course[]) => void

  messages: Message[]
  addMessage: (msg: Message) => void
  clearMessages: () => void

  gapProfile: GapProfile | null
  setGapProfile: (profile: GapProfile) => void

  enrolledCourseIds: string[]
  addEnrolledCourse: (id: string) => void

  jobAssignment: JobAssignment | null
  setJobAssignment: (ja: JobAssignment | null) => void

  directReports: DirectReport[]
  setDirectReports: (reports: DirectReport[]) => void

  selectedRoles: string[]
  setSelectedRoles: (roles: string[]) => void

  diagnosticSubject: DiagnosticSubject | null
  setDiagnosticSubject: (subject: DiagnosticSubject | null) => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),

      catalogue: [],
      setCatalogue: (courses) => set({ catalogue: courses }),

      messages: [],
      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
      clearMessages: () => set({ messages: [] }),

      gapProfile: null,
      setGapProfile: (profile) => set({ gapProfile: profile }),

      enrolledCourseIds: [],
      addEnrolledCourse: (id) =>
        set((s) => ({
          enrolledCourseIds: s.enrolledCourseIds.includes(id)
            ? s.enrolledCourseIds
            : [...s.enrolledCourseIds, id],
        })),

      jobAssignment: null,
      setJobAssignment: (ja) => set({ jobAssignment: ja }),

      directReports: [],
      setDirectReports: (reports) => set({ directReports: reports }),

      selectedRoles: [],
      setSelectedRoles: (roles) => set({ selectedRoles: roles }),

      diagnosticSubject: null,
      setDiagnosticSubject: (subject) => set({ diagnosticSubject: subject }),
    }),
    {
      name: 'compass-store',
      partialize: (s) => ({
        currentUser: s.currentUser,
        gapProfile: s.gapProfile,
        enrolledCourseIds: s.enrolledCourseIds,
        selectedRoles: s.selectedRoles,
      }),
    }
  )
)
