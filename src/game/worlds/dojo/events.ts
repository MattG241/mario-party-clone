// Dojo Summit's own board events: a training montage at the falls and the boulder grounds, a bout in
// the Tournament Ring, and a smoke bomb on the village rooftops. (The rope bridge uses the festival's
// Bridge Break event.)
import { checkpoint, type DialogLineSpec, type EventPresentation, type FlowContext, type TargetOption } from '../../board/flowTypes';
import type { PlayerState } from '../../state/MatchState';
import type { BoardEventDef } from '../types';
import { BOUT_PURSE, boutFlurries, derangement, DRILLS, pickChallenger, TRAINING_PAY, trainingStreak } from './rules';

// TurnFlow's helpers load lazily: TurnFlow imports the EventManager, which gathers these events when
// it loads, so a static import here could start that cycle from the wrong end (e.g. in unit tests).
const turnFlow = () => import('../../board/TurnFlow');

function present(ctx: FlowContext, def: BoardEventDef, lines: DialogLineSpec[], extra: Partial<EventPresentation> = {}): Promise<void> {
  return ctx.io.event({ id: def.id, title: def.title, kind: def.kind === 'global' ? 'global' : def.kind, lines, ...extra }).then(() => checkpoint(ctx));
}

/** Chaotic events pay (and cost) half as much again. */
const scale = (ctx: FlowContext, n: number) => Math.round(n * (ctx.state.config.events === 'chaotic' ? 1.5 : 1));
const coins = (n: number) => `${n} coin${n === 1 ? '' : 's'}`;

const training: BoardEventDef = {
  id: 'dojo_training',
  title: 'TRAINING MONTAGE',
  kind: 'board',
  boards: ['dojo'],
  summary: 'A training montage: every rep you land pays more coins, until the first slip ends the streak.',
  async run(ctx, p) {
    if (!p) return;
    const { gainChips } = await turnFlow();
    const atFalls = ctx.graph.node(p.nodeId).metadata?.region === 'Training Falls';
    const drills = atFalls ? DRILLS.falls : DRILLS.boulders;
    await present(
      ctx,
      this,
      [{ npc: 'wrench', pose: 'gadget', text: atFalls ? 'Training under the falls! Keep the streak going: every rep pays more coins!' : 'The boulders are ready! Keep the streak going: every rep pays more coins!' }],
      { fx: 'training', player: p },
    );
    const { reps, coins: won } = trainingStreak(ctx.rng);
    const done = drills.slice(0, reps).map((d, i) => `${d}! +${TRAINING_PAY[i]}`);
    const lines: DialogLineSpec[] = [];
    if (reps === drills.length) {
      lines.push({ npc: 'wrench', pose: 'laugh', text: `${done.join('  ')}  A perfect streak! ${coins(scale(ctx, won))}!` });
    } else if (reps > 0) {
      lines.push({ npc: 'wrench', pose: 'idea', text: `${done.join('  ')}  Then a slip on the ${drills[reps].toLowerCase()}. ${coins(scale(ctx, won))} for the streak!` });
    } else {
      lines.push({ npc: 'wrench', pose: 'surprised', text: `Whoops, a slip on the very first rep! Here's a coin for the effort.` });
    }
    await ctx.io.say(lines, p);
    checkpoint(ctx);
    await gainChips(ctx, p, reps > 0 ? scale(ctx, won) : 1, 'training');
  },
};

const bout: BoardEventDef = {
  id: 'dojo_bout',
  title: 'TOURNAMENT BOUT',
  kind: 'board',
  boards: ['dojo'],
  summary: 'Challenge a rival to a bout in the Tournament Ring: the winner takes up to 5 coins from the loser.',
  async run(ctx, p) {
    if (!p) return;
    const rivals = ctx.state.players.filter((o) => o.slot !== p.slot);
    if (!rivals.length) return;
    const { gainChips, loseChips, shieldBlocks } = await turnFlow();
    await present(ctx, this, [{ npc: 'ora', pose: 'flag', text: `${p.name} steps into the Tournament Ring! Who will answer the challenge?` }], { fx: 'parade', player: p });
    const options: TargetOption<number>[] = rivals.map((o) => ({ value: o.slot, label: `${o.name} (${coins(o.chips)})`, nodeId: o.nodeId, slot: o.slot }));
    const cpu = p.isCpu ? pickChallenger(rivals).slot : undefined;
    const picked = await ctx.io.chooseTarget(p, 'Challenge which rival?', options, cpu);
    checkpoint(ctx);
    const foe = rivals.find((o) => o.slot === picked) ?? pickChallenger(rivals);
    const f = boutFlurries(ctx.rng);
    const lines: DialogLineSpec[] = [{ npc: 'ora', pose: 'point', text: `${p.name} lands a flurry of ${f.a}! ${foe.name} answers with ${f.b}!` }];
    if (f.winner === 'draw') {
      lines.push({ npc: 'ora', pose: 'cheer', text: 'A draw! The crowd loves it and tosses both fighters 2 coins!' });
      await ctx.io.say(lines, p);
      checkpoint(ctx);
      await gainChips(ctx, p, 2, 'bout');
      await gainChips(ctx, foe, 2, 'bout');
      return;
    }
    const [winner, loser]: PlayerState[] = f.winner === 'a' ? [p, foe] : [foe, p];
    lines.push({ npc: 'ora', pose: 'cheer', text: `${winner.name} wins the bout! The purse is up to ${coins(scale(ctx, BOUT_PURSE))}!` });
    await ctx.io.say(lines, p);
    checkpoint(ctx);
    if (await shieldBlocks(ctx, loser)) return;
    const n = await loseChips(ctx, loser, scale(ctx, BOUT_PURSE), 'bout');
    // An empty-pocketed loser still gets the winner a cheer from the crowd.
    await gainChips(ctx, winner, n > 0 ? n : 2, 'bout');
  },
};

const smoke: BoardEventDef = {
  id: 'dojo_smoke',
  title: 'SMOKE BOMB',
  kind: 'board',
  boards: ['dojo'],
  summary: 'POOF! A smoke bomb bursts over the rooftops: when the smoke clears, every player has swapped places.',
  available: (ctx) => ctx.state.players.length > 1,
  async run(ctx, p) {
    await present(ctx, this, [{ npc: 'mimi', pose: 'alert', text: 'POOF! Somebody dropped a smoke bomb on the rooftops! I can\'t see a thing!' }], { fx: 'drop', focus: p?.nodeId });
    const players = ctx.state.players;
    const from = players.map((pl) => pl.nodeId);
    const order = derangement(players.length, ctx.rng);
    await Promise.all(players.map((pl, i) => (from[order[i]] !== pl.nodeId ? ctx.io.jumpTo(pl, pl.nodeId, from[order[i]], 'swap') : Promise.resolve())));
    players.forEach((pl, i) => {
      if (from[order[i]] !== pl.nodeId) pl.trail = [];
      pl.nodeId = from[order[i]];
    });
    checkpoint(ctx);
    await ctx.io.say([{ npc: 'mimi', pose: 'surprised', text: 'When the smoke clears… everybody has swapped places!' }]);
    checkpoint(ctx);
  },
};

/** Board events unique to the dojo board. */
export const DOJO_EVENTS: BoardEventDef[] = [training, bout, smoke];
