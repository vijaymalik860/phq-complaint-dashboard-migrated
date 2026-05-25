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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

import { FilterProvider } from './contexts/FilterContext';
import { ThemeProvider } from './contexts/ThemeContext';

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <FilterProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/admin/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/district/:district"
            element={
              <ProtectedRoute>
                <DistrictDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/highlights"
            element={
              <ProtectedRoute>
                <HighlightsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/reports"
            element={
              <ProtectedRoute>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/pending"
            element={
              <ProtectedRoute>
                <PendingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/complaints"
            element={
              <ProtectedRoute>
                <ComplaintsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/complaints/add"
            element={
              <ProtectedRoute>
                <ComplaintAdd />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/complaints/:id"
            element={
              <ProtectedRoute>
                <ComplaintDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/cctns"
            element={
              <ProtectedRoute>
                <CCTNSPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/dev/update-code"
            element={
              <ProtectedRoute>
                <DevTools />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </FilterProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
