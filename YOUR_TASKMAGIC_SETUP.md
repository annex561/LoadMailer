# Complete TaskMagic DAT Automation Setup

## Step 1: Create New TaskMagic Automation

1. **Open TaskMagic** and create new automation
2. **Name it**: "DAT Load Scraper" 
3. **Add Browser Action** → "Custom JavaScript"

## Step 2: Configure Browser Settings

- **Headless**: No (keep visible)
- **Viewport**: Maximized
- **Timeout**: 60 seconds

## Step 3: Import Complete Script

Copy and paste the entire `TASKMAGIC_COMPLETE_AUTOMATION.js` script into TaskMagic.

**IMPORTANT**: Replace `[YOUR-REPLIT-DOMAIN]` with your actual Replit domain in line 167:
```javascript
const webhookUrl = 'https://YOUR-ACTUAL-DOMAIN.replit.app/api/taskmagic/webhook/single-load';
```

## Step 4: Configure Variables (Optional)

The script is self-contained, but you can create these TaskMagic variables if needed:
- `extracted_loads` → `{{loads}}`
- `total_loads` → `{{loads.length}}`

## Step 5: Test Automation

1. **Run manually** first to test
2. **Monitor console** for load extraction progress
3. **Check LoadMaster** `/taskmagic-status` for incoming loads
4. **Verify** loads appear in `/dat-loads` tab

## Step 6: Schedule Automation

**Recommended Schedule:**
- **Frequency**: Every 20 minutes
- **Days**: Monday-Friday
- **Hours**: 8 AM - 6 PM EST
- **Max Runtime**: 10 minutes

## Step 7: Monitor Results

**LoadMaster Endpoints to Check:**
- `/taskmagic-status` → Integration health
- `/dat-loads` → View incoming loads
- `/drivers` → Check driver notifications

## What This Script Does

✅ **Logs into DAT** with your credentials  
✅ **Handles 2FA** (manual entry required)  
✅ **Sets up filters** for target equipment and regions  
✅ **Extracts load data** using multiple detection methods  
✅ **Sends to LoadMaster** via webhook  
✅ **Processes up to 50 loads** per run  
✅ **Includes rate limits** and error handling  

## Expected Results

Once running:
- **20-50 DAT loads** processed per automation run
- **Automatic driver notifications** via Telegram
- **Customer creation** for new freight companies  
- **Load lifecycle tracking** from available → assigned → delivered
- **Payment processing** when loads complete

## Troubleshooting

**If no loads extracted:**
- Check DAT website structure hasn't changed
- Verify filters are applying correctly
- Ensure 2FA login completed successfully

**If webhook fails:**
- Verify LoadMaster domain is correct
- Check `/taskmagic-status` endpoint is accessible
- Confirm headers and secret match

Your automation is ready to replace manual VA data entry with automated DAT scraping!