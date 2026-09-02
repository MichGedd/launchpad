import type {
  CircleShape,
  NavGridDefinition,
  NavGridNonTraversalZone,
  Point,
  Pose,
  RectangleShape,
  RobotState,
  Zone,
} from "../engine/types.ts";
import { NAV_GRID_CELL_SIZE_INCHES } from "../engine/types.ts";

export interface NavGridValidationOptions {
  readonly seasonId?: string;
  readonly fieldWidthFeet?: number;
  readonly fieldHeightFeet?: number;
  readonly featureIds?: readonly string[];
}

export interface NavGridValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface ReachabilityResult {
  readonly startValid: boolean;
  readonly unreachableZoneIds: readonly string[];
  readonly reachableCellCount: number;
}

const MAX_ZONE_COUNT = 500;
const MAX_FIELD_CELLS = 2_000_000;
const CELL_SIZE_FEET = NAV_GRID_CELL_SIZE_INCHES / 12;

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Number.isFinite(candidate.xFeet) && Number.isFinite(candidate.yFeet);
}

function shapeIsValid(shape: unknown, widthFeet: number, heightFeet: number): boolean {
  if (typeof shape !== "object" || shape === null) return false;
  const candidate = shape as Record<string, unknown>;
  if (candidate.type === "circle") {
    return isPoint(candidate.center) && isFinitePositive(candidate.radiusFeet)
      && (candidate.center as Point).xFeet - Number(candidate.radiusFeet) >= 0
      && (candidate.center as Point).yFeet - Number(candidate.radiusFeet) >= 0
      && (candidate.center as Point).xFeet + Number(candidate.radiusFeet) <= widthFeet
      && (candidate.center as Point).yFeet + Number(candidate.radiusFeet) <= heightFeet;
  }
  if (candidate.type === "rectangle") {
    const center = candidate.center as Point;
    if (!(isPoint(center) && isFinitePositive(candidate.widthFeet)
      && isFinitePositive(candidate.heightFeet)
      && (candidate.headingRotations === undefined || Number.isFinite(candidate.headingRotations)))) return false;
    const angle = Number(candidate.headingRotations ?? 0) * Math.PI * 2;
    const halfWidth = Number(candidate.widthFeet) / 2;
    const halfHeight = Number(candidate.heightFeet) / 2;
    return [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]].every(([x, y]) => {
      const rotatedX = center.xFeet + x * Math.cos(angle) - y * Math.sin(angle);
      const rotatedY = center.yFeet + x * Math.sin(angle) + y * Math.cos(angle);
      return rotatedX >= 0 && rotatedX <= widthFeet && rotatedY >= 0 && rotatedY <= heightFeet;
    });
  }
  return false;
}

/** Validate an imported or edited NavGrid without touching browser state. */
export function validateNavGrid(
  value: unknown,
  options: NavGridValidationOptions = {},
): NavGridValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["NavGrid must be an object."] };
  }
  const grid = value as Partial<NavGridDefinition>;
  if (grid.version !== 1) errors.push("Unsupported NavGrid version.");
  if (typeof grid.seasonId !== "string" || grid.seasonId.trim().length === 0) errors.push("A season ID is required.");
  if (options.seasonId !== undefined && grid.seasonId !== options.seasonId) errors.push("NavGrid belongs to a different season.");
  if (!isFinitePositive(grid.fieldWidthFeet) || !isFinitePositive(grid.fieldHeightFeet)) errors.push("Field dimensions must be finite and greater than zero.");
  if (options.fieldWidthFeet !== undefined && grid.fieldWidthFeet !== options.fieldWidthFeet) errors.push("NavGrid field width does not match the active field.");
  if (options.fieldHeightFeet !== undefined && grid.fieldHeightFeet !== options.fieldHeightFeet) errors.push("NavGrid field height does not match the active field.");
  if (grid.cellSizeInches !== NAV_GRID_CELL_SIZE_INCHES) errors.push(`NavGrid fidelity must be ${NAV_GRID_CELL_SIZE_INCHES} inches.`);
  if (!Array.isArray(grid.zones) || grid.zones.length > MAX_ZONE_COUNT) errors.push("NavGrid zones must be a bounded array.");

  const widthFeet = Number(grid.fieldWidthFeet);
  const heightFeet = Number(grid.fieldHeightFeet);
  const featureIds = new Set(options.featureIds ?? []);
  const ids = new Set<string>();
  for (const [index, zone] of (Array.isArray(grid.zones) ? grid.zones : []).entries()) {
    if (typeof zone !== "object" || zone === null) {
      errors.push(`Zone ${index + 1} is invalid.`);
      continue;
    }
    const candidate = zone as Partial<NavGridNonTraversalZone>;
    if (typeof candidate.id !== "string" || candidate.id.trim().length === 0 || ids.has(candidate.id)) errors.push(`Zone ${index + 1} must have a unique ID.`);
    else ids.add(candidate.id);
    if (!shapeIsValid(candidate.shape, widthFeet, heightFeet)) errors.push(`Zone ${candidate.id || index + 1} has invalid or out-of-bounds geometry.`);
    const rule = candidate.traversalRule;
    if (typeof rule !== "object" || rule === null || (rule.kind !== "general" && rule.kind !== "feature-specific")) {
      errors.push(`Zone ${candidate.id || index + 1} has an invalid traversal rule.`);
    } else if (rule.kind === "feature-specific" && (typeof rule.requiredFeatureId !== "string" || rule.requiredFeatureId.length === 0 || (featureIds.size > 0 && !featureIds.has(rule.requiredFeatureId)))) {
      errors.push(`Zone ${candidate.id || index + 1} requires an unknown feature.`);
    }
  }
  if (isFinitePositive(widthFeet) && isFinitePositive(heightFeet) && widthFeet / CELL_SIZE_FEET * (heightFeet / CELL_SIZE_FEET) > MAX_FIELD_CELLS) errors.push("NavGrid is too large to rasterize.");
  return { valid: errors.length === 0, errors };
}

