// Board events unique to the world boards, gathered for the event registry (EventManager).
import { CAPITOL_EVENTS } from './capitol/events';
import { DOJO_EVENTS } from './dojo/events';
import { HEROES_EVENTS } from './heroes/events';
import { PIRATES_EVENTS } from './pirates/events';
import { SHOWTIME_EVENTS } from './showtime/events';
import { TOONS_EVENTS } from './toons/events';

export const WORLD_EVENTS = [...PIRATES_EVENTS, ...DOJO_EVENTS, ...HEROES_EVENTS, ...TOONS_EVENTS, ...SHOWTIME_EVENTS, ...CAPITOL_EVENTS];
