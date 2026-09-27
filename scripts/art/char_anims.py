"""Poses for every hero animation (see characters.py).

A pose is a dict: root (pos, yaw, lean, roll), hips/spine/chest/neck/head rotations (degrees),
arms (raise, swing, twist, elbow), legs (forward, out, twist, knee), hands ('fist' | 'open'),
face (eyes, mouth, brows, look) and hero-specific extras (scarf flutter, tail swish, stars...).

Arm angles: raise 0 hangs down, 90 is horizontal, 180 straight up; swing 0 is out to the side,
90 forward, -90 backward. Leg forward swing is in degrees (negative = behind).

`animations(hero)` returns {name: [pose, ...]}: the unique frames of each animation. The playback
order (which may repeat frames) is PLAYBACK below; both are written into the generated TS.
"""
from __future__ import annotations

import copy
import math

FACE_RIGHT = 58.0  # yaw for moving poses: three-quarter view facing screen right
IDLE_YAW = 14.0


def base() -> dict:
    return dict(
        root=dict(pos=(0.0, 0.0, 0.0), yaw=IDLE_YAW, lean=0.0, roll=0.0),
        hips=(0, 0, 0), spine=(0, 0, 0), chest=(0, 0, 0), neck=(0, 0, 0), head=(0, 0, 0),
        armL=(20, 8, 0, 24), armR=(20, 8, 0, 24),
        legL=(0, 8, 0, 3), legR=(0, 8, 0, 3),
        handL='fist', handR='fist', feet_flat=True, ground=True, rise=0.0, sit=False,
        face=dict(eyes='open', mouth='smile', brows='neutral', look=(0.0, 0.0)),
        extra=dict(scarf=0.1, wave=0.0, tail=0.0, sway=0.0, stars=None, chip=None),
    )


def pose(**kw) -> dict:
    p = base()
    for k, v in kw.items():
        if isinstance(v, dict) and isinstance(p.get(k), dict):
            p[k] = {**p[k], **v}
        else:
            p[k] = v
    return p


def swing(fwd: float, out: float = 12.0, twist: float = 0.0, elbow: float = 25.0):
    """Arm swinging `fwd` degrees forward (negative: back) while held `out` from the body."""
    raise_ = math.hypot(fwd, out)
    sw = math.degrees(math.atan2(fwd, out))
    return (raise_, sw, twist, elbow)


def face(eyes='open', mouth='smile', brows='neutral', look=(0.0, 0.0)):
    return dict(eyes=eyes, mouth=mouth, brows=brows, look=look)


# ------------------------------------------------------------------------------------------
def idle(n=4):
    out = []
    for i in range(n):
        t = i / n * math.tau
        b = math.sin(t)
        out.append(pose(
            spine=(1.5 * b, 0, 0), chest=(1.2 * b, 0, 0), head=(-1.5 * b, 0, 2 * math.sin(t * 0.5)),
            armL=(20 + 2 * b, 8, 0, 24 + 4 * b), armR=(20 + 2 * b, 8, 0, 24 + 4 * b),
            legL=(0, 8, 0, 3 + 3 * (b + 1)), legR=(0, 8, 0, 3 + 3 * (b + 1)),
            extra=dict(scarf=0.08, wave=t, tail=0.15 * b, sway=0.4 * b),
        ))
    return out


def walk(n=8):
    out = []
    for i in range(n):
        p = i / n * math.tau
        s, c = math.sin(p), math.cos(p)
        out.append(pose(
            root=dict(yaw=FACE_RIGHT, lean=4.0),
            hips=(0, 0, 7 * s), chest=(2, 0, -9 * s), head=(-2, 0, 3 * s),
            legL=(26 * s, 5, 0, 6 + 38 * max(0.0, c)), legR=(-26 * s, 5, 0, 6 + 38 * max(0.0, -c)),
            footL=(-12 * max(0.0, -s) + 8 * max(0.0, c) * 0, 0, 0), footR=(-12 * max(0.0, s), 0, 0),
            armL=swing(-34 * s, 14, 0, 30 + 14 * abs(s)), armR=swing(34 * s, 14, 0, 30 + 14 * abs(s)),
            face=face('open', 'smile'),
            extra=dict(scarf=0.35, wave=p * 1.0, tail=0.25 * s, sway=0.6 * s),
        ))
    return out


