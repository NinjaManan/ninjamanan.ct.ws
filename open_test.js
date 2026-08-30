const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('file:///C:/Users/NinjaManan/Downloads/ninjamanan.ct.ws/test_webgl_file.html');
  await page.waitForTimeout(3000);
  const results = await page.evaluate(() => window.testResults);
  console.log('Results:', results.join('\n'));
  await browser.close();
})();
