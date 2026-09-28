import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { AdminShell } from './components/layout/AdminShell';
import { Login } from './pages/Login';
import { Today } from './pages/Today';
import { ReviewQueue } from './pages/ReviewQueue';
import { ReviewWorkspace } from './pages/ReviewWorkspace';
import { Triage } from './pages/Triage';
import { Patients } from './pages/Patients';
import { PatientProfile } from './pages/PatientProfile';
import { NewPatient } from './pages/NewPatient';
import { Calendar } from './pages/Calendar';
import { Messages } from './pages/Messages';
import { Leads } from './pages/Leads';
import { Library } from './pages/Library';
import { Evaluation } from './pages/Evaluation';
import { Settings } from './pages/settings/Settings';
import { AdminOverview } from './pages/admin/AdminOverview';
import { AdminTenants } from './pages/admin/AdminTenants';
import { AdminAi } from './pages/admin/AdminAi';
import { AdminSystem } from './pages/admin/AdminSystem';
import { SmileAssessment } from './pages/SmileAssessment';

function Guard({ children, platform }: { children: ReactNode; platform?: boolean }) {
  const { me, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="min-h-screen grid place-items-center text-ink-3">Loading…</div>;
  if (!me) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (platform && me.role !== 'platform_admin') return <Navigate to="/app" replace />;
  if (!platform && me.role === 'platform_admin') return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/s/:slug" element={<SmileAssessment />} />
      <Route path="/app" element={<Guard><AppShell /></Guard>}>
        <Route index element={<Today />} />
        <Route path="review" element={<ReviewQueue />} />
        <Route path="review/:id" element={<ReviewWorkspace />} />
        <Route path="triage" element={<Triage />} />
        <Route path="patients" element={<Patients />} />
        <Route path="patients/new" element={<NewPatient />} />
        <Route path="patients/:id" element={<PatientProfile />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="messages" element={<Messages />} />
        <Route path="messages/:patientId" element={<Messages />} />
        <Route path="leads" element={<Leads />} />
        <Route path="library" element={<Library />} />
        <Route path="evaluation" element={<Evaluation />} />
        <Route path="settings" element={<Settings />} />
        <Route path="settings/:tab" element={<Settings />} />
      </Route>
      <Route path="/admin" element={<Guard platform><AdminShell /></Guard>}>
        <Route index element={<AdminOverview />} />
        <Route path="tenants" element={<AdminTenants />} />
        <Route path="ai" element={<AdminAi />} />
        <Route path="system" element={<AdminSystem />} />
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