def run(n=6):
    out = []
    for i in range(n):
        p = i / n * math.tau
        s, c = math.sin(p), math.cos(p)
        out.append(pose(
            root=dict(yaw=FACE_RIGHT, lean=13.0),
            hips=(0, 0, 9 * s), chest=(6, 0, -12 * s), head=(-10, 0, 3 * s),
            legL=(44 * s, 4, 0, 18 + 70 * max(0.0, c)), legR=(-44 * s, 4, 0, 18 + 70 * max(0.0, -c)),
            footL=(-25 * max(0.0, -s), 0, 0), footR=(-25 * max(0.0, s), 0, 0),
            armL=swing(-55 * s, 18, 0, 85), armR=swing(55 * s, 18, 0, 85),
            rise=0.05 * abs(math.sin(p * 2 + 0.6)),
            face=face('open', 'grin', 'determined'),
            extra=dict(scarf=1.0, wave=p * 1.3, tail=0.6 + 0.2 * s, sway=0.8 * s),
        ))
    return out


def jump():
    return [
        pose(root=dict(lean=16.0), chest=(6, 0, 0), head=(-8, 0, 0),
             legL=(40, 8, 0, 82), legR=(40, 8, 0, 82), armL=swing(-55, 20, 0, 30), armR=swing(-55, 20, 0, 30),
             face=face('determined', 'smile', 'determined'), extra=dict(scarf=0.2, tail=-0.2)),
        pose(root=dict(lean=-4.0), ground=False, rise=0.34, feet_flat=False, chest=(-6, 0, 0), head=(6, 0, 0),
             legL=(-6, 6, 0, 10), legR=(4, 6, 0, 22), footL=(28, 0, 0), footR=(22, 0, 0),
             armL=(138, -12, 0, 8), armR=(138, -12, 0, 8), handL='open', handR='open',
             face=face('open', 'grin', 'up'), extra=dict(scarf=0.9, tail=0.6)),
        pose(ground=False, rise=0.46, feet_flat=False, chest=(4, 0, 0), head=(0, 0, 0),
             legL=(48, 10, 0, 92), legR=(36, 10, 0, 88), footL=(10, 0, 0), footR=(10, 0, 0),
             armL=(118, -10, 40, 24), armR=(118, -10, 40, 24), handL='open', handR='open',
             face=face('happy', 'laugh', 'up'), extra=dict(scarf=0.6, tail=0.9)),
        pose(root=dict(lean=10.0), legL=(30, 10, 0, 58), legR=(26, 10, 0, 54),
             armL=(70, 20, 0, 30), armR=(70, 20, 0, 30), handL='open', handR='open',
             face=face('open', 'smile'), extra=dict(scarf=0.3, tail=0.1)),
    ]


def celebrate():
    return [
        pose(armL=(138, -12, 30, 10), armR=(30, 5, 0, 95), rise=0.06, ground=True, chest=(-4, 0, 0),
             legL=(8, 8, 0, 14), legR=(-4, 8, 0, 8), face=face('happy', 'laugh'), extra=dict(scarf=0.4, tail=0.5)),
        pose(armL=(136, -12, 20, 8), armR=(136, -12, 20, 8), rise=0.16, ground=False, feet_flat=False, chest=(-6, 0, 0), head=(8, 0, 0),
             legL=(26, 10, 0, 60), legR=(10, 10, 0, 40), footL=(20, 0, 0), footR=(20, 0, 0),
             face=face('happy', 'laugh', 'up'), extra=dict(scarf=0.7, tail=0.9)),
        pose(armR=(138, -12, 30, 10), armL=(30, 5, 0, 95), rise=0.06, chest=(-4, 0, 0),
             legR=(8, 8, 0, 14), legL=(-4, 8, 0, 8), face=face('happy', 'laugh'), extra=dict(scarf=0.4, tail=0.5)),
        pose(armL=(112, -10, 90, 50), armR=(112, -10, 90, 50), chest=(-3, 0, 0), head=(6, 0, 0),
             face=face('happy', 'grin', 'up'), extra=dict(scarf=0.3, tail=0.4)),
    ]


