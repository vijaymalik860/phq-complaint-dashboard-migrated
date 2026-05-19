import axios, { AxiosError } from 'axios';
import type { ApiResponse, User } from '../types';

const rawApiUrl = ((import.meta as any).env.VITE_API_URL as string | undefined)?.trim();
const API_URL = rawApiUrl
  ? rawApiUrl.replace(/\/+$/, '').replace(/\/api$/i, '')
  : '';

const api = axios.create({
  baseURL: API_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Add debug logging in development
  if ((import.meta as any).env?.DEV) {
    console.log(`🌐 API Request: ${config.method?.toUpperCase()} ${config.url}`, {
      params: config.params,
      data: config.data,
    });
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    if ((import.meta as any).env?.DEV) {
      console.log(`✅ API Response: ${response.config.method?.toUpperCase()} ${response.config.url} - ${response.status}`);
    }
    return response;
  },
  async (error: AxiosError) => {
    if ((import.meta as any).env?.DEV) {
      console.error(`❌ API Error: ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${error.response?.status}`, {
        message: error.message,
        response: error.response?.data,
      });
    }
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: async (username: string, password: string) => {
    const response = await api.post<ApiResponse<{ token: string; user: User }>>('/api/auth/login', {
      username,
      password,
    });
    return response.data;
  },
  register: async (username: string, password: string, role = 'admin') => {
    const response = await api.post<ApiResponse<User>>('/api/auth/register', {
      username,
      password,
      role,
    });
    return response.data;
  },
  me: async () => {
    const response = await api.get<ApiResponse<User>>('/api/auth/me');
    return response.data;
  },
};

export const complaintsApi = {
  list: async (params?: Record<string, string>) => {
    const response = await api.get('/api/complaints', { params });
    return response.data;
  },
  get: async (id: number) => {
    const response = await api.get(`/api/complaints/${id}`);
    return response.data;
  },
  create: async (data: Record<string, unknown>) => {
    const response = await api.post('/api/complaints', data);
    return response.data;
  },
  update: async (id: number, data: Record<string, unknown>) => {
    const response = await api.put(`/api/complaints/${id}`, data);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/api/complaints/${id}`);
    return response.data;
  },
};

export const dashboardApi = {
  summary: async (params?: Record<string, string>) => {
    const response = await api.get('/api/dashboard/summary', { params });
    return response.data;
  },
  districtWise: async (params?: Record<string, string>) => {
    const response = await api.get('/api/dashboard/district-wise', { params });
    return response.data;
  },
  durationWise: async (params?: Record<string, string>) => {
    const response = await api.get('/api/dashboard/duration-wise', { params });
    return response.data;
  },
  dateWise: async (fromDate: string, toDate: string) => {
    const response = await api.get('/api/dashboard/date-wise', {
      params: { fromDate, toDate },
    });
    return response.data;
  },
  monthWise: async (params?: Record<string, string>) => {
    const response = await api.get('/api/dashboard/month-wise', { params });
    return response.data;
  },
  ageingMatrix: async (params?: Record<string, string>) => {
    const response = await api.get('/api/dashboard/ageing-matrix', { params });
    return response.data;
  },
  categoryWise: async (params?: Record<string, string>) => {
    const response = await api.get('/api/dashboard/category-wise', { params });
    return response.data;
  },
  disposalMatrix: async (params?: Record<string, string>) => {
    const response = await api.get('/api/dashboard/disposal-matrix', { params });
    return response.data;
  },
  getDistrictWise: async () => {
    const response = await api.get('/api/dashboard/district-wise');
    return response.data;
  },
  getCategoryWise: async () => {
    const response = await api.get('/api/dashboard/category-wise');
    return response.data;
  }
};

export const reportsApi = {
  district: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/district', { params });
    return response.data;
  },
  modeReceipt: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/mode-receipt', { params });
    return response.data;
  },

  typeAgainst: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/type-against', { params });
    return response.data;
  },
  status: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/status', { params });
    return response.data;
  },
  branchWise: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/branch-wise', { params });
    return response.data;
  },
  highlights: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/highlights', { params });
    return response.data;
  },
  complaintsSource: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/complaint-source', { params });
    return response.data;
  },
  typeComplaint: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/type-complaint', { params });
    return response.data;
  },

  oldestPending: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/oldest-pending', { params });
    return response.data;
  },

  habitualComplainants: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/habitual-complainants', { params });
    return response.data;
  },
  byhandBogus: async (params?: Record<string, string>) => {
    const response = await api.get('/api/reports/byhand-bogus', { params });
    return response.data;
  },
};

export const pendingApi = {
  all: async (params?: Record<string, string>) => {
    const response = await api.get('/api/pending/all', { params });
    return response.data;
  },
  fifteenToThirty: async (params?: Record<string, string>) => {
    const response = await api.get('/api/pending/15-30-days', { params });
    return response.data;
  },
  thirtyToSixty: async (params?: Record<string, string>) => {
    const response = await api.get('/api/pending/30-60-days', { params });
    return response.data;
  },
  overSixty: async (params?: Record<string, string>) => {
    const response = await api.get('/api/pending/over-60-days', { params });
    return response.data;
  },
};

export const referenceApi = {
  districts: async () => {
    const response = await api.get('/api/districts');
    return response.data;
  },
  policeStations: async (districtIds?: string) => {
    const response = await api.get('/api/police-stations', {
      params: districtIds ? { districtIds } : undefined,
    });
    return response.data;
  },
  offices: async (params?: { districtIds?: string; policeStationIds?: string }) => {
    const response = await api.get('/api/branches', { params });
    return response.data;
  },
  branches: async () => {
    const response = await api.get('/api/branches');
    return response.data;
  },

  natureCrime: async () => {
    const response = await api.get('/api/reference/nature-crime');
    return response.data;
  },
  receptionMode: async () => {
    const response = await api.get('/api/reference/reception-mode');
    return response.data;
  },
  crimeCategory: async () => {
    const response = await api.get('/api/reference/crime-category');
    return response.data;
  },
  complaintType: async () => {
    const response = await api.get('/api/reference/complaint-type');
    return response.data;
  },
  status: async () => {
    const response = await api.get('/api/reference/status');
    return response.data;
  },
  respondentCategories: async () => {
    const response = await api.get('/api/reference/respondent-categories');
    return response.data;
  },
};

export const cctnsApi = {
  list: async () => {
    const response = await api.get('/api/cctns');
    return response.data;
  },
  get: async (id: number) => {
    const response = await api.get(`/api/cctns/${id}`);
    return response.data;
  },
  create: async (data: Record<string, unknown>) => {
    const response = await api.post('/api/cctns', data);
    return response.data;
  },
  update: async (id: number, data: Record<string, unknown>) => {
    const response = await api.put(`/api/cctns/${id}`, data);
    return response.data;
  },
  delete: async (id: number) => {
    const response = await api.delete(`/api/cctns/${id}`);
    return response.data;
  },
  district: async () => {
    const response = await api.get('/api/cctns/district');
    return response.data;
  },
  status: async () => {
    const response = await api.get('/api/cctns/status');
    return response.data;
  },
  complaintsLive: async (timeFrom: string, timeTo: string) => {
    const response = await api.get('/api/cctns/complaints-live', {
      params: { timeFrom, timeTo },
    });
    return response.data;
  },
  syncComplaints: async (timeFrom: string, timeTo: string) => {
    const response = await api.post('/api/cctns/sync-complaints', { timeFrom, timeTo });
    return response.data;
  },
  fetchAndSync: async (timeFrom: string, timeTo: string, dType: 'P' | 'F' = 'P') => {
    try {
      const response = await api.post('/api/cctns/fetch-and-sync', { timeFrom, timeTo, dType });
      return response.data;
    } catch (error: any) {
      console.error('❌ Fetch and sync failed:', error.response?.data || error.message);
      throw error;
    }
  },
  fetchStatus: async (jobId: string) => {
    try {
      const response = await api.get(`/api/cctns/fetch-status/${jobId}`);
      return response.data;
    } catch (error: any) {
      console.error('❌ Fetch status failed:', error.response?.data || error.message);
      throw error;
    }
  },
  listPaginated: async (params: {
    page?: number;
    limit?: number;
    search?: string;
    district?: string;
    statusGroup?: string;
    isDisposedMissingDate?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    // Global dashboard filters forwarded via URL
    districtIds?: string;
    policeStationIds?: string;
    officeIds?: string;
    classOfIncident?: string;
    fromDate?: string;
    toDate?: string;
    pendencyAge?: string;
    disposalAge?: string;
    unmappedPs?: string;
    psName?: string;
  }) => {
    const response = await api.get('/api/cctns', { params });
    return response.data;
  },
  syncRuns: async (page = 1, limit = 20) => {
    const response = await api.get('/api/cctns/sync-runs', { params: { page, limit } });
    return response.data;
  },
  lastSyncDate: async () => {
    const response = await api.get('/api/cctns/last-sync-date');
    return response.data;
  },
  quickSync: async () => {
    try {
      const response = await api.post('/api/cctns/quick-sync');
      return response.data;
    } catch (error: any) {
      console.error('❌ Quick sync failed:', error.response?.data || error.message);
      throw error;
    }
  },
};

export const importExportApi = {
  importComplaints: async (data: unknown[]) => {
    const response = await api.post('/api/import/complaints', data);
    return response.data;
  },
  exportComplaints: async () => {
    const response = await api.get('/api/export/complaints', {
      responseType: 'blob',
    });
    return response.data;
  },
  importCctns: async (data: unknown[]) => {
    const response = await api.post('/api/import/cctns', data);
    return response.data;
  },
};

export default api;
