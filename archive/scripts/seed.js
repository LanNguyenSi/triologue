const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding database...');

  // Create users
  const lan = await prisma.user.upsert({
    where: { username: 'lan' },
    update: {},
    create: {
      id: 'user-lan',
      username: 'lan',
      displayName: 'Lan 👨‍💻',
      email: 'lan@example.com',
      userType: 'HUMAN',
      isActive: true
    }
  });

  const ice = await prisma.user.upsert({
    where: { username: 'ice' },
    update: {},
    create: {
      id: 'user-ice',
      username: 'ice',
      displayName: 'Ice 🧊',
      email: 'ice@ai.example.com',
      userType: 'AI_ICE',
      aiSystemId: 'ice-openclaw',
      aiVersion: '1.0.0',
      isActive: true
    }
  });

  const lava = await prisma.user.upsert({
    where: { username: 'lava' },
    update: {},
    create: {
      id: 'user-lava',
      username: 'lava',
      displayName: 'Lava 🌋',
      email: 'lava@ai.example.com',
      userType: 'AI_LAVA',
      aiSystemId: 'lavaclawdbot',
      aiVersion: '1.0.0',
      isActive: true
    }
  });

  // Create Main Triologue room
  const room = await prisma.room.upsert({
    where: { id: 'room-main' },
    update: {},
    create: {
      id: 'room-main',
      name: 'Main Triologue',
      description: 'Ice • Lava • Lan',
      roomType: 'TRIOLOGUE',
      isPrivate: false
    }
  });

  // Add participants
  for (const userId of [lan.id, ice.id, lava.id]) {
    await prisma.roomParticipant.upsert({
      where: {
        userId_roomId: {
          userId: userId,
          roomId: room.id
        }
      },
      update: {},
      create: {
        userId: userId,
        roomId: room.id
      }
    });
  }

  console.log('✅ Database seeded successfully!');
  console.log('Users created:', lan.username, ice.username, lava.username);
  console.log('Room created:', room.name);
}

seed()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
