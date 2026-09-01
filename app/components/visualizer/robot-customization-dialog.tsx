import { useEffect, useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { RobotCustomization } from "~/visualizer";

interface RobotCustomizationDialogProps {
  readonly customization: RobotCustomization;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (customization: RobotCustomization) => void;
}

interface DraftValues {
  readonly widthInches: string;
  readonly lengthInches: string;
  readonly translationSpeedFeetPerSecond: string;
  readonly spinSpeedRotationsPerSecond: string;
}

type DraftField = keyof DraftValues;

function draftFromCustomization(customization: RobotCustomization): DraftValues {
  return {
    widthInches: String(customization.widthFeet * 12),
    lengthInches: String(customization.lengthFeet * 12),
    translationSpeedFeetPerSecond: String(customization.translationSpeedFeetPerSecond),
    spinSpeedRotationsPerSecond: String(customization.spinSpeedRotationsPerSecond),
  };
}

function validateDraft(draft: DraftValues): Partial<Record<DraftField, string>> {
  const errors: Partial<Record<DraftField, string>> = {};
  const fields: readonly { readonly key: DraftField; readonly label: string }[] = [
    { key: "widthInches", label: "Width" },
    { key: "lengthInches", label: "Length" },
    { key: "translationSpeedFeetPerSecond", label: "Drive speed" },
    { key: "spinSpeedRotationsPerSecond", label: "Turn speed" },
  ];

  for (const field of fields) {
    const value = Number(draft[field.key]);
    if (draft[field.key].trim().length === 0 || !Number.isFinite(value) || value <= 0) {
      errors[field.key] = `${field.label} must be a finite value greater than zero.`;
    }
  }
  return errors;
}

function RobotCustomizationDialog({
  customization,
  open,
  onOpenChange,
  onSave,
}: RobotCustomizationDialogProps) {
  const [draft, setDraft] = useState(() => draftFromCustomization(customization));
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const errors = validateDraft(draft);

  useEffect(() => {
    if (open) {
      setDraft(draftFromCustomization(customization));
      setHasSubmitted(false);
    }
  }, [customization, open]);

  function updateDraft(field: DraftField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    if (Object.keys(errors).length > 0) return;

    onSave({
      widthFeet: Number(draft.widthInches) / 12,
      lengthFeet: Number(draft.lengthInches) / 12,
      translationSpeedFeetPerSecond: Number(draft.translationSpeedFeetPerSecond),
      spinSpeedRotationsPerSecond: Number(draft.spinSpeedRotationsPerSecond),
    });
    onOpenChange(false);
  }

  return (
    <DialogContent closeLabel="Close robot customization" className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Customize robot</DialogTitle>
        <DialogDescription>
          Set the dimensions and motion limits used when the next replay is generated.
        </DialogDescription>
      </DialogHeader>

      <form className="mt-7 space-y-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <CustomizationField
            error={hasSubmitted ? errors.widthInches : undefined}
            id="robot-width"
            label="Width"
            onChange={(value) => updateDraft("widthInches", value)}
            unit="in"
            value={draft.widthInches}
          />
          <CustomizationField
            error={hasSubmitted ? errors.lengthInches : undefined}
            id="robot-length"
            label="Length"
            onChange={(value) => updateDraft("lengthInches", value)}
            unit="in"
            value={draft.lengthInches}
          />
          <CustomizationField
            error={hasSubmitted ? errors.translationSpeedFeetPerSecond : undefined}
            id="robot-drive-speed"
            label="Drive speed"
            onChange={(value) => updateDraft("translationSpeedFeetPerSecond", value)}
            unit="ft/s"
            value={draft.translationSpeedFeetPerSecond}
          />
          <CustomizationField
            error={hasSubmitted ? errors.spinSpeedRotationsPerSecond : undefined}
            id="robot-turn-speed"
            label="Turn speed"
            onChange={(value) => updateDraft("spinSpeedRotationsPerSecond", value)}
            unit="rot/s"
            value={draft.spinSpeedRotationsPerSecond}
          />
        </div>

        {hasSubmitted && Object.keys(errors).length > 0 ? (
          <p className="text-sm text-red-300" role="alert">
            Enter a finite value greater than zero in each field before saving.
          </p>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-white/10 pt-5">
          <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
            Cancel
          </Button>
          <Button type="submit">Save customization</Button>
        </div>
      </form>
    </DialogContent>
  );
}

interface CustomizationFieldProps {
  readonly error?: string;
  readonly id: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly unit: string;
  readonly value: string;
}

function CustomizationField({ error, id, label, onChange, unit, value }: CustomizationFieldProps) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={error ? true : undefined}
          className="h-11 w-full rounded-2xl border border-white/10 bg-black/10 px-4 pr-14 text-sm text-foreground outline-none transition focus-visible:border-[#6e8ce1] focus-visible:ring-3 focus-visible:ring-[#6e8ce1]/30 aria-invalid:border-red-300 dark:bg-black/15"
          id={id}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value)}
          step="any"
          type="number"
          value={value}
        />
        <span className="pointer-events-none absolute inset-y-0 right-4 grid place-items-center text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
      {error ? <p className="text-xs text-red-300" id={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

export { RobotCustomizationDialog };
