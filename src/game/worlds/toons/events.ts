// Cartoon Coast's own board events (EVENT spaces at the loop-the-loop, the donut shop and in the bay).
import { logMatch } from '../../state/MatchState';
import type { BoardEventDef } from '../types';
import { DONUT_CALLER, DONUT_OTHERS, LOOP_MAX, LOOP_MIN, loopLanding, present, scaled, STING, swarmVictims, turnFlow } from './rules';

const loopLaunch: BoardEventDef = {
  id: 'coast_loop_launch',
  title: 'LOOP-THE-LOOP',
  kind: 'board',
  boards: ['toons'],
  summary: `The loop-the-loop flings you ${LOOP_MIN} to ${LOOP_MAX} spaces ahead, scooping up 3 coins on the way.`,
  async run(ctx, p) {
    if (!p) return;
    const { gainChips, teleport } = await turnFlow();
    const dest = loopLanding(ctx.graph, ctx.board, p.nodeId, ctx.rng.int(LOOP_MIN, LOOP_MAX));
    await present(
      ctx,
      this,
      [
        { npc: 'ora', pose: 'cheer', text: 'Full speed into the loop-the-loop! Round and round and... WHOOSH!' },
        { npc: 'ora', pose: 'point', text: "Hold on tight, you're flying right over the hills!" },
      ],
      { fx: 'bouncy', player: p },
    );
    await teleport(ctx, p, dest, 'bounce');
    await gainChips(ctx, p, 3, 'loop');
  },
};

const jellyfishSwarm: BoardEventDef = {
  id: 'coast_jellyfish',
  title: 'JELLYFISH SWARM',
  kind: 'board',
  boards: ['toons'],
  summary: `A wobbly jellyfish swarm drifts through Bubble Bay: everyone in the bay or on the pier is stung for ${STING} coins.`,
  async run(ctx, p) {
    const { loseChips, shieldBlocks } = await turnFlow();
    const victims = swarmVictims(ctx.graph, ctx.state.players, p);
    await present(
      ctx,
      this,
      [
        { npc: 'mimi', pose: 'surprised', text: 'Wibble, wobble... a whole swarm of jellyfish is drifting through the bay!' },
        { npc: 'mimi', pose: 'alert', text: 'Everyone in the water or on the pier: ouch, ouch, OUCH!' },
      ],
      { fx: 'topsy', focus: p?.nodeId },
    );
    logMatch(ctx.state, `Jellyfish stung ${victims.map((v) => v.name).join(', ') || 'nobody'}`);
    for (const v of victims) {
      if (await shieldBlocks(ctx, v)) continue;
      await loseChips(ctx, v, scaled(ctx, STING), 'sting');
    }
  },
};

const donutDelivery: BoardEventDef = {
  id: 'coast_donut_delivery',
  title: 'DONUT DELIVERY',
  kind: 'board',
  boards: ['toons'],
  summary: `The donut shop sends out a delivery: whoever landed here gets ${DONUT_CALLER} coins and everyone else ${DONUT_OTHERS}.`,
  async run(ctx, p) {
    const { gainChips } = await turnFlow();
    await present(
      ctx,
      this,
      [
        { npc: 'packsprout', pose: 'gift', text: 'Special delivery from the donut shop! Warm, pink and covered in sprinkles!' },
        { npc: 'packsprout', pose: 'cheer', text: 'A box for everybody on the island, and the biggest box for you!' },
      ],
      { fx: 'parade', player: p ?? undefined },
    );
    if (p) await gainChips(ctx, p, scaled(ctx, DONUT_CALLER), 'donut');
    for (const o of ctx.state.players) if (o !== p) await gainChips(ctx, o, DONUT_OTHERS, 'donut');
  },
};

/** Board events unique to the toons board (give each `boards: ['toons']`). */
export const TOONS_EVENTS: BoardEventDef[] = [loopLaunch, jellyfishSwarm, donutDelivery];
