const puppeteer = require('puppeteer');
const fs = require('fs');

const SHOPPING_LIST = [
    'Milk', 'Bread', 'Eggs', 'Bananas', 'Rice', 'Pasta', 'Chicken Breast', 'Potatoes', 'Cheese', 'Apples'
];

function parsePrice(priceStr) {
    if (!priceStr) return null;
    let clean = priceStr.toLowerCase().replace(/[^\d.p]/g, '');
    if (clean.includes('p')) { return parseFloat(clean.replace('p', '')) / 100; }
    return parseFloat(clean);
}

async function scrapeSupermarkets() {
    // CHECK FOR SPECIFIC INPUT
    const specificItem = process.env.SPECIFIC_ITEM;
    
    let itemsToScrape = [];
    let existingData = { prices: {} };

    if (specificItem && specificItem.trim() !== "") {
        console.log(`🎯 TARGETED MODE: Searching for "${specificItem}"`);
        itemsToScrape = [specificItem];
        
        // Load existing data so we don't delete it
        if (fs.existsSync('prices.json')) {
            existingData = JSON.parse(fs.readFileSync('prices.json', 'utf8'));
        }
    } else {
        console.log('🧹 SWEEP MODE: Running daily categories');
        itemsToScrape = SHOPPING_LIST;
    }

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

    // Initialize structure if empty
    if (!existingData.prices['Sainsburys']) existingData.prices['Sainsburys'] = {};
    if (!existingData.prices['Tesco']) existingData.prices['Tesco'] = {};
    if (!existingData.prices['Asda']) existingData.prices['Asda'] = {};
    if (!existingData.prices['Aldi']) existingData.prices['Aldi'] = {};
    if (!existingData.prices['Morrisons']) existingData.prices['Morrisons'] = {};

    // --- Scrape Logic ---
    // We pass the specific list (1 item or all items)
    await updateStore(page, existingData.prices['Sainsburys'], 'Sainsburys', 'https://www.sainsburys.co.uk/gol-ui/SearchResults/', '.pt__cost', itemsToScrape);
    await updateStore(page, existingData.prices['Tesco'], 'Tesco', 'https://www.tesco.com/groceries/en-GB/search?query=', '.price-per-sellable-unit .value', itemsToScrape);
    await updateStore(page, existingData.prices['Asda'], 'Asda', 'https://groceries.asda.com/search/', '.co-product-list__main-cntr .co-item__price', itemsToScrape);
    await updateStore(page, existingData.prices['Aldi'], 'Aldi', 'https://groceries.aldi.co.uk/en-GB/Search?keywords=', '.product-tile-price .h4', itemsToScrape);
    await updateStore(page, existingData.prices['Morrisons'], 'Morrisons', 'https://groceries.morrisons.com/search?entry=', '.fops-price', itemsToScrape);

    await browser.close();

    const output = {
        lastUpdated: new Date().toLocaleString(),
        prices: existingData.prices // Save the merged data
    };

    fs.writeFileSync('prices.json', JSON.stringify(output, null, 2));
    console.log('✅ Database updated.');
}

async function updateStore(page, storeInventory, storeName, baseUrl, priceSelector, items) {
    for (const item of items) {
        try {
            await page.goto(`${baseUrl}${encodeURIComponent(item)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s

            try {
                await page.waitForSelector(priceSelector, { timeout: 4000 });
                const text = await page.$eval(priceSelector, el => el.textContent.trim());
                const price = parsePrice(text);
                if(price) {
                    storeInventory[item] = price; // Update specific item
                    console.log(`   [${storeName}] Found ${item}: £${price}`);
                }
            } catch (e) {
                console.log(`   [${storeName}] ${item}: Not found`);
            }
        } catch (error) {
            // Ignore nav errors
        }
    }
}

scrapeSupermarkets();
