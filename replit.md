# Overview

TRAQ IQ is a comprehensive fleet management system designed for truck load tracking and logistics coordination. Its core purpose is to manage drivers, customers, and loads efficiently, with a strong emphasis on real-time load status updates, automated communication, and streamlined logistics. Key features include a Tennessee Load Feed, an SMS-based driver onboarding system, real-time GPS tracking, and a professional document management system. The project aims to establish a robust platform for efficient freight management, integrating modern communication tools for dispatch and driver interaction, with significant market potential in the logistics sector.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
The frontend is built with React 18 (TypeScript, Vite), using Shadcn/ui (Radix UI) for components, Tailwind CSS for styling, TanStack Query for state management, Wouter for routing, and React Hook Form with Zod for form handling.

## Backend
The backend utilizes Express.js with TypeScript, Drizzle ORM for PostgreSQL (via Neon Database serverless adapter), and Node-cron for job scheduling. It features an abstract storage interface.

## Database Design
Drizzle ORM is used with a PostgreSQL dialect, defining schemas for Drivers, Customers, Loads, Email Templates, and Email Logs. Load numbers use Nanoid for collision-proof generation. The system implements a multi-tenant architecture with `company_id` for data isolation across Companies, Subscriptions (Stripe integrated), Company Users (role-based access), Payment Methods, and Billing History. Indexes are applied on `company_id` for performance, and database-level security prevents cross-tenant data leakage.

### Revenue Loop Schema (PostgreSQL)
The Revenue Loop unifies the complete Offer → Book → RateCon → Invoice → Payment pipeline:

**Enums:**
- `load_lifecycle_status`: new, offered, booked, scheduled, in_transit, delivered, cancelled, expired
- `ar_invoice_status`: draft, sent, paid, void, disputed
- `collection_stage`: soft, firm, final, escalated
- `collection_item_status`: open, promise, escalated, closed, dispute
- `next_action_kind`: EMAIL, CALL, TEXT, SYSTEM

**Core Tables:**
- `loads` (extended): Added `truck_id`, `lifecycle_status`, origin/dest city/state, `offered_rate`, `rpm`, `score`, pipeline timestamps (`offered_at`, `booked_at`, `delivered_at`), document paths (`ratecon_path`, `pod_path`)
- `ar_invoices`: AR invoice tracking with `invoice_number`, `status`, `total_amount`, `balance_due`, `due_date`, `sent_at`, `paid_at`, payment info
- `collections_items`: Collection workbench with `stage`, `status`, `owner`, `last_touch_at`, `promise_date`, `next_action_at`, `next_action_kind`, `escalation_level` (L0-L3)
- `activity_log`: Audit trail with `entity_type`, `entity_id`, `action`, `actor`, `details` (JSONB)
- `compliance_documents`: Document compliance tracking with `type`, `expiry_date`, `file_path`, `status`

**Dispatch Gate (Trucks):**
The `trucks` table includes risk scoring and gate status:
- `dispatch_gate_status`: GREEN (go), YELLOW (caution/manager approval), RED (no dispatch)
- `risk_score`: 0-100 scale with component breakdown (inspection, maintenance, breakdown, compliance, age)
- Override capability with reason and expiry tracking

## Communication System
The system features unified messaging with a single conversation stream per driver, including auto-thread creation and field mapping for API consistency. Twilio SMS handles all driver communications, featuring E.164 phone number normalization, simplified dashboard link formats, optional driver-to-dispatcher SMS relay, and a dual-routing architecture for incoming driver SMS to multiple load contexts. Nodemailer is used for automated email notifications. In-app messaging provides real-time bidirectional communication between drivers (mobile dashboard) and dispatchers (SMS Dispatch tab), with notification sounds, clear sender labels, and dedicated API endpoints.

## API Design
The project uses RESTful API endpoints with centralized error handling and shared Zod schemas for frontend and backend data validation.

## UI/UX Design System
The design system employs a consistent brand palette (Navy, Slate, Teal, Whitesmoke) and typography (Poppins, Inter, JetBrains Mono). It adheres to principles like 8px border-radius, 0.2s ease transitions, and 600 font weight for headings. Theming is managed with CSS variables and tokens for light/dark mode, with Shadcn/ui components customized with the Teal brand color. Dark mode is fully supported.

## Feature Specifications
- **Driver Management**: Onboarding, status tracking, payment.
- **Load Matching**: Filters by location, equipment, weight, and driver availability.
- **Automated Communication**: SMS for load offers and driver interactions.
- **Load Workflow**: Intelligent load retry, post-confirmation messaging, manual entry.
- **Unified Dispatcher Dashboard**: A central workspace with four tabs:
    - **Overview**: Quick stats, active loads, available drivers, activity feed, quick actions, smart search.
    - **GPS Tracking**: Live map integration, driver telemetry cards, 60-second auto-refresh.
    - **Documents**: Approval workflow, filterable document cards, quick approve/reject, 30-second auto-refresh.
    - **SMS Dispatch**: Driver selection, message textarea, quick templates, recent messages, 15-second auto-refresh.
