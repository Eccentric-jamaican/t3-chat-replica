import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import {
  escapeHtml,
  formatAttachments,
  formatMessageRole,
  formatToolCalls,
} from "./sidebarExportBase";

const renderMarkdownToHtml = (markdown: string) => {
  const components: any = {
    pre: ({ children }: any) => <>{children}</>,
    code: ({ className, children, inline }: any) => {
      if (inline) {
        return <code className="inline-code">{children}</code>;
      }

      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "text";

      return (
        <div className="code-card">
          <div className="code-header">
            <span className="code-lang">{language}</span>
          </div>
          <pre className="code-body">
            <code className={className}>{children}</code>
          </pre>
        </div>
      );
    },
  };

  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>,
  );
};

export const formatTranscriptHtml = (entries: any[]) =>
  entries
    .map((msg) => {
      const role =
        msg.role === "tool"
          ? `Tool Output${msg.name ? ` (${msg.name})` : ""}`
          : formatMessageRole(msg.role ?? "message");
      const attachments = formatAttachments(msg.attachments);
      const toolCalls = formatToolCalls(msg.toolCalls);
      const bodyHtml =
        msg.role === "tool"
          ? `<pre class="tool-output"><code>${escapeHtml(
              msg.content?.trim() || "",
            )}</code></pre>`
          : renderMarkdownToHtml(msg.content?.trim() || "");

      const toolOutputsHtml = msg.toolOutputs?.length
        ? `<div class="tool-outputs">
          ${msg.toolOutputs
            .map((tool: any) => {
              const label = tool.name ? `Tool output (${tool.name})` : "Tool output";
              return `
              <div class="tool-output-inline">
                <div class="tool-output-label">${escapeHtml(label)}</div>
                <pre class="tool-output"><code>${escapeHtml(
                  tool.content?.trim() || "",
                )}</code></pre>
              </div>
            `;
            })
            .join("")}
        </div>`
        : "";

      const attachmentsHtml = attachments
        ? `<div class="meta"><div class="meta-title">Attachments</div><ul>${attachments
            .split("\n")
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join("")}</ul></div>`
        : "";

      const toolCallsHtml = toolCalls
        ? `<div class="meta"><div class="meta-title">Tool calls</div><ul>${toolCalls
            .split("\n")
            .map((line) => `<li>${escapeHtml(line)}</li>`)
            .join("")}</ul></div>`
        : "";

      return `
      <section class="message">
        <h3>${escapeHtml(role)}</h3>
        <div class="message-body">${bodyHtml || "<p><em>No content</em></p>"}</div>
        ${toolOutputsHtml}
        ${attachmentsHtml}
        ${toolCallsHtml}
      </section>
    `;
    })
    .join("\n");
