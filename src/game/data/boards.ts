// The boards on offer: each character world's board (src/game/worlds/<id>/board.ts).
import type { BoardDef } from '../board/types';
import { WORLD_BOARDS } from '../worlds/boards';

export const BOARDS: BoardDef[] = [...WORLD_BOARDS];

export function findBoard(id: string): BoardDef | undefined {
  return BOARDS.find((b) => b.id === id);
}
