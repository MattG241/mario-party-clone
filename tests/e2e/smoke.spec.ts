import { expect, test, type Page } from '@playwright/test';

/** Active scene keys, read through the game's test hook. */
async function activeScenes(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__GLEAMTRAIL__?.game.scene.getScenes(true).map((s) => s.scene.key) ?? []);
}

async function waitForScene(page: Page, key: string, timeout = 120_000): Promise<void> {
  await page.waitForFunction((k) => !!window.__GLEAMTRAIL__?.game.scene.isActive(k), key, { timeout });
}

/**
 * Press a key until the game reaches a state. On software GL a frame can take half a second, so a
 * quick tap may fall between two polls (or land during a screen's entrance) and simply retrying
 * is the honest fix.
 */
async function pressUntil(page: Page, key: string, reached: () => boolean, tries = 6): Promise<void> {
  for (let i = 0; i < tries; i++) {
    await page.keyboard.press(key);
    try {
      await page.waitForFunction(reached, null, { timeout: 5_000 });
      return;
    } catch {
      // not there yet: press again
    }
  }
  throw new Error(`pressing ${key} ${tries} times never reached the expected state`);
}

async function runtimeErrors(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__GLEAMTRAIL__?.errors ?? []);
}

test.describe('Gleamtrail smoke', () => {
  test('boots to the title screen without errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto('/?realtime');
    await page.waitForFunction(() => window.__GLEAMTRAIL__?.ready === true, null, { timeout: 90_000 });
    expect(await activeScenes(page)).toContain('Title');
    expect(pageErrors).toEqual([]);
    expect(await runtimeErrors(page)).toEqual([]);
  });

  test('keyboard reaches character select and joins player 1', async ({ page }) => {
    await page.goto('/?realtime');
    await page.waitForFunction(() => window.__GLEAMTRAIL__?.ready === true, null, { timeout: 90_000 });
    // attract -> menu
    await pressUntil(page, 'Enter', () => (window.__GLEAMTRAIL__?.game.scene.getScene('Title') as unknown as { phase?: string } | undefined)?.phase === 'menu');
    // PLAY
    await pressUntil(page, 'Enter', () => !!window.__GLEAMTRAIL__?.game.scene.isActive('CharacterSelect'));
    await page.waitForTimeout(1200);
    // join
    await pressUntil(page, 'Enter', () => window.__GLEAMTRAIL__?.session.slots[0].joined === true);
    expect(await runtimeErrors(page)).toEqual([]);
  });

  test('an all-CPU minigame reaches the results podium', async ({ page }) => {
    await page.goto('/?minigame=triple-slash&humans=0&instructions=off&realtime&seed=5');
    await waitForScene(page, 'mg-triple-slash', 90_000);
    await waitForScene(page, 'Results', 200_000);
    expect(await runtimeErrors(page)).toEqual([]);
  });

  test('an all-CPU one-round board match reaches the final results', async ({ page }) => {
    // A board turn, a whole minigame and the results run end to end; software GL renders them at
    // 1–3 fps, where ?realtime stretches game time, so this needs a generous budget.
    test.setTimeout(600_000);
    // A fixed-length minigame (45 s), so the run's length doesn't depend on which one the seed picks.
    await page.goto('/?quick&humans=0&rounds=1&realtime&seed=33&boardgame=ring-rush');
    await waitForScene(page, 'Board', 90_000);
    // Debug shortcut (dev builds): end the round's turns and go straight to the minigame.
    await page.waitForTimeout(6000);
    await page.keyboard.press('F8');
    await page.waitForFunction(
      () => {
        const s = window.__GLEAMTRAIL__?.game.scene;
        return !!s && (s.isActive('MinigameIntro') || s.getScenes(true).some((x) => x.scene.key.startsWith('mg-')));
      },
      null,
      { timeout: 120_000 },
    );
    await waitForScene(page, 'FinalResults', 520_000);
    const state = await page.evaluate(() => window.__GLEAMTRAIL__?.session.match?.phase.kind);
    expect(state).toBe('over');
    expect(await runtimeErrors(page)).toEqual([]);
  });
});
