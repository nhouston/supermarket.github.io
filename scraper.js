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
    // Remove everything except digits, dots, and 'p'
    let clean = priceStr.toLowerCase().replace(/[^\d.p]/g, '');
    
    // Handle pence (e.g., "50p" -> 0.50)
    if (clean.includes('p')) { 
        return parseFloat(clean.replace('p', '')) / 100; 
    }
    
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

    // Removed 'Sainsburys' from data structure
    const allData = { 'Tesco': {}, 'Asda': {}, 'Aldi': {}, 'Morrisons': {} };

    // --- CONFIGURATIONS ---
    
    // TESCO
    await updateStore(page, allData['Tesco'], 'Tesco',
        'https://www.tesco.com/groceries/en-GB/search?query=',
        ['._64Yvfa_priceText', '.price-per-sellable-unit .value', '[data-auto="price-value"]', '.beans-price__text'],
        null, true 
    );

    // ASDA
    await updateStore(page, allData['Asda'], 'Asda',
        'https://groceries.asda.com/search/',
        ['[data-locator="txt-product-price"]', '.co-product-list__main-cntr .co-item__price', '.price', 'strong.co-product-list__price'],
        '#onetrust-accept-btn-handler',
        false, false, true 
    );

    // ALDI
    await updateStore(page, allData['Aldi'], 'Aldi',
        'https://www.aldi.co.uk/results?q=',
        ['.base-price__regular', '.product-tile-price .h4', '.product-price span'],
        '#onetrust-accept-btn-handler', false, true 
    );

    // MORRISONS
    await updateStore(page, allData['Morrisons'], 'Morrisons',
        'https://groceries.morrisons.com/search?q=',
        ['[data-test="fop-price"]', 'span._display_xy0eg_1', '.fops-price', '.bop-price__current'],
        '#onetrust-accept-btn-handler'
    );

    await browser.close();

    const output = { lastUpdated: new Date().toLocaleString(), prices: allData };
    fs.writeFileSync('prices.json', JSON.stringify(output, null, 2));
    console.log('✅ Scrape complete.');
}

async function updateStore(page, storeInventory, storeName, baseUrl, selectors, cookieSelector, isTesco = false, isAldi = false, goHomeFirst = false) {
    let cookieHandled = false;

    // Optional: Go to homepage first
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

            // --- PRICE FINDER (SCAN ALL & PICK CHEAPEST) ---
            let foundPrices = [];
            
            for (const sel of selectors) {
                try {
                    // Get ALL matching elements, not just the first one
                    const elements = await page.$$(sel);
                    if (elements.length > 0) {
                        // Extract text from all of them
                        const texts = await Promise.all(elements.map(el => page.evaluate(e => e.textContent, el)));
                        
                        // Parse and collect valid prices
                        texts.forEach(txt => {
                            const p = parsePrice(txt.trim());
                            if (p && p > 0) foundPrices.push(p);
                        });
                    }
                } catch (e) {}
            }

            if (foundPrices.length > 0) {
                // Find the absolute lowest price on the page
                const cheapest = Math.min(...foundPrices);
                storeInventory[item] = cheapest;
                console.log(`   [${storeName}] ${item}: £${cheapest} (Lowest of ${foundPrices.length} items)`);
            } else {
                console.log(`   [${storeName}] ${item}: Not found. (Saving screenshot)`);
                try { await page.screenshot({ path: `debug-${storeName}-${item.replace(/\s/g, '')}.png` }); } catch(e) {}
            }

        } catch (error) {
            console.log(`   [${storeName}] Error: ${error.message}`);
        }
    }
}

scrapeSupermarkets();
