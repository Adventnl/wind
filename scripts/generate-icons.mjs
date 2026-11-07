// Render the code-native Wind SVG into the bitmap sizes required by each OS.
import { chromium } from '@playwright/test';
import { readFile, writeFile, readdir } from 'node:fs/promises';
const svg = await readFile('public/wind.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
async function png(size, splash = false, adaptive = false) {
  const result = await page.evaluate(
    async ({ svg, size, splash, adaptive }) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = splash ? '#16191d' : '#b9ef69';
      ctx.fillRect(0, 0, size, size);
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(svg);
      await img.decode();
      const width = splash ? size * 0.15 : adaptive ? size * 0.62 : size;
      ctx.drawImage(img, (size - width) / 2, (size - width) / 2, width, width);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { svg, size, splash, adaptive },
  );
  return Buffer.from(result, 'base64');
}
try {
  for (const size of [192, 512]) await writeFile(`public/icon-${size}.png`, await png(size));
  await writeFile('electron/icon.png', await png(512));
  await writeFile(
    'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    await png(1024),
  );
  const splash = await png(1024, true);
  for (const file of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
    await writeFile(`ios/App/App/Assets.xcassets/Splash.imageset/${file}`, splash);
  for (const [density, size] of Object.entries({
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxhdpi: 144,
    xxxhdpi: 192,
  })) {
    for (const name of ['ic_launcher', 'ic_launcher_round'])
      await writeFile(`android/app/src/main/res/mipmap-${density}/${name}.png`, await png(size));
    await writeFile(
      `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`,
      await png(Math.round(size * 2.25), false, true),
    );
  }
  for (const directory of await readdir('android/app/src/main/res')) {
    if (directory === 'drawable' || /^drawable-(land|port)-/.test(directory))
      await writeFile(`android/app/src/main/res/${directory}/splash.png`, splash);
  }
} finally {
  await browser.close();
}
