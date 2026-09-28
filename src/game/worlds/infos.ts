// World minigame metadata, gathered (pure data, so MinigameManager can import it safely).
import { CAPITOL_INFO } from './capitol/info';
import { DOJO_INFO } from './dojo/info';
import { HEROES_INFO } from './heroes/info';
import { PIRATES_INFO } from './pirates/info';
import { SHOWTIME_INFO } from './showtime/info';
import { TOONS_INFO } from './toons/info';
import type { WorldMinigameInfo } from './types';

const ALL: WorldMinigameInfo[] = [PIRATES_INFO, DOJO_INFO, HEROES_INFO, TOONS_INFO, SHOWTIME_INFO, CAPITOL_INFO];

export const WORLD_MINIGAME_INFOS = ALL.flatMap((w) => w.infos);
export const WORLD_MINIGAME_RENDERS = Object.assign({}, ...ALL.map((w) => w.renders ?? {}));