def disappointed():
    return [
        pose(root=dict(lean=5.0), chest=(10, 0, 0), neck=(10, 0, 0), head=(14, 0, -4),
             armL=(6, 5, 0, 8), armR=(6, 5, 0, 8), handL='open', handR='open',
             face=face('sad', 'frown', 'sad', (0, -0.8)), extra=dict(scarf=0.0, tail=-0.4)),
        pose(root=dict(lean=8.0), chest=(16, 0, 0), neck=(14, 0, 0), head=(20, 0, -6),
             legL=(10, 8, 0, 22), legR=(10, 8, 0, 22), armL=(4, 3, 0, 5), armR=(4, 3, 0, 5), handL='open', handR='open',
             face=face('closed', 'frown', 'sad'), extra=dict(scarf=0.0, tail=-0.6)),
        pose(root=dict(lean=12.0), chest=(20, 0, 0), neck=(16, 0, 0), head=(22, 0, -8),
             legL=(46, 10, 0, 92), legR=(42, 10, 0, 90), armL=(14, 30, 0, 20), armR=(14, 30, 0, 20), handL='open', handR='open',
             face=face('closed', 'wobble', 'sad'), extra=dict(scarf=0.0, tail=-0.8)),
    ]


def surprised():
    return [
        pose(root=dict(lean=-8.0), chest=(-8, 0, 0), head=(8, 0, 0), armL=(104, -8, 80, 50), armR=(104, -8, 80, 50),
             handL='open', handR='open', legL=(-6, 10, 0, 10), legR=(8, 10, 0, 12),
             face=face('wide', 'gasp', 'up'), extra=dict(scarf=0.5, tail=0.9)),
        pose(root=dict(lean=-10.0), rise=0.1, ground=False, feet_flat=False, chest=(-10, 0, 0), head=(10, 0, 0),
             armL=(122, -10, 60, 30), armR=(122, -10, 60, 30), handL='open', handR='open', legL=(10, 12, 0, 30), legR=(20, 12, 0, 40),
             footL=(15, 0, 0), footR=(15, 0, 0), face=face('wide', 'gasp', 'up'), extra=dict(scarf=0.8, tail=1.0)),
        pose(root=dict(lean=-4.0), chest=(-4, 0, 0), head=(4, 0, 0), armL=(72, 20, 70, 70), armR=(72, 20, 70, 70),
             handL='open', handR='open', face=face('wide', 'o', 'up'), extra=dict(scarf=0.3, tail=0.6)),
    ]


def stunned(n=4):
    out = []
    for i in range(n):
        ph = i / n * math.tau
        out.append(pose(
            sit=True, root=dict(lean=-10.0 + 4 * math.sin(ph), roll=7 * math.sin(ph)), chest=(0, 0, 0),
            head=(4, 10 * math.sin(ph + 1.0), 6 * math.cos(ph)),
            legL=(78, 16, 0, 22), legR=(70, 16, 0, 34), footL=(-15, 0, 0), footR=(-15, 0, 0),
            armL=(34, 50, 0, 30), armR=(34, 50, 0, 30), handL='open', handR='open',
            face=face('dizzy', 'wobble', 'worried'), extra=dict(scarf=0.0, stars=ph, tail=-0.3),
        ))
    return out


def wave(n=4):
    out = []
    for i in range(n):
        ph = i / n * math.tau
        out.append(pose(
            chest=(-2, 0, 4), head=(2, 0, 6),
            armR=(98, -8, 90, 58 + 20 * math.sin(ph)), armL=(18, 10, 0, 40),
            handR='open', face=face('open', 'grin'), extra=dict(scarf=0.15, wave=ph, tail=0.3 * math.sin(ph)),
        ))
    return out


