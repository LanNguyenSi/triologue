import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { DocumentDuplicateIcon, CheckIcon } from '@heroicons/react/24/outline';

interface MessageRendererProps {
  content: string;
  messageId: string;
  canReact?: boolean;
}

interface CodeBlockProps {
  children: React.ReactNode;
  className?: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ children, className = '' }) => {
  const [copied, setCopied] = useState(false);
  const language = className.replace('language-', '');
  const code = String(children).replace(/\n$/, '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  return (
    <div className="relative group bg-gray-800 rounded-lg overflow-hidden my-2">
      {/* Code header with language and copy button */}
      <div className="flex justify-between items-center px-4 py-2 bg-gray-700 border-b border-gray-600">
        <span className="text-xs text-gray-300 font-mono">
          {language || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-300 hover:text-white transition-colors rounded"
          title="Copy code"
        >
          {copied ? (
            <>
              <CheckIcon className="w-3 h-3" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <DocumentDuplicateIcon className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      
      {/* Code content */}
      <div className="p-4 overflow-x-auto">
        <code className={`text-sm font-mono ${className}`}>
          {children}
        </code>
      </div>
    </div>
  );
};

export const MessageRenderer: React.FC<MessageRendererProps> = ({ 
  content, 
  messageId,
  canReact = true 
}) => {
  return (
    <div className="message-content">
      <div className="prose prose-invert prose-sm max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
          // Custom code block with copy functionality
          code: ({ node, className, children, ...props }: any) => {
            const inline = props.inline;
            if (!inline) {
              return (
                <CodeBlock className={className}>
                  {children}
                </CodeBlock>
              );
            }
            return (
              <code 
                className="bg-gray-700 text-gray-100 px-1 py-0.5 rounded text-sm font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
          
          // Custom styling for other elements
          h1: ({ children }) => (
            <h1 className="text-xl font-bold text-white mb-2 mt-4 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-bold text-white mb-2 mt-3 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-md font-semibold text-white mb-1 mt-2 first:mt-0">
              {children}
            </h3>
          ),
          
          p: ({ children }) => (
            <p className="text-gray-100 mb-2 last:mb-0 leading-relaxed">
              {children}
            </p>
          ),
          
          ul: ({ children }) => (
            <ul className="list-disc list-inside text-gray-100 mb-2 space-y-1">
              {children}
            </ul>
          ),
          
          ol: ({ children }) => (
            <ol className="list-decimal list-inside text-gray-100 mb-2 space-y-1">
              {children}
            </ol>
          ),
          
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-blue-500 pl-4 italic text-gray-300 my-2">
              {children}
            </blockquote>
          ),
          
          a: ({ children, href }) => (
            <a 
              href={href} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline transition-colors"
            >
              {children}
            </a>
          ),
          
          strong: ({ children }) => (
            <strong className="font-bold text-white">
              {children}
            </strong>
          ),
          
          em: ({ children }) => (
            <em className="italic text-gray-200">
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