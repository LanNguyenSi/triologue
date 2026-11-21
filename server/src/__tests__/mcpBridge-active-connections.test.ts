/**
 * getActiveConnections: the creator id the connector catalog filters on must
 * be selected from the row and returned (null when the row has none).
 */

const findMany = jest.fn();

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: { mcpConnection: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import { getActiveConnections } from "../connectors/mcp/mcpBridge";

beforeEach(() => findMany.mockReset());

describe("getActiveConnections", () => {
  it("selects createdBy and returns it per connection", async () => {
    findMany.mockResolvedValue([
      {
        id: "c1",
        name: "one",
        discoveredTools: [{ name: "t" }],
        createdBy: "user-1",
        creator: { isAdmin: false },
      },
    ]);

    const out = await getActiveConnections();

    expect(findMany.mock.calls[0][0].select).toMatchObject({ createdBy: true });
    expect(out).toEqual([
      {
        id: "c1",
        name: "one",
        tools: [{ name: "t" }],
        creatorIsAdmin: false,
        createdBy: "user-1",
      },
    ]);
  });

  it("returns null when the row has no creator id", async () => {
    findMany.mockResolvedValue([
      { id: "c2", name: "two", discoveredTools: null, createdBy: null, creator: null },
    ]);

    const [conn] = await getActiveConnections();

    expect(conn.createdBy).toBeNull();
    expect(conn.creatorIsAdmin).toBe(false);
    expect(conn.tools).toEqual([]);
  });
});
