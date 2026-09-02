import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CircleIcon, DownloadIcon, MousePointer2Icon, PlusIcon, RotateCwIcon, Trash2Icon, UploadIcon } from "lucide-react";

import type { NavGridDefinition, NavGridNonTraversalZone, Point, RectangleShape, RobotState, Zone } from "~/engine/types";
import { Button } from "~/components/ui/button";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { analyzeNavGridReachability, parseNavGridJson, serializeNavGrid, validateNavGrid } from "~/visualizer/navgrid";
import type { FieldBackgroundImage, RobotFeatureOption } from "~/visualizer";

type ShapeType = "rectangle" | "circle";
type EditorTool = "select" | ShapeType;
type Interaction =
  | { kind: "move" | "resize" | "rotate"; zoneId: string; start: Point; original: NavGridNonTraversalZone; anchor?: "nw" | "ne" | "se" | "sw" }
  | null;

interface FieldEditorDialogProps {
  readonly defaultNavGrid: NavGridDefinition;
  readonly backgroundImage?: FieldBackgroundImage;
  readonly features: readonly RobotFeatureOption[];
  readonly initialNavGrid: NavGridDefinition;
  readonly meaningfulZones: readonly Zone[];
  readonly open: boolean;
  readonly robot: Pick<RobotState, "widthFeet" | "lengthFeet" | "pose">;
  readonly selectedFeatureIds: readonly string[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (grid: NavGridDefinition, resetToDefault: boolean) => void;
}

function cloneGrid(grid: NavGridDefinition): NavGridDefinition {
  return structuredClone(grid);
}

function pointFromEvent(event: ReactPointerEvent<SVGElement>, svg: SVGSVGElement, grid: NavGridDefinition): Point {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { xFeet: 0, yFeet: 0 };
  const source = svg.createSVGPoint();
  source.x = event.clientX;
  source.y = event.clientY;
  const point = source.matrixTransform(matrix.inverse());
  return {
    xFeet: Math.max(0, Math.min(grid.fieldWidthFeet, point.x)),
    yFeet: Math.max(0, Math.min(grid.fieldHeightFeet, grid.fieldHeightFeet - point.y)),
  };
}

function distanceToPoint(a: Point, b: Point) { return Math.hypot(a.xFeet - b.xFeet, a.yFeet - b.yFeet); }

function zoneContains(zone: NavGridNonTraversalZone, point: Point): boolean {
  if (zone.shape.type === "circle") return distanceToPoint(zone.shape.center, point) <= zone.shape.radiusFeet;
  const angle = -(zone.shape.headingRotations ?? 0) * Math.PI * 2;
  const dx = point.xFeet - zone.shape.center.xFeet; const dy = point.yFeet - zone.shape.center.yFeet;
  const x = dx * Math.cos(angle) - dy * Math.sin(angle); const y = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(x) <= zone.shape.widthFeet / 2 && Math.abs(y) <= zone.shape.heightFeet / 2;
}

function updateZone(grid: NavGridDefinition, zoneId: string, shape: NavGridNonTraversalZone["shape"]): NavGridDefinition {
  return { ...grid, zones: grid.zones.map((zone) => zone.id === zoneId ? { ...zone, shape } : zone) };
}

function newZone(grid: NavGridDefinition, type: ShapeType, center: Point): NavGridNonTraversalZone {
  const ids = new Set(grid.zones.map((zone) => zone.id));
  let index = 1;
  while (ids.has(`obstacle-${index}`)) index += 1;
  return type === "circle"
    ? { id: `obstacle-${index}`, shape: { type: "circle", center, radiusFeet: 2 }, traversalRule: { kind: "general" } }
    : { id: `obstacle-${index}`, shape: { type: "rectangle", center, widthFeet: 4, heightFeet: 2, headingRotations: 0 }, traversalRule: { kind: "general" } };
}

function numericValue(value: string, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function FieldEditorDialog({ backgroundImage, defaultNavGrid, features, initialNavGrid, meaningfulZones, open, robot, selectedFeatureIds, onOpenChange, onSave }: FieldEditorDialogProps) {
  const [draft, setDraft] = useState(() => cloneGrid(defaultNavGrid));
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [warningKind, setWarningKind] = useState<"validation" | "connectivity" | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { if (open) { setDraft(cloneGrid(initialNavGrid)); setSelectedZoneId(null); setTool("select"); setWarning(null); setWarningKind(null); } }, [initialNavGrid, open]);

  const selected = draft.zones.find((zone) => zone.id === selectedZoneId) ?? null;
  const fieldWidth = draft.fieldWidthFeet;
  const fieldHeight = draft.fieldHeightFeet;

  function beginPointer(event: ReactPointerEvent<SVGElement>, zone: NavGridNonTraversalZone) {
    if (!svgRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedZoneId(zone.id);
    const point = pointFromEvent(event, svgRef.current, draft);
    setInteraction({ kind: "move", zoneId: zone.id, start: point, original: zone });
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!interaction || !svgRef.current) return;
    const point = pointFromEvent(event, svgRef.current, draft);
    const delta = { xFeet: point.xFeet - interaction.start.xFeet, yFeet: point.yFeet - interaction.start.yFeet };
    const shape = interaction.original.shape;
    if (interaction.kind === "move") {
      const center = { xFeet: shape.center.xFeet + delta.xFeet, yFeet: shape.center.yFeet + delta.yFeet };
      setDraft((grid) => updateZone(grid, interaction.zoneId, { ...shape, center }));
    } else if (interaction.kind === "rotate" && shape.type === "rectangle") {
      const angle = Math.atan2(point.yFeet - shape.center.yFeet, point.xFeet - shape.center.xFeet) / (Math.PI * 2);
      setDraft((grid) => updateZone(grid, interaction.zoneId, { ...shape, headingRotations: angle }));
    } else if (interaction.kind === "resize") {
      if (shape.type === "circle") {
        setDraft((grid) => updateZone(grid, interaction.zoneId, { ...shape, radiusFeet: Math.max(0.25, distanceToPoint(shape.center, point)) }));
      } else {
        const angle = -(shape.headingRotations ?? 0) * Math.PI * 2;
        const dx = point.xFeet - shape.center.xFeet; const dy = point.yFeet - shape.center.yFeet;
        const local = { xFeet: Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) * 2, yFeet: Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) * 2 };
        setDraft((grid) => updateZone(grid, interaction.zoneId, { ...shape, widthFeet: Math.max(0.25, local.xFeet), heightFeet: Math.max(0.25, local.yFeet) }));
      }
    }
  }

  function clickField(event: ReactPointerEvent<SVGSVGElement>) {
    if (tool === "select" || !svgRef.current) return;
    const center = pointFromEvent(event, svgRef.current, draft);
    const zone = newZone(draft, tool, center);
    setDraft((grid) => ({ ...grid, zones: [...grid.zones, zone] }));
    setSelectedZoneId(zone.id);
    setTool("select");
  }

  function save() {
    const validation = validateNavGrid(draft, { seasonId: draft.seasonId, fieldWidthFeet: fieldWidth, fieldHeightFeet: fieldHeight, featureIds: features.map((feature) => feature.id) });
    if (!validation.valid) { setWarning(validation.errors.join(" ")); setWarningKind("validation"); return; }
    const result = analyzeNavGridReachability(draft, robot.pose, robot, selectedFeatureIds, meaningfulZones);
    if (!result.startValid) { setWarning("The robot starting position is inside an obstacle or outside the traversable field. Save anyway to keep this layout?"); setWarningKind("connectivity"); return; }
    if (result.unreachableZoneIds.length > 0 && warning === null) { setWarning(`These zones cannot be reached from the starting position: ${result.unreachableZoneIds.join(", ")}. Save anyway?`); setWarningKind("connectivity"); return; }
    onSave(cloneGrid(draft), serializeNavGrid(draft) === serializeNavGrid(defaultNavGrid)); onOpenChange(false);
  }

  function importGrid(file: File) {
    void file.text().then((text) => {
      try { setDraft(parseNavGridJson(text, { seasonId: draft.seasonId, fieldWidthFeet: fieldWidth, fieldHeightFeet: fieldHeight, featureIds: features.map((feature) => feature.id) })); setWarning(null); setWarningKind(null); setSelectedZoneId(null); }
      catch (error) { setWarning(error instanceof Error ? error.message : "Unable to import this NavGrid."); setWarningKind("validation"); }
    });
  }

  function exportGrid() {
    const url = URL.createObjectURL(new Blob([serializeNavGrid(draft)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${draft.seasonId}-navgrid.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  function setSelectedProperty(property: string, value: string) {
    if (!selected) return;
    const shape = selected.shape;
    let nextShape: NavGridNonTraversalZone["shape"] = shape;
    if (property === "x" || property === "y") nextShape = { ...shape, center: { ...shape.center, [property === "x" ? "xFeet" : "yFeet"]: numericValue(value, shape.center[property === "x" ? "xFeet" : "yFeet"]) } };
    if (shape.type === "circle" && property === "radius") nextShape = { ...shape, radiusFeet: Math.max(0.25, numericValue(value, shape.radiusFeet)) };
    if (shape.type === "rectangle" && ["width", "height", "rotation"].includes(property)) nextShape = { ...shape, ...(property === "width" ? { widthFeet: Math.max(0.25, numericValue(value, shape.widthFeet)) } : property === "height" ? { heightFeet: Math.max(0.25, numericValue(value, shape.heightFeet)) } : { headingRotations: numericValue(value, shape.headingRotations ?? 0) }) };
    setDraft((grid) => updateZone(grid, selected.id, nextShape));
  }

  return (
    <DialogContent className="max-w-[min(1200px,calc(100vw-64px))] overflow-hidden p-0" closeLabel="Close field editor">
      <DialogHeader className="border-b border-white/10 px-7 pb-5 pt-7">
        <DialogTitle>Field editor</DialogTitle>
        <DialogDescription>Place non-traversal zones on the 0.5-inch navigation grid. Changes remain a draft until saved.</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-[min(700px,calc(100vh-180px))] grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-h-0 flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant={tool === "select" ? "secondary" : "ghost"} onClick={() => setTool("select")}><MousePointer2Icon />Select</Button>
            <Button type="button" variant={tool === "rectangle" ? "secondary" : "ghost"} onClick={() => setTool("rectangle")}><PlusIcon />Rectangle</Button>
            <Button type="button" variant={tool === "circle" ? "secondary" : "ghost"} onClick={() => setTool("circle")}><CircleIcon />Circle</Button>
            <span className="ml-auto text-xs text-muted-foreground">{draft.zones.length} obstacles · {draft.cellSizeInches} in fidelity</span>
          </div>
          <div className="min-h-0 flex-1 rounded-2xl border border-white/12 bg-[#666b6e] p-2">
            <svg ref={svgRef} className="size-full touch-none" preserveAspectRatio="xMidYMid meet" viewBox={`0 0 ${fieldWidth} ${fieldHeight}`} onPointerDown={clickField} onPointerMove={pointerMove} onPointerUp={() => setInteraction(null)}>
              <rect fill="#72777a" width={fieldWidth} height={fieldHeight} />
              {backgroundImage ? <image height={fieldHeight} href={backgroundImage.source} preserveAspectRatio="xMidYMid slice" width={fieldWidth} /> : null}
              <path d={`M ${fieldWidth / 2} 0 V ${fieldHeight}`} stroke="rgba(255,255,255,.2)" strokeDasharray=".35 .35" strokeWidth=".1" />
              <rect fill="none" height={fieldHeight - 1.2} rx="1" stroke="rgba(255,255,255,.3)" strokeWidth=".12" width={fieldWidth - 1.2} x=".6" y=".6" />
              <g opacity=".9" transform={`rotate(${-robot.pose.headingRotations * 360} ${robot.pose.xFeet} ${fieldHeight - robot.pose.yFeet})`}><rect fill="#21409a" height={robot.lengthFeet} rx=".35" stroke="white" strokeWidth=".1" width={robot.widthFeet} x={robot.pose.xFeet - robot.widthFeet / 2} y={fieldHeight - robot.pose.yFeet - robot.lengthFeet / 2} /><circle fill="#f7931e" r=".16" cx={robot.pose.xFeet} cy={fieldHeight - robot.pose.yFeet} /></g>
              {meaningfulZones.map((zone) => zone.shape.type === "circle" ? <circle key={zone.id} cx={zone.shape.center.xFeet} cy={fieldHeight - zone.shape.center.yFeet} r={zone.shape.radiusFeet} fill="none" stroke="#f7931e" strokeDasharray=".3 .2" strokeWidth=".12" /> : zone.shape.type === "rectangle" ? <rect key={zone.id} x={zone.shape.center.xFeet - zone.shape.widthFeet / 2} y={fieldHeight - zone.shape.center.yFeet - zone.shape.heightFeet / 2} width={zone.shape.widthFeet} height={zone.shape.heightFeet} transform={`rotate(${-((zone.shape.headingRotations ?? 0) * 360)} ${zone.shape.center.xFeet} ${fieldHeight - zone.shape.center.yFeet})`} fill="none" stroke="#f7931e" strokeDasharray=".3 .2" strokeWidth=".12" /> : <polygon key={zone.id} points={zone.shape.vertices.map((point) => `${point.xFeet},${fieldHeight - point.yFeet}`).join(" ")} fill="none" stroke="#f7931e" strokeDasharray=".3 .2" strokeWidth=".12" />)}
              {draft.zones.map((zone) => {
                const isSelected = zone.id === selectedZoneId; const common = { onPointerDown: (event: ReactPointerEvent<SVGElement>) => { event.stopPropagation(); beginPointer(event, zone); }, className: isSelected ? "cursor-move fill-red-400/35 stroke-white" : "cursor-pointer fill-red-950/45 stroke-red-200" };
                return zone.shape.type === "circle" ? <g key={zone.id}><circle {...common} cx={zone.shape.center.xFeet} cy={fieldHeight - zone.shape.center.yFeet} r={zone.shape.radiusFeet} strokeWidth={isSelected ? ".2" : ".12"} /><circle aria-label="Resize circle" cx={zone.shape.center.xFeet + zone.shape.radiusFeet} cy={fieldHeight - zone.shape.center.yFeet} fill="#f7931e" r=".18" onPointerDown={(event) => { event.stopPropagation(); if (svgRef.current) setInteraction({ kind: "resize", zoneId: zone.id, start: pointFromEvent(event, svgRef.current, draft), original: zone }); }} /></g> : <g key={zone.id} transform={`rotate(${-((zone.shape.headingRotations ?? 0) * 360)} ${zone.shape.center.xFeet} ${fieldHeight - zone.shape.center.yFeet})`}><rect {...common} x={zone.shape.center.xFeet - zone.shape.widthFeet / 2} y={fieldHeight - zone.shape.center.yFeet - zone.shape.heightFeet / 2} width={zone.shape.widthFeet} height={zone.shape.heightFeet} strokeWidth={isSelected ? ".2" : ".12"} /><circle aria-label="Resize rectangle" cx={zone.shape.center.xFeet + zone.shape.widthFeet / 2} cy={fieldHeight - zone.shape.center.yFeet - zone.shape.heightFeet / 2} fill="#f7931e" r=".18" onPointerDown={(event) => { event.stopPropagation(); if (svgRef.current) setInteraction({ kind: "resize", zoneId: zone.id, start: pointFromEvent(event, svgRef.current, draft), original: zone }); }} />{isSelected ? <circle aria-label="Rotate rectangle" cx={zone.shape.center.xFeet} cy={fieldHeight - zone.shape.center.yFeet - zone.shape.heightFeet / 2 - .7} fill="#21409a" r=".2" onPointerDown={(event) => { event.stopPropagation(); if (svgRef.current) setInteraction({ kind: "rotate", zoneId: zone.id, start: pointFromEvent(event, svgRef.current, draft), original: zone }); }} /> : null}</g>;
              })}
            </svg>
          </div>
        </div>
        <aside className="overflow-y-auto border-l border-white/10 bg-black/10 p-5">
          <h3 className="text-sm font-semibold">Selected obstacle</h3>
          {selected ? <div className="mt-4 space-y-4">
            <label className="block text-xs text-muted-foreground">ID<input className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm" value={selected.id} onChange={(event) => setDraft((grid) => ({ ...grid, zones: grid.zones.map((zone) => zone.id === selected.id ? { ...zone, id: event.target.value } : zone) }))} /></label>
            <div className="grid grid-cols-2 gap-2"><EditorNumber label="X (ft)" value={selected.shape.center.xFeet} onChange={(value) => setSelectedProperty("x", value)} /><EditorNumber label="Y (ft)" value={selected.shape.center.yFeet} onChange={(value) => setSelectedProperty("y", value)} /></div>
            {selected.shape.type === "circle" ? <EditorNumber label="Radius (ft)" value={selected.shape.radiusFeet} onChange={(value) => setSelectedProperty("radius", value)} /> : <div className="grid grid-cols-2 gap-2"><EditorNumber label="Width (ft)" value={selected.shape.widthFeet} onChange={(value) => setSelectedProperty("width", value)} /><EditorNumber label="Height (ft)" value={selected.shape.heightFeet} onChange={(value) => setSelectedProperty("height", value)} /><EditorNumber label="Rotation" value={selected.shape.headingRotations ?? 0} onChange={(value) => setSelectedProperty("rotation", value)} /></div>}
            <label className="block text-xs text-muted-foreground">Traversal rule<select className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm text-foreground" value={selected.traversalRule.kind} onChange={(event) => setDraft((grid) => ({ ...grid, zones: grid.zones.map((zone) => zone.id === selected.id ? { ...zone, traversalRule: event.target.value === "general" ? { kind: "general" } : { kind: "feature-specific", requiredFeatureId: features[0]?.id ?? "" } } : zone) }))}><option value="general">General obstacle</option><option value="feature-specific">Feature-specific</option></select></label>
            {selected.traversalRule.kind === "feature-specific" ? <label className="block text-xs text-muted-foreground">Required feature<select className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm text-foreground" value={selected.traversalRule.requiredFeatureId} onChange={(event) => setDraft((grid) => ({ ...grid, zones: grid.zones.map((zone) => zone.id === selected.id && zone.traversalRule.kind === "feature-specific" ? { ...zone, traversalRule: { ...zone.traversalRule, requiredFeatureId: event.target.value } } : zone) }))}>{features.map((feature) => <option key={feature.id} value={feature.id}>{feature.label}</option>)}</select></label> : null}
            <Button className="w-full" type="button" variant="destructive" onClick={() => { setDraft((grid) => ({ ...grid, zones: grid.zones.filter((zone) => zone.id !== selected.id) })); setSelectedZoneId(null); }}><Trash2Icon />Delete obstacle</Button>
          </div> : <p className="mt-2 text-xs leading-5 text-muted-foreground">Select an obstacle or choose a shape tool, then click the field to place it.</p>}
          {warning ? <div className="mt-5 rounded-xl border border-amber-300/40 bg-amber-950/25 p-3 text-xs leading-5 text-amber-100" role="alert"><p>{warning}</p><div className="mt-3 flex gap-2">{warningKind === "connectivity" ? <Button type="button" size="sm" onClick={() => { const validation = validateNavGrid(draft, { seasonId: draft.seasonId, fieldWidthFeet: fieldWidth, fieldHeightFeet: fieldHeight, featureIds: features.map((feature) => feature.id) }); if (!validation.valid) { setWarning(validation.errors.join(" ")); setWarningKind("validation"); return; } onSave(cloneGrid(draft), serializeNavGrid(draft) === serializeNavGrid(defaultNavGrid)); onOpenChange(false); }}>Save anyway</Button> : null}<Button type="button" size="sm" variant="ghost" onClick={() => { setWarning(null); setWarningKind(null); }}>Review</Button></div></div> : null}
          <div className="mt-6 space-y-2 border-t border-white/10 pt-5"><Button className="w-full justify-start" type="button" variant="ghost" onClick={() => { setDraft(cloneGrid(defaultNavGrid)); setSelectedZoneId(null); setWarning(null); setWarningKind(null); }}><RotateCwIcon />Reset to season default</Button><Button className="w-full justify-start" type="button" variant="ghost" onClick={exportGrid}><DownloadIcon />Export NavGrid</Button><Button className="w-full justify-start" type="button" variant="ghost" onClick={() => importInput.current?.click()}><UploadIcon />Import NavGrid</Button><input ref={importInput} className="hidden" accept="application/json,.json" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) importGrid(file); event.currentTarget.value = ""; }} /></div>
        </aside>
      </div>
      <div className="flex justify-end gap-2 border-t border-white/10 px-7 py-4"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" onClick={save}>Save NavGrid</Button></div>
    </DialogContent>
  );
}

function EditorNumber({ label, value, onChange }: { readonly label: string; readonly value: number; readonly onChange: (value: string) => void }) {
  return <label className="block text-xs text-muted-foreground">{label}<input className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/10 px-3 text-sm text-foreground" inputMode="decimal" type="number" step="any" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export { FieldEditorDialog, zoneContains };
