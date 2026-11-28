import { describe, it, expect } from "vitest";
import { extractCodeLanguage } from "../components/chat/codeLanguage";

// Direct cases for class shapes the markdown pipeline cannot produce (the
// order of `hljs` versus `language-<x>` and stray classes). Header and
// aria-label share this helper, so a fence and a raw class string must agree.
describe("extractCodeLanguage", () => {
  it("returns the language from a highlighted fence class list", () => {
    expect(extractCodeLanguage("hljs language-ts")).toBe("ts");
  });

  it("returns the language regardless of class order", () => {
    expect(extractCodeLanguage("language-ts hljs")).toBe("ts");
    expect(extractCodeLanguage("hljs extra language-ts")).toBe("ts");
  });

  it("keeps non-word characters in the language", () => {
    expect(extractCodeLanguage("hljs language-c++")).toBe("c++");
    expect(extractCodeLanguage("language-c#")).toBe("c#");
    expect(extractCodeLanguage("language-objective-c")).toBe("objective-c");
  });

  it("takes the first language- token and ignores unknown classes", () => {
    expect(extractCodeLanguage("foo language-xyz bar")).toBe("xyz");
    expect(extractCodeLanguage("language-a language-b")).toBe("a");
  });

  it("treats an empty token and non-language classes as no language", () => {
    expect(extractCodeLanguage("hljs")).toBe("");
    expect(extractCodeLanguage("language-")).toBe("");
    expect(extractCodeLanguage("hljs plain")).toBe("");
  });

  it("handles the empty, undefined and null class list", () => {
    expect(extractCodeLanguage("")).toBe("");
    expect(extractCodeLanguage(undefined)).toBe("");
    expect(extractCodeLanguage(null)).toBe("");
  });
});
