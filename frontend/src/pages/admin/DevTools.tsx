import { useState, useEffect } from 'react';
import { Layout } from '../../components/layout/Layout';
import api from '../../services/api';

interface DeployInfo {
  projectRoot: string;
  deployBatPath: string;
  deployBatExists: boolean;
  deployLogPath: string;
  deployLogExists: boolean;
  nodeVersion: string;
  platform: string;
}

const DevTools = () => {
  const [loading, setLoading]           = useState(false);
  const [log, setLog]                   = useState<string>('');
  const [logUpdatedAt, setLogUpdatedAt] = useState<string | null>(null);
  const [logLoading, setLogLoading]     = useState(false);
  const [info, setInfo]                 = useState<DeployInfo | null>(null);
  const [infoError, setInfoError]       = useState<string>('');

  const fetchLog = async () => {
    setLogLoading(true);
    try {
      const res = await api.get('/api/system/deploy-log');
      setLog(res.data.log || '');
      setLogUpdatedAt(res.data.updatedAt || null);
    } catch (_) {}
    finally { setLogLoading(false); }
  };

  const fetchInfo = async () => {
    try {
      const res = await api.get('/api/system/deploy-info');
      setInfo(res.data);
      setInfoError('');
    } catch (err: any) {
      setInfoError(err.response?.data?.error || err.message || 'Failed to fetch info');
    }
  };

  useEffect(() => {
    fetchLog();
    fetchInfo();
  }, []);

  const handleDeployUpdate = async () => {
    if (!window.confirm('Trigger a deployment? This will pull the latest code from GitHub, rebuild, and restart the server. The page will become unavailable for ~2 minutes.')) return;

    setLoading(true);
    setLog('⏳ Deployment triggered. Waiting for log output (this takes ~2 minutes)...');
    try {
      const response = await api.post('/api/system/trigger-deployment');
      window.alert(response.data.message || 'Deployment triggered!');
      // Auto-refresh log after 30s and again after 90s
      setTimeout(() => fetchLog(), 30000);
      setTimeout(() => fetchLog(), 90000);
    } catch (err: any) {
      window.alert(err.response?.data?.error || err.message || 'Failed to trigger deployment.');
      setLog('');
    } finally {
      setLoading(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    padding: '20px 24px',
    background: 'rgba(30, 41, 59, 0.7)',
    borderRadius: '8px',
    marginBottom: '16px',
    border: '1px solid rgba(100,116,139,0.15)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    color: '#64748b',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '2px',
  };

  const valueStyle: React.CSSProperties = {
    fontFamily: 'Consolas, monospace',
    fontSize: '13px',
    color: '#e2e8f0',
    wordBreak: 'break-all',
  };

  return (
    <Layout>
      <div className="module-header">
        <h1 className="module-title" style={{ color: '#e2e8f0' }}>Developer Tools</h1>
      </div>

      {/* ── Diagnostic Card ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '1rem', color: '#f8fafc', margin: 0 }}>🔍 Path Diagnostics (Live from Server)</h2>
          <button onClick={fetchInfo} style={{ padding: '5px 12px', background: 'rgba(100,116,139,0.2)', border: '1px solid rgba(100,116,139,0.3)', borderRadius: '5px', color: '#94a3b8', fontSize: '12px', cursor: 'pointer' }}>
            ↻ Refresh
          </button>
        </div>

        {infoError && (
          <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#fca5a5', fontSize: '13px', marginBottom: '12px' }}>
            ⚠️ Could not fetch info: {infoError}
          </div>
        )}

        {info ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            {[
              { label: 'process.cwd() — Project Root', value: info.projectRoot },
              { label: 'deploy.bat path', value: info.deployBatPath },
              { label: 'deploy.bat EXISTS on disk?', value: info.deployBatExists ? '✅ YES — file found' : '❌ NO — FILE MISSING!', color: info.deployBatExists ? '#86efac' : '#fca5a5' },
              { label: 'deploy.log path', value: info.deployLogPath },
              { label: 'deploy.log EXISTS?', value: info.deployLogExists ? '✅ YES' : '⚪ Not yet', color: info.deployLogExists ? '#86efac' : '#94a3b8' },
              { label: 'Node.js version', value: info.nodeVersion },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '6px', padding: '10px 14px' }}>
                <div style={labelStyle}>{label}</div>
                <div style={{ ...valueStyle, color: color || '#e2e8f0' }}>{value}</div>
              </div>
            ))}
          </div>
        ) : (
          !infoError && <div style={{ color: '#64748b', fontSize: '13px' }}>Loading...</div>
        )}
      </div>

      {/* ── Update Card ── */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: '1.1rem', color: '#f8fafc', marginBottom: '8px' }}>System Update</h2>
        <p style={{ color: '#94a3b8', marginBottom: '20px', lineHeight: '1.6', fontSize: '14px' }}>
          Triggers deployment of the latest code from GitHub. Pulls <code>main</code>,
          rebuilds frontend + backend, applies DB migrations, and restarts PM2.
          Auto-rolls back if health check fails.
        </p>

        <button
          id="btn-trigger-deployment"
          onClick={handleDeployUpdate}
          disabled={loading}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '12px 24px',
            background: loading ? 'rgba(59,130,246,0.5)' : '#3b82f6',
            border: 'none', borderRadius: '6px', color: '#fff',
            fontSize: '15px', fontWeight: 600,
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
          {loading ? 'Triggering Update...' : 'Click Here to Update Application Code'}
        </button>
      </div>

      {/* ── Deploy Log Card ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '1rem', color: '#f8fafc', margin: 0 }}>
            Deploy Log
            {logUpdatedAt && (
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 400, marginLeft: '12px' }}>
                Last updated: {new Date(logUpdatedAt).toLocaleString()}
              </span>
            )}
          </h2>
          <button onClick={fetchLog} disabled={logLoading} style={{ padding: '6px 14px', background: logLoading ? 'rgba(100,116,139,0.1)' : 'rgba(100,116,139,0.2)', border: '1px solid rgba(100,116,139,0.3)', borderRadius: '5px', color: '#94a3b8', fontSize: '13px', cursor: logLoading ? 'not-allowed' : 'pointer' }}>
            {logLoading ? 'Loading...' : '↻ Refresh Log'}
          </button>
        </div>
        <pre style={{
          background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(100,116,139,0.2)',
          borderRadius: '6px', padding: '16px', color: '#a3e635',
          fontSize: '12px', fontFamily: 'Consolas, monospace',
          maxHeight: '420px', overflowY: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
        }}>
          {log || '(No log yet — click "Refresh Log" after triggering a deployment and waiting ~2 minutes)'}
        </pre>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Layout>
  );
};

export default DevTools;
