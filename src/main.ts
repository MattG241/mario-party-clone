import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import { createGame } from './game/Game';

function showBootError(message: string, detail = ''): void {
  const box = document.getElementById('boot-error');
  const msg = document.getElementById('boot-error-message');
  const det = document.getElementById('boot-error-detail');
  if (!box || !msg || !det) return;
  msg.textContent = message;
  det.textContent = detail;
  box.style.display = 'flex';
}

async function loadFonts(): Promise<void> {
  const weights = [400, 500, 600, 700];
  const load = Promise.all(weights.map((w) => document.fonts.load(`${w} 32px Fredoka`)));
  const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
  try {
    await Promise.race([load, timeout]);
  } catch {
    // Fall back to system fonts; the game still works.
  }
}

async function start(): Promise<void> {
  const parent = document.getElementById('game');
  if (!parent) {
    showBootError('The page is missing its game container.');
    return;
  }
  await loadFonts();
  try {
    createGame(parent);
  } catch (err) {
    showBootError(
      'Your browser could not start the game renderer. Try an up-to-date Chrome, Edge, Firefox or Safari with hardware acceleration enabled.',
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  }
}

void start();