- **Streamlined Navigation**: Consolidated sidebar with the Dispatcher Dashboard as the primary access point for core operations.
- **Communication Dashboard**: Modern interface for driver communications with real-time updates and quick message templates.
- **Professional Document Management**: Approval workflow, quality validation, cloud integrations, smart categorization, and PDF generation, blocking load completion without required documents.
- **Real-Time GPS Tracking**: Mobile-optimized, secure, with 60-second auto-updates and a GPS health monitor.
- **Mobile Driver Dashboard (PWA)**: Installable PWA with dynamic authentication, driver stats, load history, chat, document upload, and profile management. Includes GPS-based intelligent status buttons, an enhanced hamburger menu, and AI-powered messaging for drivers. Features debounced typing protection for message input.
- **Driver Dashboard Link Distribution System**: Automated and manual SMS delivery of personalized links with security measures.
- **Driver Onboarding**: Multi-step wizard supporting token-optional flows for invited and direct registrations, focusing on mobile driver dashboard access.
- **RateCon Inbox (Gmail Integration)**: Automatic rate confirmation email processing:
    - **Gmail Scanning**: Connects to company Gmail accounts to scan for rate confirmation emails.
    - **PDF Parsing**: Uses pdf2json to extract text from PDF attachments.
    - **AI Extraction**: OpenAI GPT-4o parses extracted text to identify 17 data fields: load number, rate, origin, destination, broker name/phone/email, dispatcher name, driver name, miles, RPM, pickup/delivery times, weight, and special instructions.
    - **Auto-Customer Creation**: Creates new customers automatically based on broker name from rate confirmations.
    - **Database Integration**: Loads are saved to PostgreSQL with lifecycle status 'booked', creating audit trail in activity_log.
    - **Duplicate Detection**: Prevents re-importing loads with the same load number.
    - **Driver Notification**: When a load is imported with a driver name, the system attempts to match the driver by name and sends an SMS notification with load details and a mobile dashboard link.
    - **API Endpoints**: `POST /api/gmail/scan` (triggers scan), `GET /api/gmail/accounts` (list connected accounts).
    - **Auto-Polling**: Background job polls Gmail every 5 minutes for new rate confirmations.
- **GA Loads Inbox**: A dedicated load scoring and management system using SQLite for lightweight load data:
    - **Load Scoring**: Algorithm-based scoring (0-100) considering RPM (50pts), deadhead penalty (-20pts), urgency bonus (10pts), equipment fit (10pts), and lane fit (10pts).
    - **Shortlist**: Top 10 highest-scored new loads for quick action.
    - **Workflow Actions**: Quote (generates email template), Book, Dismiss with status tracking.
    - **Distance Calculation**: Uses OpenStreetMap APIs (Nominatim for geocoding, OSRM for routing) with haversine fallback to calculate miles and RPM for loads missing distance data.
    - **Driver Notification on Booking**: When a load is booked with an assigned driver, sends SMS with load details and mobile dashboard link.
    - **API Endpoints**: `/api/ga/loads/ingest`, `/api/ga/loads`, `/api/ga/loads/shortlist`, `/api/ga/loads/:id/quote`, `/api/ga/loads/:id/book`, `/api/ga/loads/:id/dismiss`, `/api/ga/loads/calculate-all-miles`, `/api/ga/loads/:id/calculate-miles`.
    - **Frontend**: Dual-table view with score filter slider, located at `/loads-inbox`.
- **Items (Collections) System**: Accounts receivable management for outstanding invoices with automated follow-up scheduling:
    - **Aging Buckets**: 0-7, 8-14, 15-30, 31-60, 61-90, 90+ day buckets with totals.
    - **Next Action Automation**: SOFT touch (+2 days), PAST_DUE touch (+1 day), FINAL touch (same day), Promise (promise date), Escalate (+1 day).
    - **Collection Stages**: soft → firm → final → escalated progression.
    - **Workflow States**: open, in_progress, promised, escalated, closed with dispatcher/manager/accounting ownership.
    - **API Endpoints**: `GET /api/ga/items`, `GET /api/ga/items/aging`, `POST /api/ga/items/:id/actions/touch`, `POST /api/ga/items/:id/actions/promise`, `POST /api/ga/items/:id/actions/escalate`.
    - **Frontend**: `/items` page with aging summary, action cards, touch templates, promise scheduling, escalation levels (L1/L2/L3).

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle Kit**: Database migration and schema management.

## Messaging & Email Services
- **Twilio SMS**: Primary communication for all driver notifications and bidirectional messaging.
- **Nodemailer**: SMTP email delivery for load lifecycle notifications.

## Payment Processing
- **Stripe**: Payment processing integrated via `stripe-replit-sync` library for automatic schema management and data synchronization (products, prices, customers, subscriptions).

## UI Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **Tailwind CSS**: Utility-first CSS framework.

# Development Patterns

## WebSocket Architecture (IMPORTANT)
When adding WebSocket services that run alongside Vite's HMR WebSocket:

**NEVER use `{ server, path: '/my/path' }` mode** - This causes the `ws` library to intercept ALL WebSocket upgrade requests before Vite can handle HMR connections, breaking hot module reload and causing continuous page refresh loops.

**ALWAYS use `noServer` mode** with manual upgrade handling:
```typescript
// CORRECT: Use noServer mode
this.wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws/my-path') {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }
  // Other paths (like Vite HMR) fall through to their handlers
});
```

This pattern allows multiple WebSocket services to coexist:
- Typing indicators: `/ws/typing`
- Vite HMR: handled by Vite middleware
- Future WebSocket services: use same noServer pattern

## Google Sheets Import Pattern
- Loads from Google Sheets use content-based IDs (hash of origin-destination-pay-miles) for duplicate detection across server restarts
- Loads are stored in-memory only for API serving, not automatically saved to database
- Loads are only persisted to database when explicitly booked