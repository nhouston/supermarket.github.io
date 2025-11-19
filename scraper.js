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
    // Clean text like "£1.50", "now £1.00", "80p"
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
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    
    // NEW STEALTH USER AGENT (To fix Sainsbury's soft block)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');

    const allData = { 'Sainsburys': {}, 'Tesco': {}, 'Asda': {}, 'Aldi': {}, 'Morrisons': {} };

    // --- STORE 1: SAINSBURYS ---
    // Attempt to accept cookies if they appear
    await updateStore(page, allData['Sainsburys'], 'Sainsburys', 
        'https://www.sainsburys.co.uk/groceries/search?searchTerm=', 
        ['[data-test-id="pt-retail-price"]', '.pt__cost', '.pricePerUnit'],
        '#onetrust-accept-btn-handler'
    );

    // --- STORE 2: TESCO (Fixing the Cookie Block) ---
    await updateStore(page, allData['Tesco'], 'Tesco', 
        'https://www.tesco.com/groceries/en-GB/search?query=', 
        ['.price-per-sellable-unit .value', '[data-auto="price-value"]', '.beans-price__text'],
        null, // We handle Tesco cookies manually with a text search below
        true  // Enable Tesco special logic
    );

    // --- STORE 3: ASDA (Fixing selectors for when it loads) ---
    await updateStore(page, allData['Asda'], 'Asda', 
        'https://groceries.asda.com/search/', 
        ['.co-product-list__main-cntr .co-item__price', '.price', '.co-product-list__price'],
        '#onetrust-accept-btn-handler'
    );

    // --- STORE 4: ALDI (Fixing selectors) ---
    await updateStore(page, allData['Aldi'], 'Aldi', 
        'https://www.aldi.co.uk/results?q=', 
        ['.product-tile-price .h4', '.product-price span', '.text-primary'],
        '#onetrust-accept-btn-handler'
    );
    
    // --- STORE 5: MORRISONS (Fixing selectors) ---
    await updateStore(page, allData['Morrisons'], 'Morrisons', 
        'https://groceries.morrisons.com/search?q=', 
        ['.fops-price', '.price-group', 'span.fop-price'],
        '#onetrust-accept-btn-handler'
    );

    await browser.close();

    const output = { lastUpdated: new Date().toLocaleString(), prices: allData };
    fs.writeFileSync('prices.json', JSON.stringify(output, null, 2));
    console.log('✅ Scrape complete.');
}

async function updateStore(page, storeInventory, storeName, baseUrl, selectors, cookieSelector, isTesco = false) {
    let cookieHandled = false;

    for (const item of wishlist) {
        try {
            const url = `${baseUrl}${encodeURIComponent(item)}`;
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // --- SPECIAL COOKIE HANDLING ---
            if (!cookieHandled) {
                try {
                    if (isTesco) {
                        // TESCO SPECIFIC: Find button by text "Accept all"
                        await page.evaluate(() => {
                            const buttons = Array.from(document.querySelectorAll('button'));
                            const acceptBtn = buttons.find(b => b.textContent.includes('Accept all'));
                            if (acceptBtn) acceptBtn.click();
                        });
                    } else if (cookieSelector) {
                        // STANDARD: Click by ID
                        await page.waitForSelector(cookieSelector, { timeout: 2000 });
                        await page.click(cookieSelector);
                    }
                    await new Promise(r => setTimeout(r, 2000)); // Wait for overlay to vanish
                    cookieHandled = true;
                } catch(e) {}
            }

            // --- PRICE EXTRACTION ---
            let foundPrice = null;
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
                console.log(`   [${storeName}] ${item}: Not found. (Saving screenshot)`);
                try { await page.screenshot({ path: `debug-${storeName}-${item.replace(/\s/g,'')}.png` }); } catch(e) {}
            }

        } catch (error) {
            console.log(`   [${storeName}] Error: ${error.message}`);
        }
    }
}

scrapeSupermarkets();
