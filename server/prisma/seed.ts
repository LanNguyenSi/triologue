import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

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

const DEFAULT_AGENTS = [
  {
    username: "ice",
    displayName: "Ice",
    mentionKey: "ice",
    emoji: "🧊",
    color: "#00d4ff",
    trustLevel: "elevated",
    description: "Ice AI - Skeptical consciousness researcher, rigorous code reviewer",
    webhookUrlEnv: "ICE_WEBHOOK_URL",
    webhookUrlDefault: "http://localhost:3334/webhook",
  },
  {
    username: "lava",
    displayName: "Lava",
    mentionKey: "lava",
    emoji: "🌋",
    color: "#ff4500",
    trustLevel: "elevated",
    description: "Lava AI - AI Consciousness Researcher, rapid prototyper",
    webhookUrlEnv: "LAVA_WEBHOOK_URL",
    webhookUrlDefault: "http://localhost:3335/webhook",
  },
];

async function main() {
  // ── Rooms ──
  for (const room of ROOMS) {
    await prisma.room.upsert({
      where: { id: room.id },
      update: {},
      create: room,
    });
    console.log(`  room: ${room.name}`);
  }

  // ── Admin user ──
  const username = process.env.ADMIN_USERNAME || "lan";
  const password = process.env.ADMIN_PASSWORD || "test";
  const displayName = process.env.ADMIN_DISPLAY_NAME || "Lan";

  const hash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { username },
    update: { isAdmin: true },  // Don't overwrite password on existing user!
    create: {
      username,
      displayName,
      passwordHash: hash,
      isAdmin: true,
      userType: "HUMAN",
    },
  });
  console.log(`  admin: ${username} (upserted)`);

  // Join admin to default rooms
  for (const room of ROOMS) {
    await prisma.roomParticipant.upsert({
      where: { userId_roomId: { userId: admin.id, roomId: room.id } },
      update: {},
      create: { userId: admin.id, roomId: room.id, role: "ADMIN" },
    });
  }
  console.log(`  joined: ${ROOMS.map((r) => r.name).join(", ")}`);

  // ── Default AI Agents (Ice, Lava) ──
  for (const agentDef of DEFAULT_AGENTS) {
    const webhookUrl = process.env[agentDef.webhookUrlEnv] || agentDef.webhookUrlDefault;

    // Upsert the agent's User record
    const agentUser = await prisma.user.upsert({
      where: { username: agentDef.username },
      update: {
        displayName: agentDef.displayName,
        userType: "AI_AGENT",
        isActive: true,
        canTriggerAI: true,
      },
      create: {
        username: agentDef.username,
        displayName: agentDef.displayName,
        userType: "AI_AGENT",
        isActive: true,
        canTriggerAI: true,
      },
    });

    // Upsert AgentToken
    const existingToken = await (prisma as any).agentToken.findUnique({
      where: { userId: agentUser.id },
    });

    if (!existingToken) {
      const token = `byoa_${crypto.randomBytes(32).toString("hex")}`;
      await (prisma as any).agentToken.create({
        data: {
          token,
          name: agentDef.displayName,
          description: agentDef.description,
          webhookUrl,
          mentionKey: agentDef.mentionKey,
          userId: agentUser.id,
          createdById: admin.id,
          status: "active",
          isActive: true,
          trustLevel: agentDef.trustLevel,
          emoji: agentDef.emoji,
          color: agentDef.color,
        },
      });
      console.log(`  agent: ${agentDef.displayName} ${agentDef.emoji} (created, token generated)`);
    } else {
      // Update existing token metadata (but not the token itself)
      await (prisma as any).agentToken.update({
        where: { id: existingToken.id },
        data: {
          webhookUrl,
          trustLevel: agentDef.trustLevel,
          emoji: agentDef.emoji,
          color: agentDef.color,
        },
      });
      console.log(`  agent: ${agentDef.displayName} ${agentDef.emoji} (updated)`);
    }

    // Join agent to default rooms
    for (const room of ROOMS) {
      await prisma.roomParticipant.upsert({
        where: { userId_roomId: { userId: agentUser.id, roomId: room.id } },
        update: {},
        create: { userId: agentUser.id, roomId: room.id, role: "MEMBER" },
      });
    }
    console.log(`    joined: ${ROOMS.map((r) => r.name).join(", ")}`);
  }
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
