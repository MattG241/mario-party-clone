// The rules cards, written for the Wii Remote held sideways (D-pad, 2, 1, the B trigger). The shared game
// data's instructions name a gamepad's stick and A/B/X/Y buttons, so the Wii edition uses these instead.
#include <cstring>

#include "Minigame.h"

namespace {

struct Rules {
  const char* id;
  const char* controls;  // a one-line summary for menus
  const char* lines[4];
};

const Rules RULES[] = {
    {"stretch-snatch", "D-pad aims, hold 2 to stretch",
     {"Aim with the D-pad, hold 2 to stretch, let go to snap back with your grab",
      "Fruit 1, drumsticks 2, golden roasts 5: up to 3 in one reach",
      "Crossed arms tangle and drop it all; dodge the cook's rolling pin", "Most food after 45 seconds wins"}},
    {"triple-slash", "D-pad left / up / right slices",
     {"D-pad left slices the left lane, up (or 2) the centre, right the right lane",
      "Slice as each one crosses the line: on the beat is PERFECT", "Keep slicing for a combo; a miss or a wild swing breaks it",
      "Let bombs roll past! Top score after 40 seconds wins"}},
    {"storm-navigator", "D-pad steers, 2 pumps the sail",
     {"Steer with the D-pad: sailing straight into the wind stalls you",
      "Watch the vane: sail across or with the wind to go fast", "Press 2 to pump the sail for a burst; ram a rival to knock treasure loose",
      "Dodge lightning and the whirlpool: most treasure in 50 seconds wins"}},
    {"cloud-rider", "D-pad steers, hold 2 to charge",
     {"Steer with the D-pad through rings (+1) and energy orbs (+3)", "Hold 2 to charge, let go to burst ahead",
      "Ram rivals for rings; dodge storms and wind", "Most rings after 45 seconds wins"}},
    {"clone-chaos", "D-pad moves, 2 picks",
     {"Watch the real ninja as his clones shuffle", "When they stop, move your marker with the D-pad and press 2",
      "Quick, right picks score most (up to +5)", "Beware tricks! 5 rounds, and the last is worth double"}},
    {"rooftop-glide", "Hold 2 to glide, let go to dive",
     {"Hold 2 to glide on your cape, let go to dive", "Open the cape out of a dive to swoop up; vents lift you high",
      "Grab glowing clues: gold ones are worth 3", "Searchlights daze you and shake a clue loose! Most clues in 45 seconds wins"}},
    {"web-swing", "Hold 2 to swing, let go to fling",
     {"Press 2 to web the nearest glowing anchor, and hold it to swing", "Let go of 2 as you swing up for a PERFECT fling",
      "Miss and you drop to the street, losing time", "First to the finish tower wins (or furthest after 50 seconds)"}},
    {"repulsor-range", "D-pad aims, 2 blasts",
     {"Aim your reticle with the D-pad", "Tap 2 for a quick blast; hold 2 and let go for a big charged blast",
      "Pop drones and targets; keep hitting for a combo", "Hitting a balloon costs 3 points! Top score in 45 seconds wins"}},
    {"ring-rush", "D-pad up/down, 2 jumps, 1 spins",
     {"D-pad up and down switch lanes: follow the rings", "2 jumps over crawler bots; 1 spin-dashes through any bot (and rivals!)",
      "A bot hit scatters your rings for anyone to grab", "Most rings after 45 seconds wins"}},
    {"patty-panic", "D-pad adds the toppings",
     {"Each ticket shows a burger, bottom to top",
      "Add the toppings in order with the D-pad: left patty, down lettuce, right tomato, up cheese",
      "A wrong press topples the stack: start again!", "Serve before the customer gives up: most orders in 50 seconds wins"}},
    {"donut-dash", "D-pad runs, 2 dashes",
     {"Run with the D-pad and catch donuts frosted in your colour", "Rainbow donuts count double for anyone; broccoli and burnt ones cost a donut",
      "Press 2 to dash, and bump rivals off a good spot", "The belts speed up: most donuts after 45 seconds wins"}},
    {"hip-shake", "D-pad on the arrows, 2 on the stars",
     {"Arrows fall to your spotlight: press that way on the D-pad on the beat", "Stars are poses: press 2 on the beat",
      "PERFECT on the beat; 8 in a row raises your multiplier", "Top score wins; the final 10 seconds are an encore worth double"}},
    {"coffee-rush", "Hold 2 to pour, press 2 to swirl",
     {"Hold 2 to pull a shot; let go on the gold fill line", "Then press 2 as the milk swirl passes the pink heart",
      "Serve before the order ring runs out; perfect pours score more",
      "Most points wins; the last 10 seconds are rush hour, worth double"}},
    {"rhinestone-rodeo", "D-pad leans",
     {"Before each buck your pony tips one way; an arrow shows which", "Lean that way with the D-pad before it bucks to stay on",
      "Thrown off? You lose 2 seconds and climb back on", "The bucks get wilder: longest time in the saddle wins"}},
    {"slapshot", "D-pad skates, hold 2 to shoot",
     {"Skate into the puck with the D-pad to pick it up", "Hold 2 to wind up a slapshot, let go to fire",
      "Score in a rival goal for +2; letting one in costs 1", "No puck? Press 2 to check. Last 10 seconds: a second puck!"}},
    {"free-throw", "Press 2 for power, then aim",
     {"Press 2 to stop the power bar in the green", "Press 2 again to stop the aim needle in the green",
      "A basket is 2, a swish 3, and the golden ball doubles it", "Last 10 seconds: the hoop slides, and every basket is +1"}},
    {"fairway", "D-pad aims, hold 2 to swing",
     {"Aim with the D-pad, hold 2 to power up, let go to hit", "Wind pushes tee shots; the ball rolls downhill",
      "Hole out in 1 stroke for 5, in 2 for 3, in 3 for 2", "Closest to the pin scores 2; the last 10 seconds are double"}},
};

const Rules* find(const data::MinigameDef* d) {
  if (!d) return nullptr;
  for (const auto& r : RULES)
    if (!strcmp(r.id, d->id)) return &r;
  return nullptr;
}

}  // namespace

const char* minigameRule(const data::MinigameDef* d, int k) {
  if (k < 0 || k > 3) return "";
  const Rules* r = find(d);
  if (r) return r->lines[k];
  return d && d->instructions[k] ? d->instructions[k] : "";
}

const char* minigameControls(const data::MinigameDef* d) {
  const Rules* r = find(d);
  return r ? r->controls : "";
}
