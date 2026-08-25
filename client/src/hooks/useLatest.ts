import { useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * Keeps a ref pointed at the latest `value` without putting `value` itself
 * into a dependency array. Read `ref.current` inside a callback (e.g. a
 * data loader's catch branch) to get the current value at call time while
 * keeping the callback's own identity stable across renders that only
 * change `value`.
 *
 * Used to read the latest `t` (translation function) from
 * LanguageContext inside load* callbacks without making those callbacks
 * (and the effects that call them) re-run on every language switch: `t`'s
 * identity legitimately changes when the language changes (see
 * LanguageContext.tsx), but a data loader does not need to refetch just
 * because the active language changed.
 */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
