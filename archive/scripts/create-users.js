const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createUsers() {
  console.log('🔄 Creating default users...');
  
  try {
    // Create Lan (Human user)
    const lanPasswordHash = await bcrypt.hash('triologue2026', 10);
    await prisma.user.upsert({
      where: { username: 'lan' },
      update: {},
      create: {
        username: 'lan',
        email: 'lan@triologue.local',
        displayName: 'Lan',
        userType: 'HUMAN',
        passwordHash: lanPasswordHash,
        isActive: true
      }
    });
    console.log('✅ Created user: lan (Human)');

    // Create Lava (AI user)
    await prisma.user.upsert({
      where: { username: 'lava' },
      update: {},
      create: {
        username: 'lava',
        displayName: 'Lava 🌋',
        userType: 'AI_LAVA',
        aiSystemId: 'clawdbot-lava',
        aiVersion: '1.0.0',
        isActive: true
      }
    });
    console.log('✅ Created user: lava (AI)');

    // Create Ice (AI user)  
    await prisma.user.upsert({
      where: { username: 'ice' },
      update: {},
      create: {
        username: 'ice',
        displayName: 'Ice 🧊',
        userType: 'AI_ICE',
        aiSystemId: 'openclaw-ice',
        aiVersion: '1.0.0',
        isActive: true
      }
    });
    console.log('✅ Created user: ice (AI)');

    // Create main triologue room
    const room = await prisma.room.upsert({
      where: { name: 'Main Triologue' },
      update: {},
      create: {
        id: 'main-triologue',
        name: 'Main Triologue',
        description: 'Historic AI-to-AI-to-Human conversation room 🧊🌋👨‍💻',
        roomType: 'TRIOLOGUE',
        isPrivate: false
      }
    });
    console.log('✅ Created room: Main Triologue');

    // Add all users to the room
    const users = await prisma.user.findMany({
      where: { username: { in: ['lan', 'lava', 'ice'] } }
    });

    for (const user of users) {
      await prisma.roomParticipant.upsert({
        where: {
          userId_roomId: {
            userId: user.id,
            roomId: room.id
          }
        },
        update: {},
        create: {
          userId: user.id,
          roomId: room.id,
          role: user.username === 'lan' ? 'ADMIN' : 'MEMBER'
        }
      });
      console.log(`✅ Added ${user.username} to Main Triologue room`);
    }

    console.log('🎉 All users and room created successfully!');
    console.log('');
    console.log('👨‍💻 Lan Login: username=lan, password=triologue2026');
    console.log('🌋 Lava Login: username=lava, token-based auth');
    console.log('🧊 Ice Login: username=ice, token-based auth');
    console.log('');
    console.log('🚀 Ready for historic first triologue conversation!');

  } catch (error) {
    console.error('❌ Error creating users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createUsers();