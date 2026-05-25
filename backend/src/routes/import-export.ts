import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import * as XLSX from 'xlsx';
import { classifyComplaintStatus } from '../services/status.js';
import { enrichWithMasterIds } from '../services/master-mapping.js';

export const importExportRoutes = async (fastify: FastifyInstance) => {
  fastify.post('/import/complaints', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    try {
      const data = request.body as any[];
      if (!Array.isArray(data) || data.length === 0) {
        return sendError(reply, 'Invalid data format');
      }

      let imported = 0;
      for (const row of data) {
        try {
          const statusRaw = row.STATUS_OF_COMPLAINT || row.Status_of_Complaint || null;
          const disposalDate = row.DISPOSAL_DATE ? new Date(row.DISPOSAL_DATE) : null;
          const { statusGroup, isDisposedMissingDate } = classifyComplaintStatus(statusRaw, disposalDate);
          const classOfIncident = row.CLASS_OF_INCIDENT || row.Class_of_Incident || null;
          const typeOfComplaint = row.TYPE_OF_COMPLAINT || row.Type_of_Complaint || null;
          const incidentType = row.INCIDENT_TYPE || null;
          const mapped = await enrichWithMasterIds({
              complRegNum: row.COMPL_REG_NUM || row.complRegNum,
              districtName: row.DISTRICT || null,
              complDesc: row.COMPL_DESC,
              complSrno: row.COMPL_SRNO,
              complRegDt: row.COMPL_REG_DT ? new Date(row.COMPL_REG_DT) : undefined,
              firstName: row.FIRST_NAME,
              lastName: row.LAST_NAME,
              mobile: row.MOBILE,
              gender: row.GENDER,
              age: row.AGE,
              addressLine1: row.ADDRESS_LINE_1,
              addressLine2: row.ADDRESS_LINE_2,
              addressLine3: row.ADDRESS_LINE_3,
              village: row.VILLAGE,
              tehsil: row.TEHSIL,
              addressDistrict: row.Address_DISTRICT,
              addressPs: row.Address_PS,
              receptionMode: row.RECEPTION_MODE,
              incidentType: row.INCIDENT_TYPE,
              incidentPlc: row.INCIDENT_PLC,
              incidentFromDt: row.INCIDENT_FROM_DT ? new Date(row.INCIDENT_FROM_DT) : undefined,
              incidentToDt: row.INCIDENT_TO_DT ? new Date(row.INCIDENT_TO_DT) : undefined,
              submitPsCd: row.SUBMIT_PS_CD || null,
              submitOfficeCd: row.SUBMIT_OFFICE_CD || null,
              transferPsCd: row.TRANSFER_PS_CD || null,
              transferDistrictCd: row.TRANSFER_DISTRICT_CD || null,
              transferOfficeCd: row.TRANSFER_OFFICE_CD || null,
              email: row.EMAIL || null,
              classOfIncident,
              respondentCategories: row.RESPONDENT_CATEGORIES,
              complaintSource: row.COMPLAINT_SOURCE,
              typeOfComplaint,
              crimeCategory: classOfIncident || typeOfComplaint || incidentType,
              complainantType: row.COMPLAINANT_TYPE,
              complaintPurpose: row.COMPLAINT_PURPOSE,
              statusRaw,
              statusOfComplaint: statusRaw,
              statusGroup,
              isDisposedMissingDate,
              disposalDate: disposalDate || undefined,
              ioDetails: row.IO_DETAILS,
              branch: row.BRANCH,
          });
          await prisma.complaint.create({
            data: mapped,
          });
          imported++;
        } catch (e) {
          console.error('Insert error:', e);
        }
      }

      return sendSuccess(reply, { imported, total: data.length });
    } catch (err: any) {
      return sendError(reply, err.message);
    }
  });

  fastify.get('/export/complaints', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const complaints = await prisma.complaint.findMany({ orderBy: { complRegDt: 'desc' } });

    const worksheet = XLSX.utils.json_to_sheet(complaints);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Complaints');
    
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', 'attachment; filename=complaints.xlsx');
    
    return reply.send(Buffer.from(excelBuffer));
  });
};
