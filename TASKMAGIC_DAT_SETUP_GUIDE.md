# TaskMagic DAT Automation Setup Guide

## Quick Start Overview

Your LoadMaster system now has complete TaskMagic integration. Here's how to set up automated DAT load scraping:

1. **Create TaskMagic DAT Login Automation**
2. **Build DAT Load Scraping Workflow** 
3. **Configure Webhook Integration**
4. **Test and Monitor Results**

## Step 1: TaskMagic DAT Login Automation

### Create New Automation in TaskMagic:
1. **Name:** "DAT Login Authentication"
2. **Starting URL:** `https://www.dat.com/login`
3. **Browser:** Chrome (recommended)

### Login Sequence:
```
1. Navigate to: https://www.dat.com/login
2. Look for login button/link (may require clicking to reveal form)
3. Enter credentials:
   - Email: dispatch@lampslogistics.com
   - Password: Anonymous#56111
4. Handle 2FA if prompted
5. Wait for successful login redirect
6. Save session cookies for reuse
```

### Key Considerations:
- **Anti-Detection:** Enable TaskMagic's stealth mode
- **Session Persistence:** Save login session for reuse
- **Error Handling:** Add retry logic for login failures
- **2FA Support:** Include prompts for 2FA codes if required

## Step 2: DAT Load Scraping Automation

### Create Second Automation:
1. **Name:** "DAT Load Board Scraper"
2. **Dependency:** Requires successful DAT login
3. **Target:** DAT load search results

### Scraping Configuration:

#### Equipment Filter Settings:
```
- Box Trucks (26ft and under)
- Sprinter Vans 
- Straight Trucks
- Dry Vans (if available)
```

#### Geographic Targeting:
```
Origin States: TN, KY, GA, AL, NC, SC, FL
Destination States: TN, KY, GA, AL, NC, SC, FL
Radius: 150 miles from major TN cities
```

#### Data Extraction Points:
Extract these fields for each load:

**Company Information:**
- Company name
- Contact person name
- Phone number
- Email address (if available)

**Load Details:**
- Origin city and state
- Destination city and state
- Pickup date and time
- Delivery date and time (if specified)
- Rate/payment amount
- Equipment type required
- Load weight
- Commodity/cargo description
- Distance in miles
- Special requirements
- Hazmat indicator
- DAT load ID number

#### Sample Extraction Mapping:
```javascript
{
  company: "Text from company name field",
  contact_name: "Text from contact person",
  phone: "Text from phone number (format: 555-123-4567)",
  email: "Text from email field",
  origin_city: "Origin city text",
  origin_state: "Origin state abbreviation",
  destination_city: "Destination city text", 
  destination_state: "Destination state abbreviation",
  rate: "Numeric rate value",
  equipment_type: "dry_van|reefer|flatbed|box_truck|sprinter_van",
  weight: "Numeric weight in pounds",
  commodity: "Text description of cargo",
  pickup_date: "YYYY-MM-DDTHH:mm:ss format",
  miles: "Numeric distance",
  special_requirements: "Any special instructions",
  hazmat: "true/false",
  dat_load_id: "DAT's internal load ID"
}
```

## Step 3: Webhook Integration Setup

### Configure TaskMagic Webhooks:

**Your TaskMagic Webhook URL:** `https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW`

#### LoadMaster Endpoints (TaskMagic sends TO these):
- **Single Load Processing:** `${window.location.origin}/api/taskmagic/webhook/single-load`
- **Batch Load Processing:** `${window.location.origin}/api/taskmagic/webhook/batch-loads`

#### TaskMagic Configuration:
1. **Use your provided webhook URL:** `https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW`
2. **Method:** POST
3. **Headers:** 
   ```
   Content-Type: application/json
   x-taskmagic-secret: taskmagic-webhook-secret-2025
   ```
4. **Forward scraped data to LoadMaster endpoints above**
- **Payload Format:**
  ```json
  {
    "loads": [
      { /* load data 1 */ },
      { /* load data 2 */ },
      { /* load data 3 */ }
    ]
  }
  ```

### Webhook Authentication:
Add the secret key to your payload:
```json
{
  "webhook_secret": "taskmagic-webhook-secret-2025",
  "company": "...",
  "phone": "...",
  ...
}
```

