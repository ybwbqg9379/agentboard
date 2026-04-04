import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Custom renderer for code blocks to support Mermaid diagrams with dynamic loading.
 * This significantly reduces initial bundle size.
 */
const MermaidCodeBlock = ({ children }) => {
  const containerRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const renderMermaid = async () => {
      try {
        // Dynamically import mermaid only when needed
        const mermaid = (await import('mermaid')).default;

        if (!isLoaded) {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            securityLevel: 'strict', // Secure: Disallows JavaScript execution in diagrams
          });
          if (isMounted) setIsLoaded(true);
        }
        if (containerRef.current) {
          // Clear previous content to avoid duplicate rendering
          containerRef.current.removeAttribute('data-processed');
          containerRef.current.textContent = children;
          await mermaid.run({
            nodes: [containerRef.current],
          });
        }
      } catch (e) {
        console.error('Mermaid render error:', e);
      }
    };

    renderMermaid();
    return () => {
      isMounted = false;
    };
  }, [children, isLoaded]);

  return (
    <div className="mermaid-container my-4 overflow-x-auto bg-secondary p-2 rounded">
      <div className="mermaid" ref={containerRef}>
        {children}
      </div>
    </div>
  );
};

/**
 * Markdown 渲染组件 -- 用于 assistant / result 等包含 markdown 的文本。
 */
export default function MarkdownBody({ children, className = '' }) {
  if (!children) return null;

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node: _node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const lang = match ? match[1] : '';

            if (!inline && lang === 'mermaid') {
              return <MermaidCodeBlock>{String(children).replace(/\n$/, '')}</MermaidCodeBlock>;
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
