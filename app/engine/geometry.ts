import type { CircleShape, Point, PolygonShape, Pose, RectangleShape, RobotState, Zone, ZoneShape } from "./types.ts";

const EPSILON = 1e-9;

export function normalizeHeading(headingRotations: number): number {
  return ((headingRotations % 1) + 1) % 1;
}

export function shortestHeadingDelta(fromRotations: number, toRotations: number): number {
  const delta = normalizeHeading(toRotations) - normalizeHeading(fromRotations);
  return delta > 0.5 ? delta - 1 : delta < -0.5 ? delta + 1 : delta;
}

export function interpolatePose(from: Pose, to: Pose, translationProgress: number, rotationProgress: number): Pose {
  const headingDelta = shortestHeadingDelta(from.headingRotations, to.headingRotations);
  return {
    xFeet: from.xFeet + (to.xFeet - from.xFeet) * translationProgress,
    yFeet: from.yFeet + (to.yFeet - from.yFeet) * translationProgress,
    headingRotations: normalizeHeading(from.headingRotations + headingDelta * rotationProgress),
  };
}

export function rectangleVertices(shape: RectangleShape): readonly Point[] {
  const halfWidth = shape.widthFeet / 2;
  const halfHeight = shape.heightFeet / 2;
  const radians = (shape.headingRotations ?? 0) * Math.PI * 2;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    { xFeet: -halfWidth, yFeet: -halfHeight },
    { xFeet: halfWidth, yFeet: -halfHeight },
    { xFeet: halfWidth, yFeet: halfHeight },
    { xFeet: -halfWidth, yFeet: halfHeight },
  ].map(({ xFeet, yFeet }) => ({
    xFeet: shape.center.xFeet + xFeet * cosine - yFeet * sine,
    yFeet: shape.center.yFeet + xFeet * sine + yFeet * cosine,
  }));
}

export function robotFootprint(robot: RobotState): PolygonShape {
  return {
    type: "polygon",
    vertices: rectangleVertices({
      type: "rectangle",
      center: robot.pose,
      widthFeet: robot.lengthFeet,
      heightFeet: robot.widthFeet,
      headingRotations: robot.pose.headingRotations,
    }),
  };
}

function shapePolygon(shape: RectangleShape | PolygonShape): readonly Point[] {
  return shape.type === "rectangle" ? rectangleVertices(shape) : shape.vertices;
}

function subtract(first: Point, second: Point): Point {
  return { xFeet: first.xFeet - second.xFeet, yFeet: first.yFeet - second.yFeet };
}

function polygonsIntersect(first: readonly Point[], second: readonly Point[]): boolean {
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      if (segmentsIntersect(
        first[firstIndex]!, first[(firstIndex + 1) % first.length]!,
        second[secondIndex]!, second[(secondIndex + 1) % second.length]!,
      )) return true;
    }
  }
  return pointInPolygon(first[0]!, second) || pointInPolygon(second[0]!, first);
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const segment = subtract(end, start);
  const lengthSquared = segment.xFeet ** 2 + segment.yFeet ** 2;
  if (lengthSquared === 0) return Math.hypot(point.xFeet - start.xFeet, point.yFeet - start.yFeet);
  const relative = subtract(point, start);
  const projection = Math.max(0, Math.min(1,
    (relative.xFeet * segment.xFeet + relative.yFeet * segment.yFeet) / lengthSquared));
  return Math.hypot(
    point.xFeet - (start.xFeet + segment.xFeet * projection),
    point.yFeet - (start.yFeet + segment.yFeet * projection),
  );
}

function circleIntersectsPolygon(circle: CircleShape, vertices: readonly Point[]): boolean {
  if (pointInPolygon(circle.center, vertices)) return true;
  return vertices.some((vertex, index) =>
    pointToSegmentDistance(circle.center, vertex, vertices[(index + 1) % vertices.length]!) <= circle.radiusFeet + EPSILON);
}

