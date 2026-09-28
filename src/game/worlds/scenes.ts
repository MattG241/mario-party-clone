// World minigame scenes, gathered for the scene registry.
import { CAPITOL_SCENES } from './capitol/scenes';
import { DOJO_SCENES } from './dojo/scenes';
import { HEROES_SCENES } from './heroes/scenes';
import { PIRATES_SCENES } from './pirates/scenes';
import { SHOWTIME_SCENES } from './showtime/scenes';
import { TOONS_SCENES } from './toons/scenes';

const ALL = [PIRATES_SCENES, DOJO_SCENES, HEROES_SCENES, TOONS_SCENES, SHOWTIME_SCENES, CAPITOL_SCENES];

export const WORLD_MINIGAME_SCENES = ALL.flatMap((w) => w.scenes);
export const WORLD_MINIGAME_KEYS = ALL.flatMap((w) => w.keys);
