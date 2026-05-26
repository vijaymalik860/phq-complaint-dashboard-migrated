import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoginPage from './pages/auth/Login';
import DashboardPage from './pages/admin/Dashboard';
import DistrictDetail from './pages/admin/DistrictDetail';
import HighlightsPage from './pages/admin/Highlights';
import ReportsPage from './pages/admin/Reports';
import PendingPage from './pages/admin/Pending';
import ComplaintsPage from './pages/admin/Complaints';
import CCTNSPage from './pages/admin/CCTNS';
import ComplaintDetail from './pages/admin/ComplaintDetail';
import ComplaintAdd from './pages/admin/ComplaintAdd';
import DevTools from './pages/admin/DevTools';
import { FilterProvider } from './contexts/FilterContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

/** Redirect to login if no token. */
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

/** Only admin can access System Management — others get redirected to dashboard. */
const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/admin/dashboard" replace />;
  return <>{children}</>;
};

const AppRoutes = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/admin/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="/admin/district/:district" element={<ProtectedRoute><DistrictDetail /></ProtectedRoute>} />
      <Route path="/admin/highlights" element={<ProtectedRoute><HighlightsPage /></ProtectedRoute>} />
      <Route path="/admin/reports" element={<ProtectedRoute><ReportsPage /></ProtectedRoute>} />
      <Route path="/admin/pending" element={<ProtectedRoute><PendingPage /></ProtectedRoute>} />
      <Route path="/admin/complaints" element={<ProtectedRoute><ComplaintsPage /></ProtectedRoute>} />
      <Route path="/admin/complaints/add" element={<ProtectedRoute><ComplaintAdd /></ProtectedRoute>} />
      <Route path="/admin/complaints/:id" element={<ProtectedRoute><ComplaintDetail /></ProtectedRoute>} />
      <Route path="/admin/cctns" element={<AdminRoute><CCTNSPage /></AdminRoute>} />

      {/* System Management — admin only */}
      <Route path="/admin/dev/update-code" element={<AdminRoute><DevTools /></AdminRoute>} />

      <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
    </Routes>
  </BrowserRouter>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <FilterProvider>
          <AppRoutes />
        </FilterProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
