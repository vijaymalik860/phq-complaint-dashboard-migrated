import { useState } from 'react';
import { Layout } from '../../components/layout/Layout';
import api from '../../services/api';

const DevTools = () => {
  const [loading, setLoading] = useState(false);

  const handleDeployUpdate = async () => {
    if (!window.confirm("Deploy latest update? This will pull the latest code from GitHub, rebuild, and restart the server.")) return;

    setLoading(true);
    try {
      const response = await api.post('/api/system/trigger-deployment');
      window.alert(response.data.message || 'Deployment triggered successfully! Server is now pulling code and restarting.');
    } catch (err: any) {
      window.alert(err.response?.data?.error || err.message || 'Failed to trigger deployment. You might not have the required permissions.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="module-header">
        <h1 className="module-title" style={{ color: '#e2e8f0' }}>Developer Tools</h1>
      </div>

      <div className="metrics-grid" style={{ marginTop: '24px', gridTemplateColumns: '1fr' }}>
        <div className="metric-card" style={{ padding: '24px', background: 'rgba(30, 41, 59, 0.7)' }}>
          <h2 style={{ fontSize: '1.25rem', color: '#f8fafc', marginBottom: '16px' }}>System Update</h2>
          <p style={{ color: '#94a3b8', marginBottom: '24px', lineHeight: '1.6' }}>
            Trigger a manual deployment of the latest code from the GitHub repository. 
            This process will automatically fetch the latest main branch, rebuild the frontend and backend, 
            run database migrations, and safely restart the PM2 service. If the deployment fails or health checks do not pass, 
            the system will automatically roll back to the previous stable state.
          </p>

          <button
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
            onMouseEnter={(e) => { if(!loading) e.currentTarget.style.background = '#2563eb' }}
            onMouseLeave={(e) => { if(!loading) e.currentTarget.style.background = '#3b82f6' }}
          >
            {loading ? (
              <span className="spinner" style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            ) : (
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            {loading ? 'Triggering Update...' : 'Click Here Savin Update Application Code'}
          </button>
        </div>
      </div>
      
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Layout>
  );
};

export default DevTools;
