import { _electron, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
const mount = execFileSync('findmnt', ['-n', '-o', 'TARGET,SOURCE', '-T', '/srv/storage/data'], {
  encoding: 'utf8',
})
  .trim()
  .split(/\s+/);
if (
  mount[0] !== '/srv/storage' ||
  execFileSync('lsblk', ['-dn', '-o', 'ROTA', mount[1]], { encoding: 'utf8' }).trim() !== '1'
)
  throw new Error('Desktop smoke tests require the HDD mount.');
const userData = await mkdtemp('/srv/storage/data/wind-desktop-test-');
const server = spawn(process.execPath, ['dist-server/index.js'], {
  env: { ...process.env, PORT: '3108', ALLOWED_ORIGINS: 'wind://app' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let app;
try {
  await once(server.stdout, 'data');
  app = await _electron.launch({
    args: process.env.WIND_DESKTOP_EXECUTABLE ? [] : ['.'],
    executablePath: process.env.WIND_DESKTOP_EXECUTABLE,
    env: { ...process.env, WIND_DATA_DIR: userData },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('textbox', { name: 'DISPLAY NAME' }).fill('Desktop user');
  await page.getByRole('button', { name: 'Let’s get some fresh air' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'SERVER URL' }).fill('http://127.0.0.1:3108');
  await page.getByRole('button', { name: 'Save & reconnect' }).click();
  await expect(page.getByText('Connected to signaling', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.screenshot({ path: 'test-results/wind-desktop-shell.png' });
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  expect(errors).toEqual([]);
  console.log(
    'Electron shell passed: secure origin, profile, settings, server connection, no renderer Node access.',
  );
} finally {
  await app?.close();
  server.kill();
  await rm(userData, { recursive: true, force: true });
}
