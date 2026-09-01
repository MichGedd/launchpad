import { ActivityIcon, BoxIcon, MapPinIcon, TimerIcon } from "lucide-react";

import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { PlaybackFrame, VisualizerScene } from "~/visualizer";

interface ReplayDetailsProps {
  readonly currentTimeSeconds: number;
  readonly frame: PlaybackFrame | null;
  readonly scene: VisualizerScene | null;
}

function formatNumber(value: number) {
  return value.toFixed(1);
}

function ReplayDetails({ currentTimeSeconds, frame, scene }: ReplayDetailsProps) {
  const visibleEvents =
    scene?.playback.events.filter(
      (event) => event.timeSeconds <= currentTimeSeconds,
    ) ?? [];
  const inventory = Object.entries(frame?.robot.inventory ?? {});

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Replay details</DialogTitle>
        <DialogDescription>
          Robot state and events at {formatNumber(currentTimeSeconds)} seconds.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-7 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
          <ActivityIcon aria-hidden="true" className="mb-3 size-4 text-[#6e8ce1]" />
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Status</p>
          <p className="mt-1 font-medium capitalize">{frame?.status.replace("-", " ") ?? "Preparing"}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
          <MapPinIcon aria-hidden="true" className="mb-3 size-4 text-[#6e8ce1]" />
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Position</p>
          <p className="mt-1 font-medium">
            {frame
              ? `${formatNumber(frame.robot.pose.xFeet)}, ${formatNumber(frame.robot.pose.yFeet)} ft`
              : "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
          <TimerIcon aria-hidden="true" className="mb-3 size-4 text-[#6e8ce1]" />
          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Heading</p>
          <p className="mt-1 font-medium">
            {frame ? `${Math.round(frame.robot.pose.headingRotations * 360)}°` : "—"}
          </p>
        </div>
      </div>

      <section className="mt-6" aria-labelledby="inventory-heading">
        <div className="mb-3 flex items-center gap-2">
          <BoxIcon aria-hidden="true" className="size-4 text-[#6e8ce1]" />
          <h3 className="text-sm font-semibold" id="inventory-heading">Inventory</h3>
        </div>
        <div className="flex min-h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
          {inventory.length > 0
            ? inventory.map(([name, count]) => (
                <span className="rounded-lg bg-white/8 px-2 py-1" key={name}>
                  {name}: {count}
                </span>
              ))
            : "No game objects held at this moment."}
        </div>
      </section>

      <section className="mt-6" aria-labelledby="events-heading">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold" id="events-heading">Event timeline</h3>
          <span className="text-xs text-muted-foreground">{visibleEvents.length} reached</span>
        </div>
        <ol className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {visibleEvents.length > 0 ? (
            [...visibleEvents].reverse().map((event, index) => (
              <li
                className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3"
                key={`${event.timeSeconds}-${event.type}-${index}`}
              >
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#f7931e]" />
                <div className="min-w-0">
                  <p className="text-sm font-medium capitalize">{event.type.replaceAll("-", " ")}</p>
                  <p className="text-xs text-muted-foreground">{formatNumber(event.timeSeconds)}s · {event.actionId}</p>
                </div>
              </li>
            ))
          ) : (
            <li className="rounded-2xl border border-dashed border-white/12 px-4 py-6 text-center text-sm text-muted-foreground">
              Events will appear as the replay advances.
            </li>
          )}
        </ol>
      </section>
    </DialogContent>
  );
}

export { ReplayDetails };
