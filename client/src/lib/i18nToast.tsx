import type { ReactElement } from "react";
import toast from "react-hot-toast";
import { useLanguage } from "../contexts/LanguageContext";

/**
 * A language-aware alternative to `toast.success(t(key))` /
 * `toast.error(t(key))` / `toast.loading(t(key))`.
 *
 * Calling `t(key)` at the moment the toast is created bakes in whatever
 * language was active at that instant: react-hot-toast keeps the toast's
 * `message` (already a plain string by then) around for its full display
 * duration, so a language switch that happens while the toast is still on
 * screen never touches it (task a34078b6, Klasse 2, applied to toasts).
 *
 * Instead of a string, `toastT` passes react-hot-toast a small component
 * that reads the translation key via `useLanguage()` and renders the
 * translated text itself. react-hot-toast mounts this component as a real
 * part of the React tree (it is not serialized to a string), so as long as
 * `<Toaster />` is rendered inside `LanguageProvider` (it is, see
 * client/src/App.tsx), the toast keeps re-rendering with the current
 * language for as long as it stays on screen, exactly like the shared
 * `RunError` message/key union in `src/lib/runError.ts` (consumed by
 * PluginWorkspacePage and FilesPage).
 *
 * Only wraps `key`-only messages: a raw, already-resolved server error
 * message (not a translation key) should still go straight to
 * `toast.error(message)`, since there's nothing to re-translate.
 */
function TranslatedToastMessage({ i18nKey }: { i18nKey: string }): ReactElement {
  const { t } = useLanguage();
  return <>{t(i18nKey)}</>;
}

export const toastT = {
  success(i18nKey: string) {
    return toast.success(<TranslatedToastMessage i18nKey={i18nKey} />);
  },
  error(i18nKey: string) {
    return toast.error(<TranslatedToastMessage i18nKey={i18nKey} />);
  },
  loading(i18nKey: string) {
    return toast.loading(<TranslatedToastMessage i18nKey={i18nKey} />);
  },
};
