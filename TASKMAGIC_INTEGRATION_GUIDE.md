# TaskMagic Integration Guide

## Overview
Your LoadMaster system now includes complete TaskMagic integration for automated DAT load scraping. TaskMagic handles the complex browser automation while LoadMaster processes the scraped data and dispatches loads to drivers.

## Webhook Endpoints

### 1. Single Load Processing
**Endpoint:** `POST /api/taskmagic/webhook/single-load`
**Purpose:** Receives individual DAT loads from TaskMagic automations

**Example Payload:**
```json
{
  "company": "ABC Freight Solutions",
  "contact_name": "John Dispatcher",
  "phone": "555-123-4567",
  "email": "dispatch@abcfreight.com",
  "origin_city": "Nashville",
  "origin_state": "TN",
  "destination_city": "Atlanta",
  "destination_state": "GA",
  "rate": 1250,
  "equipment_type": "dry_van",
  "weight": 15000,
  "commodity": "Electronics",
  "pickup_date": "2025-08-23T08:00:00Z",
  "miles": 248,
  "special_requirements": "Appointment required",
  "hazmat": false,
  "dat_load_id": "DAT123456",
  "automation_run_id": "tm_run_789",
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

### 2. Batch Load Processing
**Endpoint:** `POST /api/taskmagic/webhook/batch-loads`
**Purpose:** Receives multiple DAT loads in a single batch

**Example Payload:**
```json
{
  "loads": [
    {
      "company": "First Load Company",
      "phone": "555-111-2222",
      "origin_city": "Memphis",
      "origin_state": "TN",
      "destination_city": "Birmingham",
      "destination_state": "AL",
      "rate": 980,
      "equipment_type": "reefer",
      "weight": 12000,
      "commodity": "Frozen Foods",
      "pickup_date": "2025-08-23T06:00:00Z",
      "miles": 340
    },
    {
      "company": "Second Load Company",
      "phone": "555-333-4444",
      "origin_city": "Knoxville",
      "origin_state": "TN",
      "destination_city": "Charlotte",
      "destination_state": "NC",
      "rate": 1450,
      "equipment_type": "flatbed",
      "weight": 25000,
      "commodity": "Steel Coils",
      "pickup_date": "2025-08-24T07:00:00Z",
      "miles": 425
    }
  ],
  "webhook_secret": "taskmagic-webhook-secret-2025"
}
```

### 3. Integration Status
**Endpoint:** `GET /api/taskmagic/status`
**Purpose:** Check TaskMagic integration health and statistics

**Example Response:**
```json
{
  "integration": "TaskMagic",
  "status": "active",
  "webhookEndpoints": {
    "singleLoad": "/api/taskmagic/webhook/single-load",
    "batchLoads": "/api/taskmagic/webhook/batch-loads"
  },
  "totalTaskMagicLoads": 45,
  "availableLoads": 12,
  "assignedLoads": 8,
  "inTransitLoads": 20,
  "deliveredLoads": 5,
  "lastUpdated": "2025-08-22T12:14:00Z"
}
```

## Required Load Fields

### Essential Fields (Required)
- `company`: Company name
- `phone`: Contact phone number (10+ digits)
- `origin_city`: Pickup city
- `origin_state`: Pickup state (2-letter code)
- `destination_city`: Delivery city
- `destination_state`: Delivery state (2-letter code)
- `rate`: Load rate (positive number)
- `equipment_type`: Equipment type (dry_van, reefer, flatbed, etc.)
- `commodity`: Cargo description
- `pickup_date`: Pickup date (ISO format)
- `miles`: Distance in miles

### Optional Fields
- `contact_name`: Contact person name
- `email`: Contact email address
- `pickup_time`: Specific pickup time
- `delivery_date`: Delivery date
- `delivery_time`: Specific delivery time
- `weight`: Load weight in pounds
- `length`: Load length
- `special_requirements`: Special instructions
- `hazmat`: Hazardous materials flag (boolean)
- `dat_load_id`: Original DAT load ID for tracking
- `automation_run_id`: TaskMagic automation run ID
- `scraped_at`: When the load was scraped

## Equipment Types Supported
- `dry_van`: Standard dry van
- `reefer`: Refrigerated trailer
- `flatbed`: Flatbed trailer
- `step_deck`: Step deck trailer
- `lowboy`: Lowboy trailer
- `tanker`: Tanker trailer
- `box_truck`: Box truck
- `sprinter_van`: Sprinter van
- `straight_truck`: Straight truck
- `container`: Container

## Authentication
Use the webhook secret for security:
- **Header:** `x-taskmagic-secret: taskmagic-webhook-secret-2025`
- **Body Field:** `"webhook_secret": "taskmagic-webhook-secret-2025"`
- **Query Parameter:** `?secret=taskmagic-webhook-secret-2025`

## TaskMagic Automation Setup

### 1. DAT Login Automation
Create a TaskMagic automation to:
1. Navigate to DAT login page
2. Enter credentials: `dispatch@lampslogistics.com` / `Anonymous#56111`
3. Handle 2FA if required
4. Navigate to load search page

### 2. Load Scraping Automation
Configure TaskMagic to extract:
- Company name and contact details
- Origin and destination cities/states
- Rate and equipment type
- Pickup dates and special requirements
- Load weight and commodity

### 3. Webhook Configuration
Set TaskMagic to send scraped data to:
- **Single Load:** `https://your-replit-app.replit.app/api/taskmagic/webhook/single-load`
- **Batch Loads:** `https://your-replit-app.replit.app/api/taskmagic/webhook/batch-loads`

## What Happens After Load Import

### 1. Automatic Processing
- ✅ Load validated and stored in database
- ✅ Customer created if not exists
- ✅ Load priority calculated based on rate and requirements
- ✅ Load appears in DAT Loads tab immediately

### 2. Driver Notification
- ✅ System evaluates eligible drivers (150-mile radius)
- ✅ Checks equipment compatibility
- ✅ Sends Telegram notifications to available drivers
- ✅ Manages driver responses and load assignments

### 3. Load Management
- ✅ Full lifecycle tracking (available → assigned → in_transit → delivered)
- ✅ Real-time status updates
- ✅ Document management and GPS tracking
- ✅ Automated payments generation

## Integration Benefits

### vs. Direct Puppeteer Automation
✅ **Reliability:** TaskMagic handles website changes automatically  
✅ **Anti-Detection:** Built-in bot detection avoidance  
✅ **Maintenance:** No need to update selectors when DAT changes  
✅ **Stability:** Professional automation platform vs. custom scripts  

### vs. Manual Load Entry
✅ **Speed:** Automated processing vs. manual VA input  
✅ **Volume:** Handle hundreds of loads vs. manual one-by-one entry  
✅ **Cost:** Automation vs. paying VA for data entry  
✅ **Accuracy:** Consistent data extraction vs. human error risk  

## Testing the Integration

### 1. Test Single Load
```bash
curl -X POST https://your-app.replit.app/api/taskmagic/webhook/single-load \
  -H "Content-Type: application/json" \
  -H "x-taskmagic-secret: taskmagic-webhook-secret-2025" \
  -d '{
    "company": "Test Freight Co",
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

### 2. Check Status
```bash
curl https://your-app.replit.app/api/taskmagic/status
```

## Next Steps
1. **Set up TaskMagic automations** for DAT login and scraping
2. **Configure webhook endpoints** with your Replit app URL
3. **Test with sample data** to ensure proper integration
4. **Monitor load processing** through the LoadMaster dashboard
5. **Scale automation** to handle your target load volume

Your system now provides a complete solution combining TaskMagic's automation power with LoadMaster's driver management and dispatch capabilities.