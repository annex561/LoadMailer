# TaskMagic Webhook Configuration - Complete Setup

## Based on Your Screenshot

I can see you're in TaskMagic with the "GET Loads" automation and webhook export dialog open. Here's exactly what to configure:

## Step 1: Webhook URL Configuration

In the "Export data to a Webhook" dialog you have open:

**Webhook URL Field:** Enter one of these URLs (replace with your actual Replit domain):

### Option A: Direct to LoadMaster (Recommended)
```
https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/single-load
```

### Option B: Use Your TaskMagic Webhook
```
https://webhooks.taskmagic.com/hook/i7BFrUC4Yk7ubrLYIkSW
```

## Step 2: Click "Click to show headers"

Add these HTTP headers:
```
Content-Type: application/json
x-taskmagic-secret: taskmagic-webhook-secret-2025
```

## Step 3: Setup Payload

In the "Setup payload" section, configure the JSON structure. Here's what you need to map your extracted DAT load data to:

```json
{
  "company": "{{company_name_variable}}",
  "contact_name": "{{contact_person_variable}}",
  "phone": "{{phone_number_variable}}",
  "email": "{{email_variable}}",
  "origin_city": "{{origin_city_variable}}",
  "origin_state": "{{origin_state_variable}}",
  "destination_city": "{{destination_city_variable}}",
  "destination_state": "{{destination_state_variable}}",
  "rate": {{rate_number_variable}},
  "equipment_type": "{{equipment_type_variable}}",
  "weight": {{weight_variable}},
  "commodity": "{{commodity_variable}}",
  "pickup_date": "{{pickup_date_variable}}",
  "delivery_date": "{{delivery_date_variable}}",
  "miles": {{miles_variable}},
  "special_requirements": "{{special_requirements_variable}}",
  "hazmat": {{hazmat_boolean_variable}},
  "dat_load_id": "{{dat_load_id_variable}}",
  "automation_run_id": "{{taskmagic_run_id}}",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

## Step 4: Variable Mapping

Make sure your "GET Loads" automation extracts these variables from DAT:

**Required Variables:**
- `company_name_variable` → Company name from load listing
- `phone_number_variable` → Phone number (format: 555-123-4567)
- `origin_city_variable` → Pickup city
- `origin_state_variable` → Pickup state (2 letters: TN, KY, etc.)
- `destination_city_variable` → Delivery city
- `destination_state_variable` → Delivery state (2 letters)
- `rate_number_variable` → Rate as number only (1350, not $1,350)
- `equipment_type_variable` → Equipment type
- `commodity_variable` → Cargo description
- `pickup_date_variable` → Pickup date in ISO format

**Equipment Type Mapping:**
- Van/Dry Van → "dry_van"
- Reefer → "reefer" 
- Flatbed → "flatbed"
- Box Truck → "box_truck"
- Sprinter → "sprinter_van"
- Straight Truck → "straight_truck"

## Step 5: Test Configuration

After setting up the webhook:
1. Click "Save" 
2. Run your automation manually
3. Check LoadMaster `/taskmagic-status` page for incoming loads
4. Verify loads appear in `/dat-loads` tab
5. Confirm driver notifications are sent

## Step 6: Your LoadMaster Endpoints

**Single Load Processing:**
```
https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/single-load
```

**Batch Load Processing:**
```
https://[YOUR-REPLIT-DOMAIN].replit.app/api/taskmagic/webhook/batch-loads
```

**TaskMagic Status Monitoring:**
```
https://[YOUR-REPLIT-DOMAIN].replit.app/taskmagic-status
```

## Required Headers for LoadMaster Integration
```
Content-Type: application/json
x-taskmagic-secret: taskmagic-webhook-secret-2025
```

## Sample Test Payload

Once configured, your webhook should send data like this:
```json
{
  "company": "ABC Freight Solutions",
  "phone": "555-987-6543",
  "origin_city": "Nashville",
  "origin_state": "TN",
  "destination_city": "Atlanta",
  "destination_state": "GA",
  "rate": 1350,
  "equipment_type": "dry_van",
  "weight": 15000,
  "commodity": "Electronics",
  "pickup_date": "2025-08-23T08:00:00Z",
  "miles": 248,
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

## Expected Results

Once configured and running:
- DAT loads automatically appear in LoadMaster within 30 seconds
- Eligible drivers receive Telegram notifications
- New freight companies added to database
- Full load lifecycle tracking begins
- Payment processing when loads complete

Your LoadMaster system is ready to receive loads - configure the webhook as shown above!