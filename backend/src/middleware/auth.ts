import { FastifyRequest, FastifyReply } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      id: number;
      username: string;
      role: string;
      districtId?: string | null;
      rangeId?: string | null;
    };
    user: {
      id: number;
      username: string;
      role: string;
      districtId?: string | null;
      rangeId?: string | null;
    };
  }
}

export interface AuthUser {
  id: number;
  username: string;
  role: string;
  districtId?: string | null;
  rangeId?: string | null;
}

export const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({ success: false, error: 'Invalid or expired token' });
  }
};

export const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  await authenticate(request, reply);
  
  const user = request.user as AuthUser | undefined;
  if (user?.role !== 'admin') {
    reply.status(403).send({ success: false, error: 'Admin access required' });
  }
};

export const optionalAuth = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await request.jwtVerify();
  } catch {
    // Continue without authentication
  }
};