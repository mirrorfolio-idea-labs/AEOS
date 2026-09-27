// P5.M6.T1 accept: Lighthouse performance and accessibility >= 90.
//   node scripts/lighthouse.mjs <pagesDir>
// Lighthouse's default (mobile, throttled) profile, run against the
// assembled Pages tree through Playwright's Chromium.
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import path from 'node:path';
import { serve } from './serve.mjs';

const root = path.resolve(process.argv[2] ?? 'pages');
const BASE = (process.env.AEOS_SITE_BASE ?? '/AEOS/').replace(/\/?$/, '/');
const MIN = Number(process.env.AEOS_LIGHTHOUSE_MIN ?? 0.9);
const port = 9300 + Math.floor(Math.random() * 500);

const { origin, close } = await serve(root, BASE);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: [`--remote-debugging-port=${port}`] });
let failed = false;
try {
  const result = await lighthouse(`${origin}${BASE}`, {
    port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility'],
  });
  const lhr = result.lhr;
  for (const key of ['performance', 'accessibility']) {
    const score = lhr.categories[key].score ?? 0;
    const pass = score >= MIN;
    failed ||= !pass;
    console.log(`lighthouse: ${key} ${Math.round(score * 100)} ${pass ? '>=' : '<'} ${Math.round(MIN * 100)}`);
    if (!pass) {
      for (const ref of lhr.categories[key].auditRefs) {
        const audit = lhr.audits[ref.id];
        if (ref.weight > 0 && audit.score !== null && audit.score < 0.9) console.log(`  - ${audit.title}: ${audit.displayValue ?? audit.score}`);
      }
    }
  }
} finally {
  await browser.close();
  close();
}
process.exit(failed ? 1 : 0);
