import { useState, useEffect } from 'react';
import { Layout } from '../../components/layout/Layout';
import api from '../../services/api';

const DevTools = () => {
  const [loading, setLoading]           = useState(false);
  const [log, setLog]                   = useState<string>('');
  const [logUpdatedAt, setLogUpdatedAt] = useState<string | null>(null);
  const [logLoading, setLogLoading]     = useState(false);
  const [status, setStatus]             = useState<'idle' | 'triggered' | 'done'>('idle');

  const fetchLog = async () => {
    setLogLoading(true);
    try {
      const res = await api.get('/api/system/deploy-log');
      setLog(res.data.log || '');
      setLogUpdatedAt(res.data.updatedAt || null);
    } catch (_) {}
    finally { setLogLoading(false); }
  };

  useEffect(() => { fetchLog(); }, []);

  const handleDeployUpdate = async () => {
    if (!window.confirm(
      'This will pull the latest code from GitHub, rebuild the application, and restart the server.\n\n' +
      'The app will be unavailable for ~2 minutes.\n\nProceed?'
    )) return;

    setLoading(true);
    setStatus('triggered');
    setLog('⏳ Deployment triggered. Please wait ~2 minutes, then click "Refresh Log"...');

    try {
      await api.post('/api/system/trigger-deployment');
      // Auto-refresh log after 30s, 60s, 90s
      setTimeout(() => fetchLog(), 30000);
      setTimeout(() => fetchLog(), 60000);
      setTimeout(() => { fetchLog(); setStatus('done'); }, 90000);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to trigger deployment.';
      window.alert('Error: ' + msg);
      setLog('');
      setStatus('idle');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="module-header">
        <h1 className="module-title" style={{ color: '#e2e8f0' }}>Developer Tools — System Update</h1>
      </div>

      {/* ── Update Card ── */}
      <div style={{ marginTop: '24px', padding: '28px', background: 'rgba(30,41,59,0.8)', borderRadius: '10px', border: '1px solid rgba(100,116,139,0.2)' }}>

        <div style={{ marginBottom: '20px' }}>
          <p style={{ color: '#94a3b8', lineHeight: '1.7', fontSize: '14px', margin: 0 }}>
            Clicking the button below will:
          </p>
          <ol style={{ color: '#94a3b8', lineHeight: '1.9', fontSize: '14px', marginTop: '8px', paddingLeft: '20px' }}>
            <li>Pull the latest code from GitHub <code>main</code> branch</li>
            <li>Rebuild the frontend and backend</li>
            <li>Apply any database schema changes</li>
            <li>Restart the server via PM2</li>
            <li>Run a health check — auto-rollback if it fails</li>
          </ol>
          <p style={{ color: '#f59e0b', fontSize: '13px', marginTop: '12px', marginBottom: 0 }}>
            ⚠️ The app will be unavailable for ~2 minutes. After it restarts, do a <strong>hard refresh</strong> (Ctrl+Shift+R) to see the latest changes.
          </p>
        </div>

        <button
          id="btn-trigger-deployment"
          onClick={handleDeployUpdate}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '10px',
            padding: '13px 28px',
            background: loading ? 'rgba(59,130,246,0.4)' : '#3b82f6',
            border: 'none', borderRadius: '7px', color: '#fff',
            fontSize: '15px', fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#2563eb'; }}
          onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = '#3b82f6'; }}
        >
          {loading ? (
            <span style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block', flexShrink: 0 }} />
          ) : (
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          {loading ? 'Deployment Running...' : 'Click Here to Update Application Code'}
        </button>

        {status === 'done' && (
          <div style={{ marginTop: '16px', padding: '12px 16px', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '7px', color: '#86efac', fontSize: '14px' }}>
            ✅ Deployment complete. <strong>Press Ctrl+Shift+R</strong> (hard refresh) to load the latest version.
          </div>
        )}
      </div>

      {/* ── Deploy Log ── */}
      <div style={{ marginTop: '16px', padding: '24px', background: 'rgba(30,41,59,0.8)', borderRadius: '10px', border: '1px solid rgba(100,116,139,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div>
            <span style={{ fontSize: '1rem', color: '#f8fafc', fontWeight: 600 }}>Deployment Log</span>
            {logUpdatedAt && (
              <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '12px' }}>
                Last updated: {new Date(logUpdatedAt).toLocaleString()}
              </span>
            )}
          </div>
          <button
            onClick={fetchLog}
            disabled={logLoading}
            style={{ padding: '6px 14px', background: 'rgba(100,116,139,0.2)', border: '1px solid rgba(100,116,139,0.3)', borderRadius: '5px', color: '#94a3b8', fontSize: '13px', cursor: logLoading ? 'not-allowed' : 'pointer' }}
          >
            {logLoading ? 'Loading...' : '↻ Refresh Log'}
          </button>
        </div>

        <pre style={{
          background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(100,116,139,0.15)',
          borderRadius: '6px', padding: '16px', color: '#a3e635',
          fontSize: '12px', fontFamily: 'Consolas, monospace',
          maxHeight: '500px', overflowY: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
        }}>
          {log || '(No log yet — click the button above, wait ~2 minutes, then click "↻ Refresh Log")'}
        </pre>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Layout>
  );
};

export default DevTools;
