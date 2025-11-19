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
    console.log(`🛒 Scraping ${wishlist.length} items...`);

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

    const allData = { 'Sainsburys': {}, 'Tesco': {}, 'Asda': {}, 'Aldi': {}, 'Morrisons': {} };

    // --- CONFIGURATIONS ---
    
    // SAINSBURYS: Updated with specific pkgid selector
    await updateStore(page, allData['Sainsburys'], 'Sainsburys',
        'https://www.sainsburys.co.uk/groceries/search?searchTerm=',
        ['[data-pkgid*="display-2"]', '.ds-c-price-flexible__price', '[data-test-id="pt-retail-price"]', '.pt__cost'],
        '#onetrust-accept-btn-handler',
        false, false, true // Enable Sainsbury's home-first logic
    );

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
        false, false, true // Enable Asda home-first logic
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

    // Optional: Go to homepage first to establish session/cookies for tough sites
    if (goHomeFirst) {
        try {
            const homeUrl = new URL(baseUrl).origin;
            await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await wiggleMouse(page);
            // Increased wait time to 4s to let cookies settle
            await new Promise(r => setTimeout(r, 4000));
        } catch(e) {}
    }

    for (const item of wishlist) {
        try {
            const url = `${baseUrl}${encodeURIComponent(item)}`;
            
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await wiggleMouse(page); 
            // Increased wait time between items to reduce block chance
            await new Promise(r => setTimeout(r, 3500));

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
                        // Aldi: Close "Store Selection" popup
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
