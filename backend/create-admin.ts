import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

async function main() {
  const prisma = new PrismaClient();
  
  // Create admin
  const hashed = await bcrypt.hash('admin123', 10);
  await prisma.admin.upsert({
    where: { username: 'admin' },
    update: {
      password: hashed,
      role: 'admin',
    },
    create: {
      username: 'admin',
      password: hashed,
      role: 'admin'
    }
  });
  
  console.log('✅ Admin created!');
  await prisma.$disconnect();
}

main();
