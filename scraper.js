const puppeteer = require('puppeteer');
const fs = require('fs');

// 1. LOAD MEMORY
let wishlist = [];
try {
    wishlist = JSON.parse(fs.readFileSync('wishlist.json', 'utf8'));
} catch (e) {
    wishlist = ['Milk', 'Bread'];
}

// 2. CHECK FOR NEW ITEMS
const newItem = process.env.NEW_ITEM;
if (newItem && newItem.trim() !== "") {
    const formatted = newItem.trim();
    if (!wishlist.some(item => item.toLowerCase() === formatted.toLowerCase())) {
        wishlist.push(formatted);
        fs.writeFileSync('wishlist.json', JSON.stringify(wishlist, null, 2));
    }
}

function parsePrice(priceStr) {
    if (!priceStr) return null;
    let clean = priceStr.toLowerCase().replace(/[^\d.p]/g, '');
    if (clean.includes('p')) { return parseFloat(clean.replace('p', '')) / 100; }
    return parseFloat(clean);
}

// --- HUMAN BEHAVIOR SIMULATOR ---
async function wiggleMouse(page) {
    try {
        const width = 1366;
        const height = 768;
        await page.mouse.move(width / 2, height / 2);
        await page.mouse.move(width / 2 + 100, height / 2 + 50, { steps: 25 });
        await page.mouse.move(width / 2 - 50, height / 2 - 100, { steps: 25 });
        await new Promise(r => setTimeout(r, Math.random() * 1000 + 500));
    } catch (e) {}
}

async function scrapeSupermarkets() {
    console.log(`🛒 Scraping ${wishlist.length} items (finding cheapest)...`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1366,768',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();

    // STEALTH: Standard Windows 10 Chrome
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    // Removed 'Sainsburys'
    const allData = { 'Tesco': {}, 'Asda': {}, 'Aldi': {}, 'Morrisons': {} };

    // --- CONFIGURATIONS ---
    // Added nameSelectors to each store config

    // TESCO
    await updateStore(page, allData['Tesco'], 'Tesco',
        'https://www.tesco.com/groceries/en-GB/search?query=',
        ['._64Yvfa_priceText', '.price-per-sellable-unit .value', '[data-auto="price-value"]', '.beans-price__text'],
        ['a[data-auto="product-tile--title"]', '.beans-link__text'], // Name selectors
        null, true 
    );

    // ASDA
    await updateStore(page, allData['Asda'], 'Asda',
        'https://groceries.asda.com/search/',
        ['[data-locator="txt-product-price"]', '.co-product-list__main-cntr .co-item__price', '.price', 'strong.co-product-list__price'],
        ['[data-locator="txt-product-title"]', '.co-product-list__main-cntr .co-item__title', 'h3.co-product-list__title'], // Name selectors
        '#onetrust-accept-btn-handler',
        false, false, true 
    );

    // ALDI
    await updateStore(page, allData['Aldi'], 'Aldi',
        'https://www.aldi.co.uk/results?q=',
        ['.base-price__regular', '.product-tile-price .h4', '.product-price span'],
        ['.product-tile-text', '.product-name'], // Name selectors
        '#onetrust-accept-btn-handler', false, true 
    );

    // MORRISONS
    await updateStore(page, allData['Morrisons'], 'Morrisons',
        'https://groceries.morrisons.com/search?q=',
        ['[data-test="fop-price"]', 'span._display_xy0eg_1', '.fops-price', '.bop-price__current'],
        ['[data-test="fop-title"]', 'h4._display_14438_1', '.fop-title'], // Name selectors
        '#onetrust-accept-btn-handler'
    );

    await browser.close();

    const output = { lastUpdated: new Date().toLocaleString(), prices: allData };
    fs.writeFileSync('prices.json', JSON.stringify(output, null, 2));
    console.log('✅ Scrape complete.');
}

async function updateStore(page, storeInventory, storeName, baseUrl, priceSelectors, nameSelectors, cookieSelector, isTesco = false, isAldi = false, goHomeFirst = false) {
    let cookieHandled = false;

    if (goHomeFirst) {
        try {
            const homeUrl = new URL(baseUrl).origin;
            await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await wiggleMouse(page);
            await new Promise(r => setTimeout(r, 4000));
        } catch(e) {}
    }

    for (const item of wishlist) {
        try {
            const url = `${baseUrl}${encodeURIComponent(item)}`;
            
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await wiggleMouse(page); 
            await new Promise(r => setTimeout(r, 3500));

            // --- POPUP KILLER ---
            if (!cookieHandled) {
                try {
                    if (isTesco) {
                        await page.evaluate(() => {
                            const buttons = Array.from(document.querySelectorAll('button'));
                            const accept = buttons.find(b => b.innerText.includes('Accept all'));
                            if (accept) accept.click();
                        });
                    } else if (isAldi) {
                        try { await page.click('.close-modal'); } catch(e) {}
                        try { await page.click('button[aria-label="Close"]'); } catch(e) {}
                        try { await page.click('#onetrust-accept-btn-handler'); } catch(e) {}
                    } else if (cookieSelector) {
                        await page.waitForSelector(cookieSelector, { timeout: 2000 });
                        await page.click(cookieSelector);
                    }
                    await new Promise(r => setTimeout(r, 1500));
                    cookieHandled = true;
                } catch (e) {}
            }

            // --- EXTRACT PRODUCTS (Name + Price) ---
            let foundProducts = [];
            
            // We try to find a container that holds both name and price, 
            // but generic scraping is hard. simpler strategy:
            // Grab ALL valid prices and their corresponding index/context if possible.
            // For simplicity in this robust script, we will fetch all price texts and all name texts
            // and assume they map 1:1 (which is usually true for grid layouts).

            // 1. Find Prices
            let prices = [];
            for (const sel of priceSelectors) {
                try {
                    const elements = await page.$$(sel);
                    if (elements.length > 0) {
                        prices = await Promise.all(elements.map(el => page.evaluate(e => e.textContent, el)));
                        if (prices.length > 0) break; // Found a working selector
                    }
                } catch(e){}
            }

            // 2. Find Names
            let names = [];
            for (const sel of nameSelectors) {
                try {
                    const elements = await page.$$(sel);
                    if (elements.length > 0) {
                        names = await Promise.all(elements.map(el => page.evaluate(e => e.textContent, el)));
                        if (names.length > 0) break; 
                    }
                } catch(e){}
            }

            // 3. Pair them up and find cheapest
            for (let i = 0; i < Math.min(prices.length, names.length); i++) {
                const pVal = parsePrice(prices[i]);
                const pName = names[i].trim();
                if (pVal && pVal > 0) {
                    foundProducts.push({ price: pVal, name: pName });
                }
            }

            if (foundProducts.length > 0) {
                // Sort by price ascending
                foundProducts.sort((a, b) => a.price - b.price);
                const best = foundProducts[0];
                
                // Store object: { price: 1.20, name: "Tesco Milk" }
                storeInventory[item] = best; 
                console.log(`   [${storeName}] ${item}: £${best.price} - ${best.name}`);
            } else {
                console.log(`   [${storeName}] ${item}: Not found.`);
            }

        } catch (error) {
            console.log(`   [${storeName}] Error: ${error.message}`);
        }
    }
}

scrapeSupermarkets();
