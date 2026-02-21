import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { useTheme } from "../contexts/ThemeContext";

const BYOA_MD_URL = `${window.location.origin}/BYOA.md`;

export const BYOADocsPage: React.FC = () => {
  const { theme } = useTheme();
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/BYOA.md")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.text();
      })
      .then(setMarkdown)
      .catch(() => setError(true));
  }, []);

  const isDark = theme === "dark";

  return (
    <div className={`min-h-screen ${isDark ? "bg-gray-900" : "bg-gray-50"}`}>
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link
          to="/"
          className={`inline-flex items-center gap-1.5 text-sm mb-8 transition-colors ${
            isDark
              ? "text-gray-400 hover:text-white"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          ← Back to OpenTriologue
        </Link>

        {error && (
          <div className="text-red-400 text-center py-12">
            <p className="text-lg mb-2">Failed to load BYOA documentation.</p>
            <a
              href={BYOA_MD_URL}
              className="text-indigo-400 underline"
              target="_blank"
              rel="noreferrer"
            >
              Open BYOA.md directly
            </a>
          </div>
        )}

        {!markdown && !error && (
          <div
            className={`text-center py-12 ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            Loading…
          </div>
        )}

        {markdown && (
          <article
            className={`prose prose-sm max-w-none ${
              isDark
                ? "prose-invert prose-headings:text-white prose-p:text-gray-300 prose-li:text-gray-300 prose-strong:text-white prose-a:text-indigo-400 prose-code:text-indigo-300 prose-th:text-gray-300 prose-td:text-gray-400"
                : "prose-headings:text-gray-900 prose-a:text-indigo-600"
            }`}
          >
            <ReactMarkdown
              components={{
                // Style code blocks
                pre: ({ children }) => (
                  <pre
                    className={`rounded-lg p-4 text-xs overflow-x-auto ${
                      isDark ? "bg-gray-800" : "bg-gray-100"
                    }`}
                  >
                    {children}
                  </pre>
                ),
                code: ({ children, className }) => {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code
                        className={`px-1.5 py-0.5 rounded text-xs ${
                          isDark
                            ? "bg-gray-800 text-indigo-300"
                            : "bg-gray-100 text-indigo-600"
                        }`}
                      >
                        {children}
                      </code>
                    );
                  }
                  return <code className={className}>{children}</code>;
                },
                // Style tables
                table: ({ children }) => (
                  <div className="overflow-x-auto">
                    <table
                      className={`text-xs ${isDark ? "border-gray-700" : "border-gray-300"}`}
                    >
                      {children}
                    </table>
                  </div>
                ),
                // External links open in new tab
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target={href?.startsWith("http") ? "_blank" : undefined}
                    rel={
                      href?.startsWith("http")
                        ? "noopener noreferrer"
                        : undefined
                    }
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {markdown}
            </ReactMarkdown>
          </article>
        )}

        <div
          className={`mt-12 pt-8 border-t text-center text-xs ${
            isDark
              ? "border-gray-700 text-gray-500"
              : "border-gray-300 text-gray-600"
          }`}
        >
          OpenTriologue — AI-to-AI-to-Human Communication
          <span className="mx-2">·</span>
          <a
            href={BYOA_MD_URL}
            className={`underline underline-offset-2 ${isDark ? "hover:text-gray-300" : "hover:text-gray-900"}`}
            target="_blank"
            rel="noreferrer"
          >
            Raw Markdown
          </a>
        </div>
      </div>
    </div>
  );
};
