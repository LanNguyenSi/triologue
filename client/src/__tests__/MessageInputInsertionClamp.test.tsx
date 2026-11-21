// @vitest-environment jsdom
/**
 * Code-built insertions into the draft (emoji picker, mention select) bypass
 * the textarea's `maxLength`, so they are bounded where they are built: an
 * insertion that would pass the server's 10,000-character bound is refused,
 * the draft stays as it was and a translated toast says why. Length is
 * measured with `String.prototype.length`, the UTF-16 code-unit count Joi's
 * `max(10000)` uses on the server, so a surrogate-pair emoji counts as two.
 *
 * Mutation intent: drop the check in `onEmojiClick` and the emoji-at-limit
 * case fails; drop it in `handleMentionSelect` and the mention-at-limit case
 * fails.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { EmojiClickData } from "emoji-picker-react";

const picker = vi.hoisted(() => {
  let click: ((data: EmojiClickData) => void) | null = null;
  return {
    setClick: (fn: (data: EmojiClickData) => void) => {
      click = fn;
    },
    clickEmoji: (emoji: string) => {
      if (!click) throw new Error("emoji picker not rendered");
      act(() => {
        click!({ emoji });
      });
    },
  };
});

const mention = vi.hoisted(() => {
  let select: ((username: string) => void) | null = null;
  return {
    // One stable object: MessageInput keeps the reference it destructured at
    // render time, so the tests mutate it in place.
    state: { active: false, query: "", startPos: 0 },
    closeMention: vi.fn(),
    setSelect: (fn: (username: string) => void) => {
      select = fn;
    },
    selectMention: (username: string) => {
      if (!select) throw new Error("mention handler not wired");
      act(() => {
        select!(username);
      });
    },
  };
});

const toasts = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("emoji-picker-react", async () => {
  const React = await import("react");
  return {
    __esModule: true,
    default: ({
      onEmojiClick,
    }: {
      onEmojiClick: (data: EmojiClickData) => void;
    }) => {
      picker.setClick(onEmojiClick);
      return React.createElement("div", { "data-testid": "picker-stub" });
    },
    Theme: { LIGHT: 0, DARK: 1 },
  };
});

vi.mock("../components/chat/MentionPopup", () => ({
  MentionPopup: ({ onSelect }: { onSelect: (username: string) => void }) => {
    mention.setSelect(onSelect);
    return null;
  },
  useMention: () => ({
    mentionState: mention.state,
    checkForMention: vi.fn(),
    closeMention: mention.closeMention,
  }),
}));

vi.mock("react-hot-toast", () => ({ default: { error: toasts.error } }));

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", setTheme: vi.fn() }),
}));

vi.mock("../contexts/LanguageContext", () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: "en",
    setLanguage: vi.fn(),
  }),
}));

vi.mock("../stores/socketStore", () => ({
  useSocketStore: () => ({ sendMessage: vi.fn(() => true) }),
}));

import { MessageInput } from "../components/chat/MessageInput";
import { MAX_MESSAGE_LENGTH } from "../components/chat/chatUtils";

// An astral emoji: two UTF-16 code units, the same measure the server uses.
const GRIN = "\u{1F600}";

const renderInput = () => {
  const { container } = render(<MessageInput roomId="room-1" />);
  const box = container.querySelector("textarea") as HTMLTextAreaElement;
  expect(box).toBeTruthy();
  return box;
};

const openPicker = () => {
  fireEvent.click(screen.getByTitle("chat.emojiInsert"));
  expect(screen.getByTestId("picker-stub")).toBeTruthy();
};

/** Set the draft and put the caret at `caret` (or at the end). */
const setDraft = (box: HTMLTextAreaElement, value: string, caret = value.length) => {
  fireEvent.change(box, { target: { value } });
  box.focus();
  box.setSelectionRange(caret, caret);
};

const shownKey = () => {
  const arg = toasts.error.mock.calls[0][0] as { props?: { i18nKey?: string } };
  return arg?.props?.i18nKey;
};

beforeEach(() => {
  toasts.error.mockReset();
  mention.closeMention.mockReset();
  Object.assign(mention.state, { active: false, query: "", startPos: 0 });
});

afterEach(() => {
  cleanup();
});

