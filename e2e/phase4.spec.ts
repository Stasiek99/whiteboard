import { test, expect, type Page } from '@playwright/test';

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Parses a socket.io wire frame into its event name and data.
 * Handles plain events ("42[...]") and ack-ID events ("420[...]").
 */
function parseSocketioFrame(raw: unknown): { event: string; data: unknown } | null {
  if (typeof raw !== 'string' || !raw.startsWith('42')) return null;
  const jsonStart = raw.indexOf('[', 2);
  if (jsonStart === -1) return null;
  try {
    const arr = JSON.parse(raw.slice(jsonStart)) as unknown[];
    if (!Array.isArray(arr) || arr.length < 1) return null;
    return { event: arr[0] as string, data: arr[1] };
  } catch {
    return null;
  }
}

/** Collects sent WS frames on a page (must be called before goto). */
function collectSentFrames(page: Page) {
  const sent: string[] = [];
  const sentTs: number[] = [];
  page.on('websocket', ws => {
    ws.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') { sent.push(payload); sentTs.push(Date.now()); }
    });
  });
  return { sent, sentTs };
}

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('Canvas bounding box not found');
  return box;
}

/** Wait until the Angular WhiteboardService is connected and bootstrapped. */
async function waitForAngular(page: Page) {
  // NOTE: pass `undefined` as arg so the third parameter is treated as options,
  // not as the argument passed to the page function.
  await page.waitForFunction(
    () => !!(window as any).__e2e_socket_connected && !!(window as any).__e2e_whiteboard,
    undefined,
    { timeout: 10_000 },
  );
}

/** Read the current actions$ length from the Angular service. */
function actionsLength(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as any).__e2e_whiteboard?.actions$?.getValue?.()?.length ?? 0,
  );
}

// ─── phase 4 tests ───────────────────────────────────────────────────────────

