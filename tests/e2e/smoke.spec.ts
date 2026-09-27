import { expect, test, type Page } from '@playwright/test';

/** Active scene keys, read through the game's test hook. */
async function activeScenes(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__GLEAMTRAIL__?.game.scene.getScenes(true).map((s) => s.scene.key) ?? []);
}

async function waitForScene(page: Page, key: string, timeout = 120_000): Promise<void> {
  await page.waitForFunction((k) => !!window.__GLEAMTRAIL__?.game.scene.isActive(k), key, { timeout });
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
    await page.keyboard.press('Enter'); // attract -> menu
    await page.waitForTimeout(1200);
    await page.keyboard.press('Enter'); // PLAY
    await waitForScene(page, 'CharacterSelect', 30_000);
    await page.waitForTimeout(1200);
    await page.keyboard.press('Enter'); // join
    await page.waitForFunction(() => window.__GLEAMTRAIL__?.session.slots[0].joined === true, null, { timeout: 15_000 });
    expect(await runtimeErrors(page)).toEqual([]);
  });

  test('an all-CPU minigame reaches the results podium', async ({ page }) => {
    await page.goto('/?minigame=orbit-dodge&humans=0&instructions=off&realtime&seed=5');
    await waitForScene(page, 'mg-orbit-dodge', 90_000);
    await waitForScene(page, 'Results', 200_000);
    expect(await runtimeErrors(page)).toEqual([]);
  });

  test('an all-CPU one-round board match reaches the final results', async ({ page }) => {
    await page.goto('/?quick&humans=0&rounds=1&realtime&seed=33');
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
    await waitForScene(page, 'FinalResults', 280_000);
    const state = await page.evaluate(() => window.__GLEAMTRAIL__?.session.match?.phase.kind);
    expect(state).toBe('over');
    expect(await runtimeErrors(page)).toEqual([]);
  });
});
