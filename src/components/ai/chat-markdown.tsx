"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Assistant-bubble markdown (tables/lists/code). Renders to React elements —
// no raw HTML pass-through (no rehype-raw), so tool-sourced text stays inert.
// dir="auto" lets an English/French answer flip direction per-block.
// memo: only the actively-streaming message's `content` changes per SSE
// chunk — without this, every prior completed message re-parses its full
// markdown on every chunk of an unrelated, still-streaming reply.
export const ChatMarkdown = memo(function ChatMarkdown({ content }: { content: string }) {
  return (
    <div dir="auto" className="text-sm leading-relaxed text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="my-1" {...props} />,
          ul: (props) => <ul className="my-1 list-disc ps-5" {...props} />,
          ol: (props) => <ol className="my-1 list-decimal ps-5" {...props} />,
          h1: (props) => <p className="my-1 font-semibold" {...props} />,
          h2: (props) => <p className="my-1 font-semibold" {...props} />,
          h3: (props) => <p className="my-1 font-semibold" {...props} />,
          a: (props) => <a className="text-indigo-600 underline" {...props} />,
          code: (props) => (
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs" {...props} />
          ),
          pre: (props) => (
            <pre className="my-2 overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs" dir="ltr" {...props} />
          ),
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs" {...props} />
            </div>
          ),
          th: (props) => (
            <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-start font-semibold" {...props} />
          ),
          td: (props) => <td className="border border-slate-200 px-2 py-1" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
