# TaskMagic Webhook Bridge Configuration

## Your TaskMagic Setup

**Your TaskMagic Webhook URL:** `https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW`

This webhook will receive DAT load data from your TaskMagic automation and forward it to your LoadMaster system.

## Integration Flow

```
DAT Website → TaskMagic Automation → TaskMagic Webhook → LoadMaster Processing
```

## TaskMagic Automation Configuration

### Step 1: DAT Login Automation
Create automation with these settings:
- **Name:** "DAT Login for LoadMaster"
- **Starting URL:** `https://www.dat.com/login`
- **Credentials:** 
  - Email: `dispatch@lampslogistics.com`
  - Password: `Anonymous#56111`

### Step 2: Load Scraping Workflow
Configure data extraction for these fields:

```javascript
{
  "company": "Extract company name",
  "contact_name": "Extract contact person",
  "phone": "Extract phone number (format: 555-123-4567)",
  "email": "Extract email if available",
  "origin_city": "Extract pickup city",
  "origin_state": "Extract pickup state (2 letters)",
  "destination_city": "Extract delivery city",
  "destination_state": "Extract delivery state (2 letters)",
  "rate": "Extract rate as number",
  "equipment_type": "Map to: dry_van|reefer|flatbed|box_truck|sprinter_van",
  "weight": "Extract weight in pounds",
  "commodity": "Extract cargo description",
  "pickup_date": "Format as: YYYY-MM-DDTHH:mm:ssZ",
  "delivery_date": "Format as: YYYY-MM-DDTHH:mm:ssZ (optional)",
  "miles": "Extract distance as number",
  "special_requirements": "Extract special notes",
  "hazmat": "Extract hazmat flag (true/false)",
  "dat_load_id": "Extract DAT load ID",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

### Step 3: Webhook Configuration in TaskMagic

#### Method 1: Forward to LoadMaster (Recommended)
Configure TaskMagic to send scraped data directly to:
```
URL: https://your-replit-domain.replit.app/api/taskmagic/webhook/single-load
Method: POST
Headers:
  Content-Type: application/json
  x-taskmagic-secret: taskmagic-webhook-secret-2025
```

#### Method 2: Use TaskMagic Webhook Bridge
If TaskMagic requires using your webhook URL, configure:
```
URL: https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW
Method: POST
Body: Include scraped DAT load data
```

## LoadMaster Endpoints Ready for TaskMagic

Your system is configured to receive loads at these endpoints:

### Single Load Processing
```bash
curl -X POST https://your-replit.app/api/taskmagic/webhook/single-load \
  -H "Content-Type: application/json" \
  -H "x-taskmagic-secret: taskmagic-webhook-secret-2025" \
  -d '{
    "company": "Test Freight Company",
    "phone": "555-987-6543",
    "origin_city": "Nashville",
    "origin_state": "TN",
    "destination_city": "Atlanta", 
    "destination_state": "GA",
    "rate": 1350,
    "equipment_type": "dry_van",
    "weight": 16000,
    "commodity": "Electronics",
    "pickup_date": "2025-08-23T08:00:00Z",
    "miles": 248
  }'
```

### Batch Load Processing
```bash
curl -X POST https://your-replit.app/api/taskmagic/webhook/batch-loads \
  -H "Content-Type: application/json" \
  -H "x-taskmagic-secret: taskmagic-webhook-secret-2025" \
  -d '{
    "loads": [
      { /* load 1 data */ },
      { /* load 2 data */ },
      { /* load 3 data */ }
    ]
  }'
```

## Testing the Integration

### Test TaskMagic Connection
Send test data to your TaskMagic webhook:
```bash
curl -X POST https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW \
  -H "Content-Type: application/json" \
  -d '{
    "test": true,
    "message": "LoadMaster integration test",
    "timestamp": "2025-08-22T00:21:30Z"
  }'
```

### Monitor Integration Status
Check LoadMaster TaskMagic status:
- Visit: `/taskmagic-status` in your LoadMaster dashboard
- API: `GET /api/taskmagic/status`

## Expected Results

Once configured:
1. **TaskMagic scrapes DAT loads** every 10-15 minutes
2. **Loads automatically appear** in LoadMaster DAT Loads tab
3. **Drivers receive Telegram notifications** within 30 seconds
4. **Full load lifecycle tracking** in LoadMaster dashboard
5. **Automatic customer creation** for new freight companies

## Next Steps

1. **Configure TaskMagic automation** using your webhook URL
2. **Set up DAT login workflow** with provided credentials
3. **Test with sample loads** to verify integration
4. **Monitor performance** through TaskMagic Status dashboard
5. **Scale automation** based on load volume needs

Your TaskMagic webhook URL is ready to receive and process DAT loads automatically.