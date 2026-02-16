// Quick password setter for Triologue users
// Run: node set-passwords.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setPasswords() {
  console.log('🔐 Setting user passwords...');

  // For now, use authTokens instead of password hashes (simpler for this quick fix)
  // In production, you'd use bcrypt here
  
  await prisma.user.update({
    where: { username: 'lan' },
    data: { authToken: 'trilogue2026' }
  });

  await prisma.user.update({
    where: { username: 'ice' },
    data: { authToken: 'ice2026' }
  });

  await prisma.user.update({
    where: { username: 'lava' },
    data: { authToken: 'lava2026' }
  });

  console.log('✅ Passwords set! (using authToken for now)');
  console.log('Credentials:');
  console.log('  lan / trilogue2026');
  console.log('  ice / ice2026');
  console.log('  lava / lava2026');
}

setPasswords()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
