import { Bot, Pause, Play, RefreshCw, Settings2 } from "lucide-react";
import { useState } from "react";

import type {
  AgentRuntime,
  ProviderSettings,
} from "../shared/desktop";

type AgentControlsProps = {
  provider: ProviderSettings;
  runtime: AgentRuntime;
  onSaveProvider: (
    provider: ProviderSettings & { apiKey: string },
  ) => Promise<void>;
  onSetPaused: (paused: boolean) => Promise<void>;
  onConsiderNow: () => Promise<void>;
};

export function AgentControls({
  provider,
  runtime,
  onSaveProvider,
  onSetPaused,
  onConsiderNow,
}: AgentControlsProps) {
  const [draft, setDraft] = useState(provider);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSaveProvider({ ...draft, apiKey });
      setApiKey("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="mt-5 rounded-lg border border-[#d7d4e8] bg-white/55 px-3 py-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold text-[#5d5b6d]">
        <Settings2 className="size-4" aria-hidden="true" />
        Agent settings
        <span className="ml-auto font-medium text-[#8b8798]">
          {provider.enabled ? `${provider.provider}/${provider.model}` : "Not configured"}
        </span>
      </summary>
      <div className="mt-3 grid gap-3 border-t border-[#e8e5f2] pt-3">
        <label className="grid gap-1 text-xs font-semibold text-[#5d5b6d]">
          Provider
          <input
            className="min-h-9 rounded-md border border-[#d7d4e8] bg-white px-2.5 text-sm text-[#20212a]"
            value={draft.provider}
            onChange={(event) =>
              setDraft((value) => ({ ...value, provider: event.target.value }))
            }
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[#5d5b6d]">
          Model
          <input
            className="min-h-9 rounded-md border border-[#d7d4e8] bg-white px-2.5 text-sm text-[#20212a]"
            value={draft.model}
            onChange={(event) =>
              setDraft((value) => ({ ...value, model: event.target.value }))
            }
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[#5d5b6d]">
          Base URL (optional)
          <input
            className="min-h-9 rounded-md border border-[#d7d4e8] bg-white px-2.5 text-sm text-[#20212a]"
            value={draft.baseUrl}
            onChange={(event) =>
              setDraft((value) => ({ ...value, baseUrl: event.target.value }))
            }
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[#5d5b6d]">
          API key for this launch
          <input
            type="password"
            autoComplete="off"
            className="min-h-9 rounded-md border border-[#d7d4e8] bg-white px-2.5 text-sm text-[#20212a]"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-[#5d5b6d]">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft((value) => ({ ...value, enabled: event.target.checked }))
            }
          />
          Enable the writing agent
        </label>
        <button
          type="button"
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-brand-600 px-3 text-xs font-bold text-white disabled:opacity-50"
          disabled={saving || !draft.provider.trim() || !draft.model.trim()}
          onClick={() => void save()}
        >
          <Bot className="size-4" aria-hidden="true" />
          {saving ? "Saving…" : "Save provider"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-brand-300 bg-white px-2 text-xs font-bold text-brand-700 disabled:opacity-50"
            disabled={!provider.enabled}
            onClick={() => void onSetPaused(!runtime.paused)}
          >
            {runtime.paused ? (
              <Play className="size-4" aria-hidden="true" />
            ) : (
              <Pause className="size-4" aria-hidden="true" />
            )}
            {runtime.paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-brand-300 bg-white px-2 text-xs font-bold text-brand-700 disabled:opacity-50"
            disabled={!provider.enabled || runtime.paused || runtime.running}
            onClick={() => void onConsiderNow()}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Consider now
          </button>
        </div>
      </div>
    </details>
  );
}
