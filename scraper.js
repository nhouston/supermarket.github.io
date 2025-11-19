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

// --- NEW: HUMAN BEHAVIOR SIMULATOR ---
async function wiggleMouse(page) {
    try {
        await page.mouse.move(100, 100);
        await page.mouse.move(200, 200, { steps: 10 });
        await page.mouse.move(150, 300, { steps: 10 });
        await new Promise(r => setTimeout(r, 500));
    } catch (e) {}
}

async function scrapeSupermarkets() {
    console.log(`🛒 Scraping ${wishlist.length} items...`);

    const browser = await puppeteer.launch({
        headless: "new", // Ensure this is "new" for best compatibility
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1366,768', // Standard laptop size
            '--disable-blink-features=AutomationControlled' // Mask webdriver
        ]
    });

    const page = await browser.newPage();

    // STEALTH: Use a very standard Windows Chrome User Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const allData = { 'Sainsburys': {}, 'Tesco': {}, 'Asda': {}, 'Aldi': {}, 'Morrisons': {} };

    // --- CONFIGURATIONS ---
    
    // SAINSBURYS: Added "wiggle" to pass the soft block
    await updateStore(page, allData['Sainsburys'], 'Sainsburys',
        'https://www.sainsburys.co.uk/groceries/search?searchTerm=',
        ['[data-test-id="pt-retail-price"]', '.pt__cost', '.price-per-unit'],
        '#onetrust-accept-btn-handler'
    );

    // TESCO: Special text matcher for "Accept all"
    await updateStore(page, allData['Tesco'], 'Tesco',
        'https://www.tesco.com/groceries/en-GB/search?query=',
        ['.price-per-sellable-unit .value', '[data-auto="price-value"]', '.beans-price__text'],
        null, true // Enable Tesco special mode
    );

    // ASDA: Added wiggle to try and pass Cloudflare
    await updateStore(page, allData['Asda'], 'Asda',
        'https://groceries.asda.com/search/',
        ['.co-product-list__main-cntr .co-item__price', '.price', 'strong.co-product-list__price'],
        '#onetrust-accept-btn-handler'
    );

    // ALDI: Added popup closer for "Store Selection"
    await updateStore(page, allData['Aldi'], 'Aldi',
        'https://www.aldi.co.uk/results?q=',
        ['.product-tile-price .h4', '.product-price span', '.text-primary'],
        '#onetrust-accept-btn-handler', false, true // Enable Aldi special mode
    );

    // MORRISONS: Updated selectors
    await updateStore(page, allData['Morrisons'], 'Morrisons',
        'https://groceries.morrisons.com/search?q=',
        ['.fops-price', '.bop-price__current', 'span.fop-price', '.price-group'],
        '#onetrust-accept-btn-handler'
    );

    await browser.close();

    const output = { lastUpdated: new Date().toLocaleString(), prices: allData };
    fs.writeFileSync('prices.json', JSON.stringify(output, null, 2));
    console.log('✅ Scrape complete.');
}

async function updateStore(page, storeInventory, storeName, baseUrl, selectors, cookieSelector, isTesco = false, isAldi = false) {
    let cookieHandled = false;

    for (const item of wishlist) {
        try {
            const url = `${baseUrl}${encodeURIComponent(item)}`;
            
            // Slower navigation to look human
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await wiggleMouse(page); // Move mouse to prove we are human
            await new Promise(r => setTimeout(r, 2000));

            // --- POPUP KILLER LOGIC ---
            if (!cookieHandled) {
                try {
                    if (isTesco) {
                        // Tesco: Click "Accept all" button specifically
                        await page.evaluate(() => {
                            const buttons = Array.from(document.querySelectorAll('button'));
                            const accept = buttons.find(b => b.innerText.includes('Accept all'));
                            if (accept) accept.click();
                        });
                    } else if (isAldi) {
                        // Aldi: Close "Store Selection" popup (X button or close)
                        try { await page.click('.close-modal'); } catch(e) {}
                        try { await page.click('button[aria-label="Close"]'); } catch(e) {}
                        try { await page.click('#onetrust-accept-btn-handler'); } catch(e) {}
                    } else if (cookieSelector) {
                        await page.waitForSelector(cookieSelector, { timeout: 2000 });
                        await page.click(cookieSelector);
                    }
                    await new Promise(r => setTimeout(r, 1000));
                    cookieHandled = true;
                } catch (e) {}
            }

            // --- PRICE FINDER ---
            let foundPrice = null;
            for (const sel of selectors) {
                try {
                    const el = await page.$(sel);
                    if (el) {
                        const text = await page.evaluate(element => element.textContent, el);
                        const price = parsePrice(text.trim());
                        if (price) {
                            foundPrice = price;
                            break;
                        }
                    }
                } catch (e) {}
            }

            if (foundPrice) {
                storeInventory[item] = foundPrice;
                console.log(`   [${storeName}] ${item}: £${foundPrice}`);
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
