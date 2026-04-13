/**
 * Live integration test for the agent-tasks MCP endpoint.
 *
 * Skipped by default. Set `AGENT_TASKS_MCP_TEST_URL` and
 * `AGENT_TASKS_MCP_TEST_TOKEN` in the environment to run it
 * against a live `/api/mcp` instance (staging or local). The test
 * issues two real JSON-RPC POSTs:
 *
 *   1. `tools/list` — expects exactly the 12 agent-tasks tool
 *       names.
 *   2. `tools/call` for `projects_list` — expects success and a
 *      `projects` array in the parsed payload.
 *
 * This is the smoke proof that the existing triologue mcpBridge
 * surface (HTTP POST + Bearer auth) actually reaches and invokes
 * the new endpoint without any code change to `mcpBridge.ts`.
 */

const liveUrl = process.env.AGENT_TASKS_MCP_TEST_URL;
const liveToken = process.env.AGENT_TASKS_MCP_TEST_TOKEN;
const enabled = Boolean(liveUrl && liveToken);

const EXPECTED_TOOLS = [
  "projects_list",
  "signals_ack",
  "signals_poll",
  "tasks_claim",
  "tasks_comment",
  "tasks_create",
  "tasks_get",
  "tasks_instructions",
  "tasks_list",
  "tasks_release",
  "tasks_transition",
  "tasks_update",
];

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: T;
  error?: { code: number; message: string };
}

async function jsonRpc<T>(
  url: string,
  token: string,
  body: { id: number; method: string; params?: unknown },
): Promise<JsonRpcResponse<T>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  const raw = await res.text();
  // Streamable HTTP may answer with an SSE-framed body. Strip the
  // `data: ` prefix when present.
  const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(dataLine ? dataLine.slice(6) : raw) as JsonRpcResponse<T>;
}

const describeOrSkip = enabled ? describe : describe.skip;

describeOrSkip("agent-tasks MCP — live integration (gated)", () => {
  it("tools/list returns exactly the 12 agent-tasks tools", async () => {
    const res = await jsonRpc<{
      tools: Array<{ name: string }>;
    }>(liveUrl!, liveToken!, { id: 1, method: "tools/list" });
    expect(res.error).toBeUndefined();
    const names = (res.result?.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("tools/call projects_list returns success with a projects array", async () => {
    const res = await jsonRpc<{
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    }>(liveUrl!, liveToken!, {
      id: 2,
      method: "tools/call",
      params: { name: "projects_list", arguments: {} },
    });
    expect(res.error).toBeUndefined();
    expect(res.result?.isError).not.toBe(true);
    const text = res.result?.content?.[0]?.text;
    expect(text).toBeTruthy();
    const parsed = JSON.parse(text!);
    expect(parsed).toHaveProperty("projects");
    expect(Array.isArray(parsed.projects)).toBe(true);
  });
});
