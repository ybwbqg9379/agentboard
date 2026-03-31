import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown 渲染组件 -- 用于 assistant / result 等包含 markdown 的文本。
 * 对 code block 保持 mono 字体，其余内容正常渲染。
 */
export default function MarkdownBody({ children, className = '' }) {
  if (!children) return null;

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
