import type { Components } from 'react-markdown';

export const markdownComponents: Components = {
  p: (props: any) => { const { node, ...rest } = props; return <p className="mb-2 last:mb-0 leading-relaxed" {...rest} />; },
  a: (props: any) => { const { node, ...rest } = props; return <a className="text-blue-400 hover:text-blue-300 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...rest} />; },
  ul: (props: any) => { const { node, ...rest } = props; return <ul className="list-disc pl-4 mb-2 space-y-1" {...rest} />; },
  ol: (props: any) => { const { node, ...rest } = props; return <ol className="list-decimal pl-4 mb-2 space-y-1" {...rest} />; },
  li: (props: any) => { const { node, ...rest } = props; return <li className="marker:text-slate-500" {...rest} />; },
  h1: (props: any) => { const { node, ...rest } = props; return <h1 className="text-lg font-bold mt-4 mb-2 text-slate-100" {...rest} />; },
  h2: (props: any) => { const { node, ...rest } = props; return <h2 className="text-base font-bold mt-4 mb-2 text-slate-100 border-b border-slate-700/50 pb-1" {...rest} />; },
  h3: (props: any) => { const { node, ...rest } = props; return <h3 className="text-sm font-bold mt-3 mb-1 text-slate-200" {...rest} />; },
  table: (props: any) => { const { node, ...rest } = props; return <div className="overflow-x-auto my-3"><table className="w-full text-left border-collapse" {...rest} /></div>; },
  th: (props: any) => { const { node, ...rest } = props; return <th className="border border-slate-700 bg-slate-900/50 px-3 py-2 font-semibold text-slate-100" {...rest} />; },
  td: (props: any) => { const { node, ...rest } = props; return <td className="border border-slate-700 px-3 py-2 text-slate-300" {...rest} />; },
  blockquote: (props: any) => { const { node, ...rest } = props; return <blockquote className="border-l-4 border-blue-500/50 bg-slate-900/30 pl-3 py-1 pr-2 my-2 italic text-slate-400 rounded-r" {...rest} />; },
  code(props: any) {
    const { children, className, node, ...rest } = props;
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <div className="rounded-md bg-[var(--c-code-bg)] border border-slate-700/60 my-3 overflow-hidden shadow-sm">
        <div className="bg-slate-800/80 px-3 py-1.5 text-[10px] text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700/60">
          {match[1]}
        </div>
        <pre className="p-3 overflow-x-auto text-[11px] font-mono text-slate-300 leading-normal">
          <code className={className} {...rest}>{children}</code>
        </pre>
      </div>
    ) : (
      <code className="bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700/50 text-slate-300 font-mono text-[11px]" {...rest}>
        {children}
      </code>
    );
  },
};
