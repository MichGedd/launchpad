import type { Point, Zone, ZoneGameObjectState } from "../engine/types.ts";

export interface ZoneCountLabel {
  readonly accessibleText: string;
  readonly compactText: string;
}

export function formatZoneCountLabel(
  zone: Zone,
  state: ZoneGameObjectState | undefined,
): ZoneCountLabel | null {
  if (zone.kind === "pickup" && state?.kind === "pickup") {
    if (state.availableGameObjectCount === null) {
      return { compactText: "∞", accessibleText: "Unlimited game pieces available" };
    }
    return {
      compactText: `${state.availableGameObjectCount} left`,
      accessibleText: `${state.availableGameObjectCount} game pieces available`,
    };
  }
  if (zone.kind === "score" && state?.kind === "score") {
    if (zone.gameObjectCapacity === undefined) {
      return {
        compactText: `${state.scoredGameObjectCount}/∞`,
        accessibleText: `${state.scoredGameObjectCount} game pieces scored with unlimited capacity`,
      };
    }
    return {
      compactText: `${state.scoredGameObjectCount}/${zone.gameObjectCapacity}`,
      accessibleText: `${state.scoredGameObjectCount} of ${zone.gameObjectCapacity} game pieces scored`,
    };
  }
  return null;
}

export function zoneLabelPosition(zone: Zone): Point {
  if (zone.shape.type === "circle" || zone.shape.type === "rectangle") return zone.shape.center;
  const vertices = zone.shape.vertices;
  let signedAreaTimesTwo = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    const cross = current.xFeet * next.yFeet - next.xFeet * current.yFeet;
    signedAreaTimesTwo += cross;
    weightedX += (current.xFeet + next.xFeet) * cross;
    weightedY += (current.yFeet + next.yFeet) * cross;
  }
  if (Math.abs(signedAreaTimesTwo) > Number.EPSILON) {
    return {
      xFeet: weightedX / (3 * signedAreaTimesTwo),
      yFeet: weightedY / (3 * signedAreaTimesTwo),
    };
  }
  return {
    xFeet: vertices.reduce((sum, vertex) => sum + vertex.xFeet, 0) / vertices.length,
    yFeet: vertices.reduce((sum, vertex) => sum + vertex.yFeet, 0) / vertices.length,
  };
}
