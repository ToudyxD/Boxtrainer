import type { BlockType } from "../domain/models";

export type BlockCategory = "fight" | "fitness" | "frame";

const CATEGORIES: Record<BlockType, BlockCategory> = {
  shadow: "fight",
  bag: "fight",
  power: "fight",
  drill: "fight",
  strength: "fitness",
  conditioning: "fitness",
  core: "fitness",
  circuit: "fitness",
  warmup: "frame",
  cooldown: "frame",
};

export const blockCategory = (type: BlockType): BlockCategory => CATEGORIES[type];

export const fmtDuration = (seconds: number): string =>
  seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
