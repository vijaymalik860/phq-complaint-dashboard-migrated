import { useState, useEffect, useRef, useCallback } from 'react';
import { Layout } from '../../components/layout/Layout';
import api from '../../services/api';

declare const __BUILD_TIMESTAMP__: string;

const buildTime =
  typeof __BUILD_TIMESTAMP__ !== 'undefined'
    ? new Date(__BUILD_TIMESTAMP__).toLocaleString()
    : 'Development (Local)';

type DeployStatus = 'idle' | 'triggering' | 'running' | 'success' | 'failed' | 'error';

/** Parse the last portion of the log to decide overall deployment state. */
function detectStatus(log: string): DeployStatus {
  if (!log) return 'idle';
  const tail = log.slice(-3000);
  if (tail.includes('=== DEPLOY SUCCESSFUL ==='))  return 'success';
  if (tail.includes('=== DEPLOY FAILED'))           return 'failed';
  if (
    tail.includes('[STEP]') ||
    tail.includes('[OK]')   ||
    tail.includes('[FAIL]') ||
    tail.includes('[INFO]') ||
    tail.includes('[WARN]')
  ) return 'running';
  return 'idle';
}

/** Colour a single log line based on its tag. */
function lineColor(line: string): string {
  if (line.includes('[OK]') || line.includes('SUCCESSFUL'))               return '#86efac'; // green
  if (line.includes('[FAIL]') || line.includes('FAILED') ||
      line.includes('ROLLBACK') || line.includes('ROLLED BACK'))          return '#fca5a5'; // red
  if (line.includes('[STEP]'))                                            return '#93c5fd'; // blue
  if (line.includes('[WARN]') || line.includes('[INFO]'))                 return '#fde68a'; // yellow
  return '#94a3b8'; // default grey
}

const POLL_INTERVAL_MS = 5000;

const DevTools = () => {
  const [triggering, setTriggering]     = useState(false);
  const [log, setLog]                   = useState('');
  const [logUpdatedAt, setLogUpdatedAt] = useState<string | null>(null);
  const [logLoading, setLogLoading]     = useState(false);
  const [status, setStatus]             = useState<DeployStatus>('idle');
  const [errorMsg, setErrorMsg]         = useState('');

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logBoxRef  = useRef<HTMLPreElement>(null);

  // ── Polling control ──────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // ── Fetch deploy log ─────────────────────────────────────────────────────
  const fetchLog = useCallback(async (applyStatusDetection = true) => {
    setLogLoading(true);
    try {
      const res = await api.get('/api/system/deploy-log');
      const newLog: string = res.data.log || '';
      setLog(newLog);
      setLogUpdatedAt(res.data.updatedAt || null);

      if (applyStatusDetection) {
        const detected = detectStatus(newLog);
        if (detected === 'success') {
          setStatus('success');
          stopPolling();
        } else if (detected === 'failed') {
          setStatus('failed');
          stopPolling();
        }
      }
    } catch {
      /* silently ignore network hiccups during polling */
    } finally {
      setLogLoading(false);
    }
  }, [stopPolling]);

  // ── Auto-scroll log box to bottom while deploying ────────────────────────
  useEffect(() => {
    if ((status === 'running' || status === 'triggering') && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [log, status]);

  // ── Fetch log once on mount ──────────────────────────────────────────────
  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  // ── Cleanup polling on unmount ───────────────────────────────────────────
  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollingRef.current = setInterval(() => fetchLog(true), POLL_INTERVAL_MS);
  }, [fetchLog, stopPolling]);

  // ── Trigger deployment ───────────────────────────────────────────────────
  const handleDeploy = async () => {
    if (
      !window.confirm(
        'This will pull the latest code from GitHub, rebuild the app, and restart the server.\n\n' +
          'The app will be unavailable for ~2 minutes.\n\nProceed?'
      )
    )
      return;

    setTriggering(true);
    setStatus('triggering');
    setErrorMsg('');
    setLog('⏳ Sending deployment signal to server...');

    try {
      await api.post('/api/system/trigger-deployment');
      setStatus('running');
      setLog(
        '✅ Deployment triggered!\n' +
          'Pulling code and building — this takes ~2 minutes.\n' +
          'Log auto-refreshes every 5 seconds...\n'
      );
      startPolling();
    } catch (err: any) {
      const msg: string =
        err.response?.data?.error || err.message || 'Failed to trigger deployment.';
      setErrorMsg(msg);
      setLog('');
      setStatus('error');
    } finally {
      setTriggering(false);
    }
  };

  const isDeploying = status === 'triggering' || status === 'running';

  // ── Banner config by status ──────────────────────────────────────────────
  const bannerConfig: Record<
    string,
    { bg: string; border: string; color: string; text: string } | null
  > = {
    success: {
      bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', color: '#86efac',
      text: '✅ Deployment successful!  Press Ctrl+Shift+R (hard refresh) to load the lates