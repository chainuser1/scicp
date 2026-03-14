#!/usr/bin/env node
/**
 * scrape-verse-summaries.js
 * Scrapes per-verse LDS-context AI summaries from Brave/Google/Bing.
 * Sequential (no concurrency), 2s+ delay, resume-safe via status column.
 *
 * Usage:
 *   node scripts/scrape-verse-summaries.js [--limit N] [--start-id N] [--reset-errors]
 *
 * Status values: pending | ok | error | retry
 */

const Database = require('better-sqlite3');
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = '/usr/bin/google-chrome-stable';
const DB_PATH = path.join(__dirname, '../resources/db/verse-tags.db');
const DELAY_MS = 2500;
const MAX_RETRIES_PER_VERSE = 3;

// Brave gives best LDS-specific content; Google/Bing are fallbacks only
const ENGINES = ['brave', 'google', 'bing'];

function buildUrl(engine, verseTitle) {
  const q = encodeURIComponent(
    `give a summary in (lds thematics and doctrine context) of the verse ${verseTitle}`
  );
  if (engine === 'brave') return `https://search.brave.com/search?q=${q}&source=web`;
  if (engine === 'google') return `https://www.google.com/search?q=${q}`;
  if (engine === 'bing')   return `https://www.bing.com/search?q=${q}`;
}

async function extractSummary(page, engine) {
  if (engine === 'brave') {
    return page.evaluate(() => {
      const body = document.body.innerText || '';
      // Try DOM selector first
      const el = document.querySelector('[class*="answer"]') || document.querySelector('[class*="summarizer"]');
      if (el) {
        return (el.innerText || '')
          .replace(/\nAI-generated answer\..*$/s, '')
          .replace(/\n(Elaborate|Copy|Share|More)\n/g, '')
          .replace(/\n\+\d+\n/g, '')
          .trim();
      }
      // Fallback: find the AI-generated block by text marker
      const marker = 'AI-generated answer';
      const idx = body.indexOf(marker);
      if (idx > 80) {
        // Text before the marker is the summary; strip nav noise from the top
        const raw = body.slice(0, idx).trim();
        const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        // Heuristic: real summary starts after short nav lines
        let start = 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length > 60) { start = i; break; }
        }
        return lines.slice(start).join('\n').trim();
      }
      // Last resort: largest paragraph-like block
      const blocks = [];
      document.querySelectorAll('p, div').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 200 && t.length < 4000 && el.querySelectorAll('p,div').length < 3) blocks.push(t);
      });
      return blocks.sort((a,b) => b.length - a.length)[0] || null;
    });
  }

  if (engine === 'google') {
    return page.evaluate(() => {
      // AI Overview or knowledge panel
      const selectors = [
        '[data-attrid="wa:/description"] span',
        'div.kno-rdesc span',
        '[jsname] .LGOjhe',
        'div[data-ved] span[jsname]',
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.innerText.length > 100) return el.innerText.trim();
      }
      // Fallback: largest text block that isn't boilerplate
      const blocks = [];
      document.querySelectorAll('p, div').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 200 && t.length < 3000 && el.querySelectorAll('p,div').length < 3) {
          if (!t.includes('CAPTCHA') && !t.includes('Terms of Service')) blocks.push(t);
        }
      });
      return blocks.sort((a, b) => b.length - a.length)[0] || null;
    });
  }

  if (engine === 'bing') {
    return page.evaluate(() => {
      // Bing Copilot answer or inline answer
      const selectors = [
        '#b_pole .b_text',
        '.b_ans .b_text',
        '[class*="copilot"] p',
        '.b_comprehensiveAnswerHeader + div p',
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.innerText.length > 100) return el.innerText.trim();
      }
      // Fallback: find text containing LDS-related content
      const blocks = [];
      document.querySelectorAll('p').forEach(el => {
        const t = (el.innerText || '').trim();
        if (t.length > 200 && (t.includes('LDS') || t.includes('Latter-day') || t.includes('verse') || t.includes('scripture'))) {
          blocks.push(t);
        }
      });
      return blocks[0] || null;
    });
  }

  return null;
}