def victory():
    return [
        pose(armL=(132, -12, 30, 14), armR=(132, -12, 30, 14), chest=(-4, 0, 0), head=(6, 0, 0), legL=(12, 8, 0, 30), legR=(12, 8, 0, 30),
             face=face('happy', 'laugh', 'up'), extra=dict(scarf=0.3, tail=0.6)),
        pose(armL=(140, -12, 0, 6), armR=(140, -12, 0, 6), rise=0.28, ground=False, feet_flat=False, chest=(-8, 0, 0), head=(10, 0, 0),
             legL=(30, 10, 0, 70), legR=(14, 10, 0, 50), footL=(20, 0, 0), footR=(20, 0, 0),
             face=face('happy', 'laugh', 'up'), extra=dict(scarf=0.9, tail=1.0)),
        pose(armL=(137, -12, 20, 8), armR=(137, -12, 20, 8), chest=(-6, 0, 0), head=(8, 0, 4),
             legL=(0, 10, 0, 6), legR=(0, 10, 0, 6), face=face('happy', 'grin', 'up'), extra=dict(scarf=0.35, tail=0.7)),
        pose(armL=(140, -12, 0, 6), armR=(108, -10, 90, 56), chest=(-5, 0, 6), head=(6, 0, 8),
             face=face('wink', 'grin', 'up'), extra=dict(scarf=0.3, tail=0.5)),
    ]


def crouch():
    return [pose(root=dict(lean=24.0), chest=(12, 0, 0), neck=(8, 0, 0), head=(4, 0, 0),
                 legL=(62, 12, 0, 118), legR=(58, 12, 0, 116), armL=(128, 20, 90, 118), armR=(128, 20, 90, 118), handL='open', handR='open',
                 face=face('closed', 'flat', 'worried'), extra=dict(scarf=0.0, tail=-0.2))]


def carry():
    return [pose(root=dict(yaw=FACE_RIGHT, lean=4.0), chest=(-4, 0, 0), head=(-2, 0, 0),
                 armL=(112, 78, 0, 48), armR=(112, 78, 0, 48), handL='open', handR='open',
                 face=face('open', 'grin', 'determined'), extra=dict(scarf=0.4, tail=0.4))]


def throw():
    return [
        pose(root=dict(yaw=FACE_RIGHT, lean=-10.0), chest=(-8, 0, 16), head=(-4, 0, -8),
             armL=(120, -70, 0, 60), armR=(60, 70, 0, 40), legL=(20, 8, 0, 20), legR=(-20, 8, 0, 20),
             face=face('determined', 'smile', 'determined'), extra=dict(scarf=0.4, tail=0.2)),
        pose(root=dict(yaw=FACE_RIGHT, lean=14.0), chest=(8, 0, -14), head=(-8, 0, 6),
             armL=(105, 85, 0, 8), armR=(40, -40, 0, 40), legL=(30, 8, 0, 30), legR=(-26, 8, 0, 14), handL='open',
             face=face('open', 'grin', 'determined'), extra=dict(scarf=0.9, tail=0.8)),
    ]


def balance():
    return [pose(root=dict(roll=8.0), chest=(0, -6, 0), head=(0, 8, 0), armL=(92, 5, 0, 12), armR=(88, 5, 0, 12), handL='open', handR='open',
                 legL=(24, 16, 0, 60), legR=(0, 4, 0, 4), face=face('wide', 'wobble', 'worried'), extra=dict(scarf=0.3, tail=0.7))]


def swim():
    return [
        pose(root=dict(lean=40.0), ground=False, rise=0.1, feet_flat=False, armL=(150, 80, 0, 20), armR=(40, -60, 0, 40),
             legL=(-10, 8, 0, 30), legR=(20, 8, 0, 20), face=face('determined', 'o', 'determined'), extra=dict(scarf=0.8, tail=0.6)),
        pose(root=dict(lean=40.0), ground=False, rise=0.1, feet_flat=False, armR=(150, 80, 0, 20), armL=(40, -60, 0, 40),
             legR=(-10, 8, 0, 30), legL=(20, 8, 0, 20), face=face('determined', 'o', 'determined'), extra=dict(scarf=0.8, tail=0.6)),
    ]


def climb():
    return [
        pose(root=dict(yaw=0.0), armL=(142, -10, 0, 8), armR=(112, -8, 90, 50), legL=(60, 10, 0, 90), legR=(0, 8, 0, 8),
             handL='open', handR='open', head=(-10, 0, 0), face=face('determined', 'flat', 'determined', (0, 0.8)), extra=dict(scarf=0.2, tail=0.3)),
        pose(root=dict(yaw=0.0), armR=(142, -10, 0, 8), armL=(112, -8, 90, 50), legR=(60, 10, 0, 90), legL=(0, 8, 0, 8),
             handL='open', handR='open', head=(-10, 0, 0), face=face('determined', 'flat', 'determined', (0, 0.8)), extra=dict(scarf=0.2, tail=0.3)),
    ]


