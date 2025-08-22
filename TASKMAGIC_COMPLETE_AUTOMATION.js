const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();

    console.log("🟢 Navigating to DAT.com...");
    await page.goto('https://www.dat.com', { waitUntil: 'networkidle2' });

    // Click "Carriers" → "DAT One Web"
    await page.waitForSelector('a[title="Carriers"]', { timeout: 15000 });
    await page.click('a[title="Carriers"]');

    await page.waitForTimeout(1000);
    const [link] = await page.$x("//a[contains(text(), 'DAT One Web')]");
    if (link) {
        await link.click();
    } else {
        console.log("❌ Could not find DAT One Web link.");
        await browser.close();
        return;
    }

    // Wait for login fields
    await page.waitForSelector('input[name="username"]', { timeout: 15000 });
    await page.type('input[name="username"]', 'dispatch@lampslogistics.com', { delay: 100 });
    await page.type('input[name="password"]', 'Anonymous#56111', { delay: 100 });

    console.log("🔐 Submitting login...");
    await page.click('button[type="submit"]');

    console.log("⏳ Waiting for you to manually enter the 2FA code...");
    await page.waitForNavigation({ timeout: 0 });

    console.log("✅ Logged in! Starting load extraction...");

    // Navigate to load search
    try {
        await page.goto('https://one.dat.com/load-search', { waitUntil: 'networkidle2', timeout: 30000 });
        console.log("📍 Navigated to load search page");
    } catch (error) {
        console.log("⚠️ Direct navigation failed, trying alternative...");
        await page.waitForSelector('a[href*="load"], a[href*="search"]', { timeout: 10000 });
        await page.click('a[href*="load"], a[href*="search"]');
        await page.waitForTimeout(3000);
    }

    // Set up filters for our target loads
    console.log("🔧 Setting up filters...");
    
    try {
        // Equipment filter - target box trucks, sprinter vans, dry vans
        const equipmentSelectors = [
            'input[value*="Van"]',
            'input[value*="van"]', 
            'input[value*="Box"]',
            'input[value*="Straight"]',
            'select[name*="equipment"] option[value*="Van"]',
            'select[name*="equipment"] option[value*="Box"]'
        ];
        
        for (const selector of equipmentSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.click(selector);
                console.log(`✅ Selected equipment: ${selector}`);
                break;
            } catch (e) {
                continue;
            }
        }

        // Geographic filter - target southeastern states
        const originSelectors = [
            'input[name*="origin"]',
            'input[placeholder*="Origin"]',
            'input[placeholder*="origin"]',
            '#origin-input'
        ];
        
        for (const selector of originSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.type(selector, 'TN, KY, GA, AL, NC, SC, FL');
                console.log("✅ Set geographic filter");
                break;
            } catch (e) {
                continue;
            }
        }

        // Rate filter - minimum $500
        const rateSelectors = [
            'input[name*="rate"]',
            'input[placeholder*="Rate"]',
            'input[name*="min"]'
        ];
        
        for (const selector of rateSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.clear(selector);
                await page.type(selector, '500');
                console.log("✅ Set minimum rate filter");
                break;
            } catch (e) {
                continue;
            }
        }

        // Apply filters
        const searchButtons = [
            'button[type="submit"]',
            'button:contains("Search")',
            'button:contains("Apply")',
            '.search-button',
            '#search-btn'
        ];
        
        for (const selector of searchButtons) {
            try {
                await page.waitForSelector(selector, { timeout: 2000 });
                await page.click(selector);
                console.log("✅ Applied filters");
                break;
            } catch (e) {
                continue;
            }
        }

        await page.waitForTimeout(5000);
        
    } catch (error) {
        console.log("⚠️ Filter setup had issues, continuing with default search...");
    }

    // Extract load data from the page
    console.log("📋 Extracting load data...");
    
    const loads = await page.evaluate(() => {
        const extractedLoads = [];
        
        // Multiple possible selectors for load rows
        const loadRowSelectors = [
            '.load-row',
            '.search-result',
            'tr[data-load-id]',
            '.load-item',
            '[data-testid*="load"]',
            '.result-row'
        ];
        
        let loadElements = [];
        for (const selector of loadRowSelectors) {
            loadElements = document.querySelectorAll(selector);
            if (loadElements.length > 0) break;
        }
        
        // If no specific load rows found, try table rows
        if (loadElements.length === 0) {
            loadElements = document.querySelectorAll('table tr, .table tr');
        }
        
        loadElements.forEach((element, index) => {
            try {
                // Extract text content from the row
                const text = element.textContent || element.innerText || '';
                
                // Skip header rows and empty rows
                if (text.toLowerCase().includes('company') || text.toLowerCase().includes('rate') || text.trim().length < 50) {
                    return;
                }
                
                // Look for phone numbers (various formats)
                const phoneMatch = text.match(/(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/);
                if (!phoneMatch) return; // Skip if no phone number found
                
                // Look for rates ($XXX or XXX)
                const rateMatch = text.match(/\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
                if (!rateMatch) return; // Skip if no rate found
                
                // Look for state abbreviations (for origin/destination)
                const stateMatches = text.match(/\b[A-Z]{2}\b/g);
                if (!stateMatches || stateMatches.length < 2) return; // Need at least origin and destination
                
                // Look for city names (capitalized words before state abbreviations)
                const cityStatePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s*([A-Z]{2})/g;
                const cityStateMatches = [...text.matchAll(cityStatePattern)];
                
                if (cityStateMatches.length < 2) return; // Need origin and destination
                
                // Extract company name (usually first capitalized text or near beginning)
                const companyMatch = text.match(/^[^a-z]*([A-Z][A-Za-z\s&.-]+(?:LLC|Inc|Corp|Co)?)/);
                const company = companyMatch ? companyMatch[1].trim() : `Freight Company ${index + 1}`;
                
                // Parse data
                const phone = phoneMatch[0];
                const rate = parseInt(rateMatch[1].replace(/[^0-9]/g, ''));
                const originCity = cityStateMatches[0][1];
                const originState = cityStateMatches[0][2];
                const destCity = cityStateMatches[1][1];
                const destState = cityStateMatches[1][2];
                
                // Look for equipment type keywords
                let equipmentType = 'dry_van'; // default
                const lowerText = text.toLowerCase();
                if (lowerText.includes('reefer') || lowerText.includes('refrigerat')) equipmentType = 'reefer';
                if (lowerText.includes('flatbed') || lowerText.includes('flat')) equipmentType = 'flatbed';
                if (lowerText.includes('box') || lowerText.includes('straight')) equipmentType = 'box_truck';
                if (lowerText.includes('sprinter') || lowerText.includes('cargo van')) equipmentType = 'sprinter_van';
                
                // Look for weight
                const weightMatch = text.match(/(\d{1,2}[,.]?\d{0,3})\s*(?:lbs?|pounds?|#)/i);
                const weight = weightMatch ? parseInt(weightMatch[1].replace(/[^0-9]/g, '')) : 0;
                
                // Look for miles
                const milesMatch = text.match(/(\d{1,4})\s*(?:mi|miles?)/i);
                const miles = milesMatch ? parseInt(milesMatch[1]) : 0;
                
                // Only include loads with minimum viable data and reasonable rates
                if (rate >= 500 && rate <= 10000 && company.length > 3) {
                    extractedLoads.push({
                        company: company,
                        phone: phone,
                        origin_city: originCity,
                        origin_state: originState,
                        destination_city: destCity,
                        destination_state: destState,
                        rate: rate,
                        equipment_type: equipmentType,
                        weight: weight,
                        commodity: 'General Freight',
                        pickup_date: new Date().toISOString().split('T')[0] + 'T08:00:00Z',
                        miles: miles,
                        dat_load_id: `DAT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        automation_run_id: 'taskmagic_dat_scraper',
                        webhook_secret: 'taskmagic-webhook-secret-2025'
                    });
                }
                
            } catch (error) {
                console.log('Error extracting load:', error);
            }
        });
        
        return extractedLoads;
    });

    console.log(`🎯 Extracted ${loads.length} loads from DAT`);
    
    // Send loads to LoadMaster webhook (replace with your actual domain)
    const webhookUrl = 'https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/single-load';
    
    for (let i = 0; i < loads.length && i < 50; i++) {
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-taskmagic-secret': 'taskmagic-webhook-secret-2025'
                },
                body: JSON.stringify(loads[i])
            });
            
            if (response.ok) {
                console.log(`✅ Sent load ${i + 1}: ${loads[i].company} - ${loads[i].origin_city}, ${loads[i].origin_state} → ${loads[i].destination_city}, ${loads[i].destination_state} ($${loads[i].rate})`);
            } else {
                console.log(`❌ Failed to send load ${i + 1}: ${response.status}`);
            }
            
            // 2 second delay between requests
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            console.log(`❌ Error sending load ${i + 1}:`, error);
        }
    }
    
    console.log(`🏁 Completed processing ${loads.length} loads`);
    
    // Keep browser open for manual review if needed
    console.log("🔍 Browser staying open for manual review. Close when ready.");
    
    // Return loads for TaskMagic to use
    return loads;
})();