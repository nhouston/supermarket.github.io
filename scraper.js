const puppeteer = require('puppeteer');
const fs = require('fs');

const SHOPPING_LIST = [
    'Milk', 'Bread', 'Eggs', 'Bananas', 'Rice', 'Pasta', 'Chicken Breast', 'Potatoes', 'Cheese', 'Apples'
];

// Helper to clean price strings (e.g., "£1.50" -> 1.50)
function parsePrice(priceStr) {
    if (!priceStr) return null;
    let clean = priceStr.toLowerCase().replace(/[^\d.p]/g, '');
    if (clean.includes('p')) {
        return parseFloat(clean.replace('p', '')) / 100;
    }
    return parseFloat(clean);
}

async function scrapeSupermarkets() {
    console.log('🛒 Starting Scraper...');
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    const allData = {};

    // 1. Sainsbury's
    console.log('Checking Sainsburys...');
    allData['Sainsburys'] = await scrapeStore(page, 'https://www.sainsburys.co.uk/gol-ui/SearchResults/', '.pt__cost', 'Sainsburys');

    // 2. Tesco
    console.log('Checking Tesco...');
    allData['Tesco'] = await scrapeStore(page, 'https://www.tesco.com/groceries/en-GB/search?query=', '.price-per-sellable-unit .value', 'Tesco');

    // 3. Asda
    console.log('Checking Asda...');
    allData['Asda'] = await scrapeStore(page, 'https://groceries.asda.com/search/', '.co-product-list__main-cntr .co-item__price', 'Asda');

    // 4. Aldi
    console.log('Checking Aldi...');
    allData['Aldi'] = await scrapeStore(page, 'https://groceries.aldi.co.uk/en-GB/Search?keywords=', '.product-tile-price .h4', 'Aldi');

    // 5. Morrisons
    console.log('Checking Morrisons...');
    allData['Morrisons'] = await scrapeStore(page, 'https://groceries.morrisons.com/search?entry=', '.fops-price', 'Morrisons');

    await browser.close();

    const output = { lastUpdated: new Date().toLocaleString(), prices: allData };
    fs.writeFileSync('prices.json', JSON.stringify(output, null, 2));
    console.log('✅ Data saved to prices.json');
}

async function scrapeStore(page, baseUrl, priceSelector, storeName) {
    const prices = {};
    for (const item of SHOPPING_LIST) {
        try {
            await page.goto(`${baseUrl}${encodeURIComponent(item)}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000)); // Human delay

            try {
                await page.waitForSelector(priceSelector, { timeout: 5000 });
                const text = await page.$eval(priceSelector, el => el.textContent.trim());
                prices[item] = parsePrice(text);
                console.log(`   [${storeName}] ${item}: £${prices[item]}`);
            } catch (e) {
                console.log(`   [${storeName}] ${item}: Not found`);
                prices[item] = null;
            }
        } catch (error) {
            prices[item] = null;
        }
    }
    return prices;
}

scrapeSupermarkets();
