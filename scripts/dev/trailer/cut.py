"""Write the trailer's cut list (edl.json) from the recordings' logs: every cut is placed so that a
moment in the footage (a call-out appearing, a sound effect playing) lands on a chosen beat of the
score. Re-record (scripts/dev/record.mjs + shots.json) and run this again and the cuts follow.

    python3 scripts/dev/trailer/cut.py <rawDir> [out.json]

Recorded logs (<rawDir>/<shot>/log.json) give each sound effect and watched call-out with the
recorded frame it happened on. Times here are [bar, beat] on the score's grid (music.py).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from music import BAR, BEAT  # noqa: E402

RAW = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'edl.json')
FPS = 30
# PARTIAL=1: leave out cuts from shots not recorded yet (for checking one section of the edit)
PARTIAL = bool(os.environ.get('PARTIAL'))
NAN = float('nan')
_logs = {}


def T(b, beat=0.0):
    return b * BAR + beat * BEAT


def L(shot):
    if shot not in _logs:
        path = os.path.join(RAW, shot, 'log.json')
        _logs[shot] = json.load(open(path)) if os.path.exists(path) or not PARTIAL else {'sfx': [], 'watch': [], 'marks': []}
    return _logs[shot]


def missing(what):
    if PARTIAL:
        return NAN
    raise KeyError(what)


def nframes(shot):
    return len([f for f in os.listdir(os.path.join(RAW, shot)) if f.endswith('.jpg')])


def sfx(shot, key, nth=0, after=0.0):
    """Recorded time (s) of the nth sound effect `key` at or after `after`."""
    hits = [s[1] / FPS for s in L(shot)['sfx'] if s[2] == key and s[1] is not None and s[1] / FPS >= after - 1e-6]
    if nth >= len(hits):
        return missing(f'{shot}: no {key} #{nth} after {after}')
    return hits[nth]


def sfx_before(shot, key, t):
    """Recorded time (s) of the last sound effect `key` at or before `t`."""
    hits = [s[1] / FPS for s in L(shot)['sfx'] if s[2] == key and s[1] is not None and s[1] / FPS <= t + 1e-6]
    return hits[-1] if hits else missing(f'{shot}: no {key} before {t}')


def text(shot, t, nth=0, after=0.0, exact=False):
    """Recorded time (s) at which a watched call-out text first appears (nth time, at or after `after`)."""
    out, prev = [], False
    for w in L(shot)['watch']:
        v = w[2]
        try:
            parts = json.loads(v)
            texts = parts[-1] if isinstance(parts, list) else parts
        except Exception:
            texts = v
        items = [x for x in str(texts).split(' | ')]
        on = (t in items) if exact else any(t in x for x in items)
        if on and not prev and w[1] is not None and w[1] / FPS >= after - 1e-6:
            out.append(w[1] / FPS)
        prev = on
    if nth >= len(out):
        return missing(f'{shot}: no text {t!r} #{nth} after {after}')
    return out[nth]


def mark(shot, name):
    m = next((m for m in L(shot)['marks'] if m[2] == name), None)
    return m[1] / FPS if m else missing(f'{shot}: no mark {name}')


segments, overlays = [], []


def S(start, end, shot, src, **kw):
    if src != src or not os.path.isdir(os.path.join(RAW, shot)):
        print(f'  - {shot} {start}: not recorded yet, left out')
        return
    dur = (T(*end) - T(*start)) * kw.get('speed', 1.0)
    n = nframes(shot)
    if src < 0 or (src + dur) * FPS > n + 1:
        print(f'  ! {shot}: {src:.2f}..{src + dur:.2f}s runs outside its {n / FPS:.2f}s of footage')
    segments.append(dict(start=list(start), end=list(end), shot=shot, src=round(src, 3), **kw))


def S_at(start, end, shot, event_t, at, speed=1.0, **kw):
    """A segment whose footage moment `event_t` lands on timeline position `at` ([bar, beat])."""
    S(start, end, shot, event_t - (T(*at) - T(*start)) * speed, speed=speed, **kw)


def O(start, end, kind, **kw):
    overlays.append(dict(start=list(start), end=list(end), kind=kind, **kw))


F = 1 / FPS
# ------------------------------------------------------------------------------------------
# Cold open: black, then the countdown from four different games, GO!, two quick hits, the logo.
S_at([0, 1], [0, 2], 'mg_gleam', text('mg_gleam', '3', exact=True) - F, [0, 1], speed=0.85, z0=1.06, z1=1.12)
S_at([0, 2], [0, 3], 'mg_crate', text('mg_crate', '2', exact=True) - F, [0, 2], speed=0.85, z0=1.06, z1=1.12)
S_at([0, 3], [1, 0], 'mg_tower', text('mg_tower', '1', exact=True) - F, [0, 3], speed=0.85, z0=1.06, z1=1.12)
S_at([1, 0], [1, 2], 'mg_orbit', text('mg_orbit', 'GO!', exact=True) - F, [1, 0], z0=1.1, z1=1.0, flash=0.5)
# a knock-out: the arm's hit lands just after the cut, the OUT! stamp just before the next one
ko1 = sfx_before('mg_orbit', 'hit', sfx('mg_orbit', 'stamp', 0, after=mark('mg_orbit', 'start')))
S_at([1, 2], [1, 3], 'mg_orbit', ko1, [1, 2.3], z0=1.15, z1=1.2, flash=0.35)
S_at([1, 3], [2, 0], 'mg_crate', text('mg_crate', 'GOLDEN RUSH!'), [1, 3.1], z0=1.08, z1=1.14, flash=0.35)

# Title: the logo over the title island.
S([2, 0], [5, 0], 'title', 0.2, z0=1.0, z1=1.06, focus=[0.6, 0.55], flash=1.0)
O([2, 0], [4, 0], 'logo', cx=960, cy=196, width=1000)
# The guests, a page a bar: a whoosh as each panel lands, a pop as its name appears.
for i, n in enumerate([5, 4, 4, 4]):
    O([4 + i, 0], [5 + i, 0], 'page', page=i)
    for k in range(n):
        O([4 + i, k * 0.5], [4 + i, k * 0.5 + 0.5], 'sfx', key='whoosh', rate=1, vol=0.55)
        O([4 + i, k * 0.5 + 0.35], [4 + i, k * 0.5 + 0.85], 'sfx', key='pop', rate=1.2, vol=0.35)

# Character select: four players join and lock in.
S([8, 0], [10, 0], 'select', 0.25, z0=1.0, z1=1.03, flash=0.8, sfx=0.6)  # a flurry of menu sounds: keep them down

# The board.
S([10, 0], [11, 0], 'board_intro', 0.0, z0=1.0, z1=1.05)
S_at([11, 0], [12, 0], 'board_relic', sfx('board_relic', 'dialStop'), [11, 2], z0=1.0, z1=1.06)
O([11, 0.25], [12, 0], 'callout', text='SPIN THE ORBIT DIAL!', cy=150, size=92)
S_at([12, 0], [13, 0], 'board_relic', text('board_relic', 'PRISM RELIC!'), [12, 2], z0=1.0, z1=1.04)
S_at([13, 0], [13, 2], 'board_relic', sfx('board_relic', 'whoosh', 0, after=text('board_relic', 'PRISM RELIC!')), [13, 0.3])
S_at([13, 2], [14, 0], 'board_relic', sfx('board_relic', 'cymbal', 0, after=text('board_relic', 'PRISM RELIC!')), [13, 3], flash=0.25)
O([13, 0.25], [14, 0], 'callout', text='CHASE THE PRISM RELICS!', cy=150, size=92)
S([14, 0], [16, 0], 'board_lapse', 0.0, speed=2.35, mute=True, flash=0.3)
S([16, 0], [17, 0], 'board_final', 0.0)
# Minigame time at nightfall, then (through the festival wipe) the first game's instruction card.
mg_time = text('board_final', 'MINIGAME TIME!')
S_at([17, 0], [17, 2.5], 'board_final', mg_time, [17, 0.15])
S_at([17, 2.5], [18, 0], 'board_final', text('board_final', 'S', exact=True, after=mg_time), [17, 2.75])

# The minigames, one a bar (the spiral wipe opens the montage on the game just introduced).
S_at([18, 0], [19, 0], 'mg_splash', text('mg_splash', 'LAST 2!'), [18, 2.5], z0=1.03, z1=1.09, focus=[0.5, 0.45])
O([18, 0], [18, 1.5], 'spiral')
S_at([19, 0], [20, 0], 'mg_gleam', text('mg_gleam', 'FINAL 10 SECONDS!'), [19, 1], z0=1.0, z1=1.05, flash=0.35)
S_at([20, 0], [21, 0], 'mg_orbit', text('mg_orbit', 'SPEED UP!'), [20, 1], z0=1.0, z1=1.05, flash=0.35)
S_at([21, 0], [22, 0], 'mg_crate', text('mg_crate', 'GOLDEN RUSH!'), [21, 0.5], z0=1.0, z1=1.05, flash=0.35)
S_at([22, 0], [23, 0], 'mg_skybridge', text('mg_skybridge', 'HERE COMES THE WAVE!'), [22, 0.4], z0=1.0, z1=1.05, flash=0.35)
S([23, 0], [23, 2], 'mg_totem', 1.6, z0=1.0, z1=1.04, flash=0.35)
S_at([23, 2], [24, 0], 'mg_totem', text('mg_totem', 'TEAM WINS!'), [23, 2.6], z0=1.02, z1=1.08)
S_at([24, 0], [25, 0], 'mg_relay', sfx('mg_relay', 'fanfare'), [24, 2], z0=1.04, z1=1.14, focus=[0.7, 0.4], flash=0.35)
S_at([25, 0], [26, 0], 'mg_tower', text('mg_tower', 'SUMMIT! 1st!'), [25, 2], z0=1.0, z1=1.05, flash=0.35)
for i, shot in enumerate(['mg_splash', 'mg_gleam', 'mg_orbit', 'mg_crate', 'mg_skybridge', 'mg_totem', 'mg_relay', 'mg_tower']):
    O([18 + i, 0.35 if i else 0.9], [19 + i, 0], 'tag', shot=shot)

# Rapid-fire: a beat each.
ko2 = sfx_before('mg_orbit', 'hit', sfx('mg_orbit', 'stamp', 1, after=mark('mg_orbit', 'start')))
rapid = [  # (shot, moment, where in its beat it lands, zoom centre)
    ('mg_orbit', ko2, 0.3, (0.5, 0.5)),
    ('mg_splash', text('mg_splash', 'SPLASH!'), 0.3, (0.4, 0.52)),
    ('mg_crate', sfx('mg_crate', 'chipLose'), 0.3, (0.6, 0.6)),  # a crate steal
    ('mg_skybridge', sfx('mg_skybridge', 'stamp'), 0.8, (0.45, 0.5)),  # a fall, then OUT!
    ('mg_relay', sfx('mg_relay', 'hit'), 0.35, (0.6, 0.4)),  # a bonk on a spike post
    ('mg_totem', 0.05, 0.0, (0.5, 0.55)),  # a synced pull (the montage shows the next one)
    ('mg_tower', sfx('mg_tower', 'victory'), 0.3, (0.5, 0.5)),
]
for k, (shot, t, at, focus) in enumerate(rapid):
    b, bt = 26 + k // 4, k % 4
    S_at([b, bt], [b + (bt + 1) // 4, (bt + 1) % 4], shot, t, [b, bt + at], z0=1.1, z1=1.16, focus=list(focus), flash=0.3)
O([26, 0.1], [27, 3.9], 'callout', text='8 FESTIVAL MINIGAMES!', cy=160, size=100)

# FINISH!: the last seconds of Gleam Grab slam into FINISH! on the downbeat.
S_at([27, 3], [29, 0], 'mg_gleam', sfx('mg_gleam', 'finish'), [28, 0], z0=1.0, z1=1.06)

# The ceremony: runners-up, the drumroll, the winner lands on the downbeat, fireworks.
cer_land = sfx('ceremony', 'fanfare')
cer_cymbal = sfx('ceremony', 'cymbal', 0, after=text('ceremony', 'AND THE WINNER IS'))
S([29, 0], [30, 0], 'ceremony', text('ceremony', 'AND THE WINNER IS') - 0.15, speed=1.2, flash=0.4)
S_at([30, 0], [30, 2], 'ceremony', cer_cymbal, [30, 1.9], speed=2.0)
S_at([30, 2], [31, 0], 'ceremony', cer_land, [31, 0], speed=1.2)
S([31, 0], [36, 0], 'ceremony', cer_land, flash=0.5)

# End card over the fireworks.
O([32, 0], [36, 0], 'blur', r=9, dim=0.3, ramp=0.5)
O([32, 0], [36, 0], 'endcard')
for k in range(3):  # the chips popping in, then the address
    O([32, 0.8 / BEAT + k * 0.12 / BEAT], [32, 3], 'sfx', key='pop', rate=1, vol=0.4)
O([32, 1.3 / BEAT], [33, 0], 'sfx', key='itemGet', rate=1, vol=0.45)
O([35, 2], [36, 0], 'fadeout')

json.dump({'note': 'Trailer cut list, written by cut.py from the recorded logs. start/end are [bar, beat] on the score\'s grid (music.py, 124 BPM); src is the in-point in seconds into the recorded shot; speed plays it faster or slower; z0/z1 zoom over the segment, focus is the zoom centre (0-1); flash fades in from white; mute drops its sound effects.',
           'length': [36, 0], 'segments': segments, 'overlays': overlays}, open(OUT, 'w'), indent=1)
print(len(segments), 'segments', len(overlays), 'overlays ->', OUT)