def dash():
    return [pose(root=dict(yaw=FACE_RIGHT, lean=28.0), chest=(6, 0, 0), head=(-18, 0, 0),
                 legL=(52, 6, 0, 36), legR=(-44, 6, 0, 30), footR=(-20, 0, 0),
                 armL=(62, -82, 0, 30), armR=(62, -82, 0, 30), handL='open', handR='open',
                 face=face('determined', 'grin', 'determined'), extra=dict(scarf=1.0, tail=1.0, wave=1.0))]


def fall():
    return [pose(ground=False, rise=0.12, feet_flat=False, root=dict(lean=-8.0), chest=(-6, 0, 0), head=(8, 0, 0),
                 armL=(136, -12, 20, 14), armR=(118, -8, 60, 36), handL='open', handR='open',
                 legL=(40, 14, 0, 70), legR=(14, 14, 0, 40), footL=(20, 0, 0), footR=(20, 0, 0),
                 face=face('wide', 'gasp', 'worried'), extra=dict(scarf=1.0, tail=1.0))]


def cheer():
    return [pose(armL=(128, -12, 60, 24), armR=(128, -12, 60, 24), chest=(-4, 0, 0), head=(6, 0, 0),
                 face=face('happy', 'laugh', 'up'), extra=dict(scarf=0.3, tail=0.5))]


def dial():
    return [
        pose(root=dict(lean=10.0), legL=(34, 8, 0, 66), legR=(34, 8, 0, 66), armL=(60, 30, 0, 120), armR=swing(-40, 18, 0, 40),
             face=face('determined', 'smile', 'determined', (0, 1.0)), head=(-10, 0, 0), extra=dict(scarf=0.2, tail=0.1)),
        pose(ground=False, rise=0.36, feet_flat=False, chest=(-8, 0, 0), head=(-14, 0, 0), armL=(146, -10, 0, 4), armR=(40, 30, 0, 60),
             legL=(30, 8, 0, 60), legR=(0, 8, 0, 20), footL=(20, 0, 0), footR=(25, 0, 0),
             face=face('open', 'grin', 'determined', (0, 1.0)), extra=dict(scarf=0.9, tail=0.9)),
        pose(armL=(142, -10, 0, 8), armR=(26, 10, 0, 50), chest=(-4, 0, 0), head=(-8, 0, 0), legL=(4, 8, 0, 10), legR=(-2, 8, 0, 6),
             face=face('happy', 'grin', 'up'), extra=dict(scarf=0.3, tail=0.5)),
    ]


def coins():
    return [
        pose(armL=(132, -12, 50, 20), armR=(40, 10, 0, 80), handL='open', chest=(-4, 0, 0), head=(-4, 0, 6),
             face=face('happy', 'laugh', 'up'), extra=dict(chip=True, scarf=0.3, tail=0.5)),
        pose(armL=(140, -12, 40, 12), armR=(60, 10, 70, 70), handL='open', rise=0.1, ground=False, feet_flat=False,
             legL=(20, 8, 0, 40), legR=(10, 8, 0, 30), footL=(15, 0, 0), footR=(15, 0, 0), chest=(-6, 0, 0), head=(-6, 0, 0),
             face=face('happy', 'laugh', 'up'), extra=dict(chip=True, scarf=0.6, tail=0.8)),
    ]


def lose_coins():
    return [
        pose(root=dict(lean=-6.0), armL=(90, 60, 0, 30), armR=(90, 60, 0, 30), handL='open', handR='open', head=(10, 0, 0),
             face=face('wide', 'gasp', 'worried', (0, -0.8)), extra=dict(scarf=0.3, tail=0.6)),
        pose(armL=(96, 30, 90, 128), armR=(96, 30, 90, 128), handL='open', handR='open', chest=(6, 0, 0), head=(10, 0, 0),
             face=face('sad', 'wobble', 'worried'), extra=dict(scarf=0.1, tail=-0.2)),
        pose(root=dict(lean=8.0), chest=(16, 0, 0), neck=(12, 0, 0), head=(18, 0, 0), armL=(5, 4, 0, 6), armR=(5, 4, 0, 6), handL='open',
             handR='open', face=face('closed', 'frown', 'sad'), extra=dict(scarf=0.0, tail=-0.6)),
    ]


