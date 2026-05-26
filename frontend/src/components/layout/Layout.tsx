import { ReactNode, useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { GlobalFilterBar } from './GlobalFilterBar';
import { useFilters } from '../../contexts/FilterContext';
import { ChartContext } from '../../contexts/ChartContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTachometerAlt,
  faFire,
  faFileAlt,
  faClock,
  faInbox,
  faDatabase,
  faSignOutAlt,
  faCog,
  faUserShield,
} from '@fortawesome/free-solid-svg-icons';
export { useChartExpand } from '../../contexts/ChartContext';

interface LayoutProps {
  children: ReactNode;
}

// Role badge colors
const ROLE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  admin:    { label: 'Admin',    color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
  phq:      { label: 'PHQ',     color: '#60a5fa', bg: 'rgba(96,165,250,0.15)' },
  district: { label: 'District', color: '#34d399', bg: 'rgba(52,211,153,0.15)' },
  range:    { label: 'Range',   color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
};

export const Layout = ({ children }: LayoutProps) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [filterBarOpen, setFilterBarOpen] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);

  const { theme, toggleTheme } = useTheme();
  const { user, isAdmin, logout } = useAuth();

  const location = useLocation();
  const navigate = useNavigate();
  const { filters } = useFilters();

  const [activeJobId, setActiveJobId] = useState<string | null>(() => localStorage.getItem('cctnsActiveJobId'));
  const [jobStatus, setJobStatus] = useState<string>(() => localStorage.getItem('cctnsActiveJobId') ? 'pending' : '');
  const [jobProgress, setJobProgress] = useState<string>('');
  const [jobPercent, setJobPercent] = useState<number>(0);
  const [jobError, setJobError] = useState<string>('');
  const [jobResult, setJobResult] = useState<any>(null);
  const queryClient = useQueryClient();
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll the active sync endpoint (works for BOTH manual sync jobs and background auto-syncs)
  const activeSyncQuery = useQuery({
    queryKey: ['global-active-sync'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      if (!token) return { success: true, data: { active: false } };
      const response = await fetch('/api/cctns/active-sync', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch active sync status');
      return response.json();
    },
    refetchInterval: (query) => {
      // Poll every 2 seconds if there is an active sync running, otherwise every 10 seconds
      const isActive = query.state.data?.data?.active;
      return isActive ? 2000 : 10000;
    },
    retry: false,
    // Only poll if admin (CCTNS sync is admin-only)
    enabled: isAdmin,
  });

  useEffect(() => {
    if (activeSyncQuery.data?.data) {
      const data = activeSyncQuery.data.data;
      if (data.active) {
        // Clear any pending clearout timers if a sync is running
        if (pollRef.current) {
          clearTimeout(pollRef.current);
          pollRef.current = null;
        }

        setActiveJobId(data.id || 'sync-active');
        setJobStatus(data.status || 'running');
        setJobProgress(data.progress || 'Sync in progress...');
        setJobPercent(data.progressPercentage || 0);
        setJobError(data.error || '');

        if (data.result) {
          setJobResult({
            fetched: data.result.fetched || 0,
            created: data.result.upserted || 0,
            updated: 0,
            errors: data.result.errors || 0,
          });
        } else {
          setJobResult(null);
        }
      } else {
        // If it transitioned from active to inactive, mark it as completed successfully
        if (activeJobId && activeJobId !== '') {
          setJobStatus('success');
          setJobPercent(100);
          setJobProgress('Sync completed successfully!');

          // Refresh all dashboard queries
          queryClient.invalidateQueries({ queryKey: ['cctns-synced'] });
          queryClient.invalidateQueries({ queryKey: ['cctns-history'] });
          queryClient.invalidateQueries({ queryKey: ['cctns-last-sync-date'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          queryClient.invalidateQueries({ queryKey: ['district-analysis'] });

          // Keep progress bar visible in green success state for 5 seconds, then hide it
          if (pollRef.current) clearTimeout(pollRef.current);
          pollRef.current = setTimeout(() => {
            setActiveJobId(null);
            setJobStatus('');
            setJobProgress('');
            setJobPercent(0);
            setJobError('');
            setJobResult(null);
            pollRef.current = null;
          }, 5000);
        }
      }
    }
  }, [activeSyncQuery.data, queryClient, activeJobId]);

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
    logout();
    queryClient.clear();
    navigate('/login');
  };

  // Build dynamic menu based on role
  const menuItems = [
    { path: '/admin/dashboard',  label: 'Dashboard',  icon: faTachometerAlt },
    { path: '/admin/highlights', label: 'Hotspots',   icon: faFire },
    { path: '/admin/reports',    label: 'Reports',    icon: faFileAlt },
    { path: '/admin/pending',    label: 'Pending',    icon: faClock },
    { path: '/admin/complaints', label: 'Complaints', icon: faInbox },
    // CCTNS — admin only
    ...(isAdmin ? [{ path: '/admin/cctns', label: 'CCTNS', icon: faDatabase }] : []),
    // System Management — admin only
    ...(isAdmin ? [{ path: '/admin/dev/update-code', label: 'System Mgmt', icon: faCog }] : []),
  ];

  const getModuleName = () => {
    const path = location.pathname;
    if (path.includes('/admin/complaints/') && path !== '/admin/complaints') return 'Complaint Details';
    if (path === '/admin/dev/update-code') return 'System Management';
    const match = menuItems.find(item => path === item.path || path.startsWith(item.path));
    return match ? match.label : 'Dashboard';
  };

  const roleBadge = user ? (ROLE_BADGE[user.role] ?? { label: user.role, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' }) : null;

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
          <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '1px', textTransform: 'uppercase', textShadow: theme === 'dark' ? '0 2px 4px rgba(0,0,0,0.3)' : 'none', whiteSpace: 'nowrap' }}>
            {getModuleName()}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px 12px',
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-input)';
              e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {/* Global Filter Button */}
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

          {/* Elegant User / Role Badge in Header */}
          {user && roleBadge && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: '6px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-sm)',
              height: '32px',
              flexShrink: 0,
            }}>
              <FontAwesomeIcon icon={faUserShield} style={{ fontSize: 13, color: roleBadge.color }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  {user.username}
                </span>
                <span style={{
                  fontSize: '9px',
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                  color: roleBadge.color,
                  background: roleBadge.bg,
                  padding: '1px 5px',
                  borderRadius: '10px',
                  border: `1px solid ${roleBadge.color}40`,
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>
                  {roleBadge.label}
                </span>
              </div>
            </div>
          )}
        </div>
      </header>

      {activeJobId && (
        <div style={{
          background: 'var(--bg-card)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid var(--border)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          fontSize: '13px',
          color: 'var(--text-secondary)',
          zIndex: 99,
          position: 'relative',
          boxShadow: 'var(--shadow-sm)'
        }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: jobStatus === 'success' ? '#22c55e' : jobStatus === 'error' ? '#ef4444' : '#3b82f6',
            boxShadow: jobStatus === 'success' || jobStatus === 'error' ? 'none' : '0 0 0 0 rgba(59,130,246,0.6)',
            animation: jobStatus === 'success' || jobStatus === 'error' ? 'none' : 'syncPulse 1.4s ease-out infinite',
            flexShrink: 0,
          }} />
          <span style={{ fontWeight: 500 }}>
            {jobStatus === 'pending' ? 'Sync job queued — starting shortly...' :
             jobStatus === 'running' ? `Sync in progress: ${jobProgress || 'Processing...'}` :
             jobStatus === 'success' ? '✓ Sync completed successfully!' :
             `✕ Sync failed: ${jobError || 'Error occurred'}`}
          </span>
          <div style={{ flex: 1, background: 'rgba(59,130,246,0.15)', borderRadius: 6, height: 8, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              background: jobStatus === 'success' ? '#22c55e' : jobStatus === 'error' ? '#ef4444' : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              width: `${jobStatus === 'success' ? 100 : (jobPercent || (jobStatus === 'running' ? 5 : 2))}%`,
              transition: 'width 0.5s ease',
              borderRadius: 6
            }} />
          </div>
          {jobResult && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              Fetched: <strong style={{ color: 'var(--text-primary)' }}>{jobResult.fetched.toLocaleString()}</strong> | Saved: <strong style={{ color: 'var(--success)' }}>{(jobResult.created + jobResult.updated).toLocaleString()}</strong> | Errors: <strong style={{ color: jobResult.errors > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{jobResult.errors}</strong>
            </span>
          )}
        </div>
      )}

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
              className={`nav-item ${location.pathname === item.path || (item.path === '/admin/dev/update-code' && location.pathname === '/admin/dev/update-code') ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <FontAwesomeIcon icon={item.icon} className="nav-icon" />
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            <FontAwesomeIcon icon={faSignOutAlt} className="nav-icon" />
            <span className="nav-label">Logout</span>
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
