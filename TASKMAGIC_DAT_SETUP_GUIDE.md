# TaskMagic DAT Scraper Implementation Guide

## Using Your DAT Login Script with TaskMagic

I can see you have a perfectly configured DAT login script that:
✅ Uses correct DAT credentials (dispatch@lampslogistics.com / Anonymous#56111)
✅ Handles 2FA authentication flow
✅ Navigates to DAT One Web properly
✅ Waits for manual 2FA entry

## Integration with TaskMagic Automation

### Step 1: Import Your Script into TaskMagic
1. **Create new automation** in TaskMagic
2. **Add browser action** → "Run Custom JavaScript"
3. **Paste your script** from `dat_login_scraper_1755833174446.js`
4. **Configure browser settings** to match your script

### Step 2: Extend Script for Load Extraction

Add this load scraping logic after the login success:

```javascript
// After successful login and 2FA
console.log("✅ Logged in! Starting load extraction...");

// Navigate to load search
await page.goto('https://www.dat.com/load/search', { waitUntil: 'networkidle2' });

// Set filters for box trucks/sprinter vans
await page.waitForSelector('[data-testid="equipment-filter"]', { timeout: 10000 });

// Equipment type filter
await page.click('[data-testid="equipment-filter"]');
await page.click('input[value="Van"]'); // Dry Van
await page.click('input[value="Reefer"]'); // Reefer if needed
await page.click('input[value="Box Truck"]'); // Box Truck

// Geographic filters (TN, KY, GA, AL, NC, SC, FL)
await page.click('[data-testid="origin-filter"]');
await page.type('[data-testid="origin-input"]', 'TN, KY, GA, AL, NC, SC, FL');

// Rate filters
await page.click('[data-testid="rate-filter"]');
await page.type('[data-testid="min-rate"]', '500'); // Minimum $500

// Apply filters
await page.click('[data-testid="apply-filters"]');
await page.waitForTimeout(3000);

// Extract load data
const loads = await page.evaluate(() => {
    const loadElements = document.querySelectorAll('[data-testid="load-row"]');
    const extractedLoads = [];
    
    loadElements.forEach(element => {
        try {
            const company = element.querySelector('[data-testid="company-name"]')?.textContent?.trim();
            const phone = element.querySelector('[data-testid="phone"]')?.textContent?.trim();
            const route = element.querySelector('[data-testid="route"]')?.textContent?.trim();
            const rate = element.querySelector('[data-testid="rate"]')?.textContent?.trim();
            const equipment = element.querySelector('[data-testid="equipment"]')?.textContent?.trim();
            const commodity = element.querySelector('[data-testid="commodity"]')?.textContent?.trim();
            const weight = element.querySelector('[data-testid="weight"]')?.textContent?.trim();
            const pickupDate = element.querySelector('[data-testid="pickup-date"]')?.textContent?.trim();
            const miles = element.querySelector('[data-testid="miles"]')?.textContent?.trim();
            
            if (company && phone && route && rate) {
                // Parse route
                const [origin, destination] = route.split(' → ');
                const [originCity, originState] = origin.split(', ');
                const [destCity, destState] = destination.split(', ');
                
                // Parse rate
                const rateNumber = parseInt(rate.replace(/[^0-9]/g, ''));
                
                // Map equipment type
                let equipmentMapped = 'dry_van';
                if (equipment?.toLowerCase().includes('reefer')) equipmentMapped = 'reefer';
                if (equipment?.toLowerCase().includes('box')) equipmentMapped = 'box_truck';
                if (equipment?.toLowerCase().includes('sprinter')) equipmentMapped = 'sprinter_van';
                
                extractedLoads.push({
                    company: company,
                    phone: phone,
                    origin_city: originCity,
                    origin_state: originState,
                    destination_city: destCity,
                    destination_state: destState,
                    rate: rateNumber,
                    equipment_type: equipmentMapped,
                    weight: parseInt(weight?.replace(/[^0-9]/g, '')) || 0,
                    commodity: commodity || 'General Freight',
                    pickup_date: pickupDate || new Date().toISOString(),
                    miles: parseInt(miles?.replace(/[^0-9]/g, '')) || 0,
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
return loads; // TaskMagic will use this data
```

### Step 3: Configure TaskMagic Variables

Map the extracted data to these variables in TaskMagic:
- `company_name` → `{{loads[0].company}}`
- `phone_number` → `{{loads[0].phone}}`
- `origin_city` → `{{loads[0].origin_city}}`
- `origin_state` → `{{loads[0].origin_state}}`
- `destination_city` → `{{loads[0].destination_city}}`
- `destination_state` → `{{loads[0].destination_state}}`
- `rate` → `{{loads[0].rate}}`
- `equipment_type` → `{{loads[0].equipment_type}}`
- `weight` → `{{loads[0].weight}}`
- `commodity` → `{{loads[0].commodity}}`
- `pickup_date` → `{{loads[0].pickup_date}}`
- `miles` → `{{loads[0].miles}}`
- `dat_load_id` → `{{loads[0].dat_load_id}}`

### Step 4: Configure Webhook (Already Done ✅)

Your webhook is already configured:
- **URL**: `https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/single-load`
- **Headers**: 
  - `Content-Type: application/json`
  - `x-taskmagic-secret: taskmagic-webhook-secret-2025`

### Step 5: Loop Through Multiple Loads

Configure TaskMagic to loop through all extracted loads:

```javascript
// In TaskMagic, configure a loop action
for (let i = 0; i < loads.length && i < 50; i++) {
    // Send each load individually to LoadMaster
    const loadData = {
        company: loads[i].company,
        phone: loads[i].phone,
        origin_city: loads[i].origin_city,
        origin_state: loads[i].origin_state,
        destination_city: loads[i].destination_city,
        destination_state: loads[i].destination_state,
        rate: loads[i].rate,
        equipment_type: loads[i].equipment_type,
        weight: loads[i].weight,
        commodity: loads[i].commodity,
        pickup_date: loads[i].pickup_date,
        miles: loads[i].miles,
        dat_load_id: loads[i].dat_load_id,
        automation_run_id: loads[i].automation_run_id,
        webhook_secret: loads[i].webhook_secret
    };
    
    // TaskMagic sends this to your webhook
    // Add 2-second delay between loads
    await new Promise(resolve => setTimeout(resolve, 2000));
}
```

### Step 6: Schedule and Monitor

1. **Schedule**: Run every 15-20 minutes during business hours
2. **Monitor**: Check LoadMaster `/taskmagic-status` for results
3. **Verify**: Confirm loads appear in `/dat-loads` tab
4. **Test**: Ensure driver notifications work

## DAT Targeting Strategy

Your script should target:
- **Equipment**: Van, Reefer, Box Truck, Sprinter
- **Weight**: Under 26,000 lbs
- **Regions**: TN, KY, GA, AL, NC, SC, FL
- **Rate Minimum**: $500+
- **Load Limit**: 50 loads per run

## Expected Results

Once configured:
- 20-50 DAT loads per automation run
- Automatic driver notifications via Telegram
- Customer creation for new freight companies
- Full load lifecycle tracking
- Payment processing when completed

Your DAT login script is perfect for TaskMagic integration!