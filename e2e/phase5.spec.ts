import { test, expect, type Page } from '@playwright/test';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('Canvas bounding box not found');
  return box;
}

/** Wait until the Angular WhiteboardService is connected and bootstrapped. */
async function waitForAngular(page: Page) {
  await page.waitForFunction(
    () => !!(window as any).__e2e_socket_connected && !!(window as any).__e2e_whiteboard,
    undefined,
    { timeout: 10_000 },
  );
}

/** Reads the current-tab identity exposed by UserService in dev mode. */
function currentUser(page: Page): Promise<{ id: string; name: string; color: string }> {
  return page.evaluate(() => (window as any).__e2e_user);
}

/** Reads RemoteUsersService's rendered cursor list exposed in dev mode. */
function remoteCursors(page: Page): Promise<Array<{ id: string; x: number; y: number; hidden: boolean; name: string; color: string }>> {
  return page.evaluate(() => (window as any).__e2e_remote_users?.cursors() ?? []);
}

async function waitForCursor(page: Page, userId: string, timeout = 3_000) {
  await page.waitForFunction(
    (uid) => ((window as any).__e2e_remote_users?.cursors() ?? []).some((c: any) => c.id === uid),
    userId,
    { timeout },
  );
}

async function waitForNoCursor(page: Page, userId: string, timeout = 5_000) {
  await page.waitForFunction(
    (uid) => !((window as any).__e2e_remote_users?.cursors() ?? []).some((c: any) => c.id === uid),
    userId,
    { timeout },
  );
}

/** Moves the mouse well clear of the floating toolbar (x:16-212, y:159-561px). */
async function moveCursor(page: Page, box: { x: number; y: number; width: number; height: number }, dx: number, dy: number) {
  await page.mouse.move(box.x + dx, box.y + dy, { steps: 5 });
}

// ─── phase 5 tests ───────────────────────────────────────────────────────────

