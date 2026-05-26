import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/components/layout/Layout';
import api from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';

/** Decode JWT payload without signature verification (server already verified). */
function decodeJwt(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuth();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/api/auth/login', { username, password });
      if (response.data.success && response.data.data?.token) {
        const token = response.data.data.token;
        login(token);
        queryClient.clear();

        // Decode role info from token to decide landing page
        const payload = decodeJwt(token);
        const role: string = payload.role ?? 'admin';
        const districtId: string | null = payload.districtId ?? null;
        const rangeId: string | null = payload.rangeId ?? null;

        if (role === 'district' && districtId) {
          // District users land directly on their district detail page
          navigate(`/admin/district/${encodeURIComponent(districtId)}`);
        } else if (role === 'range' && rangeId) {
          // Range users: store pending range filter, then go to dashboard
          // FilterContext will pick this up and apply the pre-filter on first render
          localStorage.setItem('phq-pending-range-filter', rangeId);
          navigate('/admin/dashboard');
        } else {
          navigate('/admin/dashboard');
        }
      } else {
        setError(response.data.error || 'Login failed');
      }
    } catch {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="login-card">
        <div className="login-logo">
          <img src="/PHQlogo.png" alt="PHQ Logo" />
          <h1>PHQ Complaint Dashboard</h1>
          <p>Haryana Police Headquarters</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg
                  width="16" height="16" viewBox="0 0 24 24" fill="none"
                  style={{ animation: 'spin 0.75s linear infinite', flexShrink: 0 }}
                >
                  <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
                  <path fill="white" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in…
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </AuthLayout>
  );
};

export default LoginPage;