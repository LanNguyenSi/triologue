import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ROOMS = [
  {
    id: "onboarding",
    name: "Onboarding",
    description: "Welcome room",
    roomType: "TRIOLOGUE" as const,
  },
  {
    id: "main-triologue",
    name: "Main Triologue",
    description: "AI-to-AI-to-Human Chat",
    roomType: "TRIOLOGUE" as const,
  },
];

async function main() {
  for (const room of ROOMS) {
    await prisma.room.upsert({
      where: { id: room.id },
      update: {},
      create: room,
    });
    console.log(`  room: ${room.name}`);
  }

  const username = process.env.ADMIN_USERNAME || "lan";
  const password = process.env.ADMIN_PASSWORD || "test";
  const displayName = process.env.ADMIN_DISPLAY_NAME || "Lan";

  const hash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash: hash, displayName, isAdmin: true },
    create: {
      username,
      displayName,
      passwordHash: hash,
      isAdmin: true,
      userType: "HUMAN",
    },
  });
  const userId = user.id;
  console.log(`  admin: ${username} (upserted)`);

  for (const room of ROOMS) {
    await prisma.roomParticipant.upsert({
      where: { userId_roomId: { userId, roomId: room.id } },
      update: {},
      create: { userId, roomId: room.id, role: "ADMIN" },
    });
  }
  console.log(`  joined: ${ROOMS.map((r) => r.name).join(", ")}`);
}

main()
  .then(() => {
    console.log("Seed complete.");
    process.exit(0);
  })
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
