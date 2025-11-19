const puppeteer = require('puppeteer');
const fs = require('fs');

// 1. LOAD THE WISHLIST (The Memory)
let wishlist = [];
try {
    wishlist = JSON.parse(fs.readFileSync('wishlist.json', 'utf8'));
} catch (e) {
    wishlist = ['Milk', 'Bread']; // Fallback
}

// 2. CHECK FOR NEW ITEM INJECTION (From Manual Workflow)
const newItem = process.env.NEW_ITEM;
if (newItem && newItem.trim() !== "") {
    const formatted = newItem.trim();
    // Only add if not already there (Case insensitive check)
    if (!wishlist.some(item => item.toLowerCase() === formatted.toLowerCase())) {
        wishlist.push(formatted);
        console.log(`📝 LEARNING: Added "${formatted}" to wishlist.json`);
        
        // SAVE THE UPDATED WISHLIST BACK TO FILE
        fs.writeFileSync('wishlist.json', JSON.stringify(wishlist, null, 2));
    } else {
        console.log(`ℹ️ ALREADY KNOW: "${formatted}" is already in the list.`);
    }
}

// Helper to parse currency
function parsePrice(priceStr) {
    if (!priceStr) return null;
    let clean = priceStr.toLowerCase().replace(/[^\d.p]/g, '');
    if (clean.includes('p')) { return parseFloat(clean.replace('p', '')) / 100; }
    return parseFloat(clean);
}

async function scrapeSupermarkets() {
    console.log(`🛒 Scraping ${wishlist.length} items from wishlist...`);
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    const allData = {};
    const stores = ['Sainsburys', 'Tesco', 'Asda', 'Aldi', 'Morrisons'];
    
    // Initialize structure
    stores.forEach(store => allData[store] = {});

    // --- SCRAPE LOOP ---
    // We pass the WHOLE wishlist to each store
    await updateStore(page, allData['Sainsburys'], 'Sainsburys', 'https://www.sainsburys.co.uk/gol-ui/SearchResults/', '.pt__cost');
    await updateStore(page, allData['Tesco'], 'Tesco', 'https://www.tesco.com/groceries/en-GB/search?query=', '.price-per-sellable-unit .value');
    await updateStore(page, allData['Asda'], 'Asda', 'https://groceries.asda.com/search/', '.co-product-list__main-cntr .co-item__price');
    await updateStore(page, allData['Aldi'], 'Aldi', 'https://groceries.aldi.co.uk/en-GB/Search?keywords=', '.product-tile-price .h4');
    await updateStore(page, allData['Morrisons'], 'Morrisons', 'https://groceries.morrisons.com/search?entry=', '.fops-price');

    await browser.close();

    const output = {
        lastUpdated: new Date().toLocaleString(),
        prices: allData
    };

    fs.writeFileSync('prices.json', JSON.stringify(output, null, 2));
    console.log('✅ Scrape complete. Prices updated.');
}

async function updateStore(page, storeInventory, storeName, baseUrl, priceSelector) {
    // We shuffle the list slightly to act more human, or just run straight through
    for (const item of wishlist) {
        try {
            // Navigate
            await page.goto(`${baseUrl}${encodeURIComponent(item)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
            
            // Human Delay (0.5s to 1.5s)
            await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));

            try {
                await page.waitForSelector(priceSelector, { timeout: 3000 });
                const text = await page.$eval(priceSelector, el => el.textContent.trim());
                const price = parsePrice(text);
                
                if (price) {
                    storeInventory[item] = price;
                    console.log(`   [${storeName}] ${item}: £${price}`);
                }
            } catch (e) {
                // Item not found or selector failed
                // console.log(`   [${storeName}] ${item}: Not found`);
            }
        } catch (error) {
            console.log(`   [${storeName}] Error loading page for ${item}`);
        }
    }
}

scrapeSupermarkets();
