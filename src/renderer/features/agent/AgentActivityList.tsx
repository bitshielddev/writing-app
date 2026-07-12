import { memo, useMemo } from "react";

import type { AgentActivity, AgentRuntime } from "../../../contracts/desktop-bridge";

type AgentActivityListProps = {
  items: AgentActivity[];
  runtime: AgentRuntime;
};

/**
 * What: renders the agent activity list component and wires its props into the surrounding UI.
 *
 * Why: callers need this behavior in one named place instead of duplicating it.
 * Called when: used by SuggestionDock and DockContent when that path needs this behavior.
 */
function AgentActivityRow({ item }: { item: AgentActivity }) {
  return (
    <li className="rounded-lg border border-[#dedbe9] bg-white/75 p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[0.65rem] font-extrabold tracking-[0.08em] text-brand-700 uppercase">{item.kind}</span>
        <time className="text-[0.65rem] text-[#8b8798]" dateTime={new Date(item.timestamp).toISOString()}>
          {new Date(item.timestamp).toLocaleTimeString()}
        </time>
      </div>
      <h3 className="mt-1.5 text-sm font-bold text-[#292a34]">{item.title}</h3>
      {item.text ? <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-[#5d5b6d]">{item.text}</p> : null}
    </li>
  );
}

const MemoizedAgentActivityRow = memo(AgentActivityRow);

export const AgentActivityList = memo(function AgentActivityList({
  items,
  runtime,
}: AgentActivityListProps) {
  const orderedItems = useMemo(() => [...items].sort(
    (left, right) => right.timestamp - left.timestamp,
  ), [items]);

  return (
    <div className="px-5 py-6 2xl:px-7 2xl:py-7">
      <header>
        <h2 className="text-lg font-extrabold text-[#1a1b22]">Agent activity</h2>
        <p className="mt-1 text-xs font-semibold text-[#777386]">
          {runtime.status} · cycle {runtime.cycleCount}
          {runtime.activeRevision === undefined
            ? ""
            : ` · revision ${runtime.activeRevision}`}
        </p>
      </header>
      <ol className="mt-5 grid gap-3" aria-label="Agent activity log">
        {orderedItems.map((item) => (
          <MemoizedAgentActivityRow key={item.id} item={item} />
        ))}
        {!items.length ? (
          <li className="rounded-xl border border-dashed border-[#c9c5dc] bg-white/35 px-5 py-10 text-center text-sm text-[#686577]">
            Activity from this app launch will appear here.
          </li>
        ) : null}
      </ol>
    </div>
  );
});
