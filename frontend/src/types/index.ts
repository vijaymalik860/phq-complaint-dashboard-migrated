export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface DashboardSummary {
  totalReceived: number;
  totalDisposed: number;
  totalPending: number;
  pendingOverFifteenDays: number;
  pendingOverOneMonth: number;
  pendingOverTwoMonths: number;
  totalPendingEoNotAssigned?: number;
}

export interface DistrictChartData {
  district: string;
  totalComplaints: number;
  pending: number;
  disposed: number;
}

export interface DurationChartData {
  month: string;
  year: number;
  totalComplaints: number;
  pending: number;
  disposed: number;
}

export interface DateWiseChartData {
  district: string;
  totalComplaints: number;
  pending: number;
  disposed: number;
}

export interface MonthWiseData {
  month: string;
  year: number;
  monthNum: number;
  total: number;
  pending: number;
}

export interface Complaint {
  id: number;
  complRegNum?: string;
  districtId?: number;
  district?: District;
  complDesc?: string;
  complSrno?: string;
  complRegDt?: string;
  firstName?: string;
  lastName?: string;
  mobile?: string;
  gender?: string;
  age?: number;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  village?: string;
  tehsil?: string;
  addressDistrict?: string;
  addressPs?: string;
  receptionMode?: string;
  incidentType?: string;
  incidentPlc?: string;
  incidentFromDt?: string;
  incidentToDt?: string;
  classOfIncident?: string;
  respondentCategories?: string;
  complaintSource?: string;
  typeOfComplaint?: string;
  complainantType?: string;
  complaintPurpose?: string;
  statusOfComplaint?: string;
  disposalDate?: string;
  ioDetails?: string;
  branch?: string;
  firNumber?: string;
  actionTaken?: string;
  createdAt: string;
  updatedAt: string;
}

export interface District {
  id: number;
  name: string;
  code?: string;
}

export interface Office {
  id: number;
  name: string;
  code?: string;
  districtId?: number;
  district?: District;
}

export interface CCTNSComplaint {
  id: number;
  complRegNum?: string;
  districtId?: number;
  district?: District;
  compCategory?: string;
  psrNumber?: string;
  firNumber?: string;
  firDate?: string;
  ActSection?: string;
  accusedName?: string;
  accusedAge?: number;
  accusedAddress?: string;
  victimName?: string;
  incidentDate?: string;
}

export interface User {
  id: number;
  username: string;
  role: string;
  token?: string;
}

export interface ReportRow {
  [key: string]: string | number | Date | null;
}
