import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database.js';
import { sendSuccess, sendError, sendUnauthorized } from '../utils/response.js';

interface LoginBody {
  username: string;
  password: string;
}

interface RegisterBody {
  username: string;
  password: string;
  role?: string;
}

export const authRoutes = async (fastify: FastifyInstance) => {
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
    });

    return sendSuccess(reply, {
      token,
      user: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
      },
    });
  });

  fastify.post<{ Body: RegisterBody }>('/auth/register', async (request, reply) => {
    const { username, password, role = 'admin' } = request.body;

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

    await prisma.admin.create({
      data: { username, password: hashedPassword, role },
    });

    return sendSuccess(reply, { username, role }, 'Admin created successfully');
  });

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
      select: { id: true, username: true, role: true },
    });
    return sendSuccess(reply, admin);
  });
};