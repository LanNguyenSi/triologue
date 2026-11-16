import React from 'react';
import { escapeInvisible } from './ApprovalBoundInput';

interface Props {
  message: string;
  isDark: boolean;
  className?: string;
  t: (key: string) => string;
}

/**
 * Inbox item text, shown as plain text with control, format and bidi characters
 * escaped as \uXXXX. A compact marker leads the line when anything was escaped.
 */
export const EscapedMessage: React.FC<Props> = ({ message, isDark, className, t }) => {
  const { text, escaped } = escapeInvisible(message);
  return (
    <div className={className}>
      {escaped && (
        <span
          title={t('inbox.message.escapedHint')}
          className={`mr-1 font-semibold ${isDark ? 'text-amber-300' : 'text-amber-800'}`}
        >
          {t('inbox.message.escaped')}
        </span>
      )}
      {text}
    </div>
  );
};
