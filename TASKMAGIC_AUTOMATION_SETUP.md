# TaskMagic Automation Configuration - Complete Setup

## Quick Setup Overview

**What You Need to Do in TaskMagic:**
1. Create DAT login automation 
2. Build load scraping workflow
3. Configure webhook to send loads to LoadMaster
4. Schedule automation to run every 10-15 minutes

**Your LoadMaster Endpoint:** 
Replace `[YOUR-REPLIT-DOMAIN]` with your actual Replit URL from browser:
```
https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/single-load
```

## Step-by-Step TaskMagic Configuration

### 1. Create New Automation
1. Log into TaskMagic dashboard
2. Click "Add new automation"
3. Name: "DAT Load Scraper - LoadMaster Integration"
4. Description: "Scrapes DAT loads and sends to LoadMaster for dispatch"

### 2. Configure DAT Login Sequence

**Starting URL:** `https://www.dat.com/login`

**Login Actions:**
1. **Wait for page load** (2 seconds)
2. **Click email field** and enter: `dispatch@lampslogistics.com`
3. **Click password field** and enter: `Anonymous#56111`
4. **Click "Sign In" button**
5. **Handle 2FA if prompted:**
   - Wait for 2FA screen
   - Check email: `dispatch@lampslogistics.com`
   - Enter verification code from email
   - Click "Verify" or "Continue"

### 3. Navigate to Load Search

After successful login:
1. **Navigate to:** `https://www.dat.com/?s=loads`
2. **Wait for load board to load** (3 seconds)
3. **Set filters:**
   - Equipment: Box trucks, Sprinter vans, Straight trucks
   - Weight: Maximum 26,000 lbs
   - Geography: TN, KY, GA, AL, NC, SC, FL

### 4. Configure Load Data Extraction

**Set up loop to extract each load with these selectors:**

**Company Information:**
- `company` → Extract company name from load listing
- `phone` → Extract phone number (look for format: 555-123-4567)
- `contact_name` → Extract contact person if available
- `email` → Extract email if shown

**Route Details:**
- `origin_city` → Extract pickup city (e.g., "Nashville")
- `origin_state` → Extract pickup state (e.g., "TN") 
- `destination_city` → Extract delivery city (e.g., "Atlanta")
- `destination_state` → Extract delivery state (e.g., "GA")
- `miles` → Extract distance as number only (e.g., 248)

**Load Information:**
- `rate` → Extract rate as number only (remove $ and commas)
- `weight` → Extract weight in pounds
- `commodity` → Extract cargo description
- `pickup_date` → Extract pickup date, format as ISO: "2025-08-23T08:00:00Z"
- `delivery_date` → Extract delivery date if available, format as ISO

**Equipment Mapping:**
Map DAT equipment types to these values:
- Van/Dry Van → `"dry_van"`
- Reefer → `"reefer"`
- Flatbed → `"flatbed"`
- Box Truck → `"box_truck"`
- Sprinter → `"sprinter_van"`
- Straight Truck → `"straight_truck"`

### 5. Configure Webhook Output

**For each scraped load, send HTTP POST to:**

**URL:** `https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/single-load`

**Method:** POST

**Headers:**
```
Content-Type: application/json
x-taskmagic-secret: taskmagic-webhook-secret-2025
```

**JSON Payload Structure:**
```json
{
  "company": "{{company_variable}}",
  "contact_name": "{{contact_name_variable}}",
  "phone": "{{phone_variable}}",
  "email": "{{email_variable}}",
  "origin_city": "{{origin_city_variable}}",
  "origin_state": "{{origin_state_variable}}",
  "destination_city": "{{destination_city_variable}}",
  "destination_state": "{{destination_state_variable}}",
  "rate": {{rate_variable}},
  "equipment_type": "{{equipment_type_variable}}",
  "weight": {{weight_variable}},
  "commodity": "{{commodity_variable}}",
  "pickup_date": "{{pickup_date_variable}}",
  "delivery_date": "{{delivery_date_variable}}",
  "miles": {{miles_variable}},
  "special_requirements": "{{special_requirements_variable}}",
  "hazmat": {{hazmat_variable}},
  "dat_load_id": "{{dat_load_id_variable}}",
  "automation_run_id": "{{taskmagic_run_id}}",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

### 6. Error Handling

**Add error handling for:**
- Login failures (retry up to 3 times)
- 2FA timeout (wait up to 60 seconds for code)
- Page load failures (refresh and retry)
- No loads found (log and continue)
- Webhook failures (retry up to 2 times)

### 7. Automation Schedule

**Recommended Schedule:**
- **Business Hours:** Every 10 minutes (Mon-Fri 6AM-8PM EST)
- **Off Hours:** Every 30 minutes
- **Weekends:** Every 20 minutes (Sat 8AM-6PM, Sun 10AM-4PM)

**Load Targeting Criteria:**
- Minimum rate: $800+
- Maximum weight: 26,000 lbs
- Maximum distance: 500 miles
- Target equipment: Box trucks, sprinters, straight trucks
- Geographic focus: TN, KY, GA, AL, NC, SC, FL

### 8. Testing Your Automation

**Test Steps:**
1. Run automation manually first
2. Verify DAT login works with provided credentials
3. Check that loads are being extracted correctly
4. Confirm webhook sends to LoadMaster successfully
5. Monitor LoadMaster `/taskmagic-status` for incoming loads

**Expected Results:**
- Loads appear in LoadMaster DAT Loads tab within 30 seconds
- Eligible drivers receive Telegram notifications automatically
- New freight companies added to LoadMaster database
- Full load lifecycle tracking begins

## Sample Test Payload

You can test LoadMaster endpoint with this sample:

```bash
curl -X POST https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/single-load \
  -H "Content-Type: application/json" \
  -H "x-taskmagic-secret: taskmagic-webhook-secret-2025" \
  -d '{
    "company": "TaskMagic Test Freight Co",
    "contact_name": "Test Dispatcher",
    "phone": "555-888-9999",
    "email": "test@taskmagicfreight.com",
    "origin_city": "Nashville",
    "origin_state": "TN",
    "destination_city": "Atlanta",
    "destination_state": "GA",
    "rate": 1250,
    "equipment_type": "dry_van",
    "weight": 18000,
    "commodity": "General Freight",
    "pickup_date": "2025-08-23T09:00:00Z",
    "delivery_date": "2025-08-24T17:00:00Z",
    "miles": 248,
    "special_requirements": "Appointment required",
    "hazmat": false,
    "dat_load_id": "TM12345",
    "automation_run_id": "taskmagic_test_run"
  }'
```

## Monitor Integration

**LoadMaster Monitoring:**
- **Status Dashboard:** `/taskmagic-status`
- **Incoming Loads:** `/dat-loads`
- **Driver Notifications:** `/telegram-dispatching`

**Success Indicators:**
- Loads processed successfully counter increases
- No webhook failures in TaskMagic logs
- Driver Telegram notifications being sent
- Load status updates in LoadMaster

Your LoadMaster system is fully configured and ready to receive DAT loads from TaskMagic automation.