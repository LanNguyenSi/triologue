import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { DocumentDuplicateIcon, CheckIcon } from "@heroicons/react/24/outline";
import { useTheme } from "../../contexts/ThemeContext";
import { useLanguage } from "../../contexts/LanguageContext";

interface MessageRendererProps {
  content: string;
  messageId: string;
  canReact?: boolean;
}

interface CodeBlockProps {
  children: React.ReactNode;
  className?: string;
  fallbackLanguage: string;
  copyTitle: string;
  copyLabel: string;
  copiedLabel: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({
  children,
  className = "",
  fallbackLanguage,
  copyTitle,
  copyLabel,
  copiedLabel,
}) => {
  const [copied, setCopied] = useState(false);
  const language = className.replace("language-", "");
  const code = String(children).replace(/\n$/, "");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
      // Fallback: show temporary error state
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      // Note: In production, could show toast notification for failed copy
    }
  };

  return (
    <div className="relative group bg-gray-950 rounded-lg overflow-hidden my-2 border border-gray-700">
      <div className="flex justify-between items-center px-4 py-2 bg-gray-800/80 border-b border-gray-700">
        <span className="text-xs text-gray-300 font-mono">
          {language || fallbackLanguage}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-300 hover:text-white transition-colors rounded"
          title={copyTitle}
        >
          {copied ? (
            <>
              <CheckIcon className="w-3 h-3" />
              <span>{copiedLabel}</span>
            </>
          ) : (
            <>
              <DocumentDuplicateIcon className="w-3 h-3" />
              <span>{copyLabel}</span>
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <div className="p-4 overflow-x-auto">
        <code className={`text-sm font-mono ${className}`}>{children}</code>
      </div>
    </div>
  );
};

export const MessageRenderer: React.FC<MessageRendererProps> = ({
  content,
  messageId,
  canReact = true,
}) => {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const isDark = theme === "dark";

  return (
    <div className="message-content">
      <div
        className={`prose prose-sm max-w-none ${isDark ? "prose-invert" : ""}`}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            // Custom code block with copy functionality
            code: ({
              node,
              className,
              children,
              inline,
              ...props
            }: {
              node?: any;
              className?: string;
              children?: React.ReactNode;
              inline?: boolean;
            }) => {
              if (!inline) {
                return (
                  <CodeBlock
                    className={className}
                    fallbackLanguage={t("chat.code.languageFallback")}
                    copyTitle={t("chat.code.copyTitle")}
                    copyLabel={t("chat.copy")}
                    copiedLabel={t("chat.copied")}
                  >
                    {children}
                  </CodeBlock>
                );
              }
              return (
                <code
                  className={`px-1 py-0.5 rounded text-sm font-mono ${
                    isDark
                      ? "bg-gray-700 text-gray-100"
                      : "bg-gray-200 text-gray-800"
                  }`}
                  {...props}
                >
                  {children}
                </code>
              );
            },

            // Custom styling for other elements
            h1: ({ children }) => (
              <h1
                className={`text-xl font-bold mb-2 mt-4 first:mt-0 ${
                  isDark ? "text-white" : "text-gray-900"
                }`}
              >
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2
                className={`text-lg font-bold mb-2 mt-3 first:mt-0 ${
                  isDark ? "text-white" : "text-gray-900"
                }`}
              >
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3
                className={`text-md font-semibold mb-1 mt-2 first:mt-0 ${
                  isDark ? "text-white" : "text-gray-900"
                }`}
              >
                {children}
              </h3>
            ),

            p: ({ children }) => (
              <p
                className={`mb-2 last:mb-0 leading-relaxed ${
                  isDark ? "text-gray-100" : "text-gray-800"
                }`}
              >
                {children}
              </p>
            ),

            ul: ({ children }) => (
              <ul
                className={`list-disc list-inside mb-2 space-y-1 ${
                  isDark ? "text-gray-100" : "text-gray-800"
                }`}
              >
                {children}
              </ul>
            ),

            ol: ({ children }) => (
              <ol
                className={`list-decimal list-inside mb-2 space-y-1 ${
                  isDark ? "text-gray-100" : "text-gray-800"
                }`}
              >
                {children}
              </ol>
            ),

            blockquote: ({ children }) => (
              <blockquote
                className={`border-l-4 border-blue-500 pl-4 italic my-2 ${
                  isDark ? "text-gray-300" : "text-gray-600"
                }`}
              >
                {children}
              </blockquote>
            ),

            a: ({ children, href }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={`underline transition-colors ${
                  isDark
                    ? "text-blue-400 hover:text-blue-300"
                    : "text-blue-600 hover:text-blue-500"
                }`}
              >
                {children}
              </a>
            ),

            strong: ({ children }) => (
              <strong
                className={`font-bold ${isDark ? "text-white" : "text-gray-900"}`}
              >
                {children}
              </strong>
            ),

            em: ({ children }) => (
              <em
                className={`italic ${isDark ? "text-gray-200" : "text-gray-700"}`}
              >
                {children}
              </em>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};
