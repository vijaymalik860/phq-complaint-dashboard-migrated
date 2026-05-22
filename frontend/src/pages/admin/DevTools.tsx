import { useState, useEffect, useRef, useCallback } from 'react';
import { Layout } from '../../components/layout/Layout';
import api from '../../services/api';

declare const __BUILD_TIMESTAMP__: string;

const buildTime =
  typeof __BUILD_TIMESTAMP__ !== 'undefined'
    ? new Date(__BUILD_TIMESTAMP__).toLocaleString()
    : 'Development (Local)';

type DeployStatus = 'idle' | 'triggering' | 'running' | 'success' | 'failed' | 'error';

function detectStatus(log: string): DeployStatus {
  if (!log) return 'idle';
  const tail = log.slice(-3000);
  if (tail.includes('=== DEPLOY SUCCESSFUL ===')) return 'success';
  if (tail.includes('=== DEPLOY FAILED')) return 'failed';
  if (tail.includes('[STEP]') || tail.includes('[OK]') || tail.includes('[FAIL]') || tail.includes('[INFO]') || tail.includes('[WARN]')) return 'running';
  return 'idle';
}

function lineColor(line: string): string {
  if (line.includes('[OK]') || line.includes('SUCCESSFUL')) return '#86efac';
  if (line.includes('[FAIL]') || line.includes('FAILED') || line.includes('ROLLBACK') || line.includes('ROLLED BACK')) return '#fca5a5';
  if (line.includes('[STEP]')) return '#93c5fd';
  if (line.includes('[WARN]') || line.includes('[INFO]')) return '#fde68a';
  return '#94a3b8';
}

const POLL_MS = 5000;

