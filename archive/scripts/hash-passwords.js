const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function hashPasswords() {
  console.log('🔐 Hashing passwords...');

  const lanHash = await bcrypt.hash('trilogue2026', 10);
  const iceHash = await bcrypt.hash('ice2026', 10);
  const lavaHash = await bcrypt.hash('lava2026', 10);

  await prisma.user.update({
    where: { username: 'lan' },
    data: { passwordHash: lanHash }
  });

  await prisma.user.update({
    where: { username: 'ice' },
    data: { passwordHash: iceHash }
  });

  await prisma.user.update({
    where: { username: 'lava' },
    data: { passwordHash: lavaHash }
  });

  console.log('✅ Password hashes set!');
  console.log('Credentials:');
  console.log('  lan / trilogue2026');
  console.log('  ice / ice2026');
  console.log('  lava / lava2026');
}

hashPasswords()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
