import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { GlobalFilterBar } from './GlobalFilterBar';
import { useFilters } from '../../contexts/FilterContext';
import { ChartContext } from '../../contexts/ChartContext';
import api from '../../services/api';
export { useChartExpand } from '../../contexts/ChartContext';

interface LayoutProps {
  children: ReactNode;
}

const menuItems = [
  { path: '/admin/dashboard', label: 'Dashboard' },
  { path: '/admin/highlights', label: 'Hotspots' },
  { path: '/admin/reports', label: 'Reports' },
  { path: '/admin/pending', label: 'Pending' },
  { path: '/admin/complaints', label: 'Complaints' },
  { path: '/admin/cctns', label: 'CCTNS' },
];

export const Layout = ({ children }: LayoutProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [filterBarOpen, setFilterBarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { filters } = useFilters();

  // Count how many independent filter groups are set
  const activeFilterCount = [
    filters.districtIds,
    filters.policeStationIds,
    filters.officeIds,
    filters.classOfIncident,
    (filters.fromDate || filters.toDate) ? '1' : '', // date range = 1 group
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const handleDeployUpdate = async () => {
    if (!window.confirm("Deploy latest update? This will pull the latest code from GitHub, rebuild, and restart the server.")) return;

    try {
      const response = await api.post('/api/system/trigger-deployment');
      window.alert(response.data.message || 'Deployment triggered successfully! Server is now pulling code and restarting.');
    } catch (err: any) {
      window.alert(err.response?.data?.error || err.message || 'Failed to trigger deployment. You might not have the required permissions.');
    }
  };

  const getModuleName = () => {
    const path = location.pathname;
    if (path.includes('/admin/complaints/') && path !== '/admin/complaints') return 'Complaint Details';
    const match = menuItems.find(item => path === item.path || path.startsWith(item.path));
    return match ? match.label : 'Dashboard';
  };

  return (
    <div className="app-container">
      <header className="top-header">
        <div className="header-left">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="header-brand">
            <img src="/PHQlogo.png" alt="PHQ" className="header-logo" />
            <div className="header-text">
              <span className="header-title">Grievance Monitoring System</span>
              <span className="header-dept">Haryana Police Headquarters</span>
            </div>
          </div>
        </div>

        <div className="header-center">
          <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e2e8f0', letterSpacing: '1px', textTransform: 'uppercase', textShadow: '0 2px 4px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
            {getModuleName()}
          </span>
        </div>

        <button
          className={`filter-toggle-btn${hasActiveFilters ? ' filter-toggle-btn--active' : ''}`}
          onClick={() => setFilterBarOpen(!filterBarOpen)}
          title={
            hasActiveFilters
              ? `${activeFilterCount} global filter${activeFilterCount > 1 ? 's' : ''} active — click to edit`
              : 'Toggle Global Filters'
          }
        >
          {/* Animated live-pulse dot — only when filters are active */}
          {hasActiveFilters && <span className="filter-active-dot" aria-hidden="true" />}

          {/* Funnel icon — filled when active */}
          <svg
            width="15" height="15"
            fill={hasActiveFilters ? 'currentColor' : 'none'}
            stroke="currentColor" strokeWidth="2"
            viewBox="0 0 24 24"
            style={{ flexShrink: 0 }}
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>



          {/* Numeric count badge — slides in when active */}
          {hasActiveFilters && (
            <span className="filter-count-badge" aria-label={`${activeFilterCount} active filters`}>
              {activeFilterCount}
            </span>
          )}

          {/* Chevron */}
          <svg
            width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"
            style={{
              transform: filterBarOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
              marginLeft: '2px',
              flexShrink: 0,
            }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </header>

      {filterBarOpen && (
        <div className="filter-bar-expanded">
          <GlobalFilterBar />
          <button
            className="filter-close-btn"
            onClick={() => setFilterBarOpen(false)}
            title="Close Filters"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <nav className="sidebar-nav">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', padding: '16px', borderTop: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={handleDeployUpdate}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid #3b82f6',
              borderRadius: '6px',
              color: '#3b82f6',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Update System
          </button>

          <button
            onClick={handleLogout}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #ef4444',
              borderRadius: '6px',
              color: '#ef4444',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      <div className={`sidebar-overlay ${sidebarOpen ? '' : 'hidden'}`} onClick={() => setSidebarOpen(false)} />

      <main className="main-content">
        <ChartContext.Provider value={{ expanded: chartExpanded, setExpanded: setChartExpanded }}>
          {children}
        </ChartContext.Provider>
      </main>
    </div>
  );
};

export const AuthLayout = ({ children }: LayoutProps) => {
  return (
    <div className="auth-container">
      <div className="auth-bg">
        <div className="auth-bg-gradient" />
        <div className="auth-bg-grid" />
      </div>
      <div className="auth-content">
        {children}
      </div>
    </div>
  );
};