const DevTools = () => {
  const [triggering, setTriggering]     = useState(false);
  const [log, setLog]                   = useState('');
  const [logUpdatedAt, setLogUpdatedAt] = useState<string | null>(null);
  const [logLoading, setLogLoading]     = useState(false);
  const [status, setStatus]             = useState<DeployStatus>('idle');
  const [errorMsg, setErrorMsg]         = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logBoxRef  = useRef<HTMLPreElement>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }, []);

  const fetchLog = useCallback(async (applyStatus = true) => {
    setLogLoading(true);
    try {
      const res = await api.get('/api/system/deploy-log');
      const newLog: string = res.data.log || '';
      setLog(newLog);
      setLogUpdatedAt(res.data.updatedAt || null);
      if (applyStatus) {
        const d = detectStatus(newLog);
        if (d === 'success') { setStatus('success'); stopPolling(); }
        else if (d === 'failed') { setStatus('failed'); stopPolling(); }
      }
    } catch { /* ignore */ }
    finally { setLogLoading(false); }
  }, [stopPolling]);

  useEffect(() => { fetchLog(); }, [fetchLog]);
  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    if ((status === 'running' || status === 'triggering') && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [log, status]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = setInterval(() => fetchLog(true), POLL_MS);
  }, [fetchLog, stopPolling]);

  const handleDeploy = async () => {
    if (!window.confirm('Pull latest code from GitHub, rebuild and restart the server?\n\nApp unavailable ~2 minutes. Proceed?')) return;
    setTriggering(true);
    setStatus('triggering');
    setErrorMsg('');
    setLog('Sending deployment signal...');
    try {
      await api.post('/api/system/trigger-deployment');
      setStatus('running');
      setLog('Deployment triggered! Building now (~2 min).\nLog auto-refreshes every 5 seconds...\n');
      startPolling();
    } catch (err: any) {
      const m: string = err.response?.data?.error || err.message || 'Failed to trigger deployment.';
      setErrorMsg(m);
      setLog('');
      setStatus('error');
    } finally {
      setTriggering(false);
    }
  };

  const isDeploying = status === 'triggering' || status === 'running';

  const getBanner = () => {
    if (status === 'success') return { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', color: '#86efac', text: 'Deployment successful! Press Ctrl+Shift+R to load the latest version.' };
    if (status === 'failed')  return { bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.3)',  color: '#fca5a5', text: 'Deployment failed — previous version automatically restored. Check log below.' };
    if (status === 'error')   return { bg: 'rgba(239,68,68,0.1)',  border: 'rgba(239,68,68,0.3)',  color: '#fca5a5', text: errorMsg };
    if (status === 'running') return { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)', color: '#93c5fd', text: 'Deployment in progress... Log auto-refreshes every 5 seconds.' };
    return null;
  };
  const banner = getBanner();

  return (
    <Layout>
      <div className="module-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h1 className="module-title" style={{ color: '#e2e8f0', margin: 0 }}>Developer Tools — System Update</h1>
        <div style={{ fontSize: '12px', color: '#94a3b8', background: 'rgba(30,41,59,0.6)', padding: '8px 16px', borderRadius: '6px', border: '1px solid rgba(100,116,139,0.2)' }}>
          Active Build: <span style={{ color: '#38bdf8', fontWeight: 600 }}>{buildTime}</span>
        </div>
      </div>

      <div style={{ marginTop: '24px', padding: '28px', background: 'rgba(30,41,59,0.8)', borderRadius: '10px', border: '1px solid rgba(100,116,139,0.2)' }}>
        <div style={{ marginBottom: '20px' }}>
          <p style={{ color: '#94a3b8', lineHeight: '1.7', fontSize: '14px', margin: 0 }}>Clicking the button below will:</p>
          <ol style={{ color: '#94a3b8', lineHeight: '1.9', fontSize: '14px', marginTop: '8px', paddingLeft: '20px' }}>
            <li>Pull the latest code from GitHub <code>main</code> branch</li>
            <li>Build the frontend and backend</li>
            <li>Apply any database schema changes</li>
            <li>Restart the server via PM2</li>
            <li>Run a health check — <strong>auto-rollback</strong> to last working version if it fails</li>
          </ol>
          <p style={{ color: '#f59e0b', fontSize: '13px', marginTop: '12px', marginBottom: 0 }}>
            ⚠️ App unavailable ~2 min. After restart press <strong>Ctrl+Shift+R</strong> to load latest changes.
          </p>
        </div>

        <button
          onClick={handleDeploy}
          disabled={isDeploying}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '13px 28px', background: isDeploying ? 'rgba(59,130,246,0.4)' : '#3b82f6', border: 'none', borderRadius: '7px', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: isDeploying ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}
          onMouseEnter={(e) => { if (!isDeploying) e.currentTarget.style.background = '#2563eb'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = isDeploying ? 'rgba(59,130,246,0.4)' : '#3b82f6'; }}
        >
          {isDeploying
            ? <span style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block', flexShrink: 0 }} />
            : <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" style={{ flexShrink: 0 }}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          }
          {status === 'triggering' ? 'Sending...' : status === 'running' ? 'Deploying...' : 'Deploy Latest Code'}
        </button>

        {banner && (
          <div style={{ marginTop: '16px', padding: '12px 16px', background: banner.bg, border: `1px solid ${banner.border}`, borderRadius: '7px', color: banner.color, fontSize: '14px', lineHeight: '1.6' }}>
            {banner.text}
          </div>
        )}
      </div>

      {log && (
        <div style={{ marginTop: '24px', padding: '20px', background: 'rgba(15,23,42,0.9)', borderRadius: '10px', border: '1px solid rgba(100,116,139,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 600 }}>
              Deploy Log{logUpdatedAt ? ` — updated ${new Date(logUpdatedAt).toLocaleTimeString()}` : ''}
              {isDeploying && <span style={{ marginLeft: '10px', fontSize: '11px', color: '#60a5fa', fontWeight: 400 }}>auto-refreshing every 5s</span>}
            </span>
            <button onClick={() => fetchLog(true)} disabled={logLoading} style={{ background: 'none', border: '1px solid rgba(100,116,139,0.4)', color: '#94a3b8', padding: '4px 12px', borderRadius: '5px', fontSize: '12px', cursor: logLoading ? 'not-allowed' : 'pointer' }}>
              {logLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <pre ref={logBoxRef} style={{ margin: 0, padding: '12px', background: 'rgba(0,0,0,0.4)', borderRadius: '6px', fontSize: '12px', lineHeight: '1.6', maxHeight: '420px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'Consolas, "Courier New", monospace' }}>
            {log.split('\n').map((line, i) => (
              <span key={i} style={{ color: lineColor(line), display: 'block' }}>{line || ' '}</span>
            ))}
          </pre>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Layout>
  );
};

export default DevTools;
