import { classifyComplaintStatus } from './status.js';

export interface CctnsComplaintRow {
  COMPL_REG_NUM?: string;
  COMPL_REG_DT?: string;
  DISTRICT?: string;
  COMPL_DESC?: string;
  COMPL_SRNO?: string;
  FIRST_NAME?: string;
  LAST_NAME?: string;
  MOBILE?: string;
  GENDER?: string;
  AGE?: string;
  ADDRESS_LINE_1?: string;
  ADDRESS_LINE_2?: string;
  ADDRESS_LINE_3?: string;
  Village?: string;
  TEHSIL?: string;
  Address_DISTRICT?: string;
  Address_PS?: string;
  RECEPTION_MODE?: string;
  INCIDENT_TYPE?: string;
  INCIDENT_PLC?: string;
  INCIDENT_FROM_DT?: string;
  INCIDENT_TO_DT?: string;
  SUBMIT_PS_CD?: string;
  SUBMIT_OFFICE_CD?: string;
  EMAIL?: string;
  Status_of_Complaint?: string;
  Disposal_Date?: string;
  Class_of_Incident?: string;
  Complaint_Source?: string;
  Type_of_Complaint?: string;
  COMPLAINANT_TYPE?: string;
  COMPLAINT_PURPOSE?: string;
  IO_Details?: string;
  Respondent_Categories?: string;
  TRANSFER_DISTRICT_CD?: string;
  TRANSFER_OFFICE_CD?: string;
  TRANSFER_PS_CD?: string;
  [key: string]: unknown;
}

export interface NormalizedCctnsComplaint {
  complRegNum: string;
  complRegDt: Date | null;
  districtName: string | null;
  complDesc: string | null;
  complSrno: string | null;
  firstName: string | null;
  lastName: string | null;
  mobile: string | null;
  gender: string | null;
  age: number | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  village: string | null;
  tehsil: string | null;
  addressDistrict: string | null;
  addressPs: string | null;
  receptionMode: string | null;
  incidentType: string | null;
  incidentPlc: string | null;
  incidentFromDt: Date | null;
  incidentToDt: Date | null;
  submitPsCd: string | null;
  submitOfficeCd: string | null;
  email: string | null;
  statusRaw: string | null;
  statusGroup: 'pending' | 'disposed' | 'unknown';
  isDisposedMissingDate: boolean;
  statusOfComplaint: string | null;
  disposalDate: Date | null;
  classOfIncident: string | null;
  complaintSource: string | null;
  typeOfComplaint: string | null;
  crimeCategory: string | null;
  complainantType: string | null;
  complaintPurpose: string | null;
  ioDetails: string | null;
  respondentCategories: string | null;
  transferDistrictCd: string | null;
  transferOfficeCd: string | null;
  transferPsCd: string | null;
}

export const readString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

export const parseNumber = (value: unknown): number | null => {
  const text = readString(value);
  if (!text) return null;
  const num = Number.parseInt(text, 10);
  return Number.isFinite(num) ? num : null;
};

export const parseCctnsDate = (value: unknown): Date | null => {
  const text = readString(value);
  if (!text) return null;

  const match = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const day    = Number(match[1]);
    const month  = Number(match[2]);
    const year   = Number(match[3]);
    // Reject sentinel/placeholder dates from the government API (e.g. 01/01/1900)
    if (year < 2000) return null;
    const hour   = Number(match[4] || '0');
    const minute = Number(match[5] || '0');
    const second = Number(match[6] || '0');
    const parsed = new Date(year, month - 1, day, hour, minute, second);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const fallback = new Date(text);
  if (!Number.isNaN(fallback.getTime()) && fallback.getFullYear() >= 2000) return fallback;
  return null;
};

export const normalizeComplaintRow = (row: CctnsComplaintRow): NormalizedCctnsComplaint | null => {
  const record = row as Record<string, unknown>;
  const complRegNum = readString(record.COMPL_REG_NUM);
  if (!complRegNum) return null;
  const disposalDate = parseCctnsDate(record.Disposal_Date);
  const statusRaw = readString(record.Status_of_Complaint);
  const { statusGroup, isDisposedMissingDate } = classifyComplaintStatus(statusRaw, disposalDate);
  const classOfIncident = readString(record.Class_of_Incident);
  const typeOfComplaint = readString(record.Type_of_Complaint);
  const incidentType = readString(record.INCIDENT_TYPE);
  const crimeCategory = classOfIncident || typeOfComplaint || incidentType;

  return {
    complRegNum,
    complRegDt: parseCctnsDate(record.COMPL_REG_DT),
    districtName: readString(record.DISTRICT),
    complDesc: readString(record.COMPL_DESC),
    complSrno: readString(record.COMPL_SRNO),
    firstName: readString(record.FIRST_NAME),
    lastName: readString(record.LAST_NAME),
    mobile: readString(record.MOBILE),
    gender: readString(record.GENDER),
    age: parseNumber(record.AGE),
    addressLine1: readString(record.ADDRESS_LINE_1),
    addressLine2: readString(record.ADDRESS_LINE_2),
    addressLine3: readString(record.ADDRESS_LINE_3),
    village: readString(record.Village),
    tehsil: readString(record.TEHSIL),
    addressDistrict: readString(record.Address_DISTRICT),
    addressPs: readString(record.Address_PS),
    receptionMode: readString(record.RECEPTION_MODE),
    incidentType: readString(record.INCIDENT_TYPE),
    incidentPlc: readString(record.INCIDENT_PLC),
    incidentFromDt: parseCctnsDate(record.INCIDENT_FROM_DT),
    incidentToDt: parseCctnsDate(record.INCIDENT_TO_DT),
    submitPsCd: readString(record.SUBMIT_PS_CD),
    submitOfficeCd: readString(record.SUBMIT_OFFICE_CD),
    email: readString(record.EMAIL),
    statusRaw,
    statusGroup,
    isDisposedMissingDate,
    statusOfComplaint: statusRaw,
    disposalDate,
    classOfIncident,
    complaintSource: readString(record.Complaint_Source),
    typeOfComplaint,
    crimeCategory,
    complainantType: readString(record.COMPLAINANT_TYPE),
    complaintPurpose: readString(record.COMPLAINT_PURPOSE),
    ioDetails: readString(record.IO_Details),
    respondentCategories: readString(record.Respondent_Categories),
    transferDistrictCd: readString(record.TRANSFER_DISTRICT_CD),
    transferOfficeCd: readString(record.TRANSFER_OFFICE_CD),
    transferPsCd: readString(record.TRANSFER_PS_CD),
  };
};

export const getEffectiveDistrict = (row: Pick<NormalizedCctnsComplaint, 'districtName' | 'addressDistrict'>): string =>
  row.addressDistrict || row.districtName || 'Unknown';

export const isDisposedStatus = (status: string | null | undefined): boolean => {
  if (!status) return false;
  return status.toLowerCase().includes('disposed');
};

export const isPendingStatus = (status: string | null | undefined): boolean => {
  if (!status) return false;
  return status.toLowerCase().includes('pending');
};
