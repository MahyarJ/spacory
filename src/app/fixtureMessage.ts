import type { FixtureConflict, FixtureMoveConflict } from "@geometry/fixtures";

export const fixtureConflictMessage: Record<FixtureMoveConflict, string> = {
  door: "The sink overlaps a doorway.",
  wall: "The sink overlaps a wall or corner.",
  width: "The sink extends beyond the wall face.",
  alignment:
    "The selected sinks are on walls at different angles. Move them separately.",
};

export const fixtureEditHelp: Record<FixtureConflict, string> = {
  door: "Move it clear of the doorway or enter a smaller width.",
  wall: "Move it away from the corner or enter a smaller dimension.",
  width: "Enter a smaller width or move the sink to a longer wall.",
};
