
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false, // so user can enter 2FA code
    defaultViewport: null,
    args: ['--start-maximized']
  });

  const page = await browser.newPage();

  // Step 1: Navigate to DAT.com homepage
  await page.goto('https://www.dat.com');

  // Step 2: Click on "Carriers"
  await page.waitForSelector('a[href="#carriers"]');
  await page.click('a[href="#carriers"]');

  // Step 3: Click on "DAT One Web"
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    const targetLink = links.find(link => link.textContent.includes('DAT One Web'));
    if (targetLink) targetLink.click();
  });

  // Step 4: Wait for login redirect
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  // Step 5: Enter email
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', 'dispatch@lampslogistics.com');
  await page.keyboard.press('Enter');

  // Step 6: Enter password
  await page.waitForSelector('input[type="password"]');
  await page.type('input[type="password"]', 'Anonymous#56111');
  await page.keyboard.press('Enter');

  // Step 7: Pause for manual 2FA input
  console.log('🛑 Awaiting manual 2FA entry... Login should complete once you enter the code.');

  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  console.log('✅ Logged in. You may now begin scraping.');

  // Keep browser open for scraping
})();
