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
  // Create-only: everything here (user, token, room memberships) is written
  // only when the agent's user does not exist yet. An existing agent user is
  // left exactly as the admin manages it: no write of isActive, canTriggerAI,
  // userType or displayName, nothing on its token (webhookUrl, trustLevel,
  // status and isActive included; every one of them is settable through the
  // admin UI, e.g. PATCH /api/agents/:id sets webhookUrl and isActive), and
  // removed room memberships are not re-added. The single exception is an
  // existing user whose token row is missing: there is nothing to preserve,
  // so the token is created (without re-adding room memberships), but only for
  // a user whose userType is AI_AGENT; an existing non-agent user is skipped.
  const createAgentToken = async (
    agentDef: (typeof DEFAULT_AGENTS)[number],
    userId: string,
    webhookUrl: string,
  ) => {
    const token = `byoa_${crypto.randomBytes(32).toString("hex")}`;
    await (prisma as any).agentToken.create({
      data: {
        token,
        name: agentDef.displayName,
        description: agentDef.description,
        webhookUrl,
        mentionKey: agentDef.mentionKey,
        userId,
        createdById: admin.id,
        status: "active",
        isActive: true,
        trustLevel: agentDef.trustLevel,
        emoji: agentDef.emoji,
        color: agentDef.color,
      },
    });
  };

  for (const agentDef of DEFAULT_AGENTS) {
    const webhookUrl = process.env[agentDef.webhookUrlEnv] || agentDef.webhookUrlDefault;

    const existingAgentUser = await prisma.user.findUnique({
      where: { username: agentDef.username },
    });

    if (existingAgentUser) {
      // A user that merely carries an agent's username (a HUMAN account) must
      // never receive an agent token: skip it, write nothing, log no secret.
      // Only AI_AGENT counts as an agent; legacy AI_ICE/AI_LAVA/AI_OTHER rows
      // were backfilled to AI_AGENT by migration 20260223_backfill_ai_agent_user_type.
      if (existingAgentUser.userType !== "AI_AGENT") {
        console.log(
          `  agent: ${agentDef.displayName} ${agentDef.emoji} (user "${agentDef.username}" exists but is not an agent, skipped)`,
        );
        continue;
      }
      const existingToken = await (prisma as any).agentToken.findUnique({
        where: { userId: existingAgentUser.id },
      });
      if (existingToken) {
        console.log(`  agent: ${agentDef.displayName} ${agentDef.emoji} (exists, left unchanged)`);
      } else {
        await createAgentToken(agentDef, existingAgentUser.id, webhookUrl);
        console.log(`  agent: ${agentDef.displayName} ${agentDef.emoji} (exists, token created)`);
      }
      continue;
    }

    const agentUser = await prisma.user.create({
      data: {
        username: agentDef.username,
        displayName: agentDef.displayName,
        userType: "AI_AGENT",
        isActive: true,
        canTriggerAI: true,
      },
    });

    await createAgentToken(agentDef, agentUser.id, webhookUrl);
    console.log(`  agent: ${agentDef.displayName} ${agentDef.emoji} (created, token generated)`);

    // Join agent to default rooms: only in the run that created the user.
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