export function serializeNavGrid(grid: NavGridDefinition): string {
  return JSON.stringify(grid, null, 2);
}

export function parseNavGridJson(json: string, options: NavGridValidationOptions = {}): NavGridDefinition {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("NavGrid file is not valid JSON.");
  }
  const result = validateNavGrid(value, options);
  if (!result.valid) throw new Error(result.errors.join(" "));
  return value as NavGridDefinition;
}

function storageKey(seasonId: string) {
  return `launchpad.navgrid.v1.${seasonId}`;
}

export function loadStoredNavGrid(
  seasonId: string,
  fallback: NavGridDefinition,
  featureIds: readonly string[] = [],
): NavGridDefinition {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(storageKey(seasonId));
    return stored ? parseNavGridJson(stored, {
      seasonId,
      fieldWidthFeet: fallback.fieldWidthFeet,
      fieldHeightFeet: fallback.fieldHeightFeet,
      featureIds,
    }) : fallback;
  } catch {
    return fallback;
  }
}

export function storeNavGrid(grid: NavGridDefinition): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(storageKey(grid.seasonId), serializeNavGrid(grid)); } catch { /* Storage can be unavailable in private browsing. */ }
}

export function clearStoredNavGrid(seasonId: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(storageKey(seasonId)); } catch { /* Storage can be unavailable in private browsing. */ }
}

function hasFeature(gridZone: NavGridNonTraversalZone, selectedFeatureIds: ReadonlySet<string>): boolean {
  return gridZone.traversalRule.kind === "feature-specific" && selectedFeatureIds.has(gridZone.traversalRule.requiredFeatureId);
}

function rotateIntoRectangle(point: Point, shape: RectangleShape): Point {
  const angle = -(shape.headingRotations ?? 0) * Math.PI * 2;
  const dx = point.xFeet - shape.center.xFeet;
  const dy = point.yFeet - shape.center.yFeet;
  return { xFeet: dx * Math.cos(angle) - dy * Math.sin(angle), yFeet: dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function collidesWithShape(point: Point, shape: CircleShape | RectangleShape, radiusFeet: number): boolean {
  if (shape.type === "circle") return Math.hypot(point.xFeet - shape.center.xFeet, point.yFeet - shape.center.yFeet) <= shape.radiusFeet + radiusFeet;
  const local = rotateIntoRectangle(point, shape);
  return Math.max(Math.abs(local.xFeet) - shape.widthFeet / 2, 0) ** 2 + Math.max(Math.abs(local.yFeet) - shape.heightFeet / 2, 0) ** 2 <= radiusFeet ** 2;
}

function pointContactsZone(point: Point, zone: Zone, radiusFeet: number): boolean {
  const shape = zone.shape;
  if (shape.type === "polygon") {
    let inside = false;
    let minimumDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < shape.vertices.length; index += 1) {
      const start = shape.vertices[index];
      const end = shape.vertices[(index + 1) % shape.vertices.length];
      const edgeX = end.xFeet - start.xFeet;
      const edgeY = end.yFeet - start.yFeet;
      const lengthSquared = edgeX * edgeX + edgeY * edgeY;
      const projection = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.xFeet - start.xFeet) * edgeX + (point.yFeet - start.yFeet) * edgeY) / lengthSquared));
      minimumDistance = Math.min(minimumDistance, Math.hypot(point.xFeet - (start.xFeet + projection * edgeX), point.yFeet - (start.yFeet + projection * edgeY)));
      if ((start.yFeet > point.yFeet) !== (end.yFeet > point.yFeet) && point.xFeet < ((end.xFeet - start.xFeet) * (point.yFeet - start.yFeet)) / (end.yFeet - start.yFeet) + start.xFeet) inside = !inside;
    }
    return inside || minimumDistance <= radiusFeet;
  }
  return collidesWithShape(point, shape, radiusFeet);
}

