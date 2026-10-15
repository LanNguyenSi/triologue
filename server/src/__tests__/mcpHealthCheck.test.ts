/**
 * Unit tests for server/src/connectors/mcp/mcpHealthCheck.ts.
 *
 * Guards tested:
 *   1. The periodic check selects connections in status pending, active and error.
 *      A freshly seeded connection starts as pending, and only a discovery run
 *      turns it active or error, so a check that skipped pending rows would
 *      never probe it.
 *   2. Every selected connection gets a discovery run, and one failing
 *      connection does not stop the others.
 *
 * Mutation-test intent: dropping 'pending' from the status filter breaks test 1.
 */

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    mcpConnection: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('../connectors/mcp/mcpBridge', () => ({
  discoverTools: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import prisma from '../lib/prisma';
import { discoverTools } from '../connectors/mcp/mcpBridge';
import { startMcpHealthCheck, stopMcpHealthCheck } from '../connectors/mcp/mcpHealthCheck';

const INTERVAL_MS = 5 * 60 * 1000;

describe('mcpHealthCheck', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    stopMcpHealthCheck();
    jest.useRealTimers();
  });

  it('selects pending, active and error connections', async () => {
    (prisma.mcpConnection.findMany as jest.Mock).mockResolvedValue([]);

    startMcpHealthCheck();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(prisma.mcpConnection.findMany).toHaveBeenCalledTimes(1);
    const args = (prisma.mcpConnection.findMany as jest.Mock).mock.calls[0][0];
    expect([...args.where.status.in].sort()).toEqual(['active', 'error', 'pending']);
  });

  it('runs discovery for each selected connection and continues after a failure', async () => {
    (prisma.mcpConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'c-pending', name: 'agent-tasks' },
      { id: 'c-active', name: 'other' },
    ]);
    (discoverTools as jest.Mock).mockRejectedValueOnce(new Error('unreachable')).mockResolvedValueOnce([]);

    startMcpHealthCheck();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(discoverTools).toHaveBeenCalledTimes(2);
    expect(discoverTools).toHaveBeenNthCalledWith(1, 'c-pending');
    expect(discoverTools).toHaveBeenNthCalledWith(2, 'c-active');
  });
});
