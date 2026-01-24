# TRAQ IQ - Fleet Management System
## Complete Project Summary for AI Assistance

---

## 1. PROJECT OVERVIEW

**Name:** TRAQ IQ  
**Type:** Comprehensive fleet management system for truck load tracking and logistics  
**Purpose:** Manage drivers, customers, and loads with real-time GPS tracking, SMS communication, and complete invoice/payment workflows

### Core Business Features:
- Driver management & mobile onboarding (PWA)
- Load management with automated scoring
- Real-time GPS tracking with 60-second refresh
- SMS-based driver communication via Twilio
- Accounts receivable / Collections management
- Multi-tenant architecture for multiple trucking companies
- Stripe payment integration

---

## 2. TECH STACK

### Frontend
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **UI Components:** Shadcn/ui (Radix UI primitives)
- **Styling:** Tailwind CSS
- **State Management:** TanStack Query (React Query v5)
- **Routing:** Wouter
- **Forms:** React Hook Form + Zod validation
- **Icons:** Lucide React

### Backend
- **Runtime:** Node.js
- **Framework:** Express.js with TypeScript
- **ORM:** Drizzle ORM
- **Database:** PostgreSQL (Neon serverless)
- **Scheduling:** Node-cron for background jobs

### External Services
- **SMS:** Twilio (driver notifications, bidirectional messaging)
- **Email:** Nodemailer (SMTP)
- **Payments:** Stripe (subscriptions, invoicing)
- **Database Hosting:** Neon Database (serverless PostgreSQL)

---

## 3. PROJECT STRUCTURE

```
/
├── client/                    # Frontend React app
│   ├── src/
│   │   ├── components/        # Reusable UI components
│   │   │   └── ui/            # Shadcn/ui components
│   │   ├── pages/             # Page components (50+ pages)
│   │   ├── hooks/             # Custom React hooks
│   │   └── lib/               # Utilities (queryClient, utils)
│   └── index.html
│
├── server/                    # Backend Express server
│   ├── routes.ts              # Main API routes (3000+ lines)
│   ├── db-storage.ts          # Database operations
│   ├── ga-loads-router.ts     # GA Loads Inbox API
│   ├── ga-items-router.ts     # Collections/AR API
│   ├── ga-db.ts               # SQLite for load scoring
│   └── [service files].ts     # Various services
│
├── shared/
│   └── schema.ts              # Drizzle ORM schema (2800+ lines)
│
└── replit.md                  # Project documentation
```

---

## 4. DATABASE SCHEMA (PostgreSQL)

### Multi-Tenant Core Tables

```typescript
// Companies - the trucking company organization
companies {
  id: varchar (UUID)
  name: text
  slug: text (unique, URL-friendly)
  stripeCustomerId: text
  billingEmail: text
  trialEndsAt: timestamp
  settings: jsonb
  // ... address fields
}

// Subscriptions - Stripe integration
subscriptions {
  id: varchar
  companyId: varchar (FK → companies)
  stripeSubscriptionId: text
  planTier: enum ['starter', 'pro', 'enterprise']
  status: enum ['trialing', 'active', 'past_due', 'canceled', ...]
  seatsPurchased: integer
  currentPeriodStart/End: timestamp
}

// Company Users - role-based access
companyUsers {
  id: varchar
  companyId: varchar (FK → companies)
  userId: varchar (FK → users)
  role: enum ['admin', 'dispatcher']
  isPrimaryAdmin: boolean
}
```

### Core Business Tables

```typescript
// Drivers
drivers {
  id: varchar (UUID)
  companyId: varchar (FK → companies)
  name: text
  email: text (unique)
  phone: text
  status: text ['available', 'on_route', 'unavailable']
  equipmentType: text ['dry_van', 'refrigerated', 'flatbed', ...]
  loadType: text ['full', 'partial', 'full_partial']
  maxWeight: integer (default 26000 lbs)
  maxLength: integer (default 53 ft)
  enableSmsNotifications: boolean
  trackingToken: varchar (for GPS links)
  // Performance metrics
  totalLoads, completedLoads, averageRating, totalMiles, totalRevenue
  onTimeDeliveries, safetyScore, maintenanceScore
}

// Customers (Brokers/Shippers)
customers {
  id: varchar
  companyId: varchar (FK → companies)
  name: text
  contactPerson: text
  email: text
  phone: text
  address: text
  status: text ['active', 'inactive']
}

// Loads
loads {
  id: varchar (UUID)
  companyId: varchar (FK → companies)
  loadNumber: text (unique, auto-generated with Nanoid)
  customerId: varchar (FK → customers)
  driverId: varchar (FK → drivers, nullable)
  
  // Addresses & Times
  pickupAddress, pickupDate, pickupTime: text/timestamp
  deliveryAddress, deliveryDate, deliveryTime: text/timestamp
  
  // Status workflow
  status: text ['scheduled', 'assigned', 'in_transit', 'delivered', 'cancelled', 'expired']
  priority: text ['standard', 'high', 'urgent']
  
  // Load specs
  description: text
  equipmentType: text
  loadType: text ['full', 'partial']
  weight: integer (lbs)
  length: integer (ft)
  miles: integer
  rate: real ($)
  
  // Temperature (for reefer)
  temperatureRequired: boolean
  minTemperature, maxTemperature: integer
  
  // Source tracking
  sourceBoard: text ['manual', 'dat', 'loadboard']
  expiresAt: timestamp
}
```

