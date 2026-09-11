import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { AppLayout } from "./layout/AppLayout";
import { AdConfigPage } from "./pages/admin/AdConfigPage";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { DepartmentsPage } from "./pages/admin/DepartmentsPage";
import { NotificationSettingsPage } from "./pages/admin/NotificationSettingsPage";
import { RolesPage } from "./pages/admin/RolesPage";
import { SmtpSettingsPage } from "./pages/admin/SmtpSettingsPage";
import { StorageSettingsPage } from "./pages/admin/StorageSettingsPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { WhatsappSettingsPage } from "./pages/admin/WhatsappSettingsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentLibraryPage } from "./pages/DocumentLibraryPage";
import { LoginPage } from "./pages/LoginPage";
import { PhysicalFilesPage } from "./pages/PhysicalFilesPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { QrResolverPage } from "./pages/QrResolverPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SearchPage } from "./pages/SearchPage";
import { TypeTestCertificatesPage } from "./pages/TypeTestCertificatesPage";
import { WorkflowPage } from "./pages/WorkflowPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            <Route path="/documents" element={<DocumentLibraryPage />} />
            <Route path="/physical-files" element={<PhysicalFilesPage />} />
            <Route path="/certificates" element={<TypeTestCertificatesPage />} />
            <Route path="/pf/:token" element={<QrResolverPage />} />
            <Route path="/workflow" element={<WorkflowPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="roles" element={<RolesPage />} />
              <Route path="departments" element={<DepartmentsPage />} />
              <Route path="ad-config" element={<AdConfigPage />} />
              <Route path="smtp" element={<SmtpSettingsPage />} />
              <Route path="storage" element={<StorageSettingsPage />} />
              <Route path="whatsapp" element={<WhatsappSettingsPage />} />
              <Route path="notifications" element={<NotificationSettingsPage />} />
            </Route>
            <Route path="/audit-logs" element={<AuditLogsPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
