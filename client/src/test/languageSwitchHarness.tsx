import { useMemo, type ReactElement, type ReactNode } from "react";

/**
 * Text of the button rendered by `buildLanguageSwitchHarness`'s Harness.
 * Clicking it calls the REAL `setLanguage("en")` from LanguageContext (not
 * a mock), so the test exercises an actual language switch end to end.
 */
export const REAL_SWITCH_TO_EN_LABEL = "real-switch-to-en";

/**
 * Minimal shape of the dynamically-imported `contexts/LanguageContext`
 * module the harness needs. Each a34078b6 page test dynamically imports
 * LanguageContext itself, after `vi.doMock`-ing the page's other
 * dependencies (apiClient, ThemeContext, ...), so the harness takes the
 * already-resolved module rather than importing it statically: a static
 * import here would resolve before those `vi.doMock` calls run and pull in
 * the page's real, un-mocked dependencies.
 */
export interface LanguageContextModule {
  LanguageProvider: (props: { children: ReactNode }) => ReactNode;
  useLanguage: () => { setLanguage: (lang: "de" | "en") => void };
}

/**
 * Builds the `Harness` component that used to be copy-pasted (with the
 * dynamically-imported LanguageContext, in one of two locally-renamed
 * forms) into all seven a34078b6 page test files: SecretDetailPage,
 * SecretEditPage, AgentMemoryDetailPage, AgentMemoryEditPage,
 * AgentMemoryPage, ProjectEditPage, UserConnectionsPage. Extracted per
 * task a34078b6 (Slice 3, Component C) once a third page (PluginWorkspace-
 * Page) needed the same real-LanguageProvider-plus-real-setLanguage setup.
 *
 * Renders `pageElement` under a real `LanguageProvider` alongside a button
 * (text: `REAL_SWITCH_TO_EN_LABEL`) that calls the real `setLanguage("en")`
 * on click, so a test can assert on genuine re-renders in the new language
 * rather than a mocked context value.
 *
 * `pageElement` must already be fully constructed (its own MemoryRouter/
 * Routes wrapper included) by the caller, after any `vi.doMock` + dynamic
 * import has resolved. It is captured once via `useMemo` with an empty
 * dependency array, matching the original inline pattern in each of the
 * seven files: the wrapped tree is built once per Harness mount and keeps
 * a stable identity across re-renders (an unstable `children` identity
 * would remount MemoryRouter on every render, resetting the page
 * underneath it).
 */
export function buildLanguageSwitchHarness(
  languageContextModule: LanguageContextModule,
  pageElement: ReactElement,
): () => ReactElement {
  const { LanguageProvider, useLanguage } = languageContextModule;

  function LanguageSwitchButton(): ReactElement {
    const { setLanguage } = useLanguage();
    return (
      <button onClick={() => setLanguage("en")}>
        {REAL_SWITCH_TO_EN_LABEL}
      </button>
    );
  }

  return function Harness(): ReactElement {
    const children = useMemo(
      () => (
        <>
          {pageElement}
          <LanguageSwitchButton />
        </>
      ),
      [],
    );
    return <LanguageProvider>{children}</LanguageProvider>;
  };
}
