// World boards, gathered for the board registry (data/boards.ts).
import type { BoardDef } from '../board/types';
import { CAPITOL_BOARD } from './capitol/board';
import { DOJO_BOARD } from './dojo/board';
import { HEROES_BOARD } from './heroes/board';
import { PIRATES_BOARD } from './pirates/board';
import { SHOWTIME_BOARD } from './showtime/board';
import { TOONS_BOARD } from './toons/board';

export const WORLD_BOARDS: BoardDef[] = [PIRATES_BOARD, DOJO_BOARD, HEROES_BOARD, TOONS_BOARD, SHOWTIME_BOARD, CAPITOL_BOARD].filter((b): b is BoardDef => b !== null);
