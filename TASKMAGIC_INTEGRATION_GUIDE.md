# TaskMagic DAT Load Integration - Step by Step

## Your Current Setup ✅
- **TaskMagic Webhook**: `https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW` (TESTED & WORKING)
- **LoadMaster Ready**: All endpoints configured and tested
- **DAT Credentials**: `dispatch@lampslogistics.com` / `Anonymous#56111`

## Step 1: Create DAT Scraping Automation in TaskMagic

### 1.1 Start New Automation
1. Open TaskMagic dashboard
2. Click "Add new automation"
3. Name: "DAT Load Scraper for LoadMaster"

### 1.2 Configure DAT Login
1. **Starting URL**: `https://www.dat.com/login`
2. **Add login steps**:
   - Click email field, enter: `dispatch@lampslogistics.com`
   - Click password field, enter: `Anonymous#56111`
   - Click "Sign In" button
   - Handle 2FA if prompted (check email for code)

### 1.3 Navigate to Load Search
After successful login:
1. Navigate to: `https://www.dat.com/?s=loads`
2. Set equipment filters for: Box trucks, Sprinter vans, Straight trucks
3. Set weight limit: Under 26,000 lbs
4. Set geography: TN, KY, GA, AL, NC, SC, FL

## Step 2: Configure Data Extraction

### 2.1 Set Up Load Scraping Loop
Create a loop to extract each load with these fields:

**Company Information:**
- `company` → Extract company name from load listing
- `contact_name` → Extract contact person (if available)
- `phone` → Extract phone number in format: 555-123-4567
- `email` → Extract email if shown

**Route Information:**
- `origin_city` → Extract pickup city (e.g., "Nashville")
- `origin_state` → Extract pickup state (e.g., "TN")
- `destination_city` → Extract delivery city (e.g., "Atlanta")
- `destination_state` → Extract delivery state (e.g., "GA")
- `miles` → Extract distance as number only (e.g., 248)

**Load Details:**
- `rate` → Extract rate as number only (e.g., 1350, not $1,350)
- `weight` → Extract weight in pounds (e.g., 15000)
- `commodity` → Extract cargo description (e.g., "Electronics")
- `equipment_type` → Map to: "dry_van", "reefer", "flatbed", "box_truck", "sprinter_van"

**Dates:**
- `pickup_date` → Format as: "2025-08-23T08:00:00Z"
- `delivery_date` → Format as: "2025-08-24T17:00:00Z" (optional)

**Additional:**
- `special_requirements` → Extract special instructions
- `hazmat` → Set to true/false for hazmat loads
- `dat_load_id` → Extract DAT's load ID number

## Step 3: Configure Webhook Output

### 3.1 Webhook Settings
For each scraped load, configure TaskMagic to send:

**Method**: POST
**URL**: Your LoadMaster endpoint (see Step 3.2)
**Headers**:
```
Content-Type: application/json
x-taskmagic-secret: taskmagic-webhook-secret-2025
```

### 3.2 Choose Integration Method

**Option A: Direct to LoadMaster (Recommended)**
Send directly to your LoadMaster system:
```
URL: https://your-replit-domain.replit.app/api/taskmagic/webhook/single-load
```

**Option B: Via TaskMagic Webhook**
Send to your TaskMagic webhook first:
```
URL: https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW
```

### 3.3 Payload Structure
Configure TaskMagic to send this JSON structure:

```json
{
  "company": "{{extracted_company}}",
  "contact_name": "{{extracted_contact}}",
  "phone": "{{extracted_phone}}",
  "email": "{{extracted_email}}",
  "origin_city": "{{extracted_origin_city}}",
  "origin_state": "{{extracted_origin_state}}",
  "destination_city": "{{extracted_dest_city}}",
  "destination_state": "{{extracted_dest_state}}",
  "rate": {{extracted_rate}},
  "equipment_type": "{{mapped_equipment}}",
  "weight": {{extracted_weight}},
  "commodity": "{{extracted_commodity}}",
  "pickup_date": "{{formatted_pickup_date}}",
  "delivery_date": "{{formatted_delivery_date}}",
  "miles": {{extracted_miles}},
  "special_requirements": "{{extracted_special}}",
  "hazmat": {{extracted_hazmat}},
  "dat_load_id": "{{extracted_load_id}}",
  "automation_run_id": "{{taskmagic_run_id}}",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

## Step 4: Equipment Type Mapping

Map DAT equipment types to LoadMaster types:
- **Van** or **Dry Van** → `"dry_van"`
- **Reefer** or **Refrigerated** → `"reefer"`
- **Flatbed** → `"flatbed"`
- **Box Truck** → `"box_truck"`
- **Sprinter** → `"sprinter_van"`
- **Straight Truck** → `"straight_truck"`

## Step 5: Configure Automation Schedule

### 5.1 Recommended Schedule
- **Business Hours**: Every 10-15 minutes (Mon-Fri 6AM-8PM EST)
- **Off Hours**: Every 30 minutes
- **Weekends**: Every 20 minutes (Sat 8AM-6PM, Sun 10AM-4PM)

### 5.2 Load Targeting
Focus on loads that match your drivers:
- **Minimum Rate**: $800+
- **Maximum Weight**: 26,000 lbs
- **Distance**: Under 500 miles preferred
- **Target States**: TN, KY, GA, AL, NC, SC, FL

## Step 6: Test Your Integration

### 6.1 Manual Test
1. Run your TaskMagic automation manually
2. Scrape 1-2 test loads from DAT
3. Send them to LoadMaster via webhook
4. Check results in LoadMaster `/taskmagic-status` page

### 6.2 Verify Results
Check that loads appear in:
- **TaskMagic Status**: `/taskmagic-status` in LoadMaster
- **DAT Loads Tab**: `/dat-loads` to see processed loads
- **Driver Notifications**: Eligible drivers receive Telegram alerts

### 6.3 Sample Test Data
You can also test with this sample payload:
```bash
curl -X POST https://your-replit.app/api/taskmagic/webhook/single-load \
  -H "Content-Type: application/json" \
  -H "x-taskmagic-secret: taskmagic-webhook-secret-2025" \
  -d '{
    "company": "Test DAT Company",
    "phone": "555-123-4567",
    "origin_city": "Nashville",
    "origin_state": "TN",
    "destination_city": "Atlanta",
    "destination_state": "GA",
    "rate": 1200,
    "equipment_type": "dry_van",
    "weight": 15000,
    "commodity": "General Freight",
    "pickup_date": "2025-08-23T08:00:00Z",
    "miles": 248
  }'
```

## Step 7: Monitor and Scale

### 7.1 Performance Monitoring
- Check LoadMaster `/taskmagic-status` for integration health
- Monitor load processing rates and success ratios
- Watch for any webhook failures or errors

### 7.2 Scale Up
Once testing successfully:
1. Increase scraping frequency during peak hours
2. Add more equipment types if needed
3. Expand geographic coverage
4. Monitor driver capacity and load volume

## Expected Results

Once configured correctly:
- **Automated Load Flow**: DAT loads appear in LoadMaster within 30 seconds
- **Driver Notifications**: Eligible drivers receive Telegram alerts automatically
- **Customer Creation**: New freight companies added to database
- **Load Tracking**: Full lifecycle from available → assigned → delivered
- **Payment Processing**: Automatic payment generation when loads complete

Your TaskMagic webhook is confirmed working - follow these steps to scrape real DAT loads and send them to LoadMaster!