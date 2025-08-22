# TaskMagic Webhook Endpoints for Your Setup

## Your LoadMaster System Details

**Your Replit Domain**: Use your actual Replit app URL (check browser address bar)
**Your TaskMagic Webhook**: `https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW` ✅

## Method 1: Direct Integration (Recommended)

Send scraped DAT loads directly from TaskMagic to LoadMaster:

### Single Load Endpoint
```
URL: https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/single-load
Method: POST
Headers:
  Content-Type: application/json
  x-taskmagic-secret: taskmagic-webhook-secret-2025
```

### Batch Loads Endpoint (if scraping multiple loads)
```
URL: https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/batch-loads
Method: POST
Headers:
  Content-Type: application/json
  x-taskmagic-secret: taskmagic-webhook-secret-2025
```

## Method 2: Via TaskMagic Webhook (Alternative)

If TaskMagic requires using your webhook URL:

### Your TaskMagic Webhook
```
URL: https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW
Method: POST
Headers:
  Content-Type: application/json
```

Then configure TaskMagic to forward the data to LoadMaster endpoints above.

## Sample Payload Structure

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

## Required Fields for LoadMaster

**Minimum required fields:**
- `company` (string)
- `phone` (string)
- `origin_city` (string)
- `origin_state` (string, 2 letters)
- `destination_city` (string)
- `destination_state` (string, 2 letters)
- `rate` (number)
- `equipment_type` (string: dry_van, reefer, flatbed, box_truck, sprinter_van)
- `commodity` (string)
- `pickup_date` (ISO date string)

**Optional but recommended:**
- `contact_name`, `email`, `weight`, `miles`, `delivery_date`, `special_requirements`, `hazmat`, `dat_load_id`

## Equipment Type Mapping

Map DAT equipment to these LoadMaster types:
- **Van/Dry Van** → `"dry_van"`
- **Reefer** → `"reefer"`
- **Flatbed** → `"flatbed"`
- **Box Truck** → `"box_truck"`
- **Sprinter** → `"sprinter_van"`
- **Straight Truck** → `"straight_truck"`

## Test the Integration

Use this curl command to test (replace [YOUR-REPLIT-DOMAIN] with your actual domain):

```bash
curl -X POST https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/single-load \
  -H "Content-Type: application/json" \
  -H "x-taskmagic-secret: taskmagic-webhook-secret-2025" \
  -d '{
    "company": "TaskMagic Test Freight",
    "phone": "555-999-7777",
    "origin_city": "Memphis",
    "origin_state": "TN",
    "destination_city": "Birmingham",
    "destination_state": "AL",
    "rate": 1100,
    "equipment_type": "box_truck",
    "weight": 16000,
    "commodity": "Retail Goods",
    "pickup_date": "2025-08-23T10:00:00Z",
    "miles": 340
  }'
```

## Configure TaskMagic Automation

1. **Create automation** for DAT login using provided credentials
2. **Set up load scraping** with field extraction 
3. **Configure webhook** to send to LoadMaster endpoint above
4. **Map equipment types** using the conversion table
5. **Schedule automation** to run every 10-15 minutes
6. **Test with sample loads** before going live

Your LoadMaster system is ready to receive and process DAT loads automatically!