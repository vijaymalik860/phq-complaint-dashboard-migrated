import { useState, useEffect, useRef, useCallback } from 'react';
import { Layout } from '../../components/layout/Layout';
import api from '../../services/api';
import { RANGE_LABELS } from '../../data/rangeMapping';
import { useQuery } from '@tanstack/react-query';

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

const cardStyle: React.CSSProperties = {
  marginTop: '24px',
  padding: '28px',
  background: 'var(--bg-card)',
  backdropFilter: 'var(--glass-blur)',
  borderRadius: '10px',
  border: '1px solid var(--border)',
  boxShadow: 'var(--shadow-sm)',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text-primary)',
  fontSize: '14px',
  outline: 'none',
  transition: 'border-color 0.2s',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

// ─── Deploy Tab ───────────────────────────────────────────────────────────────
const DeployTab = () => {
  const [log, setLog] = useState('');
  const [logUpdatedAt, setLogUpdatedAt] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [status, setStatus] = useState<DeployStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logBoxRef = useRef<HTMLPreElement>(null);

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
    }
  };

  const isDeploying = status === 'triggering' || status === 'running';

  const getBanner = () => {
    if (status === 'success') return { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)', color: 'var(--success)', text: 'Deployment successful! Press Ctrl+Shift+R to load the latest version.' };
    if (status === 'failed') return { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)', color: 'var(--danger)', text: 'Deployment failed — previous version automatically restored. Check log below.' };
    if (status === 'error') return { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)', color: 'var(--danger)', text: errorMsg };
    if (status === 'running') return { bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.2)', color: 'var(--primary)', text: 'Deployment in progress... Log auto-refreshes every 5 seconds.' };
    return null;
  };
  const banner = getBanner();

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: '20px' }}>
        <p style={{ color: 'var(--text-secondary)', lineHeight: '1.7', fontSize: '14px', margin: 0 }}>Clicking the button below will:</p>
        <ol style={{ color: 'var(--text-secondary)', lineHeight: '1.9', fontSize: '14px', marginTop: '8px', paddingLeft: '20px' }}>
          <li>Pull the latest code from GitHub <code>main</code> branch</li>
          <li>Build the frontend and backend</li>
          <li>Apply any database schema changes</li>
          <li>Restart the server via PM2</li>
          <li>Run a health check — <strong>auto-rollback</strong> to last working version if it fails</li>
        </ol>
        <p style={{ color: 'var(--warning)', fontSize: '13px', marginTop: '12px', marginBottom: 0 }}>
          ⚠️ App unavailable ~2 min. After restart press <strong>Ctrl+Shift+R</strong> to load latest changes.
        </p>
      </div>

      <button
        onClick={handleDeploy}
        disabled={isDeploying}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '13px 28px', background: isDeploying ? 'rgba(99,102,241,0.4)' : 'var(--primary)', border: 'none', borderRadius: '7px', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: isDeploying ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}
        onMouseEnter={(e) => { if (!isDeploying) e.currentTarget.style.background = 'var(--primary-dark)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = isDeploying ? 'rgba(99,102,241,0.4)' : 'var(--primary)'; }}
      >
        {isDeploying
          ? <span style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block', flexShrink: 0 }} />
          : <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" style={{ flexShrink: 0 }}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        }
        {status === 'triggering' ? 'Sending...' : status === 'running' ? 'Deploying...' : 'Deploy — Latest Code'}
      </button>

      {banner && (
        <div style={{ marginTop: '16px', padding: '12px 16px', background: banner.bg, border: `1px solid ${banner.border}`, borderRadius: '7px', color: banner.color, fontSize: '14px', lineHeight: '1.6' }}>
          {banner.text}
        </div>
      )}

      {log && (
        <div style={{ marginTop: '24px', padding: '20px', background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>
              Deploy Log{logUpdatedAt ? ` — updated ${new Date(logUpdatedAt).toLocaleTimeString()}` : ''}
              {isDeploying && <span style={{ marginLeft: '10px', fontSize: '11px', color: 'var(--primary)', fontWeight: 400 }}>auto-refreshing every 5s</span>}
            </span>
            <button onClick={() => fetchLog(true)} disabled={logLoading} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', padding: '4px 12px', borderRadius: '5px', fontSize: '12px', cursor: logLoading ? 'not-allowed' : 'pointer' }}>
              {logLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <pre ref={logBoxRef} style={{ margin: 0, padding: '12px', background: 'rgba(0,0,0,0.6)', color: '#94a3b8', borderRadius: '6px', fontSize: '12px', lineHeight: '1.6', maxHeight: '420px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'Consolas, "Courier New", monospace' }}>
            {log.split('\n').map((line, i) => (
              <span key={i} style={{ color: lineColor(line), display: 'block' }}>{line || ' '}</span>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
};

// ─── Change Password Tab ──────────────────────────────────────────────────────
const ChangePasswordTab = () => {
  const [current, setCurrent] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (newPwd !== confirm) { setMsg({ text: 'New passwords do not match.', ok: false }); return; }
    if (newPwd.length < 6) { setMsg({ text: 'New password must be at least 6 characters.', ok: false }); return; }
    setLoading(true);
    try {
      await api.post('/api/system/change-password', { currentPassword: current, newPassword: newPwd });
      setMsg({ text: 'Password changed successfully!', ok: true });
      setCurrent(''); setNewPwd(''); setConfirm('');
    } catch (err: any) {
      setMsg({ text: err.response?.data?.error || 'Failed to change password.', ok: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={cardStyle}>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: 0, marginBottom: 20 }}>
        Change your own login password. You must know your current password to proceed.
      </p>
      <form onSubmit={handleSubmit} style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle}>Current Password</label>
          <input type="password" style={inputStyle} value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" />
        </div>
        <div>
          <label style={labelStyle}>New Password</label>
          <input type="password" style={inputStyle} value={newPwd} onChange={e => setNewPwd(e.target.value)} required autoComplete="new-password" minLength={6} />
        </div>
        <div>
          <label style={labelStyle}>Confirm New Password</label>
          <input type="password" style={inputStyle} value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
        </div>
        {msg && (
          <div style={{ padding: '10px 14px', borderRadius: 6, background: msg.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${msg.ok ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`, color: msg.ok ? 'var(--success)' : 'var(--danger)', fontSize: 13 }}>
            {msg.ok ? '✓ ' : '✕ '}{msg.text}
          </div>
        )}
        <button type="submit" disabled={loading} style={{ alignSelf: 'flex-start', padding: '10px 24px', background: loading ? 'rgba(99,102,241,0.4)' : 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Saving...' : 'Change Password'}
        </button>
      </form>
    </div>
  );
};

// ─── User Management Tab ──────────────────────────────────────────────────────
interface UserRow {
  id: number;
  username: string;
  role: string;
  districtId?: string | null;
  rangeId?: string | null;
  createdAt: string;
}

const ROLES = [
  { value: 'admin',    label: 'Admin — Full access + System Mgmt + CCTNS' },
  { value: 'phq',     label: 'PHQ — Full data access, no CCTNS/Sys Mgmt' },
  { value: 'district',label: 'District — Lands on District Detail page' },
  { value: 'range',   label: 'Range — Dashboard with pre-set district filter' },
];

const ROLE_COLORS: Record<string, string> = {
  admin: '#fbbf24', phq: '#60a5fa', district: '#34d399', range: '#a78bfa',
};

const UserManagementTab = () => {
  const [form, setForm] = useState({ username: '', password: '', role: 'phq', districtId: '', rangeId: '' });
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  // Fetch districts for the dropdown
  const { data: districtData } = useQuery({
    queryKey: ['sys-districts'],
    queryFn: async () => {
      const res = await api.get('/api/districts');
      return res.data.data as Array<{ id: string; name: string }>;
    },
    staleTime: 10 * 60 * 1000,
  });
  const districts = districtData || [];

  // Fetch users
  const { data: usersData, isLoading: usersLoading, refetch: refetchUsers } = useQuery({
    queryKey: ['sys-users'],
    queryFn: async () => {
      const res = await api.get('/api/system/users');
      return res.data.data as UserRow[];
    },
  });
  const users = usersData || [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateMsg(null);
    if (!form.username || !form.password || !form.role) {
      setCreateMsg({ text: 'Username, password and role are required.', ok: false }); return;
    }
    if (form.role === 'district' && !form.districtId) {
      setCreateMsg({ text: 'Please select a district for district-role users.', ok: false }); return;
    }
    if (form.role === 'range' && !form.rangeId) {
      setCreateMsg({ text: 'Please select a range for range-role users.', ok: false }); return;
    }
    setCreating(true);
    try {
      await api.post('/api/system/users', {
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        districtId: form.role === 'district' ? form.districtId : undefined,
        rangeId: form.role === 'range' ? form.rangeId : undefined,
      });
      setCreateMsg({ text: `User "${form.username}" created successfully.`, ok: true });
      setForm({ username: '', password: '', role: 'phq', districtId: '', rangeId: '' });
      refetchUsers();
    } catch (err: any) {
      setCreateMsg({ text: err.response?.data?.error || 'Failed to create user.', ok: false });
    } finally { setCreating(false); }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/api/system/users/${id}`);
      setDeleteConfirm(null);
      refetchUsers();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete user.');
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetMsg(null);
    if (resetPwd.length < 6) { setResetMsg({ text: 'Password must be at least 6 chars.', ok: false }); return; }
    setResetLoading(true);
    try {
      await api.post(`/api/system/users/${resetTarget.id}/reset-password`, { newPassword: resetPwd });
      setResetMsg({ text: `Password reset for "${resetTarget.username}".`, ok: true });
      setResetPwd('');
      setTimeout(() => { setResetTarget(null); setResetMsg(null); }, 2000);
    } catch (err: any) {
      setResetMsg({ text: err.response?.data?.error || 'Failed.', ok: false });
    } finally { setResetLoading(false); }
  };

  return (
    <div>
      {/* Create User Form */}
      <div style={cardStyle}>
        <h3 style={{ color: 'var(--text-primary)', margin: '0 0 16px', fontSize: 16 }}>Create New User</h3>
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input style={inputStyle} type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required placeholder="e.g. karnal_range" />
          </div>
          <div>
            <label style={labelStyle}>Password (min 6 chars)</label>
            <input style={inputStyle} type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={6} placeholder="Set initial password" />
          </div>
          <div>
            <label style={labelStyle}>Role</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value, districtId: '', rangeId: '' }))}>
              {ROLES.map(r => <option key={r.value} value={r.value} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>{r.label}</option>)}
            </select>
          </div>
          <div>
            {form.role === 'district' && (
              <>
                <label style={labelStyle}>District</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.districtId} onChange={e => setForm(f => ({ ...f, districtId: e.target.value }))} required>
                  <option value="" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>— Select District —</option>
                  {[...districts].sort((a, b) => a.name.localeCompare(b.name)).map(d => (
                    <option key={d.id} value={d.id} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>{d.name}</option>
                  ))}
                </select>
              </>
            )}
            {form.role === 'range' && (
              <>
                <label style={labelStyle}>Range</label>
                <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.rangeId} onChange={e => setForm(f => ({ ...f, rangeId: e.target.value }))} required>
                  <option value="" style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>— Select Range —</option>
                  {Object.entries(RANGE_LABELS).map(([key, label]) => (
                    <option key={key} value={key} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>{label}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="submit" disabled={creating} style={{ padding: '10px 24px', background: creating ? 'rgba(99,102,241,0.4)' : 'var(--primary)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 14, fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer' }}>
              {creating ? 'Creating...' : '+ Create User'}
            </button>
            {createMsg && (
              <span style={{ fontSize: 13, color: createMsg.ok ? 'var(--success)' : 'var(--danger)' }}>
                {createMsg.ok ? '✓ ' : '✕ '}{createMsg.text}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* User List */}
      <div style={{ ...cardStyle, marginTop: 16 }}>
        <h3 style={{ color: 'var(--text-primary)', margin: '0 0 16px', fontSize: 16 }}>
          All Users {!usersLoading && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>({users.length} total)</span>}
        </h3>
        {usersLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading users...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['#', 'Username', 'Role', 'District / Range', 'Created', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{u.id}</td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontWeight: 500 }}>{u.username}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: ROLE_COLORS[u.role] || 'var(--text-muted)', background: `${ROLE_COLORS[u.role] || '#94a3b8'}1a`, padding: '2px 8px', borderRadius: 10, border: `1px solid ${ROLE_COLORS[u.role] || '#94a3b8'}40`, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: 12 }}>
                      {u.role === 'district' && u.districtId ? `District ID: ${u.districtId}` :
                       u.role === 'range' && u.rangeId ? (RANGE_LABELS[u.rangeId] || u.rangeId) :
                       '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 12 }}>{new Date(u.createdAt).toLocaleDateString('en-IN')}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => { setResetTarget(u); setResetPwd(''); setResetMsg(null); }}
                          style={{ padding: '4px 10px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, color: 'var(--primary-light)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                        >Reset Pwd</button>
                        {deleteConfirm === u.id ? (
                          <>
                            <button onClick={() => handleDelete(u.id)} style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 5, color: '#fca5a5', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>Confirm Delete</button>
                            <button onClick={() => setDeleteConfirm(null)} style={{ padding: '4px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>Cancel</button>
                          </>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(u.id)}
                            style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 5, color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reset Password Modal */}
      {resetTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 28, width: 380, maxWidth: '90vw', boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ color: 'var(--text-primary)', margin: '0 0 6px', fontSize: 16 }}>Reset Password</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 20px' }}>Setting new password for: <strong style={{ color: 'var(--text-primary)' }}>{resetTarget.username}</strong></p>
            <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle}>New Password (min 6 chars)</label>
                <input style={inputStyle} type="password" value={resetPwd} onChange={e => setResetPwd(e.target.value)} required minLength={6} autoFocus />
              </div>
              {resetMsg && (
                <div style={{ fontSize: 13, color: resetMsg.ok ? 'var(--success)' : 'var(--danger)' }}>{resetMsg.ok ? '✓ ' : '✕ '}{resetMsg.text}</div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button type="submit" disabled={resetLoading} style={{ padding: '9px 20px', background: 'var(--primary)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 14, fontWeight: 600, cursor: resetLoading ? 'not-allowed' : 'pointer' }}>
                  {resetLoading ? 'Saving...' : 'Reset Password'}
                </button>
                <button type="button" onClick={() => { setResetTarget(null); setResetPwd(''); setResetMsg(null); }} style={{ padding: '9px 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-secondary)', fontSize: 14, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main DevTools Page ───────────────────────────────────────────────────────
type TabId = 'deploy' | 'password' | 'users';

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'deploy',   label: 'Deploy Update',    icon: '🚀' },
  { id: 'password', label: 'Change Password',  icon: '🔑' },
  { id: 'users',    label: 'User Management',  icon: '👥' },
];

const DevTools = () => {
  const [activeTab, setActiveTab] = useState<TabId>('deploy');

  return (
    <Layout>
      <div className="module-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h1 className="module-title" style={{ color: 'var(--text-primary)', margin: 0 }}>System Management</h1>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'var(--bg-input)', padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border)' }}>
          Active Build: <span style={{ color: 'var(--primary-light)', fontWeight: 600 }}>{buildTime}</span>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 0, marginTop: 20, borderBottom: '1px solid var(--border)' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 22px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 700 : 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              transition: 'all 0.15s',
              marginBottom: '-1px',
            }}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'deploy'   && <DeployTab />}
      {activeTab === 'password' && <ChangePasswordTab />}
      {activeTab === 'users'    && <UserManagementTab />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Layout>
  );
};

export default DevTools;
