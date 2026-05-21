import { useState, useEffect } from 'react';
import { Layout } from '../../components/layout/Layout';
import api from '../../services/api';

const DevTools = () => {
  const [loading, setLoading]       = useState(false);
  const [log, setLog]               = useState<string>('');
  const [logUpdatedAt, setLogUpdatedAt] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);

  const fetchLog = async () => {
    setLogLoading(true);
    try {
      const res = await api.get('/api/system/deploy-log');
      setLog(res.data.log || '');
      setLogUpdatedAt(res.data.updatedAt || null);
    } catch (_) {
      // Not a critical failure
    } finally {
      setLogLoading(false);
    }
  };

  // Auto-fetch log on mount
  useEffect(() => {
    fetchLog();
  }, []);

  const handleDeployUpdate = async () => {
    if (!window.confirm('Trigger a deployment? This will pull the latest code from GitHub, rebuild, and restart the server. The page will become unavailable for 1-2 minutes.')) return;

    setLoading(true);
    setLog('');
    try {
      const response = await api.post('/api/system/trigger-deployment');
      window.alert(response.data.message || 'Deployment triggered! Server restarting...');
      // Poll log after 30 seconds
      setTimeout(() => fetchLog(), 30000);
    } catch (err: any) {
      window.alert(err.response?.data?.error || err.message || 'Failed to trigger deployment.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="module-header">
        <h1 className="module-title" style={{ color: '#e2e8f0' }}>Developer Tools</h1>
      </div>

      {/* ── Update Card ── */}
      <div className="metrics-grid" style={{ marginTop: '24px', gridTemplateColumns: '1fr' }}>
        <div className="metric-card" style={{ padding: '24px', background: 'rgba(30, 41, 59, 0.7)' }}>
          <h2 style={{ fontSize: '1.25rem', color: '#f8fafc', marginBottom: '8px' }}>System Update</h2>
          <p style={{ color: '#94a3b8', marginBottom: '24px', lineHeight: '1.6', fontSize: '14px' }}>
            Triggers deployment of the latest code from GitHub. The process pulls the latest <code>main</code> branch,
            rebuilds frontend and backend, applies DB migrations, and restarts PM2.
            If the health check fails the system auto-rolls back.
          </p>

          <button
            id="btn-trigger-deployment"
            onClick={handleDeployUpdate}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 24px',
              background: loading ? 'rgba(59, 130, 246, 0.5)' : '#3b82f6',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              fontSize: '15px',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#2563eb'; }}
            onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = '#3b82f6'; }}
          >
            {loading ? (
              <span style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block' }} />
            ) : (
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {loading ? 'Triggering Update...' : 'Click Here to Update Application-Code'}
          </button>
        </div>
      </div>

      {/* ── Deploy Log Card ── */}
      <div className="metrics-grid" style={{ marginTop: '16px', gridTemplateColumns: '1fr' }}>
        <div className="metric-card" style={{ padding: '24px', background: 'rgba(30, 41, 59, 0.7)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '1.1rem', color: '#f8fafc', margin: 0 }}>
              Deploy Log
              {logUpdatedAt && (
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 400, marginLeft: '12px' }}>
                  Last updated: {new Date(logUpdatedAt).toLocaleString()}
                </span>
              )}
            </h2>
            <button
              onClick={fetchLog}
              disabled={logLoading}
              style={{
                padding: '6px 14px',
                background: logLoading ? 'rgba(100,116,139,0.3)' : 'rgba(100,116,139,0.2)',
                border: '1px solid rgba(100,116,139,0.3)',
                borderRadius: '5px',
                color: '#94a3b8',
                fontSize: '13px',
                cursor: logLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {logLoading ? 'Loading...' : '↻ Refresh Log'}
            </button>
          </div>
          <pre style={{
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(100,116,139,0.2)',
            borderRadius: '6px',
            padding: '16px',
            color: '#a3e635',
            fontSize: '12px',
            fontFamily: 'Consolas, monospace',
            maxHeight: '400px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}>
            {log || '(No log yet — click "Refresh Log" after triggering a deployment)'}
          </pre>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </Layout>
  );
};

export default DevTools;
