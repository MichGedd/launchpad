import { useEffect, useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  type LlmConfigurationRequest,
  type LlmConfigurationStatus,
  type LlmProvider,
  type ReasoningEffort,
} from "~/llm/client";

interface LlmConfigurationDialogProps {
  readonly configuration: LlmConfigurationStatus | null;
  readonly open: boolean;
  readonly onDisconnect: () => Promise<void>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (configuration: LlmConfigurationRequest) => Promise<void>;
}

interface DraftValues {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly apiKey: string;
}

function draftFromConfiguration(configuration: LlmConfigurationStatus | null): DraftValues {
  return {
    provider: configuration?.provider ?? "openai",
    model: configuration?.model ?? "gpt-5.6-luna",
    reasoningEffort: configuration?.reasoningEffort ?? "low",
    apiKey: "",
  };
}

function LlmConfigurationDialog({
  configuration,
  open,
  onDisconnect,
  onOpenChange,
  onSave,
}: LlmConfigurationDialogProps) {
  const [draft, setDraft] = useState(() => draftFromConfiguration(configuration));
  const [isSaving, setIsSaving] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft((current) => ({ ...current, apiKey: "" }));
      return;
    }
    setDraft(draftFromConfiguration(configuration));
    setError(null);
  }, [configuration, open]);

  function updateDraft<Key extends keyof DraftValues>(field: Key, value: DraftValues[Key]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (draft.provider !== "openai") {
      setError("Only ChatGPT is available right now.");
      return;
    }
    if (draft.model.trim().length === 0) {
      setError("Enter an OpenAI model ID.");
      return;
    }
    if (!configuration?.configured && draft.apiKey.trim().length === 0) {
      setError("Enter an API key to configure ChatGPT.");
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        provider: "openai",
        model: draft.model.trim(),
        reasoningEffort: draft.reasoningEffort,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      });
      setDraft((current) => ({ ...current, apiKey: "" }));
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "ChatGPT could not be configured.");
    } finally {
      setIsSaving(false);
    }
  }

  async function disconnect() {
    setError(null);
    setIsDisconnecting(true);
    try {
      await onDisconnect();
      setDraft((current) => ({ ...current, apiKey: "" }));
      onOpenChange(false);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "ChatGPT could not be disconnected.");
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <DialogContent closeLabel="Close LLM configuration" className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Configure language model</DialogTitle>
        <DialogDescription>
          Connect a model for strategy suggestions. Your API key is kept in the server session and is never shown again.
        </DialogDescription>
      </DialogHeader>

      <form className="mt-7 space-y-5" onSubmit={submit}>
        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="llm-provider">Provider</label>
          <select
            className="h-11 w-full appearance-none rounded-2xl border border-white/10 bg-black/10 px-4 text-sm text-foreground outline-none transition focus-visible:border-[#6e8ce1] focus-visible:ring-3 focus-visible:ring-[#6e8ce1]/30 dark:bg-black/15"
            id="llm-provider"
            onChange={(event) => updateDraft("provider", event.target.value as LlmProvider)}
            value={draft.provider}
          >
              <option value="openai">ChatGPT</option>
            <option disabled value="anthropic">Claude (Coming soon)</option>
            <option disabled value="ollama">Ollama (Local) (Coming soon)</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="llm-api-key">API key</label>
          <input
            autoComplete="new-password"
            className="h-11 w-full rounded-2xl border border-white/10 bg-black/10 px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:border-[#6e8ce1] focus-visible:ring-3 focus-visible:ring-[#6e8ce1]/30 dark:bg-black/15"
            id="llm-api-key"
            onChange={(event) => updateDraft("apiKey", event.target.value)}
            placeholder={configuration?.configured ? "Leave blank to keep the saved key" : "sk-…"}
            type="password"
            value={draft.apiKey}
          />
          <p className="text-xs text-muted-foreground">The key is sent only to Launchpad’s same-origin server.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="llm-model">Model ID</label>
            <input
              className="h-11 w-full rounded-2xl border border-white/10 bg-black/10 px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:border-[#6e8ce1] focus-visible:ring-3 focus-visible:ring-[#6e8ce1]/30 dark:bg-black/15"
              id="llm-model"
              onChange={(event) => updateDraft("model", event.target.value)}
              value={draft.model}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium" htmlFor="llm-reasoning">Reasoning effort</label>
            <select
              className="h-11 w-full appearance-none rounded-2xl border border-white/10 bg-black/10 px-4 text-sm text-foreground outline-none transition focus-visible:border-[#6e8ce1] focus-visible:ring-3 focus-visible:ring-[#6e8ce1]/30 dark:bg-black/15"
              id="llm-reasoning"
              onChange={(event) => updateDraft("reasoningEffort", event.target.value as ReasoningEffort)}
              value={draft.reasoningEffort}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/10 pt-5">
          <p className="text-xs text-muted-foreground" role="status">
            {configuration?.configured ? "ChatGPT is configured for this session." : "ChatGPT is not configured."}
          </p>
          <div className="flex gap-2">
            {configuration?.configured ? (
              <Button disabled={isDisconnecting || isSaving} onClick={() => void disconnect()} type="button" variant="destructive">
                {isDisconnecting ? "Disconnecting…" : "Disconnect"}
              </Button>
            ) : null}
            <Button disabled={isSaving || isDisconnecting} type="submit">
              {isSaving ? "Saving…" : "Save configuration"}
            </Button>
          </div>
        </div>
        {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
      </form>
    </DialogContent>
  );
}

export { LlmConfigurationDialog };
