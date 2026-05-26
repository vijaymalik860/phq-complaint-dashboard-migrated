import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { resolveRangeDistrictIds } from '../data/rangeMapping';
import { useAuth } from './AuthContext';

export interface DashboardFilters {
  districtIds: string;
  policeStationIds: string;
  officeIds: string;
  classOfIncident: string;
  fromDate: string;
  toDate: string;
}

interface FilterContextType {
  filters: DashboardFilters;
  setFilter: (key: keyof DashboardFilters, value: string) => void;
  resetFilters: () => void;
}

const defaultFilters: DashboardFilters = {
  districtIds: '',
  policeStationIds: '',
  officeIds: '',
  classOfIncident: '',
  fromDate: '',
  toDate: '',
};

const STORAGE_KEY = 'phq-dashboard-filters';

const loadFiltersFromStorage = (): DashboardFilters => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaultFilters, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load filters from localStorage:', e);
  }
  return defaultFilters;
};

const FilterContext = createContext<FilterContextType>({
  filters: defaultFilters,
  setFilter: () => {},
  resetFilters: () => {},
});

export const FilterProvider = ({ children }: { children: ReactNode }) => {
  const [filters, setFilters] = useState<DashboardFilters>(loadFiltersFromStorage);
  const { user } = useAuth();

  // Persist filters to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch (e) {
      console.warn('Failed to save filters to localStorage:', e);
    }
  }, [filters]);

  // Apply default range filter dynamically when a range user logs in or resets filters
  useEffect(() => {
    if (user?.role === 'range' && user.rangeId && !filters.districtIds) {
      const applyRangeFilter = async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch('/api/districts', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return;
          const json = await res.json();
          const districts: Array<{ id: string; name: string }> = json.data || [];
          const ids = resolveRangeDistrictIds(user.rangeId!, districts);
          if (ids.length > 0) {
            setFilters((prev) => ({ ...prev, districtIds: ids.join(',') }));
          }
        } catch (e) {
          console.warn('Failed to apply range filter:', e);
        }
      };

      applyRangeFilter();
    }
  }, [user, filters.districtIds]);

  // Apply default district filter dynamically when a district user logs in or resets filters
  useEffect(() => {
    if (user?.role === 'district' && user.districtId && !filters.districtIds) {
      setFilters((prev) => ({ ...prev, districtIds: user.districtId! }));
    }
  }, [user, filters.districtIds]);

  const prevUserIdRef = useRef<number | undefined>(user?.id);

  // Reset filters to default whenever user logs out or changes
  useEffect(() => {
    if (prevUserIdRef.current !== user?.id) {
      setFilters(defaultFilters);
      prevUserIdRef.current = user?.id;
    }
  }, [user?.id]);

  const setFilter = useCallback((key: keyof DashboardFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => setFilters(defaultFilters), []);

  return (
    <FilterContext.Provider value={{ filters, setFilter, resetFilters }}>
      {children}
    </FilterContext.Provider>
  );
};

export const useFilters = () => useContext(FilterContext);
