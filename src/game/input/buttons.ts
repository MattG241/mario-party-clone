// Logical controller vocabulary shared by gamepads, keyboard and CPU controls.
// Xbox layout names are used because the game is designed around an Xbox controller.

export type Button =
  | 'A'
  | 'B'
  | 'X'
  | 'Y'
  | 'LB'
  | 'RB'
  | 'LT'
  | 'RT'
  | 'VIEW'
  | 'MENU'
  | 'LS'
  | 'RS'
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT';

export const BUTTONS: readonly Button[] = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'VIEW', 'MENU', 'LS', 'RS', 'UP', 'DOWN', 'LEFT', 'RIGHT'];

export type NavDir = 'up' | 'down' | 'left' | 'right';

/** Keyboard-bindable actions. Movement keys drive the left stick and D-pad together. */
export type KeyAction = 'up' | 'down' | 'left' | 'right' | 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'MENU' | 'VIEW' | 'aimUp' | 'aimDown' | 'aimLeft' | 'aimRight';

export const KEY_ACTIONS: readonly KeyAction[] = ['up', 'down', 'left', 'right', 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'MENU', 'VIEW', 'aimUp', 'aimDown', 'aimLeft', 'aimRight'];

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  up: 'Move Up',
  down: 'Move Down',
  left: 'Move Left',
  right: 'Move Right',
  A: 'A · Confirm / Jump',
  B: 'B · Back / Duck',
  X: 'X · Secondary',
  Y: 'Y · Items',
  LB: 'LB · Cycle Left',
  RB: 'RB · Cycle Right',
  LT: 'LT · Left Trigger',
  RT: 'RT · Right Trigger',
  MENU: 'Menu · Pause',
  VIEW: 'View · Scores',
  aimUp: 'Aim Up',
  aimDown: 'Aim Down',
  aimLeft: 'Aim Left',
  aimRight: 'Aim Right',
};

/** Default keyboard bindings (KeyboardEvent.code values). */
export const DEFAULT_KEY_BINDINGS: Record<KeyAction, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  A: ['Enter', 'Space'],
  B: ['Escape', 'Backspace'],
  X: ['KeyE'],
  Y: ['KeyQ'],
  LB: ['KeyZ'],
  RB: ['KeyC'],
  LT: ['KeyR'],
  RT: ['KeyF'],
  MENU: ['KeyP'],
  VIEW: ['Tab'],
  aimUp: ['KeyI'],
  aimDown: ['KeyK'],
  aimLeft: ['KeyJ'],
  aimRight: ['KeyL'],
};

/** Human-readable key names for prompts. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: 'Enter',
    Space: 'Space',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Tab: 'Tab',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
  };
  return map[code] ?? code;
}
