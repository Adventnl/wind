import { test, expect, type Page } from '@playwright/test';
async function onboard(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'DISPLAY NAME' }).fill(name);
  await page.getByRole('button', { name: 'Let’s get some fresh air' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Online & feeling breezy')).toBeVisible();
}
async function invite(page: Page) {
  await page.getByRole('button', { name: 'Share your invite' }).click();
  const code = await page.getByRole('textbox', { name: 'Your Wind invite' }).inputValue();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return code;
}
test('two identities exchange encrypted messages, attachments and a video call', async ({
  browser,
}) => {
  const a = await browser.newContext({
    permissions: ['microphone', 'camera'],
    viewport: { width: 1440, height: 1050 },
  });
  const b = await browser.newContext({
    permissions: ['microphone', 'camera'],
    viewport: { width: 1440, height: 1050 },
  });
  const alice = await a.newPage(),
    bob = await b.newPage();
  const errors: string[] = [];
  for (const page of [alice, bob]) page.on('pageerror', (error) => errors.push(error.message));
  await onboard(alice, 'Alice');
  await onboard(bob, 'Bob');
  await alice.screenshot({ path: 'test-results/wind-desktop.png', fullPage: true });
  const code = await invite(bob);
  await alice.getByRole('main').getByRole('button', { name: 'Add a friend', exact: true }).click();
  await alice.getByRole('textbox', { name: 'Friend invite' }).fill(code);
  await alice.getByRole('button', { name: 'Send friend request' }).click();
  await expect(alice.getByText('Invite sent · waiting for acceptance')).toBeVisible();
  await bob.getByRole('button', { name: /Requests/ }).click();
  await bob.getByRole('button', { name: 'Accept', exact: true }).click();
  await alice.locator('.conversation').filter({ hasText: 'Bob' }).click();
  await bob.locator('.conversation').filter({ hasText: 'Alice' }).click();
  await expect(alice.getByText('Encrypted peer connection', { exact: true })).toBeVisible();
  await expect(bob.getByText('Encrypted peer connection', { exact: true })).toBeVisible();
  await alice
    .getByRole('textbox', { name: 'Message Bob' })
    .fill('Hello Bob — this went straight to you.');
  await alice.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(bob.getByTestId('message').filter({ hasText: 'Hello Bob' })).toBeVisible();
  await expect(alice.getByLabel('delivered', { exact: true })).toBeVisible();
  await bob
    .getByRole('textbox', { name: 'Message Alice' })
    .fill('Hi Alice! https://youtu.be/dQw4w9WgXcQ');
  await bob.getByRole('textbox', { name: 'Message Alice' }).press('Enter');
  await expect(alice.getByRole('button', { name: /YouTube video/ })).toBeVisible();
  await expect(alice.locator('iframe')).toHaveCount(0); // Embeds never contact the provider before consent.
  await bob.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => bob.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  await alice
    .getByLabel('Choose attachment')
    .setInputFiles({ name: 'hello.png', mimeType: 'image/png', buffer: png });
  await expect(bob.getByRole('img', { name: 'hello.png' })).toBeVisible();
  const bytes = Buffer.alloc(300000, 87); // exercises backpressure and multiple chunks
  await bob
    .getByLabel('Choose attachment')
    .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: bytes });
  await expect(alice.getByRole('link', { name: 'notes.txt' })).toBeVisible();
  await bob.screenshot({ path: 'test-results/wind-mobile-chat.png', fullPage: true });
  await alice.getByRole('button', { name: 'Start video call' }).click();
  await bob.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(alice.locator('.call-duration')).toHaveText(/\d\d:\d\d/, { timeout: 35000 });
  await expect(bob.locator('.call-duration')).toHaveText(/\d\d:\d\d/);
  await expect(alice.locator('.remote-video')).toBeVisible();
  await expect
    .poll(() => alice.locator('.remote-video').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await alice.getByRole('button', { name: 'Mute microphone', exact: true }).click();
  await expect(alice.getByRole('button', { name: 'Unmute microphone', exact: true })).toBeVisible();
  await expect(bob.locator('.call-duration')).toContainText('Mic muted');
  await alice.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  await expect(alice.getByRole('button', { name: 'Turn camera on', exact: true })).toBeVisible();
  await expect(bob.locator('.remote-video')).not.toBeVisible();
  await alice.getByRole('button', { name: 'Turn camera on', exact: true }).click();
  await alice.getByRole('button', { name: 'Share screen', exact: true }).click();
  await expect(
    alice.getByRole('button', { name: 'Stop screen sharing', exact: true }),
  ).toBeVisible();
  await expect(bob.locator('.call-duration')).toContainText('Screen shared');
  await alice.getByRole('button', { name: 'Stop screen sharing', exact: true }).click();
  await expect(alice.getByRole('button', { name: 'Share screen', exact: true })).toBeVisible();
  await alice.screenshot({ path: 'test-results/wind-call.png', fullPage: true });
  await alice.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(bob.getByRole('region', { name: 'Call' })).not.toBeVisible();
  await alice.screenshot({ path: 'test-results/wind-chat.png', fullPage: true });
  // A voice call reserves video, then upgrades the same encrypted connection.
  await bob.getByRole('button', { name: 'Start voice call' }).click();
  await alice.getByRole('button', { name: 'Answer', exact: true }).click();
  await expect(bob.locator('.call-duration')).toHaveText(/\d\d:\d\d/);
  await expect(alice.locator('.remote-video')).not.toBeVisible();
  await bob.getByRole('button', { name: 'Turn camera on', exact: true }).click();
  await expect(alice.locator('.remote-video')).toBeVisible();
  await expect
    .poll(() => alice.locator('.remote-video').evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await bob.getByRole('button', { name: 'End call', exact: true }).click();
  await expect(alice.getByRole('region', { name: 'Call' })).not.toBeVisible();
  // A reload keeps the identity and history, then rebuilds the peer connection.
  await alice.reload();
  await expect(alice.getByRole('dialog')).not.toBeVisible();
  await alice.locator('.conversation').filter({ hasText: 'Bob' }).click();
  await expect(
    alice.getByText('Hello Bob — this went straight to you.', { exact: true }),
  ).toBeVisible();
  await expect(alice.getByText('Encrypted peer connection', { exact: true })).toBeVisible();
  await expect(alice.getByRole('link', { name: 'notes.txt' })).toBeVisible();
  await alice.getByRole('button', { name: 'Conversation options' }).click();
  await alice.getByRole('button', { name: 'Verify identity' }).click();
  await expect(alice.locator('.fingerprint')).toHaveText(/[a-f0-9]{4}/);
  await alice.getByRole('button', { name: 'We compared · mark verified' }).click();
  await expect(alice.getByText(/Identity verified/)).toBeVisible();
  await bob.close();
  await expect(alice.getByText('Offline', { exact: true }).first()).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test('phone layout, invalid invite and profile editing', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('textbox', { name: 'DISPLAY NAME' }).fill('Jordan');
  await page.getByRole('button', { name: 'Let’s get some fresh air' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/wind-mobile.png', fullPage: true });
  await page.locator('.mobile-nav').getByRole('button', { name: 'Add friend' }).click();
  await page.getByRole('textbox', { name: 'Friend invite' }).fill('not-an-invite');
  await page.getByRole('button', { name: 'Send friend request' }).click();
  await expect(page.getByRole('alert')).toContainText('That invite doesn’t look right');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('.mobile-nav').getByRole('button', { name: 'You', exact: true }).click();
  await page.getByRole('button', { name: 'Edit your name, bio & photo' }).click();
  await page.getByRole('textbox', { name: 'DISPLAY NAME' }).fill('Jordan Green');
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles('public/icon-192.png');
  await expect(page.getByRole('img', { name: 'Jordan Green’s avatar' })).toBeVisible();
  await page.getByRole('button', { name: 'Save your profile' }).click();
  await page.reload();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await context.close();
});

test('installed PWA shell and device profile survive an offline reload', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await onboard(page, 'Offline user');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.self-bar').getByText('Offline user', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Your people/ })).toBeVisible();
  await expect(page.locator('.connection-banner')).toBeVisible();
  await context.close();
});
