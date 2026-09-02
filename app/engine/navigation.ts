import { NAV_GRID_CELL_SIZE_INCHES, type NavGridDefinition, type NavGridNonTraversalZone, type Point, type Pose, type RobotState } from "./types.ts";

const FEET_PER_INCH = 1 / 12;
const CELL_SIZE_FEET = NAV_GRID_CELL_SIZE_INCHES * FEET_PER_INCH;
const EPSILON = 1e-9;
const MAX_GRID_CELLS = 8_000_000;
const MAX_NAV_GRID_ZONES = 10_000;

interface GridCell {
  readonly x: number;
  readonly y: number;
}

interface HeapEntry {
  readonly index: number;
  readonly score: number;
  readonly order: number;
}

function finitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be finite and greater than zero.`);
}

function pointFinite(point: Point, label: string): void {
  if (!Number.isFinite(point.xFeet) || !Number.isFinite(point.yFeet)) throw new Error(`${label} coordinates must be finite.`);
}

/** Validate the portable, versioned NavGrid wire format. */
export function validateNavGrid(
  navGrid: NavGridDefinition,
  knownFeatureIds: ReadonlySet<string> = new Set(),
): void {
  if (navGrid.version !== 1) throw new Error("NavGrid version must be 1.");
  if (typeof navGrid.seasonId !== "string" || navGrid.seasonId.length === 0) throw new Error("NavGrid season ID cannot be empty.");
  finitePositive(navGrid.fieldWidthFeet, "NavGrid field width");
  finitePositive(navGrid.fieldHeightFeet, "NavGrid field height");
  if (navGrid.cellSizeInches !== NAV_GRID_CELL_SIZE_INCHES) {
    throw new Error(`NavGrid cell size must be exactly ${NAV_GRID_CELL_SIZE_INCHES} inches.`);
  }
  const width = Math.ceil(navGrid.fieldWidthFeet / CELL_SIZE_FEET);
  const height = Math.ceil(navGrid.fieldHeightFeet / CELL_SIZE_FEET);
  if (width * height > MAX_GRID_CELLS) throw new Error("NavGrid is too large to rasterize.");
  if (!Array.isArray(navGrid.zones) || navGrid.zones.length > MAX_NAV_GRID_ZONES) throw new Error("NavGrid contains too many zones.");
  const ids = new Set<string>();
  for (const zone of navGrid.zones) {
    if (zone.id.length === 0) throw new Error("NavGrid zone IDs cannot be empty.");
    if (ids.has(zone.id)) throw new Error(`Duplicate NavGrid zone ID "${zone.id}".`);
    ids.add(zone.id);
    if (zone.shape.type === "circle") {
      pointFinite(zone.shape.center, `NavGrid zone "${zone.id}" center`);
      finitePositive(zone.shape.radiusFeet, `NavGrid zone "${zone.id}" radius`);
      if (zone.shape.center.xFeet - zone.shape.radiusFeet < 0
        || zone.shape.center.xFeet + zone.shape.radiusFeet > navGrid.fieldWidthFeet
        || zone.shape.center.yFeet - zone.shape.radiusFeet < 0
        || zone.shape.center.yFeet + zone.shape.radiusFeet > navGrid.fieldHeightFeet) {
        throw new Error(`NavGrid zone "${zone.id}" must be within field bounds.`);
      }
    } else if (zone.shape.type === "rectangle") {
      pointFinite(zone.shape.center, `NavGrid zone "${zone.id}" center`);
      finitePositive(zone.shape.widthFeet, `NavGrid zone "${zone.id}" width`);
      finitePositive(zone.shape.heightFeet, `NavGrid zone "${zone.id}" height`);
      if (zone.shape.headingRotations !== undefined && !Number.isFinite(zone.shape.headingRotations)) {
        throw new Error(`NavGrid zone "${zone.id}" heading must be finite.`);
      }
      const radians = (zone.shape.headingRotations ?? 0) * Math.PI * 2;
      const cosine = Math.cos(radians);
      const sine = Math.sin(radians);
      const halfWidth = zone.shape.widthFeet / 2;
      const halfHeight = zone.shape.heightFeet / 2;
      const vertices = [
        [-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight],
      ].map(([x, y]) => ({
        xFeet: zone.shape.center.xFeet + x! * cosine - y! * sine,
        yFeet: zone.shape.center.yFeet + x! * sine + y! * cosine,
      }));
      if (vertices.some((vertex) => vertex.xFeet < 0 || vertex.xFeet > navGrid.fieldWidthFeet
        || vertex.yFeet < 0 || vertex.yFeet > navGrid.fieldHeightFeet)) {
        throw new Error(`NavGrid zone "${zone.id}" must be within field bounds.`);
      }
    } else {
      throw new Error(`NavGrid zone "${zone.id}" has an unsupported shape.`);
    }
    if (zone.traversalRule.kind === "feature-specific") {
      if (zone.traversalRule.requiredFeatureId.length === 0) throw new Error(`NavGrid zone "${zone.id}" required feature cannot be empty.`);
      if (!knownFeatureIds.has(zone.traversalRule.requiredFeatureId)) {
        throw new Error(`NavGrid zone "${zone.id}" references unknown feature "${zone.traversalRule.requiredFeatureId}".`);
      }
    } else if (zone.traversalRule.kind !== "general") {
      throw new Error(`NavGrid zone "${zone.id}" has an unsupported traversal rule.`);
    }
  }
}

function pointToRectangleDistance(point: Point, zone: NavGridNonTraversalZone): number {
  if (zone.shape.type !== "rectangle") return Number.POSITIVE_INFINITY;
  const radians = -(zone.shape.headingRotations ?? 0) * Math.PI * 2;
  const dx = point.xFeet - zone.shape.center.xFeet;
  const dy = point.yFeet - zone.shape.center.yFeet;
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians);
  const outsideX = Math.max(Math.abs(localX) - zone.shape.widthFeet / 2, 0);
  const outsideY = Math.max(Math.abs(localY) - zone.shape.heightFeet / 2, 0);
  return Math.hypot(outsideX, outsideY);
}

function pointBlocked(point: Point, zones: readonly NavGridNonTraversalZone[], selectedFeatures: ReadonlySet<string>, robotRadius: number): boolean {
  return zones.some((zone) => {
    if (zone.traversalRule.kind === "feature-specific" && selectedFeatures.has(zone.traversalRule.requiredFeatureId)) return false;
    if (zone.shape.type === "circle") {
      return Math.hypot(point.xFeet - zone.shape.center.xFeet, point.yFeet - zone.shape.center.yFeet)
        <= zone.shape.radiusFeet + robotRadius + EPSILON;
    }
    return pointToRectangleDistance(point, zone) <= robotRadius + EPSILON;
  });
}

function compareHeapEntries(first: HeapEntry, second: HeapEntry): number {
  return first.score - second.score || first.order - second.order || first.index - second.index;
}

class MinHeap {
  #items: HeapEntry[] = [];

  get length(): number { return this.#items.length; }

  push(item: HeapEntry): void {
    this.#items.push(item);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareHeapEntries(this.#items[parent]!, item) <= 0) break;
      this.#items[index] = this.#items[parent]!;
      index = parent;
    }
    this.#items[index] = item;
  }

  pop(): HeapEntry | undefined {
    const first = this.#items[0];
    if (!first) return undefined;
    const last = this.#items.pop()!;
    if (this.#items.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.#items.length) break;
      const right = left + 1;
      const child = right < this.#items.length && compareHeapEntries(this.#items[right]!, this.#items[left]!) < 0 ? right : left;
      if (compareHeapEntries(this.#items[child]!, last) >= 0) break;
      this.#items[index] = this.#items[child]!;
      index = child;
    }
    this.#items[index] = last;
    return first;
  }
}

export class NavGridNavigator {
  readonly navGrid: NavGridDefinition;
  readonly #width: number;
  readonly #height: number;
  readonly #passable: Uint8Array;
  readonly #selectedFeatures: ReadonlySet<string>;
  readonly #robotRadius: number;

  constructor(navGrid: NavGridDefinition, robot: Pick<RobotState, "widthFeet" | "lengthFeet">, selectedFeatureIds: readonly string[] = [], knownFeatureIds?: ReadonlySet<string>) {
    validateNavGrid(navGrid, knownFeatureIds ?? new Set(selectedFeatureIds));
    this.navGrid = navGrid;
    this.#width = Math.ceil(navGrid.fieldWidthFeet / CELL_SIZE_FEET);
    this.#height = Math.ceil(navGrid.fieldHeightFeet / CELL_SIZE_FEET);
    this.#selectedFeatures = new Set(selectedFeatureIds);
    this.#robotRadius = Math.hypot(robot.widthFeet, robot.lengthFeet) / 2 + CELL_SIZE_FEET;
    this.#passable = new Uint8Array(this.#width * this.#height);
    for (let y = 0; y < this.#height; y += 1) {
      for (let x = 0; x < this.#width; x += 1) {
        const point = this.cellPoint({ x, y });
        const inBounds = point.xFeet >= this.#robotRadius && point.xFeet <= navGrid.fieldWidthFeet - this.#robotRadius
          && point.yFeet >= this.#robotRadius && point.yFeet <= navGrid.fieldHeightFeet - this.#robotRadius;
        this.#passable[this.index({ x, y })] = inBounds && !pointBlocked(point, navGrid.zones, this.#selectedFeatures, this.#robotRadius) ? 1 : 0;
      }
    }
  }

  cellPoint(cell: GridCell): Point {
    return { xFeet: (cell.x + 0.5) * CELL_SIZE_FEET, yFeet: (cell.y + 0.5) * CELL_SIZE_FEET };
  }

  index(cell: GridCell): number { return cell.y * this.#width + cell.x; }

  #cellForPoint(point: Point): GridCell | null {
    if (point.xFeet < 0 || point.xFeet > this.navGrid.fieldWidthFeet || point.yFeet < 0 || point.yFeet > this.navGrid.fieldHeightFeet) return null;
    return {
      x: Math.min(this.#width - 1, Math.floor(point.xFeet / CELL_SIZE_FEET)),
      y: Math.min(this.#height - 1, Math.floor(point.yFeet / CELL_SIZE_FEET)),
    };
  }

  #isPassable(cell: GridCell): boolean {
    return cell.x >= 0 && cell.x < this.#width && cell.y >= 0 && cell.y < this.#height && this.#passable[this.index(cell)] === 1;
  }

  #lineOfSight(first: GridCell, second: GridCell): boolean {
    let x = first.x;
    let y = first.y;
    const dx = Math.abs(second.x - first.x);
    const dy = Math.abs(second.y - first.y);
    const stepX = first.x < second.x ? 1 : -1;
    const stepY = first.y < second.y ? 1 : -1;
    let error = dx - dy;
    while (true) {
      if (!this.#isPassable({ x, y })) return false;
      if (x === second.x && y === second.y) return true;
      const doubled = error * 2;
      const nextX = doubled > -dy ? x + stepX : x;
      const nextY = doubled < dx ? y + stepY : y;
      if (nextX !== x && nextY !== y && (!this.#isPassable({ x: nextX, y }) || !this.#isPassable({ x, y: nextY }))) return false;
      error -= nextX !== x ? dy : 0;
      error += nextY !== y ? dx : 0;
      x = nextX;
      y = nextY;
    }
  }

  #pointPassable(point: Point): boolean {
    if (point.xFeet < this.#robotRadius || point.xFeet > this.navGrid.fieldWidthFeet - this.#robotRadius
      || point.yFeet < this.#robotRadius || point.yFeet > this.navGrid.fieldHeightFeet - this.#robotRadius) return false;
    return !pointBlocked(point, this.navGrid.zones, this.#selectedFeatures, this.#robotRadius);
  }

  #segmentClear(first: Point, second: Point): boolean {
    const length = Math.hypot(second.xFeet - first.xFeet, second.yFeet - first.yFeet);
    const samples = Math.max(1, Math.ceil(length / (CELL_SIZE_FEET / 2)));
    for (let i = 0; i <= samples; i += 1) {
      const progress = i / samples;
      if (!this.#pointPassable({ xFeet: first.xFeet + (second.xFeet - first.xFeet) * progress, yFeet: first.yFeet + (second.yFeet - first.yFeet) * progress })) return false;
    }
    return true;
  }

  findPath(start: Pose, target: Pose): readonly Point[] | null {
    pointFinite(start, "NavGrid start");
    pointFinite(target, "NavGrid target");
    if (!this.#pointPassable(start) || !this.#pointPassable(target)) return null;
    if (this.#segmentClear(start, target)) return [
      { xFeet: start.xFeet, yFeet: start.yFeet },
      { xFeet: target.xFeet, yFeet: target.yFeet },
    ];
    const startCell = this.#cellForPoint(start);
    const targetCell = this.#cellForPoint(target);
    if (!startCell || !targetCell || !this.#isPassable(startCell) || !this.#isPassable(targetCell)) return null;
    const total = this.#width * this.#height;
    const gScore = new Float64Array(total).fill(Number.POSITIVE_INFINITY);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const startIndex = this.index(startCell);
    const targetIndex = this.index(targetCell);
    const heuristic = (cell: GridCell): number => {
      const dx = Math.abs(cell.x - targetCell.x);
      const dy = Math.abs(cell.y - targetCell.y);
      return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * CELL_SIZE_FEET;
    };
    const heap = new MinHeap();
    let order = 0;
    gScore[startIndex] = 0;
    heap.push({ index: startIndex, score: heuristic(startCell), order: order++ });
    const directions = [
      { x: 0, y: 1, cost: 1 }, { x: 1, y: 0, cost: 1 }, { x: 0, y: -1, cost: 1 }, { x: -1, y: 0, cost: 1 },
      { x: 1, y: 1, cost: Math.SQRT2 }, { x: 1, y: -1, cost: Math.SQRT2 }, { x: -1, y: -1, cost: Math.SQRT2 }, { x: -1, y: 1, cost: Math.SQRT2 },
    ];
    while (heap.length > 0) {
      const current = heap.pop()!;
      if (closed[current.index]) continue;
      closed[current.index] = 1;
      if (current.index === targetIndex) break;
      const currentCell = { x: current.index % this.#width, y: Math.floor(current.index / this.#width) };
      for (const direction of directions) {
        const neighbor = { x: currentCell.x + direction.x, y: currentCell.y + direction.y };
        if (!this.#isPassable(neighbor) || (direction.x !== 0 && direction.y !== 0
          && (!this.#isPassable({ x: currentCell.x + direction.x, y: currentCell.y })
            || !this.#isPassable({ x: currentCell.x, y: currentCell.y + direction.y })))) continue;
        const neighborIndex = this.index(neighbor);
        if (closed[neighborIndex]) continue;
        const candidate = gScore[current.index]! + direction.cost * CELL_SIZE_FEET;
        if (candidate >= gScore[neighborIndex]! - EPSILON) continue;
        cameFrom[neighborIndex] = current.index;
        gScore[neighborIndex] = candidate;
        heap.push({ index: neighborIndex, score: candidate + heuristic(neighbor), order: order++ });
      }
    }
    if (startIndex !== targetIndex && cameFrom[targetIndex] < 0) return null;
    const cells: GridCell[] = [];
    for (let index = targetIndex; index >= 0; index = cameFrom[index]!) {
      cells.push({ x: index % this.#width, y: Math.floor(index / this.#width) });
      if (index === startIndex) break;
    }
    cells.reverse();
    const simplified: GridCell[] = [cells[0]!];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let farthest = anchor + 1;
      for (let candidate = cells.length - 1; candidate > farthest; candidate -= 1) {
        if (this.#lineOfSight(cells[anchor]!, cells[candidate]!)) { farthest = candidate; break; }
      }
      simplified.push(cells[farthest]!);
      anchor = farthest;
    }
    const points: Point[] = [{ xFeet: start.xFeet, yFeet: start.yFeet }];
    for (const cell of simplified.slice(1, -1)) points.push(this.cellPoint(cell));
    points.push({ xFeet: target.xFeet, yFeet: target.yFeet });
    for (let i = 1; i < points.length; i += 1) if (!this.#segmentClear(points[i - 1]!, points[i]!)) return null;
    return points;
  }
}
