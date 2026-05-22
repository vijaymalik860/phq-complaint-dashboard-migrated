import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database.js';
import { sendSuccess, sendError, sendNotFound } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import { classifyComplaintStatus } from '../services/status.js';
import { enrichWithMasterIds, getDistrictNameByIdMap } from '../services/master-mapping.js';
import { buildPrismaWhereClause } from '../utils/filters.js';

export const complaintRoutes = async (fastify: FastifyInstance) => {
  const toBigInt = (value: unknown): bigint | null => {
    const raw = String(value ?? '').trim();
    if (!raw || !/^-?\d+$/.test(raw)) return null;
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  };

  const enrichLocationFields = async (input: Record<string, any>): Promise<Record<string, any>> => {
    const { districtId, policeStationId, officeId, ...rest } = input;
    const normalized: Record<string, any> = { ...rest };
    const districtMasterId = toBigInt(districtId);
    const policeStationMasterId = toBigInt(policeStationId);
    const officeMasterId = toBigInt(officeId);

    if (!normalized.districtName && districtId) {
      const district = await prisma.district.findUnique({ where: { id: toBigInt(districtId) ?? BigInt(-1) } });
      if (district) normalized.districtName = district.name;
    }

    if (!normalized.addressPs && policeStationId) {
      const station = await prisma.policeStation.findUnique({ where: { id: toBigInt(policeStationId) ?? BigInt(-1) } });
      if (station) normalized.addressPs = station.name;
    }

    return enrichWithMasterIds({
      ...normalized,
      districtMasterId,
      policeStationMasterId,
      officeMasterId,
    }) as Promise<Record<string, any>>;
  };

  fastify.get('/complaints', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { page = '1', limit = '10', search = '' } = request.query as Record<string, string>;
    
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50000, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Merge global filter (district, station, office, classOfIncident, dates) with search
    const globalWhere = buildPrismaWhereClause(request.query);
    const searchWhere = search ? {
      OR: [
        { firstName:   { contains: search, mode: 'insensitive' as const } },
        { lastName:    { contains: search, mode: 'insensitive' as const } },
        { mobile:      { contains: search, mode: 'insensitive' as const } },
        { complRegNum: { contains: search, mode: 'insensitive' as const } },
        { complDesc:   { contains: search, mode: 'insensitive' as const } },
      ],
    } : {};
    const where: any = { ...globalWhere, ...searchWhere };

    const COMPLAINT_SELECT = {
      id: true,
      complRegNum: true,
      districtName: true,
      addressDistrict: true,
      firstName: true,
      lastName: true,
      mobile: true,
      complRegDt: true,
      statusOfComplaint: true,
      districtMasterId: true,
    } as const;

    const [complaints, total] = await Promise.all([
      prisma.complaint.findMany({ where, skip, take: limitNum, orderBy: { id: 'desc' }, select: COMPLAINT_SELECT }),
      prisma.complaint.count({ where }),
    ]);

    const districtMap = await getDistrictNameByIdMap();
    const enrichedComplaints = complaints.map(c => {
      let resolvedDistrictName = c.districtName;
      if (c.districtMasterId) {
        resolvedDistrictName = districtMap.get(c.districtMasterId.toString()) || resolvedDistrictName;
      }
      return {
        ...c,
        districtMasterId: c.districtMasterId?.toString(),
        districtName: resolvedDistrictName || c.addressDistrict || '-',
      };
    });

    return sendSuccess(reply, {
      data: enrichedComplaints,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  });

  fastify.get('/complaints/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    
    const complaintId = parseInt(id);
    if (isNaN(complaintId)) {
      return sendError(reply, 'Invalid complaint ID', 400);
    }
    
    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
    });

    if (!complaint) {
      return sendNotFound(reply, 'Complaint not found');
    }

    const enriched = { ...complaint } as any;
    if (complaint.districtMasterId) {
      const district = await prisma.district.findUnique({ where: { id: complaint.districtMasterId } });
      if (district) {
        enriched.districtName = district.name;
      }
    }

    return sendSuccess(reply, enriched);
  });

  fastify.post('/complaints', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const data = await enrichLocationFields(request.body as Record<string, any>);
    if (!data.complRegNum) {
      return sendError(reply, 'complRegNum is required', 400);
    }
    const disposalDate = data.disposalDate ? new Date(data.disposalDate) : null;
    const statusRaw = data.statusRaw || data.statusOfComplaint || null;
    const { statusGroup, isDisposedMissingDate } = classifyComplaintStatus(statusRaw, disposalDate);

    const result = await prisma.complaint.create({
      data: {
        ...data,
        complRegNum: String(data.complRegNum),
        statusRaw,
        statusOfComplaint: data.statusOfComplaint || statusRaw,
        disposalDate,
        statusGroup,
        isDisposedMissingDate,
      },
    });

    return sendSuccess(reply, { id: result.id }, 'Complaint created successfully');
  });

  fastify.put('/complaints/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as Record<string, string>;
    const data = await enrichLocationFields(request.body as Record<string, any>);

    const complaintId = parseInt(id);
    if (isNaN(complaintId)) {
      return sendError(reply, 'Invalid complaint ID', 400);
    }

    const existing = await prisma.complaint.findUnique({
      where: { id: complaintId },
    });

    if (!existing) {
      return sendNotFound(reply, 'Complaint not found');
    }

    const disposalDate = data.disposalDate ? new Date(data.disposalDate) : null;
    const statusRaw = data.statusRaw || data.statusOfComplaint || existing.statusRaw || null;
    const { statusGroup, isDisposedMissingDate } = classifyComplaintStatus(statusRaw, disposalDate);

    await prisma.complaint.update({
      where: { id: complaintId },
      data: {
        ...data,
        complRegNum: data.complRegNum ? String(data.complRegNum) : existing.complRegNum,
        statusRaw,
        statusOfComplaint: data.statusOfComplaint || statusRaw,
        disposalDate,
        statusGroup,
        isDisposedMissingDate,
      },
    });

    return sendSuccess(reply, null, 'Complaint updated successfully');
  });

  fastify.delete('/complaints/:id', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { id } = request.params as Record<string, string>;

    const complaintId = parseInt(id);
    if (isNaN(complaintId)) {
      return sendError(reply, 'Invalid complaint ID', 400);
    }

    const existing = await prisma.complaint.findUnique({
      where: { id: complaintId },
    });

    if (!existing) {
      return sendNotFound(reply, 'Complaint not found');
    }

    await prisma.complaint.delete({
      where: { id: complaintId },
    });

    return sendSuccess(reply, null, 'Complaint deleted successfully');
  });
};
