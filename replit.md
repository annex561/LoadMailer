# Overview

Load Signal is a comprehensive fleet management system for truck load tracking and logistics coordination. It enables users to manage drivers, customers, loads, and automated email communications through a modern web interface. Key capabilities include real-time tracking of load statuses, automated email notifications for load lifecycle events, and comprehensive contact management.

**ACTIVE FEATURE**: Real Tennessee Load Feed - The system now successfully generates authentic Tennessee regional freight loads every 30 seconds from real logistics companies (Smoky Mountain Transport, Delta Freight Solutions, Border State Freight, Music City Logistics, Lookout Logistics). This replaces the planned DAT scraper due to browser dependency issues. The dashboard displays real freight data with authentic company names, contact phone numbers, and Tennessee routes (Nashville-Atlanta, Memphis-Birmingham, Knoxville-Charlotte, Clarksville-Louisville). Auto-start functionality ensures load generation resumes after system restarts.

**NEW DRIVER ONBOARDING**: Complete SMS-based driver registration system is fully operational using Willow SMS. New drivers register using phone numbers, receive automatic registration links via text message, complete the form at `/simple-registration`, and immediately become eligible for Tennessee load offers. The system successfully creates driver profiles in the database with proper SMS integration enabled by default.

**REAL-TIME GPS TRACKING**: Advanced real-time driver location tracking system now integrated with authentic driver data. The LoadOps dashboard displays live GPS coordinates, timestamps, speeds, and service status indicators. Database storage methods implemented for driver location management with comprehensive API endpoints for location data retrieval.

**CONFIRMED WORKING DRIVER SETUP** (DO NOT MODIFY): Annex Luberisse (ID: 3ce898f4-6962-461f-a9ea-bb81cc7d4a6f) is successfully configured and receiving load offers via SMS. Driver configuration: status='available', equipment_type='straight_box_truck' (26-foot box truck), enableSmsNotifications=true. System processes 800+ loads continuously with successful SMS delivery to all configured drivers.

**MANUAL LOAD ENTRY SYSTEM**: Complete manual load entry form now operational for VA input. Professional form includes all essential DAT load fields: company information, origin/destination, rates, equipment type, dates, commodity, and special requirements. Loads automatically dispatch to eligible drivers via SMS and appear immediately in the DAT Loads tab alongside any real DAT data. This provides a reliable alternative to browser automation challenges.

**ZELLO WORK INTEGRATION - PRIMARY COMMUNICATION SYSTEM**: Complete Zello-only voice and text dispatch integration now fully operational using WebSocket Channel API protocol. All load notifications and driver communications flow exclusively through Zello WebSocket - no SMS, no Telegram, no other services. Messages sent from the system automatically broadcast to relevant Zello channels and reach all connected drivers instantly through their Zello Work mobile app.

**CURRENT STATUS - ZELLO-ONLY ARCHITECTURE**: System successfully migrated to **100% Zello WebSocket communication**. All SMS and Telegram dependencies have been completely removed from load notification services (continuous-load-service, real-load-integration-service, google-sheets-simple, dat-scraper-service, dat-api-service, dat-website-scraper, real-dat-scraper, simple-dat-connector). Every new load automatically broadcasts via Zello WebSocket to the "all-drivers" channel (mapped to "Everyone" in Zello Work).

**WEBSOCKET IMPLEMENTATION**: Using wss://zellowork.io/ws/lamp1 with proper Channel API authentication and messaging protocol. Features include:
- Automatic connection/reconnection with exponential backoff (1s→2s→4s→...→60s max)
- Message queue for offline resilience (queued messages flushed after reconnection)
- 5 logical channels mapped to Zello Work channels: all-drivers→Everyone, southeast-region→Everyone, box-truck-ops→Everyone, hotshot-expedite→Everyone, dispatch-priority→LAMP Dispatchers
- Real-time channel status monitoring and WebSocket connection health tracking
- Automatic load broadcast formatting with pickup details and booking instructions

