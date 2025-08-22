# TaskMagic Payload Configuration - Final Step

## Your Headers Are Perfect ✅
I can see you've configured the headers correctly:
- `Content-Type: application/json`
- `x-taskmagic-secret: taskmagic-webhook-secret-2025`

## Setup Payload Configuration

In the "Setup payload" section, you need to configure the JSON structure that will be sent to LoadMaster for each DAT load.

### Click the "Select value" dropdown and choose "Custom JSON"

Then configure this JSON structure:

```json
{
  "company": "{{company_name}}",
  "contact_name": "{{contact_person}}",
  "phone": "{{phone_number}}",
  "email": "{{email_address}}",
  "origin_city": "{{pickup_city}}",
  "origin_state": "{{pickup_state}}",
  "destination_city": "{{delivery_city}}",
  "destination_state": "{{delivery_state}}",
  "rate": {{load_rate}},
  "equipment_type": "{{equipment_type_mapped}}",
  "weight": {{load_weight}},
  "commodity": "{{cargo_description}}",
  "pickup_date": "{{pickup_date_iso}}",
  "delivery_date": "{{delivery_date_iso}}",
  "miles": {{distance}},
  "special_requirements": "{{special_notes}}",
  "hazmat": {{hazmat_flag}},
  "dat_load_id": "{{dat_load_id}}",
  "automation_run_id": "{{$run_id}}",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

### Variable Mapping Instructions

Replace the placeholder variables above with your actual TaskMagic variables that extract data from DAT:

**Required Variables:**
- `{{company_name}}` → Company name from DAT load listing
- `{{phone_number}}` → Phone number in format 555-123-4567
- `{{pickup_city}}` → Origin city (e.g., "Nashville")
- `{{pickup_state}}` → Origin state (e.g., "TN")
- `{{delivery_city}}` → Destination city (e.g., "Atlanta")  
- `{{delivery_state}}` → Destination state (e.g., "GA")
- `{{load_rate}}` → Rate as number only (1350, not $1,350)
- `{{cargo_description}}` → Commodity/cargo description

**Equipment Type Mapping:**
Create a mapping variable `{{equipment_type_mapped}}` that converts DAT equipment to:
- Van/Dry Van → `"dry_van"`
- Reefer → `"reefer"`
- Flatbed → `"flatbed"`
- Box Truck → `"box_truck"`
- Sprinter → `"sprinter_van"`
- Straight Truck → `"straight_truck"`

**Optional Variables:**
- `{{contact_person}}` → Contact name if available
- `{{email_address}}` → Email if shown
- `{{load_weight}}` → Weight in pounds
- `{{pickup_date_iso}}` → Format: "2025-08-23T08:00:00Z"
- `{{delivery_date_iso}}` → Format: "2025-08-24T17:00:00Z"
- `{{distance}}` → Miles as number
- `{{special_notes}}` → Special requirements
- `{{hazmat_flag}}` → true/false for hazmat
- `{{dat_load_id}}` → DAT's load ID

### Example of Completed Payload

Once configured with your variables, it should look something like:

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

### After Configuration:
1. **Click "Save"** to save the webhook configuration
2. **Test the automation** manually first
3. **Schedule it** to run every 10-15 minutes
4. **Monitor results** in LoadMaster `/taskmagic-status`

### Expected Results:
- DAT loads automatically appear in LoadMaster
- Eligible drivers receive Telegram notifications
- New freight companies added to database
- Full load lifecycle tracking begins

Your LoadMaster integration is ready and tested - just complete the payload configuration!