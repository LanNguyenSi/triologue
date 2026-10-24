// Load .env from the working directory first (`npm run db:seed` runs in
// server/, next to server/.env). Variables already set in the environment win
// over the file. It must stay the first import: the Prisma client and the
// imports below read process.env when they load.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import {
  upsertAgentTasksMcpConnection,
  type McpConnectionClient,
} from "../src/connectors/mcp/agentTasksSeed";
import { decideAdminPasswordAction } from "../src/utils/env-validation";

const prisma = new PrismaClient();

const ROOMS = [
  {
    id: "onboarding",
    name: "Onboarding",
    description: "Welcome room",
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
  // The password is only used to create the admin, so check it against whether
  // the admin exists: refuse (before any write) when the user would be created
  // with an unset, example or short password, warn when an existing admin
  // still has a weak one configured. The messages never contain the value.
  const username = process.env.ADMIN_USERNAME || "lan";
  const existingAdmin = await prisma.user.findUnique({ where: { username } });
  const adminPassword = decideAdminPasswordAction(process.env, existingAdmin !== null);
  if (adminPassword.action === "refuse") {
    throw new Error(adminPassword.message);
  }
  if (adminPassword.action === "warn") {
    console.warn(`  warning: ${adminPassword.message}`);
  }

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
  const displayName = process.env.ADMIN_DISPLAY_NAME || "Lan";

  // An existing user is only flagged as admin; a hash is needed (and the
  // password checked above) only when the user is created.
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { username },
        data: { isAdmin: true },  // Don't overwrite password on existing user!
      })
    : await prisma.user.upsert({
        where: { username },
        update: { isAdmin: true },
        create: {
          username,
          displayName,
          passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD as string, 12),
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
  .then(async () => {
    // Run after the main seed so the admin user already exists.
    // Re-fetch admin id by username to avoid a top-level mutable
    // closure — keeps the helper above pure for the unit test.
    const adminUsername = process.env.ADMIN_USERNAME || "lan";
    const admin = await prisma.user.findUnique({
      where: { username: adminUsername },
    });
    if (admin) {
      const result = await upsertAgentTasksMcpConnection(
        prisma as unknown as McpConnectionClient,
        process.env,
        admin.id,
      );
      if (result.kind === "skipped") {
        console.log(`  mcp connection: skipped (${result.reason})`);
      } else {
        console.log(`  mcp connection: agent-tasks (${result.kind}) → ${result.url}`);
      }
    }
    console.log("Seed complete.");
    process.exit(0);
  })
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
