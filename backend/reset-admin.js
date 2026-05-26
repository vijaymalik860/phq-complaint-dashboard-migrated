const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Checking Admin users...');
  const admins = await prisma.admin.findMany();
  console.log('Found admins:', admins.length);

  for (const admin of admins) {
    console.log(`- ${admin.username} (Role: ${admin.role})`);
  }

  // Create or update default admin
  const username = 'admin';
  const password = 'password123'; // Default password
  
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const existingAdmin = await prisma.admin.findUnique({ where: { username } });
  
  if (existingAdmin) {
    console.log(`Updating password for ${username}...`);
    await prisma.admin.update({
      where: { username },
      data: { password: hashedPassword }
    });
    console.log(`Password updated. Try logging in with ${username} / ${password}`);
  } else {
    console.log(`Creating new admin ${username}...`);
    await prisma.admin.create({
      data: {
        username,
        password: hashedPassword,
        role: 'admin'
      }
    });
    console.log(`Admin created. Try logging in with ${username} / ${password}`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