describe("emoji insertion is bounded", () => {
  it("the picker opens and its click reaches the component", () => {
    renderInput();
    openPicker();
  });

  it("refuses an insertion past the limit: draft unchanged, toast shown", () => {
    const box = renderInput();
    openPicker();
    const draft = "a".repeat(MAX_MESSAGE_LENGTH - 1);
    setDraft(box, draft);
    expect(box.value.length).toBe(MAX_MESSAGE_LENGTH - 1);

    picker.clickEmoji(GRIN);

    expect(box.value).toBe(draft);
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(shownKey()).toBe("chat.messageLimitReached");
  });

  it("inserts when the result is exactly at the limit", () => {
    const box = renderInput();
    openPicker();
    const draft = "a".repeat(MAX_MESSAGE_LENGTH - GRIN.length);
    setDraft(box, draft);

    picker.clickEmoji(GRIN);

    expect(box.value.length).toBe(MAX_MESSAGE_LENGTH);
    expect(box.value).toBe(draft + GRIN);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("inserts at the caret when there is room", () => {
    const box = renderInput();
    openPicker();
    setDraft(box, "ab", 1);

    picker.clickEmoji(GRIN);

    expect(box.value).toBe(`a${GRIN}b`);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("replaces a selection: the removed characters make room", () => {
    const box = renderInput();
    openPicker();
    const draft = "a".repeat(MAX_MESSAGE_LENGTH);
    setDraft(box, draft);
    box.setSelectionRange(10, 12);

    picker.clickEmoji(GRIN);

    expect(box.value).toBe("a".repeat(10) + GRIN + "a".repeat(MAX_MESSAGE_LENGTH - 12));
    expect(box.value.length).toBe(MAX_MESSAGE_LENGTH);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("refuses when a replaced selection does not free enough room", () => {
    const box = renderInput();
    openPicker();
    const draft = "a".repeat(MAX_MESSAGE_LENGTH);
    setDraft(box, draft);
    box.setSelectionRange(10, 11);

    picker.clickEmoji(GRIN + GRIN);

    expect(box.value).toBe(draft);
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(shownKey()).toBe("chat.messageLimitReached");
  });
});

describe("mention insertion is bounded", () => {
  it("refuses an insertion past the limit: draft unchanged, toast shown", () => {
    const box = renderInput();
    const draft = "a".repeat(MAX_MESSAGE_LENGTH - 4);
    setDraft(box, draft);
    Object.assign(mention.state, { active: true, query: "bo", startPos: draft.length });

    mention.selectMention("bob");

    expect(box.value).toBe(draft);
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(shownKey()).toBe("chat.messageLimitReached");
  });

  it("inserts when the result is exactly at the limit", () => {
    const box = renderInput();
    const draft = "a".repeat(MAX_MESSAGE_LENGTH - 5);
    setDraft(box, draft);
    Object.assign(mention.state, { active: true, query: "bo", startPos: draft.length });

    mention.selectMention("bob");

    expect(box.value).toBe(`${draft}@bob `);
    expect(box.value.length).toBe(MAX_MESSAGE_LENGTH);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("inserts the mention when there is room and closes the popup", () => {
    const box = renderInput();
    setDraft(box, "hi ");
    Object.assign(mention.state, { active: true, query: "bo", startPos: 3 });

    mention.selectMention("bob");

    expect(box.value).toBe("hi @bob ");
    expect(mention.closeMention).toHaveBeenCalledTimes(1);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("closes the popup even when the insertion is refused", () => {
    const box = renderInput();
    const draft = "a".repeat(MAX_MESSAGE_LENGTH - 4);
    setDraft(box, draft);
    Object.assign(mention.state, { active: true, query: "bo", startPos: draft.length });

    mention.selectMention("bob");

    expect(mention.closeMention).toHaveBeenCalledTimes(1);
    expect(box.value).toBe(draft);
  });

  it("counts the text after the caret: accepted when the result is exactly at the limit", () => {
    const box = renderInput();
    const draft = "hi bo" + "z".repeat(MAX_MESSAGE_LENGTH - 8);
    setDraft(box, draft, 5);
    Object.assign(mention.state, { active: true, query: "bo", startPos: 3 });

    mention.selectMention("bob");

    expect(box.value).toBe("hi @bob " + "z".repeat(MAX_MESSAGE_LENGTH - 8));
    expect(box.value.length).toBe(MAX_MESSAGE_LENGTH);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("counts the text after the caret: refused one unit past the limit", () => {
    const box = renderInput();
    const draft = "hi bo" + "z".repeat(MAX_MESSAGE_LENGTH - 7);
    setDraft(box, draft, 5);
    Object.assign(mention.state, { active: true, query: "bo", startPos: 3 });

    mention.selectMention("bob");

    expect(box.value).toBe(draft);
    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(shownKey()).toBe("chat.messageLimitReached");
  });
});