function pointInPolygon(point: Point, vertices: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const currentPoint = vertices[index]!;
    const previousPoint = vertices[previous]!;
    const crosses = (currentPoint.yFeet > point.yFeet) !== (previousPoint.yFeet > point.yFeet)
      && point.xFeet < (previousPoint.xFeet - currentPoint.xFeet) * (point.yFeet - currentPoint.yFeet)
        / (previousPoint.yFeet - currentPoint.yFeet) + currentPoint.xFeet;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function shapesIntersect(first: ZoneShape, second: ZoneShape): boolean {
  if (first.type === "circle" && second.type === "circle") {
    return Math.hypot(first.center.xFeet - second.center.xFeet, first.center.yFeet - second.center.yFeet)
      <= first.radiusFeet + second.radiusFeet + EPSILON;
  }
  if (first.type === "circle") {
    if (second.type === "circle") return false;
    return circleIntersectsPolygon(first, shapePolygon(second));
  }
  if (second.type === "circle") return circleIntersectsPolygon(second, shapePolygon(first));
  return polygonsIntersect(shapePolygon(first), shapePolygon(second));
}

function orientation(first: Point, second: Point, third: Point): number {
  return (second.xFeet - first.xFeet) * (third.yFeet - first.yFeet)
    - (second.yFeet - first.yFeet) * (third.xFeet - first.xFeet);
}

function segmentsIntersect(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): boolean {
  const firstSideStart = orientation(firstStart, firstEnd, secondStart);
  const firstSideEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondSideStart = orientation(secondStart, secondEnd, firstStart);
  const secondSideEnd = orientation(secondStart, secondEnd, firstEnd);
  if (((firstSideStart > EPSILON && firstSideEnd < -EPSILON) || (firstSideStart < -EPSILON && firstSideEnd > EPSILON))
      && ((secondSideStart > EPSILON && secondSideEnd < -EPSILON) || (secondSideStart < -EPSILON && secondSideEnd > EPSILON))) {
    return true;
  }
  return pointToSegmentDistance(firstStart, secondStart, secondEnd) <= EPSILON
    || pointToSegmentDistance(firstEnd, secondStart, secondEnd) <= EPSILON
    || pointToSegmentDistance(secondStart, firstStart, firstEnd) <= EPSILON
    || pointToSegmentDistance(secondEnd, firstStart, firstEnd) <= EPSILON;
}

function segmentToSegmentDistance(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): number {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
  return Math.min(
    pointToSegmentDistance(firstStart, secondStart, secondEnd),
    pointToSegmentDistance(firstEnd, secondStart, secondEnd),
    pointToSegmentDistance(secondStart, firstStart, firstEnd),
    pointToSegmentDistance(secondEnd, firstStart, firstEnd),
  );
}

function polygonDistance(first: readonly Point[], second: readonly Point[]): number {
  if (polygonsIntersect(first, second)) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      minimum = Math.min(minimum, segmentToSegmentDistance(
        first[firstIndex]!, first[(firstIndex + 1) % first.length]!,
        second[secondIndex]!, second[(secondIndex + 1) % second.length]!,
      ));
    }
  }
  return minimum;
}

export function distanceBetweenShapes(first: ZoneShape, second: ZoneShape): number {
  if (shapesIntersect(first, second)) return 0;
  if (first.type === "circle" && second.type === "circle") {
    return Math.max(0, Math.hypot(first.center.xFeet - second.center.xFeet, first.center.yFeet - second.center.yFeet)
      - first.radiusFeet - second.radiusFeet);
  }
  if (first.type === "circle") {
    if (second.type === "circle") return 0;
    const vertices = shapePolygon(second);
    return Math.max(0, Math.min(...vertices.map((vertex, index) =>
      pointToSegmentDistance(first.center, vertex, vertices[(index + 1) % vertices.length]!))) - first.radiusFeet);
  }
  if (second.type === "circle") return distanceBetweenShapes(second, first);
  return polygonDistance(shapePolygon(first), shapePolygon(second));
}

export function robotContactsZone(robot: RobotState, zone: Zone): boolean {
  return shapesIntersect(robotFootprint(robot), zone.shape);
}

export function robotDistanceToZone(robot: RobotState, zone: Zone): number {
  return distanceBetweenShapes(robotFootprint(robot), zone.shape);
}

export function zoneCharacteristicSize(zone: Zone): number {
  if (zone.shape.type === "circle") return zone.shape.radiusFeet * 2;
  if (zone.shape.type === "rectangle") return Math.min(zone.shape.widthFeet, zone.shape.heightFeet);
  const vertices = zone.shape.vertices;
  return Math.min(...vertices.map((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]!;
    return Math.hypot(next.xFeet - vertex.xFeet, next.yFeet - vertex.yFeet);
  }));
}
