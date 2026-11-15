import React, { useState } from 'react';

/** Request-body fields the connector proxy consumes itself and leaves out of the input hash. */
export const EXCLUDED_FROM_HASH = ['approvalReason', 'taskId'] as const;

export const BOUND_INPUT_MAX_LINES = 20;
export const BOUND_INPUT_MAX_CHARS = 1500;

/**
 * The value an approval is bound to, shaped the way the server hashes it: the
 * stored request body spread into a plain object (so an array becomes an object
 * with numeric keys, a non-object becomes empty) minus the fields the server
 * leaves out of the hash. Returns undefined when nothing is left.
 */
export function boundInputOf(actionInput: unknown): unknown {
  if (typeof actionInput !== 'object' || actionInput === null) return undefined;
  const rest: Record<string, unknown> = { ...(actionInput as Record<string, unknown>) };
  for (const key of EXCLUDED_FROM_HASH) delete rest[key];
  return Object.keys(rest).length === 0 ? undefined : rest;
}

// Control (Cc) and format (Cf) characters, line/paragraph separators. JSON.stringify
// leaves most of these raw, so bidi overrides and zero-width characters could
// reorder or hide text in the card. The layout newline is kept.
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

export function escapeInvisible(text: string): { text: string; escaped: boolean } {
  let escaped = false;
  const out = text.replace(INVISIBLE, ch => {
    if (ch === '\n') return ch;
    escaped = true;
    const hex = ch.codePointAt(0)!.toString(16).toUpperCase();
    return hex.length <= 4 ? `\\u${hex.padStart(4, '0')}` : `\\u{${hex}}`;
  });
  return { text: out, escaped };
}

function render(value: unknown): { full: string; shown: string; escaped: boolean } {
  let raw: string;
  try {
    raw = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    raw = String(value);
  }
  const { text: full, escaped } = escapeInvisible(raw);
  const shown = full.split('\n').slice(0, BOUND_INPUT_MAX_LINES).join('\n').slice(0, BOUND_INPUT_MAX_CHARS);
  return { full, shown, escaped };
}

interface Props {
  actionInput: unknown;
  isDark: boolean;
  t: (key: string) => string;
  id: string;
}

/** Shows, as plain text, the exact input an approval authorises. */
export const ApprovalBoundInput: React.FC<Props> = ({ actionInput, isDark, t, id }) => {
  const [expanded, setExpanded] = useState(false);
  const value = boundInputOf(actionInput);
  const muted = isDark ? 'text-gray-400' : 'text-gray-600';
  const regionId = `approval-input-${id}`;

  let body: React.ReactNode;
  if (value === undefined) {
    body = <p className={`text-xs italic ${muted}`}>{t('approvals.input.none')}</p>;
  } else {
    const { full, shown, escaped } = render(value);
    const truncated = shown.length < full.length;
    body = (
      <>
        {escaped && (
          <p className={`mb-1 text-xs ${isDark ? 'text-amber-300' : 'text-amber-800'}`}>
            {t('approvals.input.escaped')}
          </p>
        )}
        <pre
          id={regionId}
          className={`whitespace-pre-wrap break-all rounded border px-2 py-1.5 font-mono text-xs ${
            isDark ? 'border-gray-700 bg-gray-900 text-gray-100' : 'border-gray-200 bg-gray-50 text-gray-900'
          }`}
        >
          {truncated && !expanded ? `${shown}\n…` : full}
        </pre>
        {truncated && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={regionId}
            onClick={() => setExpanded(e => !e)}
            className={`mt-1 text-xs underline ${isDark ? 'text-blue-300' : 'text-blue-700'}`}
          >
            {expanded ? t('approvals.input.collapse') : t('approvals.input.expand')}
          </button>
        )}
      </>
    );
  }

  return (
    <div className={`border-t pt-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
      <h3 className={`mb-1 text-xs font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
        {t('approvals.input.label')}
      </h3>
      {body}
    </div>
  );
};