def portal():
    out = []
    for i, yaw in enumerate((IDLE_YAW + 90, IDLE_YAW + 210, IDLE_YAW + 330)):
        out.append(pose(root=dict(yaw=yaw), ground=False, rise=0.12 + 0.1 * i, feet_flat=False,
                        armL=(130, -12, 40, 20), armR=(130, -12, 40, 20), legL=(10, 4, 0, 30), legR=(20, 4, 0, 40),
                        footL=(20, 0, 0), footR=(20, 0, 0), face=face('happy', 'grin', 'up'), extra=dict(scarf=0.8, tail=0.8)))
    return out


def pull():
    return [
        pose(root=dict(yaw=FACE_RIGHT, lean=-18.0), chest=(-6, 0, 0), head=(12, 0, 0),
             legL=(34, 6, 0, 36), legR=(-18, 6, 0, 30), armL=(84, 84, 0, 14), armR=(80, 80, 0, 18),
             face=face('closed', 'flat', 'determined'), extra=dict(scarf=0.6, tail=0.5)),
        pose(root=dict(yaw=FACE_RIGHT, lean=-24.0), chest=(-8, 0, 0), head=(14, 0, 0),
             legL=(40, 6, 0, 42), legR=(-22, 6, 0, 34), armL=(80, 84, 0, 10), armR=(76, 80, 0, 14),
             face=face('determined', 'grin', 'determined'), extra=dict(scarf=0.8, tail=0.6)),
    ]


def animations(hero: str) -> dict:
    return {
        'idle': idle(), 'walk': walk(), 'run': run(), 'jump': jump(), 'celebrate': celebrate(),
        'disappointed': disappointed(), 'surprised': surprised(), 'stunned': stunned(), 'wave': wave(),
        'victory': victory(), 'crouch': crouch(), 'carry': carry(), 'throw': throw(), 'balance': balance(),
        'swim': swim(), 'climb': climb(), 'dash': dash(), 'fall': fall(), 'cheer': cheer(), 'dial': dial(),
        'coins': coins(), 'loseCoins': lose_coins(), 'portal': portal(), 'pull': pull(),
    }


# Playback: frame order (indices into the animation's unique frames), fps and looping.
PLAYBACK = {
    'idle': ([0, 1, 2, 3], 5, True),
    'walk': ([0, 1, 2, 3, 4, 5, 6, 7], 11, True),
    'run': ([0, 1, 2, 3, 4, 5], 13, True),
    'jump': ([0, 1, 2, 3], 9, False),
    'celebrate': ([0, 1, 2, 1, 3], 7, False),
    'disappointed': ([0, 1, 2, 2], 6, False),
    'surprised': ([0, 1, 0, 2], 7, False),
    'stunned': ([0, 1, 2, 3, 0, 1, 2, 3], 8, False),
    'wave': ([0, 1, 2, 3, 0, 1, 2, 3], 9, False),
    'victory': ([0, 1, 2, 3, 2], 7, False),
    'crouch': ([0], 3, False),
    'sprint': ([0, 2, 4], 13, False),
    'carry': ([0], 2, False),
    'throw': ([0, 1, 1], 8, False),
    'balance': ([0], 2, False),
    'swim': ([0, 1], 3, True),
    'climb': ([0, 1], 3, True),
    'dash': ([0], 3, False),
    'fall': ([0], 1.5, False),
    'cheer': ([0], 1.5, False),
    'dial': ([0, 1, 2, 1, 2], 9, False),
    'coins': ([0, 1, 0, 1], 7, False),
    'loseCoins': ([0, 1, 2, 2], 6, False),
    'portal': ([0, 1, 2], 9, False),
    'pull': ([0, 1], 4, False),
}


def clone(p):
    return copy.deepcopy(p)
