import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const text = readFileSync('real-floor.txt', 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
const r = await page.evaluate(async (realText) => {
  const mod = await import('/src/core/render/renderer.ts');
  const lines = realText.split('\n');
  const docStart = /^\s*(?:<!DOCTYPE html|<html\b)/i;
  const firstDoc = lines.findIndex((l) => docStart.test(l));
  // escape 之后第一行变成什么
  const esc = mod.escapeCustomTags ? mod.escapeCustomTags(realText) : null;
  const escLines = esc ? esc.split('\n') : null;
  const firstDocAfter = escLines ? escLines.findIndex((l) => docStart.test(l)) : -1;
  return {
    firstDocBefore: firstDoc,
    line0: JSON.stringify(lines[0].slice(0, 50)),
    line0After: escLines ? JSON.stringify(escLines[0].slice(0, 60)) : null,
    firstDocAfter,
    hasEscapeFn: Boolean(mod.escapeCustomTags),
  };
}, text);
console.log(JSON.stringify(r, null, 1));
await browser.close();