### GPS & Location Tables

```typescript
// Driver Locations (real-time tracking)
driverLocations {
  id: varchar
  driverId: varchar (FK → drivers)
  loadId: varchar (FK → loads, nullable)
  latitude, longitude: real
  accuracy: real (meters)
  speed: real (mph)
  heading: real (degrees)
  altitude: real
  address: text (reverse geocoded)
  batteryLevel: integer
  isActive: boolean
  source: text ['gps', 'simulated']
  timestamp: timestamp
}

// Geofences (pickup/delivery zones)
geofences {
  id, name, type: ['pickup', 'delivery', 'depot', 'restricted']
  centerLatitude, centerLongitude, radius: real
  loadId, customerId: varchar (FKs)
  notificationSettings: jsonb
}

// Geofence Events
geofenceEvents {
  geofenceId, driverId: varchar
  eventType: text ['entered', 'exited', 'dwelling']
  dwellTime: integer (minutes)
  wasNotified: boolean
}
```

### Communication Tables

```typescript
// Driver Messages (SMS/in-app)
driverMessages {
  id: varchar
  driverId: varchar (FK → drivers)
  loadId: varchar (FK → loads, nullable)
  direction: text ['inbound', 'outbound']
  channel: text ['sms', 'app', 'system']
  messageType: text ['load_offer', 'status_update', 'chat', ...]
  content: text
  status: text ['pending', 'sent', 'delivered', 'failed', 'read']
  twilioSid: text
  isRead: boolean
}

// Email Templates
emailTemplates {
  name, description: text
  trigger: text ['load_created', 'pickup_confirmed', 'in_transit', 'delivered']
  recipients: text ['driver', 'customer', 'both']
  subject, body: text
  isActive: boolean
}

// Email Logs
emailLogs {
  loadId, templateId: varchar
  recipientEmail, subject: text
  status: text ['sent', 'failed', 'pending']
}
```

### Document Management

```typescript
// Documents
documents {
  id: varchar
  driverId, loadId: varchar
  type: text ['bol', 'pod', 'rate_con', 'lumper', 'scale_ticket', ...]
  status: text ['pending', 'approved', 'rejected', 'processing']
  url: text (object storage)
  originalFilename: text
  mimeType: text
  fileSize: integer
  thumbnailUrl: text
  aiProcessedData: jsonb
  approvedBy, rejectedBy: varchar
}
```

---

## 5. SQLite TABLES (GA Loads Inbox)

Used for lightweight load scoring and collections:

```sql
-- ga_loads: Scored loads for inbox
CREATE TABLE ga_loads (
  id TEXT PRIMARY KEY,
  origin_city, origin_state, dest_city, dest_state TEXT,
  miles INTEGER,
  rpm REAL,                    -- Rate per mile
  weight INTEGER,
  equipment TEXT,
  pickup_date, delivery_date TEXT,
  broker_name, broker_email, broker_phone TEXT,
  
  -- Scoring (0-100)
  score INTEGER,               -- Calculated score
  
  -- Workflow status
  status TEXT DEFAULT 'new',   -- new, quoted, booked, dismissed
  
  -- Invoice/Payment tracking
  invoice_id TEXT,
  invoice_status TEXT,         -- draft, sent, paid
  invoice_total REAL,
  invoice_sent_at TEXT,
  paid_at TEXT,
  
  -- Collections fields
  item_status TEXT,            -- open, in_progress, promised, escalated, closed
  item_owner TEXT,             -- dispatcher, manager, accounting
  collection_stage TEXT,       -- soft, firm, final, escalated
  next_action_at TEXT,
  next_action_type TEXT,       -- SOFT, PAST_DUE, FINAL, CALL
  last_touch_at TEXT,
  promise_to_pay_at TEXT,
  escalated_at TEXT,
  escalation_level TEXT,       -- L1, L2, L3
  escalation_reason TEXT
);
```

### Load Scoring Algorithm (0-100 points)
- **RPM (50 pts):** Rate per mile quality
- **Deadhead penalty (-20 pts):** Distance to pickup
- **Urgency bonus (10 pts):** Quick pickup needed
- **Equipment fit (10 pts):** Matches fleet equipment
- **Lane fit (10 pts):** Matches preferred lanes

---

## 6. KEY API ENDPOINTS

