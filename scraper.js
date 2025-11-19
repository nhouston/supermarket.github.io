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

async function scrapeSupermarkets() {
    console.log(`🛒 Scraping ${wishlist.length} items...`);
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--window-size=1920,1080',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const page = await browser.newPage();
    
    // STEALTH: Pass as a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const allData = { 'Sainsburys': {}, 'Tesco': {}, 'Asda': {}, 'Aldi': {}, 'Morrisons': {} };

    // --- CONFIGURATION ---
    // selector: The CSS class for the price
    // cookieBtn: The selector for the "Accept Cookies" button (to clear the screen)
    
    await updateStore(page, allData['Sainsburys'], 'Sainsburys', 
        'https://www.sainsburys.co.uk/groceries/search?searchTerm=', 
        ['[data-test-id="pt-retail-price"]', '.pt__cost'],
        '#onetrust-accept-btn-handler' // Cookie button
    );

    await updateStore(page, allData['Tesco'], 'Tesco', 
        'https://www.tesco.com/groceries/en-GB/search?query=', 
        ['.price-per-sellable-unit .value', '[data-auto="price-value"]'],
        'button[title="Accept all cookies"]'
    );

    await updateStore(page, allData['Asda'], 'Asda', 
        'https://groceries.asda.com/search/', 
        ['.co-product-list__main-cntr .co-item__price', 'strong.co-product-list__price'],
        '#onetrust-accept-btn-handler'
    );

    await updateStore(page, allData['Aldi'], 'Aldi', 
        'https://www.aldi.co.uk/results?q=', 
        ['.product-tile-price .h4', '.product-tile-price', '.text-primary'],
        '#onetrust-accept-btn-handler'
    );
    
    await updateStore(page, allData['Morrisons'], 'Morrisons', 
        'https://groceries.morrisons.com/search?q=', 
        ['.fops-price', '.bop-price__current'],
        '#onetrust-accept-btn-handler'
    );

    await browser.close();

    const output = { lastUpdated: new Date().toLocaleString(), prices: allData };
    fs.writeFileSync('prices.json', JSON.stringify(output, null, 2));
    console.log('✅ Scrape complete.');
}

async function updateStore(page, storeInventory, storeName, baseUrl, selectors, cookieBtnSelector) {
    let cookieClicked = false;

    for (const item of wishlist) {
        try {
            const url = `${baseUrl}${encodeURIComponent(item)}`;
            // Increased timeout to 45s for slow loads
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
            
            // 1. TRY TO SMASH COOKIE BANNER (Once per store)
            if (!cookieClicked && cookieBtnSelector) {
                try {
                    const btn = await page.waitForSelector(cookieBtnSelector, { timeout: 2000 });
                    if (btn) {
                        await btn.click();
                        await new Promise(r => setTimeout(r, 1000)); // Wait for banner to disappear
                        cookieClicked = true;
                    }
                } catch(e) {}
            }

            // 2. CHECK PAGE TITLE (Debug: Are we blocked?)
            const title = await page.title();
            if (title.includes("Access Denied") || title.includes("Robot")) {
                console.log(`   [${storeName}] ⛔ BLOCKED. (IP banned by store)`);
                continue; 
            }

            let foundPrice = null;

            // 3. FIND PRICE
            for (const sel of selectors) {
                try {
                    const el = await page.waitForSelector(sel, { timeout: 1500 });
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
                console.log(`   [${storeName}] ${item}: Not found. Saving screenshot...`);
                // 4. TAKE DEBUG SCREENSHOT
                // This will create a file like "debug-Tesco-Milk.png" so you can see what happened
                try {
                    await page.screenshot({ path: `debug-${storeName}-${item.replace(/\s/g,'')}.png` });
                } catch(e) {}
            }

        } catch (error) {
            console.log(`   [${storeName}] Error: ${error.message}`);
        }
    }
}

scrapeSupermarkets();