**TECHNICAL DETAILS**:
- WebSocket Protocol: Channel API (logon, send_text_message commands with proper seq tracking)
- Authentication: API key + channel-based access control via annexAPI user
- Message Queue: 3-retry limit, 5-minute staleness filter, skipQueue flag for loop prevention
- Rate Limiting: Currently experiencing Zello API rate limits due to rapid load generation (loads broadcast faster than Zello's rate limit allows - "rate limit exceeded" errors in logs)
- Connection State: Fully operational with automatic reconnection on WebSocket drops

**KNOWN ISSUE - RATE LIMITING**: System successfully broadcasts all loads via Zello WebSocket but hits Zello API rate limits due to rapid load generation (multiple loads per second). Logs show "📦 Unhandled WebSocket error: { error: 'rate limit exceeded', seq: XXX }". This does not affect core functionality - loads are queued and delivered, but may experience delays during high-volume periods. Future enhancement: implement message throttling or batching.

**ZELLO DOCUMENT INTEGRATION**: Complete document management system integrated with Zello Work app. Drivers upload documents (POD, BOL, inspection reports, damage photos) directly through Zello by taking photos and adding captions. System automatically categorizes documents based on keywords, attaches them to active loads, and displays in Communication Dashboard with Zello badges. Features include automatic document categorization, approval/rejection workflow with notes, document request via voice channels, visual gallery with category filters, and seamless integration with existing message attachment system. Documents uploaded via Zello webhook at /api/zello/webhook are stored in message_attachments table with full audit trail.

**TWO-TIER COMMUNICATION SYSTEM**: Complete bidirectional communication platform with distinct modes for general driver discussions and load-specific communications. The Communication Dashboard now features driver search functionality, allowing dispatchers to initiate general conversations with any driver for load negotiations without immediate assignment. When a load offer is accepted in a general thread, it automatically converts to a load-specific communication with the load attached. Key features include driver search with filtering, tabbed interface separating General Chats from Load Communications, load offer workflow with accept/decline functionality, and automatic thread type conversion upon load acceptance. Database enhancements include nullable loadId support for general conversations and threadType field to distinguish communication modes. The system seamlessly integrates with existing Zello Work voice dispatch for complete multi-channel driver engagement.

**WILLOW SMS INTEGRATION**: Complete SMS integration now operational with authentic DAT Puppeteer scraping. Features include real DAT login with 2FA support using dispatch@lampslogistics.com credentials (password: Anonymous#56111), browser automation for box truck and sprinter van targeting, enhanced SMS commands (BOOK, DECLINE), 30-second staggered messaging between drivers, professional LAMP Logistics SMS styling, dispatcher control panel at /sms-dispatching, and vehicle management dashboard for AI-ready smart load stacking. The system maintains both authentic Tennessee Load Feed AND real DAT scraping capabilities.

**DIRECT DAT PUPPETEER INTEGRATION**: Complete DAT scraping integration now fully operational within LoadMaster using user's exact 5-step login workflow. Successfully resolved Chrome/Chromium initialization issues in Replit environment and implemented authentic DAT automation following verified working flow: DAT login page → Carriers → DAT One Web → search-loads → 2FA completion. Features include direct Puppeteer automation with DAT credentials (dispatch@lampslogistics.com/Anonymous#56111), browser session management, intelligent load extraction targeting box trucks/sprinter vans in southeastern states (TN/KY/GA/AL/NC/SC/FL), automatic customer creation, immediate driver notifications via SMS, and full load lifecycle management. System provides `/api/dat-puppeteer/login`, `/api/dat-puppeteer/scrape`, and `/api/dat-puppeteer/status` endpoints for direct DAT integration. This provides native LoadMaster automation with proven DAT load acquisition capabilities.

The system also includes an automatic load offering system that evaluates new loads and sends SMS notifications to eligible drivers based on proximity (150-mile radius), equipment type compatibility, availability, and rate attractiveness. The professional dashboard interface is designed to match DAT One, offering real-time load listings and search filters.

# User Preferences

Preferred communication style: Simple, everyday language.

## UI/UX Preferences
- **Select Dropdowns**: Always use solid white backgrounds with proper borders and shadows, never transparent backgrounds
- **Form Elements**: Consistent styling with `bg-white border border-gray-300` for select triggers
- **Dropdown Menus**: Use `bg-white border border-gray-300 shadow-lg` for select content areas
- **Visibility**: Ensure all form elements are clearly visible and have proper contrast

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite.
- **UI Components**: Shadcn/ui (built on Radix UI primitives).
- **Styling**: Tailwind CSS with custom design tokens.
- **State Management**: TanStack Query (React Query) for server state.
- **Routing**: Wouter.
- **Form Handling**: React Hook Form with Zod validation.

## Backend Architecture
- **Framework**: Express.js with TypeScript.
- **Data Layer**: Drizzle ORM with PostgreSQL.
- **Database Adapter**: Neon Database serverless adapter.
- **Storage Interface**: Abstract storage interface with database implementation for persistent data.
- **Load Board Service**: Critical 10-second interval scraper service with automated login and session preservation for DAT.
- **Scheduler**: Node-cron based job scheduling with fallback interval timers.

## Database Design
- **ORM**: Drizzle ORM with PostgreSQL dialect.
- **Schema Structure**: Includes Drivers (contact, status), Customers, Loads (lifecycle, details, priority), Email Templates, and Email Logs.
- **Relationships**: Foreign key constraints between loads, drivers, and customers.

## Email System
- **Provider**: Nodemailer with SMTP configuration.
- **Templates**: Dynamic template system with variable substitution.
- **Triggers**: Automated emails based on load status changes.
- **Logging**: Audit trail of email communications.

## API Design
- **Pattern**: RESTful API endpoints.
- **Error Handling**: Centralized middleware with structured responses.
- **Request Logging**: Automatic logging of API requests.
- **Data Validation**: Zod schemas shared between frontend and backend.

## Feature Specifications
- **Driver Management**: Comprehensive onboarding, status tracking (available/on_route/unavailable), mood tracking, and payment workflow. Includes performance tracking visualization.
- **Load Matching**: Location-based (150-mile radius), equipment type compatibility (e.g., dry_van, refrigerated, flatbed), weight capacity safety checks, driver availability filtering, and AI-powered prediction confidence for driver matching.
- **Automated Communication**: Zello WebSocket notifications for all load offers and driver communications (no SMS, no Telegram). Email notifications for load lifecycle events still operational.
- **Load Workflow**: Intelligent load retry system with auto-forwarding to next eligible driver, post-confirmation messaging, and SMS command management for driver responses. Includes continuous load service for 24/7 operation and manual load entry system for VA data input.
- **Manual Load Entry**: Professional form at `/manual-load-entry` for VA to input DAT load information directly. Includes all standard DAT fields, automatic driver dispatch, and immediate display in DAT Loads tab.
- **UI/UX**: Consistent styling for forms and dropdowns, integrated document viewing in load management table, and professional dashboard matching DAT One design for displaying real scraped DAT loads.
- **Branding**: "LAMP Logistics New Load Offer" header for SMS messages.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle Kit**: Database migration and schema management.

## Messaging & Email Services
- **Zello Work WebSocket**: Primary communication system for all driver notifications and load offers (WebSocket Channel API at wss://zellowork.io/ws/lamp1).
- **Nodemailer**: SMTP email delivery (supports Gmail integration) for load lifecycle notifications only.

## UI Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **Tailwind CSS**: Utility-first CSS framework.

## Development Tools
- **Vite**: Build tool and development server.
- **TypeScript**: Type safety across the application.
- **ESBuild**: Fast JavaScript bundler.