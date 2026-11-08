import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "../../..");

const read = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

/**
 * Two static guards for the page-language fix. The runtime half (the
 * provider writing document.documentElement.lang on mount and on every
 * switch, with the localStorage value winning over the fallback default)
 * lives in src/contexts/LanguageContext.test.tsx; this file covers what a
 * jsdom render cannot see: what the browser announces before the bundle runs
 * and what the fallback default actually is.
 */
describe("page language guards", () => {
  it("declares the provider's fallback default as the static lang of client/index.html", () => {
    const context = read("client/src/contexts/LanguageContext.tsx");
    const fallback =
      /stored === "en" \|\| stored === "de" \? stored : "(de|en)"/.exec(
        context,
      )?.[1];
    expect(fallback).toBeTruthy();

    const html = read("client/index.html");
    const staticLang = /<html[^>]*\blang="([^"]*)"/.exec(html)?.[1];

    // A mismatch means a first visit (or any render before the provider's
    // effect) is announced in a language the UI never shows.
    expect(staticLang).toBe(fallback);
  });

  it("has no ae/oe/ue stand-ins left in the German translation block", () => {
    const lines = read("client/src/contexts/LanguageContext.tsx").split("\n");
    const deStart = lines.findIndex((l) => /^\s*de:\s*\{/.test(l));
    const enStart = lines.findIndex((l) => /^\s*en:\s*\{/.test(l));
    expect(deStart).toBeGreaterThan(-1);
    expect(enStart).toBeGreaterThan(deStart);

    const standIns =
      /\b(fuer|Fuer|ueber|Ueber|koennen|Koennen|moechte|Moechte|waehle|Waehle|moeglic|Moeglic|ausser|Ausser|muessen|Muessen|persoenlich|Persoenlich|geloescht|Geloescht|laedt|Laedt|jaeh|naech)\b/;
    const offenders = lines
      .slice(deStart, enStart)
      .map((line, i) => ({ line, number: deStart + i + 1 }))
      .filter(({ line }) => {
        const value = /^\s*"[^"]+":\s*"(.*)",?$/.exec(line)?.[1];
        return value !== undefined && standIns.test(value);
      });

    expect(offenders).toEqual([]);
  });
});
