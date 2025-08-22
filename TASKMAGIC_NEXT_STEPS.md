# TaskMagic DAT Configuration - Next Steps

## ✅ Confirmed Working
Your TaskMagic automation successfully captured our test webhook data! I can see in your screenshot that TaskMagic recorded:
- **timestamp**: 2025-08-22T00:21:30Z  
- **message**: LoadMaster integration test
- **loadmaster_endpoint**: Your correct LoadMaster URL

## Configure Your TaskMagic DAT Scraper

### 1. Modify Current Automation to Scrape DAT
Update your existing automation to scrape actual DAT load data instead of test data.

### 2. DAT Login Steps in TaskMagic:
1. **Navigate to**: `https://www.dat.com/login`
2. **Enter credentials**:
   - Email: `dispatch@lampslogistics.com`
   - Password: `Anonymous#56111`
3. **Handle 2FA** if prompted
4. **Navigate to load search** after successful login

### 3. Configure Load Scraping
Set up TaskMagic to extract these fields from DAT load listings:

**Required Fields:**
```
company → Company name
phone → Phone number
origin_city → Pickup city  
origin_state → Pickup state
destination_city → Delivery city
destination_state → Delivery state
rate → Load rate (number only, no $ symbol)
equipment_type → "dry_van" (or map from DAT equipment)
commodity → Cargo description
pickup_date → "2025-08-23T08:00:00Z" (ISO format)
miles → Distance (number only)
weight → Load weight in pounds
```

**Optional Fields:**
```
contact_name → Contact person
email → Email if available
delivery_date → Delivery date in ISO format
special_requirements → Special instructions
hazmat → true/false for hazmat loads
dat_load_id → DAT's load ID
```

### 4. Update Webhook Payload
Modify your TaskMagic automation to send this data structure:

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
  "automation_run_id": "taskmagic_run_789",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

### 5. Equipment Type Mapping
Map DAT equipment to LoadMaster types:
- **Van/Dry Van** → `"dry_van"`
- **Reefer** → `"reefer"`  
- **Flatbed** → `"flatbed"`
- **Box Truck** → `"box_truck"`
- **Sprinter** → `"sprinter_van"`
- **Straight Truck** → `"straight_truck"`

### 6. Target Load Criteria
Focus on loads that match your drivers:
- **Weight**: Under 26,000 lbs
- **Equipment**: Box trucks, sprinter vans, straight trucks
- **Geography**: TN, KY, GA, AL, NC, SC, FL
- **Rate**: $800+ minimum

### 7. Webhook Configuration
Keep using your existing webhook URL:
- **URL**: `https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW`
- **Method**: POST
- **Headers**: Content-Type: application/json

But instead of sending to your TaskMagic webhook, configure it to send scraped DAT loads directly to:
- **LoadMaster URL**: Use the `loadmaster_endpoint` value from your captured data
- **Endpoint**: `/api/taskmagic/webhook/single-load`
- **Full URL**: `https://your-replit-domain.replit.app/api/taskmagic/webhook/single-load`

### 8. Test Workflow
1. **Scrape 1-2 loads** from DAT using TaskMagic
2. **Send to LoadMaster** using the webhook
3. **Check results** in LoadMaster `/taskmagic-status` and `/dat-loads`
4. **Verify driver notifications** are sent via Telegram
5. **Scale up** to scrape every 10-15 minutes

## Expected Results
Once configured correctly:
- DAT loads appear in LoadMaster within seconds
- Eligible drivers receive Telegram notifications
- Load lifecycle tracking begins automatically
- Customer records created for new companies
- Full integration with existing dispatch workflow

## Monitor Success
- **TaskMagic Status**: `/taskmagic-status` in LoadMaster
- **DAT Loads**: `/dat-loads` to see incoming loads  
- **Driver Activity**: `/telegram-dispatching` for notifications

Your TaskMagic integration is confirmed working - now configure it to scrape real DAT loads using the data structure above!