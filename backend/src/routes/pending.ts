import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database.js';
import { sendSuccess } from '../utils/response.js';
import { authenticate } from '../middleware/auth.js';
import { buildPrismaWhereClause } from '../utils/filters.js';
import { getDistrictNameByIdMap } from '../services/master-mapping.js';

// Only the fields the Pending page actually renders — avoids transferring heavy
// text columns like complDesc, ioDetails, respondentCategories, etc.
const PENDING_SELECT = {
  id:              true,
  complRegNum:     true,
  complRegDt:      true,
  firstName:       true,
  lastName:        true,
  mobile:          true,
  addressDistrict: true,
  districtName:    true,
  branch:          true,
  statusGroup:     true,
  statusOfComplaint: true,
  districtMasterId: true,
} as const;

export const pendingRoutes = async (fastify: FastifyInstance) => {
  const handlePaginatedRequest = async (request: any, reply: any, baseWhere: any) => {
    const { page = '1', limit = '50', search = '' } = request.query;
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50000, Math.max(1, parseInt(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    let searchWhere = {};
    if (search) {
      searchWhere = {
        OR: [
          { firstName:   { contains: search, mode: 'insensitive' as const } },
          { lastName:    { contains: search, mode: 'insensitive' as const } },
          { mobile:      { contains: search, mode: 'insensitive' as const } },
          { complRegNum: { contains: search, mode: 'insensitive' as const } },
        ],
      };
    }
    const where = { ...baseWhere, ...searchWhere };

    const [complaints, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        select: PENDING_SELECT,
        orderBy: { complRegDt: 'asc' },
        skip,
        take: limitNum,
      }),
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
  };

  fastify.get('/pending/all', { preHandler: [authenticate] }, async (request, reply) => {
    const where = { ...buildPrismaWhereClause(request.query as any), statusGroup: 'pending' as const };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/under-7-days', { preHandler: [authenticate] }, async (request, reply) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const where = {
      ...buildPrismaWhereClause(request.query as any),
      statusGroup: 'pending' as const,
      complRegDt: { gt: sevenDaysAgo },
    };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/missing', { preHandler: [authenticate] }, async (request, reply) => {
    const where = {
      ...buildPrismaWhereClause(request.query as any),
      statusGroup: 'pending' as const,
      complRegDt: null,
    };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/7-15-days', { preHandler: [authenticate] }, async (request, reply) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo  = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const where = {
      ...buildPrismaWhereClause(request.query as any),
      statusGroup: 'pending' as const,
      complRegDt: { lte: sevenDaysAgo, gt: fifteenDaysAgo },
    };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/15-30-days', { preHandler: [authenticate] }, async (request, reply) => {
    const now = new Date();
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const where = {
      ...buildPrismaWhereClause(request.query as any),
      statusGroup: 'pending' as const,
      complRegDt: { lte: fifteenDaysAgo, gt: thirtyDaysAgo },
    };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/30-60-days', { preHandler: [authenticate] }, async (request, reply) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const where = {
      ...buildPrismaWhereClause(request.query as any),
      statusGroup: 'pending' as const,
      complRegDt: { lte: thirtyDaysAgo, gt: sixtyDaysAgo },
    };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/over-60-days', { preHandler: [authenticate] }, async (request, reply) => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const where = {
      ...buildPrismaWhereClause(request.query as any),
      statusGroup: 'pending' as const,
      complRegDt: { lte: sixtyDaysAgo },
    };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/branch/:branch', { preHandler: [authenticate] }, async (request, reply) => {
    const { branch } = request.params as { branch: string };
    const where = { ...buildPrismaWhereClause(request.query as any), branch, statusGroup: 'pending' as const };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/branch/:branch/missing', { preHandler: [authenticate] }, async (request, reply) => {
    const { branch } = request.params as { branch: string };
    const where = { ...buildPrismaWhereClause(request.query as any), branch, statusGroup: 'pending' as const, complRegDt: null };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/branch/:branch/under-7-days', { preHandler: [authenticate] }, async (request, reply) => {
    const { branch } = request.params as { branch: string };
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const where = { ...buildPrismaWhereClause(request.query as any), branch, statusGroup: 'pending' as const, complRegDt: { gt: sevenDaysAgo } };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/branch/:branch/7-15-days', { preHandler: [authenticate] }, async (request, reply) => {
    const { branch } = request.params as { branch: string };
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fifteenDaysAgo  = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const where = { ...buildPrismaWhereClause(request.query as any), branch, statusGroup: 'pending' as const, complRegDt: { lte: sevenDaysAgo, gt: fifteenDaysAgo } };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/branch/:branch/15-30-days', { preHandler: [authenticate] }, async (request, reply) => {
    const { branch } = request.params as { branch: string };
    const now = new Date();
    const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo  = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const where = { ...buildPrismaWhereClause(request.query as any), branch, statusGroup: 'pending' as const, complRegDt: { lte: fifteenDaysAgo, gt: thirtyDaysAgo } };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/branch/:branch/30-60-days', { preHandler: [authenticate] }, async (request, reply) => {
    const { branch } = request.params as { branch: string };
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo  = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const where = { ...buildPrismaWhereClause(request.query as any), branch, statusGroup: 'pending' as const, complRegDt: { lte: thirtyDaysAgo, gt: sixtyDaysAgo } };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/branch/:branch/over-60-days', { preHandler: [authenticate] }, async (request, reply) => {
    const { branch } = request.params as { branch: string };
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const where = { ...buildPrismaWhereClause(request.query as any), branch, statusGroup: 'pending' as const, complRegDt: { lte: sixtyDaysAgo } };
    return handlePaginatedRequest(request, reply, where);
  });

  fastify.get('/pending/branches', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const complaints = await prisma.complaint.findMany({
      where: { branch: { not: '' } },
      select: { branch: true },
      distinct: ['branch'],
    });
    const branches = complaints.map(c => c.branch).filter(Boolean);
    return sendSuccess(reply, branches);
  });
};