## Step 4: Automation Scheduling

### Recommended Schedule:
- **Login Check:** Every 2 hours
- **Load Scraping:** Every 10-15 minutes during business hours
- **Batch Processing:** Process 10-20 loads per webhook call
- **Off-Hours:** Reduced frequency (every 30 minutes)

### Business Hours Focus:
```
Monday-Friday: 6 AM - 8 PM EST
Saturday: 8 AM - 6 PM EST  
Sunday: 10 AM - 4 PM EST
```

## Step 5: Error Handling & Monitoring

### TaskMagic Error Handling:
1. **Login Failures:** Retry with exponential backoff
2. **Page Structure Changes:** Alert system and pause automation
3. **Rate Limiting:** Implement delays between requests
4. **Session Expiry:** Automatic re-authentication

### LoadMaster Monitoring:
Check integration status:
```bash
curl https://your-replit-app.replit.app/api/taskmagic/status
```

### Success Indicators:
- ✅ Loads appearing in DAT Loads tab
- ✅ Automatic driver notifications sent
- ✅ Load status tracking functional
- ✅ Customer records created automatically

## Step 6: Testing & Validation

### Test Payload Example:
```json
{
  "company": "TaskMagic Test Freight",
  "contact_name": "John Dispatcher",
  "phone": "555-987-6543",
  "email": "dispatch@testfreight.com",
  "origin_city": "Nashville",
  "origin_state": "TN",
  "destination_city": "Atlanta", 
  "destination_state": "GA",
  "rate": 1400,
  "equipment_type": "dry_van",
  "weight": 18000,
  "commodity": "General Freight",
  "pickup_date": "2025-08-23T09:00:00Z",
  "delivery_date": "2025-08-24T15:00:00Z",
  "miles": 248,
  "special_requirements": "Dock high delivery required",
  "hazmat": false,
  "dat_load_id": "DAT789012",
  "automation_run_id": "tm_test_456",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

### Test Command:
```bash
curl -X POST https://your-replit-app.replit.app/api/taskmagic/webhook/single-load \
  -H "Content-Type: application/json" \
  -H "x-taskmagic-secret: taskmagic-webhook-secret-2025" \
  -d @test-load.json
```

## Expected Results After Setup:

### Immediate Benefits:
1. **Automated DAT Scraping:** No more manual website navigation
2. **Real Load Data:** Authentic DAT loads processed automatically  
3. **Driver Notifications:** Instant Telegram alerts to eligible drivers
4. **Load Management:** Full lifecycle tracking in LoadMaster dashboard
5. **Customer Database:** Automatic customer record creation
6. **Cost Savings:** Eliminate VA manual entry costs

### Performance Targets:
- **Load Volume:** 50-200 loads per day (depending on market)
- **Processing Speed:** < 2 seconds per load
- **Driver Response Time:** < 30 seconds for Telegram notifications
- **Success Rate:** > 95% successful load processing

## Troubleshooting Common Issues:

### TaskMagic Side:
- **Login Failures:** Check DAT credentials, handle 2FA
- **Scraping Errors:** Verify selectors, handle dynamic content
- **Rate Limiting:** Add delays, use residential proxies if needed

### LoadMaster Side:
- **Webhook Failures:** Check endpoint URLs and authentication
- **Data Validation:** Ensure all required fields are provided
- **Driver Notifications:** Verify Telegram bot configuration

## Advanced Configuration:

### Load Filtering:
Configure TaskMagic to only scrape loads matching:
- Rate > $800 minimum
- Weight < 26,000 lbs (box truck compatible)
- Distance < 500 miles
- No hazmat requirements
- Pickup within 48 hours

### Priority Routing:
High-value loads (>$2000) get immediate processing and priority driver notifications.

## Next Steps:

1. **Log into TaskMagic** and create the DAT login automation
2. **Build the load scraping workflow** using the field mappings above  
3. **Configure webhooks** with your Replit app URLs
4. **Test with sample data** to verify integration
5. **Monitor performance** and adjust scraping frequency
6. **Scale up** once system is stable

Your TaskMagic + LoadMaster integration will provide automated DAT load acquisition with proven driver dispatch capabilities, solving the automation challenge while maintaining your existing workflow advantages.