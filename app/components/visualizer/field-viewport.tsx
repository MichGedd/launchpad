import type {
  PlaybackFrame,
  VisualizerPreview,
  VisualizerScene,
} from "~/visualizer";
import { formatZoneCountLabel, zoneLabelPosition } from "~/visualizer";
import { LoaderCircleIcon } from "lucide-react";

import { SimulationTelemetry } from "./simulation-telemetry";

interface FieldViewportProps {
  readonly frame: PlaybackFrame | null;
  readonly isGenerating?: boolean;
  readonly preview: VisualizerPreview;
  readonly scene: VisualizerScene | null;
}

function pointsForPolygon(
  vertices: readonly { readonly xFeet: number; readonly yFeet: number }[],
  fieldHeightFeet: number,
) {
  return vertices
    .map(({ xFeet, yFeet }) => `${xFeet},${fieldHeightFeet - yFeet}`)
    .join(" ");
}

function FieldViewport({
  frame,
  isGenerating = false,
  preview,
  scene,
}: FieldViewportProps) {
  const field = scene?.field ?? preview.field;
  const displayedFrame = scene === null ? preview.initialFrame : frame;
  const zones = scene?.playback.zones ?? preview.zones;
  const rankingPointDefinitions =
    scene?.playback.rankingPointDefinitions ?? preview.rankingPointDefinitions;
  const navGrid = scene?.navGrid ?? preview.navGrid;

  return (
    <div
      aria-label="Simulation field"
      className="relative size-full overflow-hidden rounded-[26px] border border-white/12 bg-[#666b6e] shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_28px_70px_rgb(0_0_0/0.22)]"
      role="region"
    >
      <svg
        aria-label={field.backgroundImage?.altText ?? "Robot position and field zones"}
        className="size-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        viewBox={`0 0 ${field.widthFeet} ${field.heightFeet}`}
      >
        <defs>
          <pattern
            id="field-grid"
            width="3"
            height="3"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 3 0 L 0 0 0 3"
              fill="none"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="0.06"
            />
          </pattern>
          <filter id="robot-shadow" x="-80%" y="-80%" width="260%" height="260%">
            <feDropShadow dx="0" dy="0.35" floodColor="#08133a" floodOpacity="0.45" stdDeviation="0.5" />
          </filter>
        </defs>

        <rect fill="#72777a" height={field.heightFeet} width={field.widthFeet} />
        {field.backgroundImage ? (
          <image
            height={field.heightFeet}
            href={field.backgroundImage.source}
            preserveAspectRatio="xMidYMid slice"
            width={field.widthFeet}
          />
        ) : null}
        <rect fill="url(#field-grid)" height={field.heightFeet} width={field.widthFeet} />
        <rect
          fill="none"
          height={field.heightFeet - 1.2}
          rx="1"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="0.12"
          width={field.widthFeet - 1.2}
          x="0.6"
          y="0.6"
        />
        <line
          stroke="rgba(255,255,255,0.18)"
          strokeDasharray="0.35 0.35"
          strokeWidth="0.1"
          x1={field.widthFeet / 2}
          x2={field.widthFeet / 2}
          y1="0.8"
          y2={field.heightFeet - 0.8}
        />

        {navGrid.zones.map((zone) => {
          const className = zone.traversalRule.kind === "feature-specific"
            ? "fill-[#21409a]/28 stroke-[#8ea5ff]"
            : "fill-black/35 stroke-white/60";
          if (zone.shape.type === "circle") {
            return <circle className={className} cx={zone.shape.center.xFeet} cy={field.heightFeet - zone.shape.center.yFeet} data-navgrid-zone-id={zone.id} key={`nav-${zone.id}`} r={zone.shape.radiusFeet} strokeWidth="0.1" />;
          }
          return <rect className={className} data-navgrid-zone-id={zone.id} height={zone.shape.heightFeet} key={`nav-${zone.id}`} transform={`rotate(${-((zone.shape.headingRotations ?? 0) * 360)} ${zone.shape.center.xFeet} ${field.heightFeet - zone.shape.center.yFeet})`} width={zone.shape.widthFeet} x={zone.shape.center.xFeet - zone.shape.widthFeet / 2} y={field.heightFeet - zone.shape.center.yFeet - zone.shape.heightFeet / 2} strokeWidth="0.1" />;
        })}

        {zones.map((zone) => {
          const className =
            zone.kind === "score"
              ? "fill-[#f7931e]/18 stroke-[#f7931e]"
              : zone.kind === "pickup"
                ? "fill-[#21409a]/24 stroke-[#6e8ce1]"
                : "fill-red-950/30 stroke-red-300/70";
          const shape = zone.shape;

          if (shape.type === "circle") {
            return (
              <circle
                className={className}
                cx={shape.center.xFeet}
                cy={field.heightFeet - shape.center.yFeet}
                data-zone-id={zone.id}
                key={zone.id}
                r={shape.radiusFeet}
                strokeDasharray="0.35 0.2"
                strokeWidth="0.14"
              />
            );
          }

          if (shape.type === "rectangle") {
            return (
              <rect
                className={className}
                data-zone-id={zone.id}
                height={shape.heightFeet}
                key={zone.id}
                rx="0.45"
                strokeDasharray="0.35 0.2"
                strokeWidth="0.14"
                transform={`rotate(${-((shape.headingRotations ?? 0) * 360)} ${shape.center.xFeet} ${field.heightFeet - shape.center.yFeet})`}
                width={shape.widthFeet}
                x={shape.center.xFeet - shape.widthFeet / 2}
                y={field.heightFeet - shape.center.yFeet - shape.heightFeet / 2}
              />
            );
          }

          return (
            <polygon
              className={className}
              data-zone-id={zone.id}
              key={zone.id}
              points={pointsForPolygon(shape.vertices, field.heightFeet)}
              strokeDasharray="0.35 0.2"
              strokeWidth="0.14"
            />
          );
        })}

        {zones.map((zone) => {
          const label = formatZoneCountLabel(zone, displayedFrame?.zoneStates[zone.id]);
          if (label === null) return null;
          const position = zoneLabelPosition(zone);
          const width = Math.max(2.4, label.compactText.length * 0.48 + 1.1);
          return (
            <g
              aria-label={label.accessibleText}
              className="pointer-events-none"
              key={`${zone.id}-count`}
              role="img"
              transform={`translate(${position.xFeet} ${field.heightFeet - position.yFeet})`}
            >
              <title>{`${zone.id}: ${label.accessibleText}`}</title>
              <rect
                fill="rgba(25,29,31,0.78)"
                height="1.25"
                rx="0.5"
                stroke="rgba(255,255,255,0.28)"
                strokeWidth="0.08"
                width={width}
                x={-width / 2}
                y="-0.625"
              />
              <text
                dominantBaseline="central"
                fill="white"
                fontFamily="Geist Variable, Geist, sans-serif"
                fontSize="0.68"
                fontWeight="600"
                textAnchor="middle"
              >
                {label.compactText}
              </text>
            </g>
          );
        })}

        {displayedFrame ? (
          <g
            data-robot="true"
            filter="url(#robot-shadow)"
            transform={`translate(${displayedFrame.robot.pose.xFeet} ${field.heightFeet - displayedFrame.robot.pose.yFeet}) rotate(${-displayedFrame.robot.pose.headingRotations * 360})`}
          >
            <rect
              fill="#21409a"
              height={displayedFrame.robot.lengthFeet}
              rx="0.5"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="0.16"
              width={displayedFrame.robot.widthFeet}
              x={-displayedFrame.robot.widthFeet / 2}
              y={-displayedFrame.robot.lengthFeet / 2}
            />
            <path
              d={`M 0 0 L ${displayedFrame.robot.widthFeet * 0.75} 0`}
              stroke="#f7931e"
              strokeLinecap="round"
              strokeWidth="0.24"
            />
            <circle fill="white" r="0.18" />
          </g>
        ) : null}
      </svg>

      <ul aria-label="Zone game object counts" className="sr-only">
        {zones.map((zone) => {
          const label = formatZoneCountLabel(zone, displayedFrame?.zoneStates[zone.id]);
          return label ? <li key={`${zone.id}-accessible-count`}>{`${zone.id}: ${label.accessibleText}`}</li> : null;
        })}
      </ul>

      <div className="pointer-events-none absolute left-5 top-5 rounded-xl border border-white/12 bg-black/25 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-white/70 backdrop-blur-xl">
        Neutral field · {field.widthFeet} × {field.heightFeet} ft
      </div>
      <SimulationTelemetry
        definitions={rankingPointDefinitions}
        metrics={displayedFrame?.metrics ?? null}
        robot={displayedFrame?.robot ?? null}
      />

      {isGenerating ? (
        <div
          aria-label="Generating simulation"
          aria-live="polite"
          className="absolute inset-0 z-30 grid place-items-center rounded-[26px] bg-[#202527]/48 backdrop-blur-[3px]"
          role="status"
        >
          <div className="glass-panel flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-medium text-white shadow-xl shadow-black/20">
            <LoaderCircleIcon aria-hidden="true" className="size-5 animate-spin text-[#f7931e]" />
            Generating simulation…
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { FieldViewport };
