# Your TaskMagic DAT Setup Instructions

## ✅ Integration Ready
Your LoadMaster system is fully configured and ready to receive DAT loads from TaskMagic.

**Your TaskMagic Webhook:** `https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW` ✅ TESTED

## TaskMagic Automation Setup

### 1. Create DAT Login Automation
1. **Open TaskMagic** and create new automation
2. **Name:** "DAT Login - LoadMaster"  
3. **Starting URL:** `https://www.dat.com/login`
4. **Credentials to use:**
   - **Email:** `dispatch@lampslogistics.com`
   - **Password:** `Anonymous#56111`

### 2. Create Load Scraping Automation  
1. **Name:** "DAT Load Scraper - Box Trucks"
2. **Dependencies:** Requires successful DAT login
3. **Target loads:** Box trucks, sprinter vans, straight trucks under 26,000 lbs

### 3. Configure Data Extraction
Map these DAT fields to TaskMagic variables:

```javascript
{
  "company": "Company name from load listing",
  "contact_name": "Contact person name",  
  "phone": "Phone number (555-123-4567 format)",
  "email": "Email address if shown",
  "origin_city": "Pickup city",
  "origin_state": "Pickup state (TN, KY, GA, etc)",
  "destination_city": "Delivery city", 
  "destination_state": "Delivery state",
  "rate": "Load rate as number (1250, not $1,250)",
  "equipment_type": "dry_van",  // Map DAT equipment to our types
  "weight": "Weight in pounds",
  "commodity": "Cargo description", 
  "pickup_date": "2025-08-23T08:00:00Z",  // ISO format
  "delivery_date": "2025-08-24T17:00:00Z", // ISO format (optional)
  "miles": "Distance as number",
  "special_requirements": "Special instructions",
  "hazmat": false,  // Boolean true/false
  "dat_load_id": "DAT's load ID number",
  "automation_run_id": "Your TaskMagic run ID",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

### 4. Equipment Type Mapping
Map DAT equipment types to LoadMaster types:
- **Van** → `dry_van`  
- **Reefer** → `reefer`
- **Flatbed** → `flatbed`
- **Box Truck** → `box_truck`
- **Sprinter** → `sprinter_van`
- **Straight Truck** → `straight_truck`

### 5. Configure Webhook Output
Set TaskMagic to POST scraped data to:

**URL:** `https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW`
**Method:** POST
**Headers:**
```
Content-Type: application/json
```

**Sample Payload:**
```json
{
  "company": "ABC Freight Solutions",
  "contact_name": "John Dispatcher",
  "phone": "555-987-6543",
  "email": "dispatch@abcfreight.com",
  "origin_city": "Nashville",
  "origin_state": "TN", 
  "destination_city": "Atlanta",
  "destination_state": "GA",
  "rate": 1350,
  "equipment_type": "dry_van",
  "weight": 15000,
  "commodity": "Electronics",
  "pickup_date": "2025-08-23T08:00:00Z",
  "delivery_date": "2025-08-24T17:00:00Z",
  "miles": 248,
  "special_requirements": "Appointment required",
  "hazmat": false,
  "dat_load_id": "DAT123456",
  "automation_run_id": "tm_run_789",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

## LoadMaster Will Automatically:
1. ✅ Receive and validate your scraped loads
2. ✅ Create customer records for new freight companies  
3. ✅ Store loads in database with proper formatting
4. ✅ Send Telegram notifications to eligible drivers
5. ✅ Track load lifecycle (available → assigned → delivered)
6. ✅ Generate payments when loads are completed

## Testing Your Integration

### Test 1: Send Sample Load
Use this curl command to test (replace with your Replit URL):
```bash
curl -X POST https://your-replit.app/api/taskmagic/webhook/single-load \
  -H "Content-Type: application/json" \
  -H "x-taskmagic-secret: taskmagic-webhook-secret-2025" \
  -d '{
    "company": "TaskMagic Test Co",
    "phone": "555-123-4567",
    "origin_city": "Nashville", 
    "origin_state": "TN",
    "destination_city": "Atlanta",
    "destination_state": "GA", 
    "rate": 1200,
    "equipment_type": "dry_van",
    "weight": 14000,
    "commodity": "General Freight",
    "pickup_date": "2025-08-23T08:00:00Z",
    "miles": 248
  }'
```

### Test 2: Check Integration Status
Visit `/taskmagic-status` in your LoadMaster dashboard to monitor:
- Total loads processed
- Current load statistics  
- Integration health
- Webhook endpoints

## Recommended Schedule
- **Login Check:** Every 2 hours
- **Load Scraping:** Every 10-15 minutes during business hours
- **Business Hours:** Mon-Fri 6AM-8PM, Sat 8AM-6PM, Sun 10AM-4PM EST

## Target Load Criteria
Focus on loads that match your drivers:
- **Rate:** $800+ minimum
- **Weight:** Under 26,000 lbs
- **Distance:** Under 500 miles  
- **Equipment:** Box trucks, sprinter vans, straight trucks
- **Geography:** TN, KY, GA, AL, NC, SC, FL

## Next Steps
1. ✅ **LoadMaster Integration Complete** 
2. 🔄 **Create TaskMagic DAT login automation**
3. 🔄 **Build load scraping workflow**
4. 🔄 **Configure webhook with your URL**
5. 🔄 **Test with sample loads**
6. 🔄 **Monitor results in LoadMaster dashboard**

Your system is ready to receive and process DAT loads automatically. Configure your TaskMagic automations and start testing!