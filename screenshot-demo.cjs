const puppeteer = require('puppeteer');
const path = require('path');

const BASE = 'https://vgc-itsm1-app.azurewebsites.net';
const DIR = path.join(__dirname, 'screenshots');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const fs = require('fs');
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // 1. Landing page
  console.log('1/8 Landing page...');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.screenshot({ path: path.join(DIR, '01-landing.png'), fullPage: true });
  console.log('  -> saved 01-landing.png');

  // 2. Click "Demo Experience" for Super Admin (first one)
  console.log('2/8 Clicking Demo Experience (Super Admin)...');
  const btns = await page.$$('button');
  for (const btn of btns) {
    const txt = await page.evaluate(el => el.textContent, btn);
    if (txt && txt.includes('Demo')) {
      await btn.click();
      await wait(4000);
      break;
    }
  }
  await page.screenshot({ path: path.join(DIR, '02-dashboard.png'), fullPage: true });
  console.log('  -> saved 02-dashboard.png');

  // 3. Try clicking sidebar nav items
  const navItems = ['Incidents', 'Services', 'Knowledge', 'Assets', 'Analytics', 'AI Copilot'];
  let idx = 3;
  for (const label of navItems) {
    console.log(`${idx}/8 Navigating to ${label}...`);
    const clicked = await page.evaluate((lbl) => {
      const els = document.querySelectorAll('a, button, div, span, li, nav *');
      for (const el of els) {
        const t = el.textContent.trim();
        if (t === lbl || t.startsWith(lbl)) {
          if (el.offsetParent !== null || el.offsetWidth > 0) {
            el.click();
            return true;
          }
        }
      }
      return false;
    }, label);
    
    if (clicked) await wait(2500);
  await browser.close();
  console.log('\nDone! All screenshots saved to ./screenshots/');
})();