### Drivers
```
GET    /api/drivers                    # List all drivers
GET    /api/drivers/:id                # Get single driver
POST   /api/drivers                    # Create driver
PUT    /api/drivers/:id                # Update driver
DELETE /api/drivers/:id                # Delete driver
POST   /api/drivers/:id/send-dashboard-link  # SMS dashboard link
```

### Loads
```
GET    /api/loads                      # List loads (with filters)
GET    /api/loads/:id                  # Get single load
POST   /api/loads                      # Create load
PUT    /api/loads/:id                  # Update load
PATCH  /api/loads/:id                  # Partial update
DELETE /api/loads/:id                  # Delete load
POST   /api/loads/:id/assign           # Assign driver to load
```

### GA Loads Inbox (SQLite)
```
POST   /api/ga/loads/ingest            # Import loads from source
GET    /api/ga/loads                   # List scored loads
GET    /api/ga/loads/shortlist         # Top 10 highest scored
POST   /api/ga/loads/:id/quote         # Generate quote email
POST   /api/ga/loads/:id/book          # Book the load
POST   /api/ga/loads/:id/dismiss       # Dismiss load
```

### Collections/Items (AR Management)
```
GET    /api/ga/items                   # List unpaid invoices
GET    /api/ga/items/aging             # Aging buckets summary
POST   /api/ga/items/:id/actions/touch     # Log follow-up touch
POST   /api/ga/items/:id/actions/promise   # Record payment promise
POST   /api/ga/items/:id/actions/escalate  # Escalate to L1/L2/L3
```

### GPS & Location
```
GET    /api/driver-locations/active    # Active driver positions
POST   /api/driver-location/update     # Update driver GPS
POST   /api/gps/send-tracking-link     # SMS GPS tracking link
```

### Documents
```
GET    /api/documents/all              # All documents
POST   /api/documents                  # Upload document
POST   /api/documents/:id/approve      # Approve document
POST   /api/documents/:id/reject       # Reject document
GET    /api/loads/:loadId/documents    # Documents for a load
```

### Communication
```
GET    /api/communication/threads      # Message threads
POST   /api/sms/send                   # Send SMS to driver
POST   /api/twilio/webhook             # Incoming SMS webhook
```

---

## 7. MAIN PAGES (Frontend Routes)

### Core Operations
- `/loadops-dashboard` - Main dispatcher dashboard (entry point)
- `/loads` - Load management
- `/loads-inbox` - GA Loads scoring & shortlist
- `/items` - Collections/AR management

### Driver Management
- `/driver-management` - Driver list & management
- `/driver-onboarding` - Multi-step onboarding wizard
- `/driver-dashboard` - Mobile driver PWA
- `/gps-tracking` - Real-time driver map

### Communication
- `/communication-dashboard` - Driver messages
- `/sms-dispatching` - SMS dispatch center
- `/ai-communication-insights` - AI analysis of comms

### Fleet & Maintenance
- `/fleet-dashboard` - Fleet overview
- `/fleet-trucks` - Truck inventory
- `/fleet-work-orders` - Maintenance work orders
- `/predictive-maintenance` - AI maintenance predictions

### Admin & Settings
- `/admin-overview` - System overview
- `/analytics` - Business analytics
- `/templates` - Email templates
- `/payments` - Payment workflow

---

## 8. CURRENT FEATURES STATUS

### Fully Implemented ✅
- Multi-tenant company architecture
- Driver CRUD with equipment matching
- Load management with status workflow
- Real-time GPS tracking (60-sec refresh)
- SMS notifications via Twilio
- GA Loads Inbox with scoring algorithm
- Collections/AR with aging buckets
- Document upload & approval workflow
- Mobile driver PWA dashboard
- Stripe subscription integration

### In Progress 🔄
- AI-powered truck recommendation
- Dispatch Gate integration
- Rate confirmation generation

---

## 9. DESIGN SYSTEM

### Brand Colors
- **Navy:** Primary dark (#0a1628)
- **Teal:** Brand accent (#00b5b8)
- **Slate:** Neutral grays
- **White/Whitesmoke:** Backgrounds

### Typography
- **Headings:** Poppins (600 weight)
- **Body:** Inter
- **Code:** JetBrains Mono

### UI Principles
- 8px border-radius
- 0.2s ease transitions
- Dark mode fully supported
- Mobile-first responsive design

---

## 10. HOW TO RUN

```bash
# Development
npm run dev          # Starts Express + Vite on port 5000

# Database
npm run db:push      # Push schema changes to PostgreSQL

# The app binds to port 5000 (frontend + API)
```

---

## 11. ENVIRONMENT VARIABLES NEEDED

```
DATABASE_URL=postgresql://...          # Neon PostgreSQL
TWILIO_ACCOUNT_SID=...                 # Twilio SMS
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
STRIPE_SECRET_KEY=...                  # Stripe payments
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  # Email
```

---

## 12. WHAT I NEED HELP WITH

[Add your specific questions or features you want to build here]

---

*Generated: January 2026*
*This document provides context for AI assistants to understand the TRAQ IQ codebase*
