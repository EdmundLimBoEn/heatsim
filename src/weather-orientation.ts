export type CardinalDirection = 'N' | 'E' | 'S' | 'W';

/** Geographic FROM direction expressed in the fixed floor plan's coordinates. */
export function windToPlanDirection(from: CardinalDirection, houseOrientationDeg = 0): CardinalDirection {
  const directions: CardinalDirection[] = ['N', 'E', 'S', 'W'];
  const turns = [0, 90, 180, 270].includes(houseOrientationDeg) ? houseOrientationDeg / 90 : 0;
  return directions[(directions.indexOf(from) - turns + 4) % 4];
}
