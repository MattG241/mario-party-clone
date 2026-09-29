// Pirate Cove's own board events (EVENT spaces on the galleon, in the map room, on the beach and reef).
import { logMatch } from '../../state/MatchState';
import type { BoardEventDef } from '../types';
import { TREASURE_SPOT } from './board';
import { KNOCKBACK, present, scaled, tideVictims, turnFlow, volleyTargets, VOLLEY_RANGE } from './rules';

const cannonVolley: BoardEventDef = {
  id: 'cove_cannon_volley',
  title: 'CANNON VOLLEY',
  kind: 'board',
  boards: ['pirates'],
  summary: `The galleon fires a volley along the shoals: every rival up to ${VOLLEY_RANGE} spaces ahead is blasted ${KNOCKBACK} spaces back.`,
  async run(ctx, p) {
    if (!p) return;
    const { gainChips, pushBackward, shieldBlocks } = await turnFlow();
    const targets = volleyTargets(ctx.graph, ctx.board, ctx.state.players, p);
    await present(
      ctx,
      this,
      [
        { npc: 'wrench', pose: 'gadget', text: "I packed the galleon's cannons with party confetti. Light the fuse!" },
        targets.length
          ? { npc: 'wrench', pose: 'laugh', text: 'KA-BOOM! That volley is headed for everyone up ahead!' }
          : { npc: 'wrench', pose: 'idea', text: 'Not a soul in range! The crew loved the fireworks anyway. Here, a few coins!' },
      ],
      { fx: 'cannon', focus: p.nodeId },
    );
    if (!targets.length) {
      await gainChips(ctx, p, 3, 'event');
      return;
    }
    logMatch(ctx.state, `Cannon volley hit ${targets.map((t) => t.name).join(', ')}`);
    for (const o of targets) {
      if (await shieldBlocks(ctx, o)) continue;
      await pushBackward(ctx, o, KNOCKBACK, 'cannon');
    }
  },
};

const treasureMap: BoardEventDef = {
  id: 'cove_treasure_map',
  title: 'TREASURE MAP',
  kind: 'board',
  boards: ['pirates'],
  summary: 'A treasure map turns up in the map room: you are whisked to the Treasure Cave and dig up 6 to 10 coins.',
  async run(ctx, p) {
    if (!p) return;
    const { gainChips, teleport } = await turnFlow();
    const coins = scaled(ctx, ctx.rng.int(6, 10));
    await present(
      ctx,
      this,
      [
        { npc: 'pipper', pose: 'point', text: 'Ooh, a treasure map, tucked between the sea charts! X marks the spot, right at the Treasure Cave.' },
        { npc: 'pipper', pose: 'coin', text: "Follow it before anyone else does. Dig, dig, dig!" },
      ],
      { fx: 'treasure', player: p },
    );
    await teleport(ctx, p, TREASURE_SPOT, 'guide');
    await gainChips(ctx, p, coins, 'treasure');
  },
};

const highTide: BoardEventDef = {
  id: 'cove_high_tide',
  title: 'HIGH TIDE',
  kind: 'board',
  boards: ['pirates'],
  summary: `The tide rolls over Palm Beach, the Sandbar Shoals and the Reef Steps: everyone on them is washed ${KNOCKBACK} spaces back.`,
  async run(ctx, p) {
    const { pushBackward, shieldBlocks } = await turnFlow();
    const victims = tideVictims(ctx.graph, ctx.state.players, p);
    await present(
      ctx,
      this,
      [
        { npc: 'mimi', pose: 'alert', text: 'Surf is up! The tide is rolling in over the beach, the shoals and the reef!' },
        { npc: 'mimi', pose: 'surprised', text: 'Everybody on the shoreline, hold your hats. Splash!' },
      ],
      { fx: 'wind', focus: p?.nodeId },
    );
    for (const v of victims) {
      if (await shieldBlocks(ctx, v)) continue;
      await pushBackward(ctx, v, KNOCKBACK, 'wind');
    }
  },
};

/** Board events unique to the pirates board (give each `boards: ['pirates']`). */
export const PIRATES_EVENTS: BoardEventDef[] = [cannonVolley, treasureMap, highTide];
