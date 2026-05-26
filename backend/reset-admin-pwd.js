const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres:2qIgm5dXVmTehReC@db.wexeyxgadiupmdzuuenx.supabase.co:6543/postgres?pgbouncer=true"
    }
  }
});

async function main() {
  const hashedPassword = await bcrypt.hash('admin123', 10);
  await prisma.admin.upsert({
    where: { username: 'admin' },
    update: { password: hashedPassword },
    create: { username: 'admin', password: hashedPassword, role: 'admin' }
  });
  console.log('Admin password reset to admin123');
  await prisma.$disconnect();
}

main();