/** Flood-fill meaningful targets using the same conservative robot-radius model used by the editor. */
export function analyzeNavGridReachability(
  grid: NavGridDefinition,
  startPose: Pose,
  robot: Pick<RobotState, "widthFeet" | "lengthFeet">,
  selectedFeatureIds: readonly string[],
  meaningfulZones: readonly Zone[],
): ReachabilityResult {
  const columns = Math.ceil(grid.fieldWidthFeet / CELL_SIZE_FEET);
  const rows = Math.ceil(grid.fieldHeightFeet / CELL_SIZE_FEET);
  const radiusFeet = Math.hypot(robot.widthFeet, robot.lengthFeet) / 2 + CELL_SIZE_FEET;
  const selected = new Set(selectedFeatureIds);
  const passable = (column: number, row: number) => {
    const point = { xFeet: (column + 0.5) * CELL_SIZE_FEET, yFeet: (row + 0.5) * CELL_SIZE_FEET };
    if (point.xFeet < radiusFeet || point.yFeet < radiusFeet || point.xFeet > grid.fieldWidthFeet - radiusFeet || point.yFeet > grid.fieldHeightFeet - radiusFeet) return false;
    return grid.zones.every((zone) => hasFeature(zone, selected) || !collidesWithShape(point, zone.shape, radiusFeet));
  };
  const startColumn = Math.floor(startPose.xFeet / CELL_SIZE_FEET);
  const startRow = Math.floor(startPose.yFeet / CELL_SIZE_FEET);
  const startValid = startColumn >= 0 && startColumn < columns && startRow >= 0 && startRow < rows && passable(startColumn, startRow);
  if (!startValid) return { startValid: false, unreachableZoneIds: meaningfulZones.map((zone) => zone.id), reachableCellCount: 0 };
  const visited = new Uint8Array(columns * rows);
  const queue = new Int32Array(columns * rows);
  let queueHead = 0;
  let queueTail = 0;
  const startIndex = startRow * columns + startColumn;
  visited[startIndex] = 1;
  queue[queueTail] = startIndex;
  queueTail += 1;
  const meaningfulReached = new Uint8Array(meaningfulZones.length);
  const directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
  while (queueHead < queueTail) {
    const currentIndex = queue[queueHead];
    queueHead += 1;
    const row = Math.floor(currentIndex / columns);
    const column = currentIndex - row * columns;
    const point = { xFeet: (column + 0.5) * CELL_SIZE_FEET, yFeet: (row + 0.5) * CELL_SIZE_FEET };
    for (let zoneIndex = 0; zoneIndex < meaningfulZones.length; zoneIndex += 1) {
      if (!meaningfulReached[zoneIndex] && pointContactsZone(point, meaningfulZones[zoneIndex], radiusFeet)) meaningfulReached[zoneIndex] = 1;
    }
    for (const [dc, dr] of directions) {
      const nextColumn = column + dc; const nextRow = row + dr;
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
      const nextIndex = nextRow * columns + nextColumn;
      if (visited[nextIndex] || !passable(nextColumn, nextRow)) continue;
      if (dc !== 0 && dr !== 0 && (!passable(column + dc, row) || !passable(column, row + dr))) continue;
      visited[nextIndex] = 1;
      queue[queueTail] = nextIndex;
      queueTail += 1;
    }
  }
  return { startValid: true, unreachableZoneIds: meaningfulZones.filter((_, index) => meaningfulReached[index] === 0).map((zone) => zone.id), reachableCellCount: queueTail };
}
