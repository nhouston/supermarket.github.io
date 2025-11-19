const puppeteer = require('puppeteer');
const fs = require('fs');

// 1. LOAD MEMORY (wishlist.json)
// This file stores the list of items we want to track forever.
let wishlist = [];
try {
    wishlist = JSON.parse(fs.readFileSync('wishlist.json', 'utf8'));
} catch (e) {
    // Default list if file is missing
    wishlist = ['Milk', 'Bread']; 
}

// 2. CHECK FOR NEW ITEMS (From Manual Workflow Input)
// If you run the GitHub Action manually and type "Saffron", it appears here.
const newItem = process.env.NEW_ITEM;
if (newItem && newItem.trim() !== "") {
    const formatted = newItem.trim();
    // Add only if unique (case-insensitive check)
    if (!wishlist.some(item => item.toLowerCase() === formatted.toLowerCase())) {
        wishlist.push(formatted);
        // Save immediately so we remember it for next time
        fs.writeFileSync('wishlist.json', JSON.stringify(wishlist, null, 2));
        console.log(`📝 Added "${formatted}" to wishlist.`);
    }
}

// Helper: Clean price text (e.g. "£1.50" -> 1.50, "80p" -> 0.80)
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
        // Add these args to bypass some basic detection
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--window-size=1920,1080',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    
    // 3. STEALTH MODE: Set headers to look like a real Mac Chrome user
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    });

    const allData = { 'Sainsburys': {}, 'Tesco': {}, 'Asda': {}, 'Aldi': {}, 'Morrisons': {} };

    // --- STORE CONFIGURATIONS ---
    // We provide an ARRAY of selectors to try in order. If one fails, it tries the next.
    
    await updateStore(page, allData['Sainsburys'], 'Sainsburys', 
        'https://www.sainsburys.co.uk/groceries/search?searchTerm=', 
        ['[data-test-id="pt-retail-price"]', '.pt__cost', '.pricePerUnit']
    );

    await updateStore(page, allData['Tesco'], 'Tesco', 
        'https://www.tesco.com/groceries/en-GB/search?query=', 
        ['.price-per-sellable-unit .value', '[data-auto="price-value"]', '.beans-price__text']
    );

    await updateStore(page, allData['Asda'], 'Asda', 
        'https://groceries.asda.com/search/', 
        ['.co-product-list__main-cntr .co-item__price', '.price', 'strong.co-product-list__price']
    );

    await updateStore(page, allData['Aldi'], 'Aldi', 
        'https://www.aldi.co.uk/results?q=', 
        ['.product-tile-price .h4', '.product-price', '.text-primary']
    );
    
    // Morrisons is extremely strict on bots, this is a best effort
    await updateStore(page, allData['Morrisons'], 'Morrisons', 
        'https://groceries.morrisons.com/search?q=', 
        ['.fops-price', '.price-group', '.bop-price__current']
    );

    await browser.close();

    const output = {
        lastUpdated: new Date().toLocaleString(),
        prices: allData
    };

    fs.writeFileSync('prices.json', JSON.stringify(output, null, 2));
    console.log('✅ Scrape complete.');
}

async function updateStore(page, storeInventory, storeName, baseUrl, selectors) {
    for (const item of wishlist) {
        try {
            const url = `${baseUrl}${encodeURIComponent(item)}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
            
            // Human pause to avoid rate limits (Random wait between 1s and 2.5s)
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));

            let foundPrice = null;

            // TRY MULTIPLE SELECTORS
            for (const sel of selectors) {
                try {
                    // Wait briefly for this selector (2 seconds max)
                    const el = await page.waitForSelector(sel, { timeout: 2000 });
                    if (el) {
                        const text = await page.evaluate(element => element.textContent, el);
                        const price = parsePrice(text.trim());
                        if (price) {
                            foundPrice = price;
                            break; // Stop checking other selectors if we found one
                        }
                    }
                } catch (e) {
                    // Selector not found, try next one
                }
            }

            if (foundPrice) {
                storeInventory[item] = foundPrice;
                console.log(`   [${storeName}] ${item}: £${foundPrice}`);
            } else {
                console.log(`   [${storeName}] ${item}: Not found`);
            }

        } catch (error) {
            console.log(`   [${storeName}] Error loading page for ${item}`);
        }
    }
}

scrapeSupermarkets();
