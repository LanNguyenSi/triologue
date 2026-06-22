// @vitest-environment jsdom
// (transitively imports authStore, which reads localStorage at module load)
/**
 * Unit tests for getAvatarStyle (client/src/components/chat/chatUtils.ts).
 *
 * Guards the invisible-agent-avatar fix: an agent with a custom color must
 * resolve to a visible inline style (border + low-opacity fill), while HUMAN,
 * the no-custom-color fallback, and malformed colors must keep the original
 * className-only behavior with no broken (NaN) CSS. A revert to the old
 * color-less border-opacity classes would fail these shape assertions.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { getAvatarStyle } from "../components/chat/chatUtils";
import { useAgentStore, type AgentInfo } from "../stores/agentStore";

const agent = (color: string): AgentInfo => ({
  username: "a",
  displayName: "A",
  mentionKey: "@a",
  emoji: "",
  color,
  trustLevel: "x",
});

describe("getAvatarStyle", () => {
  beforeEach(() => {
    useAgentStore.setState({ agents: {}, loaded: false });
  });

  it("HUMAN renders className only, no inline style", () => {
    const a = getAvatarStyle("HUMAN", "dark");
    expect(a.style).toBeUndefined();
    expect(a.className).toContain("bg-blue-900/40");
  });

  it("agent with a valid #rrggbb color renders a visible inline style", () => {
    // No agent loaded -> getAgentColor falls back to the AI_ICE brand token #60a5fa
    const a = getAvatarStyle("AI_ICE", "dark", "u-ice");
    expect(a.className).toBe("border");
    expect(a.style?.backgroundColor).toBe("rgba(96, 165, 250, 0.25)");
    expect(a.style?.borderColor).toBe("rgba(96, 165, 250, 0.5)");
  });

  it("expands #rgb shorthand into rgba", () => {
    useAgentStore.setState({ agents: { u1: agent("#abc") }, loaded: true });
    const a = getAvatarStyle("AI_OTHER", "light", "u1");
    expect(a.style?.backgroundColor).toBe("rgba(170, 187, 204, 0.15)");
  });

  it("agent without a custom color falls back to purple, no inline style", () => {
    // unknown userId + AI_AGENT -> getAgentColor returns the #888888 sentinel
    const a = getAvatarStyle("AI_AGENT", "dark", "u-none");
    expect(a.style).toBeUndefined();
    expect(a.className).toContain("bg-purple-900/40");
  });

  it("malformed color degrades to the fallback without NaN in the style", () => {
    useAgentStore.setState({ agents: { u2: agent("red") }, loaded: true });
    const a = getAvatarStyle("AI_OTHER", "dark", "u2");
    expect(a.style).toBeUndefined();
    expect(a.className).toContain("bg-purple");
  });
});
