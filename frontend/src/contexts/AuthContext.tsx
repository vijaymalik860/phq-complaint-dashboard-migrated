import { createContext, useContext, useMemo, useState, useEffect, ReactNode } from 'react';

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  districtId?: string | null;
  rangeId?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isAdmin: boolean;
  isPhq: boolean;
  isDistrict: boolean;
  isRange: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  isPhq: false,
  isDistrict: false,
  isRange: false,
  login: () => {},
  logout: () => {},
});

/** Decode the JWT payload (without verifying — verification is done server-side). */
function decodeJwtPayload(token: string): AuthUser | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(json);
    return {
      id: payload.id,
      username: payload.username,
      role: payload.role,
      districtId: payload.districtId ?? null,
      rangeId: payload.rangeId ?? null,
    };
  } catch {
    return null;
  }
}

function readUserFromStorage(): AuthUser | null {
  const token = localStorage.getItem('token');
  if (!token) return null;
  return decodeJwtPayload(token);
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(readUserFromStorage);

  // Re-read from localStorage when the window regains focus or storage changes
  // (handles login/logout in other tabs, and post-navigate refresh)
  useEffect(() => {
    const sync = () => setUser(readUserFromStorage());
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    // Also sync once on mount to catch any token set before this component mounts
    sync();
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  const login = (token: string) => {
    localStorage.setItem('token', token);
    setUser(decodeJwtPayload(token));
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('phq-dashboard-filters');
    localStorage.removeItem('phq-pending-range-filter');
    setUser(null);
  };

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAdmin:    user?.role === 'admin',
      isPhq:      user?.role === 'phq',
      isDistrict: user?.role === 'district',
      isRange:    user?.role === 'range',
      login,
      logout,
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