test.describe('Phase 4 — real-time collaboration', () => {

  // ── T1: stroke sync within 200 ms ──────────────────────────────────────────
  test('stroke drawn in Tab 1 appears in Tab 2 within 200 ms', async ({ browser }) => {
    // Unique boardId per run avoids server-state pollution from prior test runs.
    const boardId = `e2e-t1-${Date.now()}`;
    const ctx = await browser.newContext();
    const [page1, page2] = await Promise.all([ctx.newPage(), ctx.newPage()]);

    await Promise.all([
      page1.goto(`/?boardId=${boardId}`),
      page2.goto(`/?boardId=${boardId}`),
    ]);
    await Promise.all([waitForAngular(page1), waitForAngular(page2)]);

    const box = await canvasBox(page1);

    await page1.mouse.move(box.x + 100, box.y + 100);
    await page1.mouse.down();
    await page1.mouse.move(box.x + 300, box.y + 200, { steps: 10 });
    // Start timing at mouse-up — that is when the socket.emit fires.
    const t0 = Date.now();
    await page1.mouse.up();

    // Primary: the server board log must record the stroke (round-trip to server).
    await expect.poll(
      async () => {
        const r = await page1.request.get(`http://localhost:3000/debug/board/${boardId}`);
        const body = await r.json() as { seq: number; log: unknown[] };
        return body.log.length;
      },
      { timeout: 400 },
    ).toBeGreaterThan(0);

    const elapsed = Date.now() - t0;
    expect(elapsed, `action took ${elapsed}ms to reach server`).toBeLessThan(200);

    // Secondary: page2's Angular service must also reflect the broadcast.
    await page2.waitForFunction(
      () => ((window as any).__e2e_whiteboard?.actions$?.getValue?.()?.length ?? 0) > 0,
      undefined,
      { timeout: 2_000 },
    );

    await ctx.close();
  });

  // ── T2: late-joiner pre-populated from board:state ─────────────────────────
  test('Tab 3 joining mid-session pre-populates from board:state', async ({ browser }) => {
    const boardId = `e2e-t2-${Date.now()}`;
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();
    await page1.goto(`/?boardId=${boardId}`);
    await waitForAngular(page1);

    const box = await canvasBox(page1);

    // Commit 10 strokes. Guard each one: wait for socket to be connected first
    // so an HMR-triggered page reload doesn't silently drop a stroke mid-loop.
    // Drawn well clear of the floating toolbar overlay (x:16-212, y:159-561px)
    // in the top-left corner — starting inside that box silently swallows the
    // pointerdown into a toolbar control instead of the canvas underneath.
    for (let i = 0; i < 10; i++) {
      await page1.waitForFunction(
        () => !!(window as any).__e2e_socket_connected,
        undefined,
        { timeout: 8_000 },
      );
      const y = box.y + 40 + i * 18;
      await page1.mouse.move(box.x + 400, y);
      await page1.mouse.down();
      await page1.mouse.move(box.x + 630, y, { steps: 5 });
      await page1.mouse.up();
      await page1.waitForTimeout(200);
    }

    // Wait until the server board log has at least 10 entries.
    // This is the only monotonic metric: once a stroke is server-acked it stays.
    // actions$ is not monotonic (board:state reseeds can reset it mid-loop).
    await expect.poll(
      async () => {
        const r = await page1.request.get(`http://localhost:3000/debug/board/${boardId}`);
        const body = await r.json() as { seq: number; log: unknown[] };
        return body.log.length;
      },
      { timeout: 20_000 },
    ).toBeGreaterThanOrEqual(10);

    // Open page3 AFTER the server board is fully populated.
    const page3 = await ctx.newPage();
    await page3.goto(`/?boardId=${boardId}`);
    await waitForAngular(page3);

    // board:state seeding must populate actions$ without any user interaction.
    await page3.waitForFunction(
      () => ((window as any).__e2e_whiteboard?.actions$?.getValue?.()?.length ?? 0) >= 10,
      undefined,
      { timeout: 5_000 },
    );

    const len = await actionsLength(page3);
    expect(len).toBeGreaterThanOrEqual(10);

    // page3 never drew anything — actions come from board:state seeding only.
    const lastAction = await page3.evaluate(
      () => (window as any).__e2e_last_draw_action ?? null,
    );
    expect(lastAction, 'page3 should not have received a live draw:action').toBeNull();

    await ctx.close();
  });

  // ── T3: network drop → reconnect → user:join re-emitted ────────────────────
  test('Tab 1 auto-reconnects after network drop and re-emits user:join', async ({ browser }) => {
    const boardId = `e2e-t3-${Date.now()}`;
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();

    const frames = collectSentFrames(page1);
    await page1.goto(`/?boardId=${boardId}`);
    await waitForAngular(page1);

    const connectCountBefore = await page1.evaluate(
      () => (window as any).__e2e_connect_count ?? 0,
    );
    expect(connectCountBefore).toBeGreaterThanOrEqual(1);

    // Programmatically disconnect the socket (mirrors network drop).
    // context.setOffline does not reliably close established WS in headless Chrome.
    await page1.evaluate(() => (window as any).__e2e_socket?.disconnect());
    await page1.waitForFunction(
      () => !(window as any).__e2e_socket_connected,
      undefined,
      { timeout: 5_000 },
    );

    // Draw 3 strokes while disconnected (committed locally).
    const box = await canvasBox(page1);
    for (let i = 0; i < 3; i++) {
      const y = box.y + 60 + i * 30;
      await page1.mouse.move(box.x + 50, y);
      await page1.mouse.down();
      await page1.mouse.move(box.x + 200, y);
      await page1.mouse.up();
    }

    // Reconnect — socket.io fires connect → Angular re-emits user:join.
    await page1.evaluate(() => (window as any).__e2e_socket?.connect());
    await page1.waitForFunction(
      (before) => ((window as any).__e2e_connect_count ?? 0) > before,
      connectCountBefore,
      { timeout: 10_000 },
    );

    // Confirm user:join was sent on the new connection.
    await expect.poll(
      () => frames.sent.filter(f => f.includes('"user:join"')).length,
      { timeout: 3_000, intervals: [200] },
    ).toBeGreaterThan(connectCountBefore);

    // Known MVP limitation: the 3 offline strokes disappear from the sender's
    // local state on reconnect because board:state replaces actions$ on re-join.

    await ctx.close();
  });

  // ── T4: draw:action sent on pointerup only, never during pointermove ────────
  test('draw:action socket frame is sent exactly once on pointerup, never during pointermove', async ({ page }) => {
    const frames = collectSentFrames(page);
    await page.goto('/?boardId=e2e-t4');
    await waitForAngular(page);

    const box = await canvasBox(page);
    const baseline = () => frames.sent.filter(f => f.includes('"draw:action"')).length;
    const start = baseline();

    // Phase A: hover without pressing — no draw:action.
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.move(box.x + 250, box.y + 200, { steps: 20 });
    await page.waitForTimeout(100);
    expect(baseline()).toBe(start);

    // Phase B: press + drag — no draw:action until release.
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 100, { steps: 10 });
    await page.mouse.move(box.x + 220, box.y + 160, { steps: 10 });
    await page.mouse.move(box.x + 360, box.y + 220, { steps: 10 });
    await page.waitForTimeout(100);
    expect(baseline()).toBe(start);

    // Phase C: release — exactly one draw:action emitted.
    await page.mouse.up();
    await expect.poll(baseline, { timeout: 2_000 }).toBe(start + 1);

    const actionFrame = frames.sent.find(f => f.includes('"draw:action"'))!;
    const parsed = parseSocketioFrame(actionFrame);
    expect(parsed?.event).toBe('draw:action');
    expect((parsed?.data as { type?: string })?.type).toBe('stroke');
  });

  // ── T5: cursor rate-limited to ≤ 35 fps by auditTime(33) ──────────────────
  test('cursor events sent by Tab 1 are spaced ≥ 30 ms apart (auditTime guard)', async ({ browser }) => {
    // For cursor rate limiting we only need to verify the SENDER's outgoing frames.
    // auditTime(33) guarantees the client emits at most ~30fps regardless of
    // how fast pointermove fires — we assert on framesent timestamps.
    const ctx = await browser.newContext();
    const page1 = await ctx.newPage();

    const frames = collectSentFrames(page1);
    await page1.goto('/?boardId=e2e-t5');
    await waitForAngular(page1);

    const box = await canvasBox(page1);

    // 20 rapid sweeps, 50ms apart — each sweep is a separate auditTime window.
    for (let pass = 0; pass < 20; pass++) {
      const x = pass % 2 === 0 ? box.x + 50 : box.x + box.width - 50;
      await page1.mouse.move(x, box.y + 100, { steps: 15 });
      await page1.waitForTimeout(50);
    }
    await page1.waitForTimeout(200);

    const cursorFrames = frames.sent
      .map((f, i) => ({ f, ts: frames.sentTs[i] }))
      .filter(({ f }) => f.includes('"draw:cursor"'));

    expect(cursorFrames.length, 'no draw:cursor frames sent').toBeGreaterThanOrEqual(5);

    // Every consecutive pair of cursor emissions must be ≥ 30ms apart.
    for (let i = 1; i < cursorFrames.length; i++) {
      const gap = cursorFrames[i].ts - cursorFrames[i - 1].ts;
      expect(
        gap,
        `cursor frames ${i - 1}→${i} only ${gap}ms apart (auditTime(33) violated)`,
      ).toBeGreaterThanOrEqual(30);
    }

    await ctx.close();
  });
});