async function scrapeVerse(page, verse, engineIndex) {
  const engine = ENGINES[engineIndex % ENGINES.length];
  const url = buildUrl(engine, verse.verse_title);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 });
    if (engine === 'brave') {
      // Wait for AI answer to appear
      try {
        await page.waitForFunction(
          () => document.body.innerText.includes('AI-generated'),
          { timeout: 15000 }
        );
      } catch (_) { /* fallback */ }
      await new Promise(r => setTimeout(r, 1500));
      // Click "More" inside the answer box to expand truncated content
      const clicked = await page.evaluate(() => {
        const ansEl = document.querySelector('[class*="answer"]') || document.querySelector('[class*="summarizer"]');
        if (!ansEl) return false;
        const moreBtn = [...ansEl.querySelectorAll('button')].find(
          b => (b.innerText || '').trim().toLowerCase() === 'more'
        );
        if (moreBtn) { moreBtn.click(); return true; }
        return false;
      });
      await new Promise(r => setTimeout(r, clicked ? 3000 : 1000));
    } else {
      await new Promise(r => setTimeout(r, 4000));
    }

    const summary = await extractSummary(page, engine);

    if (summary && summary.length > 80) {
      return { ok: true, summary, engine };
    }
    return { ok: false, reason: 'no_summary', engine };
  } catch (e) {
    return { ok: false, reason: e.message, engine };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
  const startId = args.includes('--start-id') ? parseInt(args[args.indexOf('--start-id') + 1]) : 0;
  const resetErrors = args.includes('--reset-errors');

  const db = new Database(DB_PATH);

  if (resetErrors) {
    db.prepare("UPDATE verse_summaries SET status='pending' WHERE status IN ('error','retry')").run();
    console.log('Reset error/retry rows to pending.');
  }

  // Fetch all pending verses
  let query = "SELECT verse_id, verse_title FROM verse_summaries WHERE status != 'ok'";
  if (startId > 0) query += ` AND verse_id >= ${startId}`;
  query += ' ORDER BY verse_id';
  if (limitArg) query += ` LIMIT ${limitArg}`;

  const verses = db.prepare(query).all();
  console.log(`Verses to process: ${verses.length}`);

  if (verses.length === 0) { db.close(); return; }

  const updateStmt = db.prepare(
    'UPDATE verse_summaries SET summary=?, status=?, engine=? WHERE verse_id=?'
  );

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,  // visible browser — avoids CAPTCHA bot detection
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled', '--lang=en-US,en',
      '--start-maximized',
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  let engineIndex = 0;
  let done = 0;
  let failed = 0;

  for (const verse of verses) {
    let result = null;
    let attempts = 0;

    // Always start with Brave (best LDS content), fall back to others on failure
    const engineOrder = [0, 1, 2]; // brave, google, bing

    while (attempts < MAX_RETRIES_PER_VERSE) {
      const engIdx = engineOrder[attempts % engineOrder.length];
      result = await scrapeVerse(page, verse, engIdx);
      if (result.ok) break;
      console.warn(`  [${result.engine}] failed (${result.reason}) — trying next engine`);
      attempts++;
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    if (result.ok) {
      updateStmt.run(result.summary, 'ok', result.engine, verse.verse_id);
      done++;
      if (done % 25 === 0) {
        console.log(`\n[${done}/${verses.length}] ${verse.verse_title} ✓ (${result.engine})`);
      } else {
        process.stdout.write('.');
      }
    } else {
      updateStmt.run(null, 'error', result.engine, verse.verse_id);
      failed++;
      console.warn(`\n  FAILED: ${verse.verse_title} (${result.reason})`);
    }

    engineIndex++;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  await browser.close();
  db.close();

  console.log(`\n\nDone. OK: ${done}, Failed: ${failed}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
