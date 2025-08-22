
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();

    console.log("🟢 Navigating to DAT.com...");
    await page.goto('https://www.dat.com', { waitUntil: 'networkidle2' });

    // Click "Carriers" → "DAT One Web"
    await page.waitForSelector('a[title="Carriers"]', { timeout: 15000 });
    await page.click('a[title="Carriers"]');

    await page.waitForTimeout(1000);
    const [link] = await page.$x("//a[contains(text(), 'DAT One Web')]");
    if (link) {
        await link.click();
    } else {
        console.log("❌ Could not find DAT One Web link.");
        await browser.close();
        return;
    }

    // Wait for login fields
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    await page.type('input[name="username"]', 'dispatch@lampslogistics.com', { delay: 100 });
    await page.type('input[name="password"]', 'Anonymous#56111', { delay: 100 });

    console.log("🔐 Submitting login...");
    await page.click('button[type="submit"]');

    console.log("⏳ Waiting for you to manually enter the 2FA code...");
    await page.waitForNavigation({ timeout: 0 });

    console.log("✅ Logged in! Ready to scrape loads.");

    // Load scraping logic goes here
})();
