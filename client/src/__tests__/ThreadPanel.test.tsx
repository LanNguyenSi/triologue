// @vitest-environment jsdom
/**
 * Thread panel, end to end on the client: "Reply in thread" from a message,
 * the title step, the reply box payload, live replies through the socket
 * handler, the threads list, and resolve/reopen with the server's refusal.
 * Real stores and components; the network is the mocked apiClient and the
 * socket is a fake whose handlers the test calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";

const apiClient = vi.hoisted(() => vi.fn());
const sockets = vi.hoisted(() => {
  const handlers: Record<string, (payload: unknown) => void> = {};
  const socket = {
    connected: true,
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler;
    },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return { handlers, socket };
});
vi.mock("../lib/apiClient", () => ({ apiClient }));
vi.mock("socket.io-client", () => ({ io: () => sockets.socket }));

import { ThemeProvider } from "../contexts/ThemeContext";
import { LanguageProvider } from "../contexts/LanguageContext";
import { MessageItem } from "../components/chat/MessageItem";
import { ThreadSidebar } from "../components/chat/ThreadSidebar";
import { useThreadStore } from "../stores/threadStore";
import { useSocketStore } from "../stores/socketStore";
import { useChatStore } from "../stores/chatStore";
import { useAuthStore } from "../stores/authStore";
import { agent, human, jsonResponse, makeMessage, makeThread, ROOM_ID } from "./helpers/threadFixtures";

const user = {
  ...human,
  isActive: true,
  lastSeen: "2026-11-07T10:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  userType: "HUMAN" as const,
};

const root = makeMessage({
  id: "m1",
  content: "Release branch is green\nsecond line",
  sender: agent,
});

function Harness({ isMobile = false }: { isMobile?: boolean }) {
  const view = useThreadStore((s) => s.view);
  const { replyInThread, openList } = useThreadStore.getState();
  return (
    <>
      <button onClick={openList}>open-list</button>
      <MessageItem message={root} isGrouped={false} canPin={false} onReplyInThread={replyInThread} />
      {view !== "closed" && <ThreadSidebar isMobile={isMobile} />}
    </>
  );
}

const mount = (props: { isMobile?: boolean } = {}) =>
  render(
    <ThemeProvider>
      <LanguageProvider>
        <Harness {...props} />
      </LanguageProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  localStorage.setItem("triologue_language", "en");
  localStorage.setItem("triologue_theme", "dark");
  apiClient.mockReset();
  apiClient.mockResolvedValue(jsonResponse([]));
  sockets.socket.emit.mockReset();
  sockets.socket.connected = true;
  useAuthStore.setState({ token: "t", user });
  useSocketStore.setState({ socket: null, isConnected: false });
  useSocketStore.getState().connect();
  useChatStore.setState({
    messages: [root as never],
    currentRoomId: ROOM_ID,
    currentRoom: { id: ROOM_ID, name: "Main", roomType: "TRIOLOGUE", role: "MEMBER", canSendMessages: true },
  });
  useThreadStore.setState({ roomId: null });
  useThreadStore.getState().setRoom(ROOM_ID);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("open from a message", () => {
  it("opens the title step with the title prefilled from the message, then the thread", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reply in thread" }));

    expect(screen.getByRole("heading", { name: "New thread" })).toBeTruthy();
    const title = screen.getByLabelText("Thread title") as HTMLInputElement;
    expect(title.value).toBe("Release branch is green");

    fireEvent.change(title, { target: { value: "Release status" } });
    apiClient
      .mockResolvedValueOnce(
        jsonResponse(makeThread({ id: "t1", title: "Release status", rootMessageId: "m1" }), 201),
      )
      .mockResolvedValueOnce(jsonResponse([]));
    fireEvent.click(screen.getByRole("button", { name: "Start thread" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Release status" })).toBeTruthy(),
    );
    const [path, init] = apiClient.mock.calls[0];
    expect(path).toBe(`/api/rooms/${ROOM_ID}/threads`);
    expect(JSON.parse(init.body)).toEqual({ title: "Release status", rootMessageId: "m1" });
    expect(screen.getByText("No replies yet.")).toBeTruthy();
  });

  it("opens the existing thread of a message that already roots one", async () => {
    useThreadStore.setState({
      threads: [makeThread({ id: "t1", title: "Already here", rootMessageId: "m1" })],
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reply in thread" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Already here" })).toBeTruthy());
    expect(screen.queryByLabelText("Thread title")).toBeNull();
  });

  it("shows the server's failure and keeps the title step", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reply in thread" }));
    apiClient
      .mockResolvedValueOnce(jsonResponse({ error: "no" }, 500))
      .mockResolvedValueOnce(jsonResponse([]));
    fireEvent.click(screen.getByRole("button", { name: "Start thread" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not create the thread."));
    expect(screen.getByRole("heading", { name: "New thread" })).toBeTruthy();
  });
});

describe("reply box", () => {
  beforeEach(() => {
    useThreadStore.setState({
      threads: [makeThread({ id: "t1", title: "Release status", rootMessageId: "m1" })],
      view: "thread",
      activeThreadId: "t1",
    });
  });

  it("sends the reply over the socket with the thread id and clears the box", () => {
    mount();
    const box = screen.getByLabelText("Reply to the thread") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "  on it  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(sockets.socket.emit).toHaveBeenCalledWith("message:send", {
      roomId: ROOM_ID,
      content: "on it",
      threadId: "t1",
    });
    expect(box.value).toBe("");
  });

  it("Enter sends, Shift+Enter does not", () => {
    mount();
    const box = screen.getByLabelText("Reply to the thread");
    fireEvent.change(box, { target: { value: "one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(sockets.socket.emit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sockets.socket.emit).toHaveBeenCalledTimes(1);
  });

  it("keeps the text and says so when there is no connection", () => {
    sockets.socket.connected = false;
    mount();
    const box = screen.getByLabelText("Reply to the thread") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "lost?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(box.value).toBe("lost?");
    expect(screen.getByRole("alert").textContent).toContain("could not be sent");
  });

  it("cannot send an empty reply", () => {
    mount();
    expect((screen.getByRole("button", { name: "Send reply" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("live replies", () => {
  it("shows a human and an agent reply in the open panel, and not in the room list", async () => {
    useThreadStore.setState({
      threads: [makeThread({ id: "t1", title: "Release status", messageCount: 0 })],
      view: "thread",
      activeThreadId: "t1",
    });
    mount();
    expect(screen.getByText("No replies yet.")).toBeTruthy();

    act(() => {
      sockets.handlers["message:new"](
        makeMessage({ id: "h1", content: "human reply", threadId: "t1", senderId: "u1" } as never),
      );
      sockets.handlers["message:new"](
        makeMessage({ id: "a1", content: "agent reply", threadId: "t1", sender: agent, createdAt: "2026-11-07T10:01:00.000Z" } as never),
      );
    });

    const log = screen.getByRole("log");
    expect(within(log).getByText("human reply")).toBeTruthy();
    expect(within(log).getByText("agent reply")).toBeTruthy();
    expect(within(log).getByText("Ice Agent")).toBeTruthy();
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("threads list", () => {
  // The page goes through loadThreads, unordered, like the server's answer
  // would after a reply moved a thread: the list order is the store's job.
  const seed = async () => {
    apiClient.mockResolvedValueOnce(
      jsonResponse([
        makeThread({ id: "a", title: "Alpha", lastActivity: "2026-11-07T08:00:00.000Z", messageCount: 1 }),
        makeThread({ id: "c", title: "Gamma", lastActivity: "2026-11-07T07:00:00.000Z", messageCount: 5 }),
        makeThread({ id: "b", title: "Beta", lastActivity: "2026-11-07T09:00:00.000Z", messageCount: 0, isResolved: true }),
      ]),
    );
    await useThreadStore.getState().loadThreads(ROOM_ID);
    useThreadStore.setState({ view: "list" });
  };
  const titles = () =>
    screen.getAllByRole("listitem").map((li) => within(li).getAllByText(/Alpha|Beta|Gamma/)[0].textContent);

  it("lists title, reply count, last activity and the resolved marker, newest activity first", async () => {
    await seed();
    mount();
    expect(titles()).toEqual(["Beta", "Alpha", "Gamma"]);
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("0 replies");
    expect(items[0].textContent).toContain("Resolved");
    expect(items[1].textContent).toContain("1 reply");
    expect(items[1].textContent).not.toContain("Resolved");
    expect(items[2].textContent).toContain("5 replies");
    expect(items[1].textContent).toContain("Last activity:");
  });

  it("a live reply updates the count and moves the thread to the top", async () => {
    await seed();
    mount();
    act(() => {
      sockets.handlers["message:new"](
        makeMessage({ id: "n1", threadId: "c", createdAt: "2026-11-07T20:00:00.000Z" } as never),
      );
    });
    expect(titles()).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("6 replies");
  });

  it("a thread:created event adds a thread live", async () => {
    await seed();
    mount();
    act(() => {
      sockets.handlers["thread:created"](
        makeThread({ id: "z", title: "Gamma 2", lastActivity: "2026-11-07T23:00:00.000Z" }),
      );
    });
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("Gamma 2");
  });

  it("opens a thread from the list and goes back", async () => {
    await seed();
    mount();
    fireEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Alpha" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back to threads list" }));
    expect(screen.getByRole("heading", { name: "Threads" })).toBeTruthy();
  });

  it("says so when the room has no threads, and when loading failed", () => {
    useThreadStore.setState({ view: "list", threads: [] });
    mount();
    expect(screen.getByText("There are no threads in this room yet.")).toBeTruthy();
    cleanup();
    useThreadStore.setState({ threadsError: true });
    mount();
    expect(screen.getByRole("alert").textContent).toContain("Could not load threads.");
  });

  it("renders in German with the same data", async () => {
    localStorage.setItem("triologue_language", "de");
    await seed();
    mount();
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("0 Antworten");
    expect(items[0].textContent).toContain("Erledigt");
    expect(items[1].textContent).toContain("1 Antwort");
    expect(screen.getByRole("button", { name: "Thread-Bereich schließen" })).toBeTruthy();
  });
});

describe("resolve and reopen", () => {
  const open = (thread = makeThread({ id: "t1", title: "Release status" })) =>
    useThreadStore.setState({ threads: [thread], view: "thread", activeThreadId: "t1" });

  it("resolves, shows the marker and offers reopen", async () => {
    open();
    mount();
    apiClient.mockResolvedValueOnce(jsonResponse(makeThread({ id: "t1", title: "Release status", isResolved: true })));
    fireEvent.click(screen.getByRole("button", { name: "Mark as resolved" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy());
    expect(screen.getByText("Resolved")).toBeTruthy();
    expect(JSON.parse(apiClient.mock.calls[0][1].body)).toEqual({ isResolved: true });

    apiClient.mockResolvedValueOnce(jsonResponse(makeThread({ id: "t1", title: "Release status", isResolved: false })));
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark as resolved" })).toBeTruthy());
    expect(screen.queryByText("Resolved")).toBeNull();
  });

  it("keeps the state and shows the reason when the server refuses", async () => {
    open();
    mount();
    apiClient.mockResolvedValueOnce(jsonResponse({ error: "Only the creator" }, 403));
    fireEvent.click(screen.getByRole("button", { name: "Mark as resolved" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "You are not allowed to resolve or reopen this thread.",
      ),
    );
    expect(screen.queryByText("Resolved")).toBeNull();
    expect(screen.getByRole("button", { name: "Mark as resolved" })).toBeTruthy();
  });

  it("offers the action to the creator, a room admin and a system admin only", () => {
    // Creator.
    open();
    mount();
    expect(screen.queryByRole("button", { name: "Mark as resolved" })).not.toBeNull();
    cleanup();

    // A member who did not create the thread.
    open(makeThread({ id: "t1", title: "Release status", createdBy: "someone-else" }));
    mount();
    expect(screen.queryByRole("button", { name: "Mark as resolved" })).toBeNull();
    cleanup();

    // A thread whose creator deleted their account.
    open(makeThread({ id: "t1", title: "Release status", createdBy: null }));
    mount();
    expect(screen.queryByRole("button", { name: "Mark as resolved" })).toBeNull();
    cleanup();

    // Room admin.
    useChatStore.setState({ currentRoom: { id: ROOM_ID, name: "Main", roomType: "TRIOLOGUE", role: "ADMIN" } });
    mount();
    expect(screen.queryByRole("button", { name: "Mark as resolved" })).not.toBeNull();
    cleanup();

    // System admin.
    useChatStore.setState({ currentRoom: { id: ROOM_ID, name: "Main", roomType: "TRIOLOGUE", role: "MEMBER" } });
    useAuthStore.setState({ user: { ...user, isAdmin: true } });
    mount();
    expect(screen.queryByRole("button", { name: "Mark as resolved" })).not.toBeNull();
  });
});

describe("mobile sheet", () => {
  it("is a labelled modal dialog, traps focus, closes on Escape and hands focus back", async () => {
    mount({ isMobile: true });
    const opener = screen.getByRole("button", { name: "Reply in thread" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "New thread" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Tab from the last control wraps to the first one inside the sheet.
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>("button:not([disabled]),input,textarea"),
    );
    controls[controls.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(controls[0]);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("closes from the labelled close control", () => {
    useThreadStore.setState({ view: "list", threads: [] });
    mount({ isMobile: true });
    fireEvent.click(screen.getByRole("button", { name: "Close threads panel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("wide layout", () => {
  it("is a labelled region, closes on Escape and hands focus back to the opener", async () => {
    mount();
    const opener = screen.getByRole("button", { name: "Reply in thread" });
    opener.focus();
    fireEvent.click(opener);
    const region = screen.getByRole("region", { name: "New thread" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(region, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "New thread" })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