test.describe('Phase 5 — multi-cursor overlay', () => {

  // ── T1: remote cursor renders with correct label + color ──────────────────
  test('cursor moved in Tab 1 renders as a labeled, colored cursor in Tab 2', async ({ browser }) => {
    const boardId = `e2e-p5-t1-${Date.now()}`;
    const ctx = await browser.newContext();
    const [page1, page2] = await Promise.all([ctx.newPage(), ctx.newPage()]);

    await Promise.all([
      page1.goto(`/?boardId=${boardId}`),
      page2.goto(`/?boardId=${boardId}`),
    ]);
    await Promise.all([waitForAngular(page1), waitForAngular(page2)]);

    const user1 = await currentUser(page1);
    const box = await canvasBox(page1);

    await moveCursor(page1, box, 500, 100);
    await moveCursor(page1, box, 520, 120);

    await waitForCursor(page2, user1.id);

    const cursorLocator = page2.locator('.cursor').filter({ hasText: user1.name });
    await expect(cursorLocator).toBeVisible();
    await expect(cursorLocator.locator('.nametag')).toHaveText(user1.name);

    // Compare via the browser's own color normalization instead of assuming a format.
    const actualFill = await cursorLocator.locator('svg.arrow').evaluate((el) => (el as SVGElement).style.fill);
    const expectedFill = await page2.evaluate((color) => {
      const probe = document.createElement('div');
      probe.style.fill = color;
      return probe.style.fill;
    }, user1.color);
    expect(actualFill).toBe(expectedFill);

    await ctx.close();
  });

  // ── T2: coordinate normalization across different window sizes ───────────
  test('cursor at the center of Tab 1 canvas appears at the visual center of Tab 2 canvas', async ({ browser }) => {
    const boardId = `e2e-p5-t2-${Date.now()}`;
    const ctx = await browser.newContext();
    const [page1, page2] = await Promise.all([ctx.newPage(), ctx.newPage()]);

    // Deliberately mismatched window sizes to prove 0-1 normalization, not raw pixels.
    await page1.setViewportSize({ width: 900, height: 700 });
    await page2.setViewportSize({ width: 1440, height: 960 });

    await Promise.all([
      page1.goto(`/?boardId=${boardId}`),
      page2.goto(`/?boardId=${boardId}`),
    ]);
    await Promise.all([waitForAngular(page1), waitForAngular(page2)]);
    // Let each canvas's ResizeObserver publish its viewport size before measuring.
    await page1.waitForTimeout(100);
    await page2.waitForTimeout(100);

    const user1 = await currentUser(page1);
    const box1 = await canvasBox(page1);
    const centerX = box1.x + box1.width / 2;
    const centerY = box1.y + box1.height / 2;

    await page1.mouse.move(centerX - 5, centerY - 5, { steps: 5 });
    await page1.mouse.move(centerX, centerY, { steps: 5 });

    await waitForCursor(page2, user1.id);

    // Primary assertion: the wire value is normalized to ~0.5/0.5 regardless of window size.
    await expect.poll(async () => {
      const cursors = await remoteCursors(page2);
      const c = cursors.find((c) => c.id === user1.id);
      return c ? Math.abs(c.x - 0.5) < 0.02 && Math.abs(c.y - 0.5) < 0.02 : false;
    }, { timeout: 2_000 }).toBe(true);

    // Secondary assertion: the rendered element actually sits at Tab 2's visual center.
    await page2.waitForTimeout(150); // let the 80ms transform transition settle
    const box2 = await canvasBox(page2);
    const cursorBox = await page2.locator('.cursor').filter({ hasText: user1.name }).boundingBox();
    if (!cursorBox) throw new Error('Tab 2 cursor element not found');

    const actualX = cursorBox.x - box2.x;
    const actualY = cursorBox.y - box2.y;
    expect(Math.abs(actualX - box2.width / 2), `expected ~${box2.width / 2}px, got ${actualX}px`).toBeLessThan(8);
    expect(Math.abs(actualY - box2.height / 2), `expected ~${box2.height / 2}px, got ${actualY}px`).toBeLessThan(8);

    await ctx.close();
  });

  // ── T3/T4: idle-hide via visibility (not removal), then reappear fast ─────
  test('remote cursor hides via CSS visibility after idle, stays in the DOM, and reappears promptly on movement', async ({ browser }) => {
    const boardId = `e2e-p5-t3-${Date.now()}`;
    const ctx = await browser.newContext();
    const [page1, page2] = await Promise.all([ctx.newPage(), ctx.newPage()]);

    await Promise.all([
      page1.goto(`/?boardId=${boardId}`),
      page2.goto(`/?boardId=${boardId}`),
    ]);
    await Promise.all([waitForAngular(page1), waitForAngular(page2)]);

    const user1 = await currentUser(page1);
    const box = await canvasBox(page1);

    await moveCursor(page1, box, 400, 100);
    await waitForCursor(page2, user1.id);

    const cursorLocator = page2.locator('.cursor').filter({ hasText: user1.name });
    await expect(cursorLocator).toBeVisible();

    // Hold still for 4s (IDLE_HIDE_MS = 3000) — element stays attached, just hidden.
    await page1.waitForTimeout(4_000);

    await expect(cursorLocator).toHaveCount(1); // never removed from the DOM
    await expect.poll(
      () => cursorLocator.evaluate((el) => getComputedStyle(el).visibility),
      { timeout: 1_000 },
    ).toBe('hidden');

    // Move again — no debounce guards the way back to visible.
    const t0 = Date.now();
    await moveCursor(page1, box, 420, 120);
    await expect.poll(
      () => cursorLocator.evaluate((el) => getComputedStyle(el).visibility),
      { timeout: 1_000, intervals: [16] },
    ).toBe('visible');
    const elapsed = Date.now() - t0;
    expect(elapsed, `cursor took ${elapsed}ms to reappear after movement`).toBeLessThan(500);

    await ctx.close();
  });

  // ── T5: closing the tab removes its cursor within 5s ──────────────────────
  test('closing Tab 1 removes its cursor from Tab 2 within 5s', async ({ browser }) => {
    const boardId = `e2e-p5-t5-${Date.now()}`;
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();
    const page2 = await ctx.newPage();

    await Promise.all([
      page1.goto(`/?boardId=${boardId}`),
      page2.goto(`/?boardId=${boardId}`),
    ]);
    await Promise.all([waitForAngular(page1), waitForAngular(page2)]);

    const user1 = await currentUser(page1);
    const box = await canvasBox(page1);
    await moveCursor(page1, box, 400, 100);
    await waitForCursor(page2, user1.id);

    await page1.close();

    await waitForNoCursor(page2, user1.id, 5_000);

    await ctx.close();
  });

  // ── T6: refresh mid-session drops the stale socket's cursor, then rejoins ──
  test('refreshing Tab 1 mid-session clears the pre-refresh cursor within 5s and rejoins under the same tab identity', async ({ browser }) => {
    const boardId = `e2e-p5-t6-${Date.now()}`;
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();
    const page2 = await ctx.newPage();

    await Promise.all([
      page1.goto(`/?boardId=${boardId}`),
      page2.goto(`/?boardId=${boardId}`),
    ]);
    await Promise.all([waitForAngular(page1), waitForAngular(page2)]);

    const oldUser = await currentUser(page1);
    const box = await canvasBox(page1);
    await moveCursor(page1, box, 400, 100);
    await waitForCursor(page2, oldUser.id);

    await page1.reload();

    // NOTE: contrary to the ROADMAP's "known MVP limitation" note, sessionStorage
    // survives a same-tab reload by spec (it only clears on tab close) — verified
    // empirically here. So the identity is unchanged; only the socket reconnects.
    // The pre-refresh cursor still briefly disappears (old socket disconnects,
    // server emits user:left) before Tab 1 rejoins on the fresh connection.
    await waitForNoCursor(page2, oldUser.id, 5_000);

    await waitForAngular(page1);
    const rejoinedUser = await currentUser(page1);
    expect(rejoinedUser.id).toBe(oldUser.id);

    await moveCursor(page1, box, 420, 120);
    await waitForCursor(page2, rejoinedUser.id);
    await expect(page2.locator('.cursor').filter({ hasText: rejoinedUser.name })).toBeVisible();

    await ctx.close();
  });
});
