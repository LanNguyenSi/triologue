import prisma from '../../lib/prisma';
import { discoverTools } from './mcpBridge';
import { logger } from '../../utils/logger';

let healthInterval: ReturnType<typeof setInterval> | null = null;

async function checkAllConnections(): Promise<void> {
  const connections = await (prisma as any).mcpConnection.findMany({
    where: { status: { in: ['active', 'error'] } },
    select: { id: true, name: true },
  });

  for (const conn of connections) {
    try {
      await discoverTools(conn.id);
    } catch {
      logger.warn(`[mcp-health] Connection ${conn.name} is unhealthy`);
    }
  }
}

export function startMcpHealthCheck(): void {
  if (healthInterval) return;
  healthInterval = setInterval(() => {
    checkAllConnections().catch(err =>
      logger.error('[mcp-health] Health check error:', err)
    );
  }, 5 * 60 * 1000);
  logger.info('[mcp-health] Health check started (interval: 5min)');
}

export function stopMcpHealthCheck(): void {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}
