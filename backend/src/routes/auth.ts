import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { sendSuccess, sendError, sendUnauthorized } from '../utils/response.js';
import { authenticate, AuthUser } from '../middleware/auth.js';

interface LoginBody {
  username: string;
  password: string;
}

interface RegisterBody {
  username: string;
  password: string;
  role?: string;
  districtId?: string;
  rangeId?: string;
}

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

export const authRoutes = async (fastify: FastifyInstance) => {
  // POST /api/auth/login
  fastify.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    const { username, password } = request.body;

    if (!username || !password) {
      return sendError(reply, 'Username and password are required');
    }

    const admin = await prisma.admin.findUnique({
      where: { username },
    });

    if (!admin) {
      return sendError(reply, 'Invalid credentials');
    }

    const isValidPassword = await bcrypt.compare(password, admin.password);

    if (!isValidPassword) {
      return sendError(reply, 'Invalid credentials');
    }

    const token = fastify.jwt.sign({
      id: admin.id,
      username: admin.username,
      role: admin.role,
      districtId: admin.districtId ?? null,
      rangeId: admin.rangeId ?? null,
    });

    return sendSuccess(reply, {
      token,
      user: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        districtId: admin.districtId ?? null,
        rangeId: admin.rangeId ?? null,
      },
    });
  });

  // POST /api/auth/register — create a new user (open, use with care in prod)
  fastify.post<{ Body: RegisterBody }>('/auth/register', async (request, reply) => {
    const { username, password, role = 'admin', districtId, rangeId } = request.body;

    if (!username || !password) {
      return sendError(reply, 'Username and password are required');
    }

    const existing = await prisma.admin.findUnique({
      where: { username },
    });

    if (existing) {
      return sendError(reply, 'Username already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const created = await prisma.admin.create({
      data: {
        username,
        password: hashedPassword,
        role,
        districtId: districtId ?? null,
        rangeId: rangeId ?? null,
      },
    });

    return sendSuccess(reply, {
      id: created.id,
      username: created.username,
      role: created.role,
      districtId: created.districtId,
      rangeId: created.rangeId,
    }, 'User created successfully');
  });

  // GET /api/auth/me
  fastify.get('/auth/me', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return sendUnauthorized(reply);
      }
    },
  }, async (request, reply) => {
    const admin = await prisma.admin.findUnique({
      where: { id: (request.user as any).id },
      select: { id: true, username: true, role: true, districtId: true, rangeId: true },
    });
    return sendSuccess(reply, admin);
  });

  // POST /api/auth/change-password — change own password
  fastify.post<{ Body: ChangePasswordBody }>('/auth/change-password', {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const user = request.user as AuthUser;
    const { currentPassword, newPassword } = request.body;

    if (!currentPassword || !newPassword) {
      return sendError(reply, 'Current password and new password are required');
    }

    if (newPassword.length < 6) {
      return sendError(reply, 'New password must be at least 6 characters');
    }

    const admin = await prisma.admin.findUnique({ where: { id: user.id } });
    if (!admin) return sendError(reply, 'User not found');

    const isValid = await bcrypt.compare(currentPassword, admin.password);
    if (!isValid) return sendError(reply, 'Current password is incorrect');

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.admin.update({ where: { id: user.id }, data: { password: hashed } });

    return sendSuccess(reply, {}, 'Password changed successfully');
  });
};