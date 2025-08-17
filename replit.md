# Overview

LoadMaster is a comprehensive fleet management system designed for truck load tracking and logistics coordination. The application enables users to manage drivers, customers, loads, and automated email communications through a modern web interface. It provides real-time tracking of load statuses, automated email notifications for load lifecycle events, and comprehensive contact management for fleet operations.

**Critical Feature**: The system includes a robust load board scraper that pulls freight data from multiple load boards (DAT, Truckstop, etc.) every 10 seconds, ensuring continuous availability of fresh freight opportunities. The professional dashboard interface matches DAT One design with real-time load listings, search filters, and company sections.

**Automatic Load Offering**: Advanced location-based driver matching system that automatically evaluates every new load and sends Telegram notifications to eligible drivers based on proximity (150-mile radius), equipment type compatibility, availability status, and rate attractiveness. Equipment type filtering ensures drivers only receive loads for equipment they can handle (dry_van, refrigerated, flatbed, step_deck).

# User Preferences

Preferred communication style: Simple, everyday language.

## UI/UX Preferences
- **Select Dropdowns**: Always use solid white backgrounds with proper borders and shadows, never transparent backgrounds
- **Form Elements**: Consistent styling with `bg-white border border-gray-300` for select triggers
- **Dropdown Menus**: Use `bg-white border border-gray-300 shadow-lg` for select content areas
- **Visibility**: Ensure all form elements are clearly visible and have proper contrast

# Recent Changes

**Complete Weight Field Removal (Aug 17, 2025)**
- Removed "Weight lbs" field entirely from loads database schema per user requirements
- System now uses only "Weight capacity" field from driver preferences for load matching
- Updated all load creation forms, scrapers, and Telegram messages to exclude weight information
- Load matching algorithm simplified to use driver weight capacity without specific load weight constraints
- Database schema migration completed successfully - loads table no longer contains weight column
- All load offers and descriptions now omit weight specifications entirely

**Document Upload Integration into Load Management (Aug 17, 2025)**
- Removed standalone Document Management page per user feedback that drivers upload via mobile devices
- Integrated document viewing directly into load management table with new "Documents" column
- Added DocumentCount component showing real-time BOL and photo counts for each load
- Documents are displayed as visual indicators with file type icons and counts
- Backend document upload service remains active for mobile driver uploads
- Document workflow: drivers upload via mobile when "On Site", viewable in load management interface

**Driver Mood Tracking System Implementation (Aug 17, 2025)**
- Implemented comprehensive emoji-based mood tracking for team management
- Added 6 mood options: happy, neutral, stressed, frustrated, tired, sick with color-coded badges
- Created dedicated mood tracker dashboard with statistics and attention alerts
- Database schema updated with currentMood, moodUpdatedAt, and moodNote fields
- Backend API endpoint `/api/drivers/:id/mood` for mood updates with proper persistence
- Mood tracker accessible from main navigation sidebar
- Real-time mood updates with cache invalidation for immediate UI updates
- Drivers needing attention (stressed/frustrated/sick) highlighted prominently

**LAMP Logistics Branding and Load Management Enhancement (Aug 17, 2025)**
- Updated all Telegram load offers to include company header: "LAMP Logistics New Load Offer"
- Added "assigned" status to load schema and load management filter options
- Confirmed loads now move to load management section with "assigned" status for proper tracking
- Fixed storage method calls in Telegram service (getLoads → getAllLoads)
- Enhanced post-confirmation messaging with specific user requirements

**Post-Confirmation Messaging and Button Management (Aug 17, 2025)**
- Enhanced driver confirmation workflow with proper post-booking messaging
- Added automatic button removal from Telegram messages after driver confirmation/decline
- Implemented custom booking confirmation: "Your load has been booked. Please start planning your trip and heading to your pick up location"
- Fixed button interaction by passing message IDs through callback handlers
- Updated both confirmation and decline handlers to clean up message UI after action

**Enhanced Equipment Types and Load Matching (Aug 17, 2025)**
- Added comprehensive equipment types dropdown with 20+ variations from actual load boards
- Equipment types now include: sprinter_van, van, van_lift_gate, van_hotshot, straight_box_truck, box_truck, moving_van, flatbed, flatbed_hotshot, step_deck, lowboy, dry_van, refrigerated, power_only, container, car_carrier, tanker, dump_truck, conestoga, removable_gooseneck
- Enhanced load matching algorithm with proper driver preference scoring system
- Fixed all dropdown background transparency issues - all equipment selects now have solid white backgrounds
- Created test driver with preference fields and verified system functionality
- System successfully matching and sending load offers with 70-75% match scores
- Load board scraper generating loads with all equipment types for realistic testing
- Fixed equipment dropdown visibility issues across driver onboarding, contact forms, and DAT loads pages

**Enhanced Rate Setting and Telegram Integration (Aug 17, 2025)**
- Fixed driver rate input field: changed from number input to text input (removed up/down arrows)
- Enhanced backend to automatically calculate deadhead distance based on driver location and pickup address
- Updated Telegram service to include calculated deadhead distance in initial load offers to drivers
- Fixed rate setting modal functionality: dispatcher can now properly set rates and send confirmation messages to drivers
- Implemented `sendDispatcherRateConfirmation` method for proper Telegram notifications with rate details and deadhead distance
- Verified complete two-step booking workflow: Book Now → Rate Setting → Driver Confirmation → Load Assignment

**Complete Driver Lifecycle Management System (Aug 17, 2025)**
- Implemented comprehensive driver onboarding process with step-by-step workflow and form validation
- Created dedicated driver dashboard for load management, tracking, and communication
- Developed payment workflow component for end-to-end transaction processing
- Added complete backend API endpoints supporting driver lifecycle operations
- Fixed all technical issues (imports, fetch API, event handling) for stable operation
- Enhanced driver eligibility logic: unavailable drivers now properly excluded from load offers with database persistence
- Added Payment Workflow to sidebar navigation for easy access to payment processing

**Previous Features (Aug 17, 2025)**
- Implemented intelligent load retry system for non-responsive drivers
- First timeout (3 minutes): Resends same load to original driver with reminder message
- Second timeout (3 minutes): Automatically forwards load to next eligible driver in vicinity
- Enhanced callback query handling for Telegram inline keyboard buttons (Book/Decline)
- Fixed critical issue where booking buttons weren't responding due to text vs callback handler mismatch
- Added comprehensive dispatcher notifications for load reassignments and driver availability status
- Schema updated with retry tracking fields (retryCount, lastSentAt) for load offers
- System ensures continuous load coverage with automatic fallback to nearby drivers
- Implemented driver rate system: drivers see 90% of load board rate, dispatchers see both full and driver rates

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite as the build tool
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and CSS variables
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Form Handling**: React Hook Form with Zod validation schemas

## Backend Architecture
- **Framework**: Express.js with TypeScript
- **Development**: Hot module replacement via Vite middleware in development
- **Data Layer**: Drizzle ORM with PostgreSQL database
- **Database Adapter**: Neon Database serverless adapter
- **Storage Interface**: Abstract storage interface with in-memory implementation for development
- **Load Board Service**: Critical 10-second interval scraper service for continuous freight data acquisition
- **Scheduler**: Node-cron based job scheduling with fallback interval timers for reliability

## Database Design
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Structure**:
  - Drivers: Contact info, status tracking (available/on_route/unavailable)
  - Customers: Business contact details and account status
  - Loads: Complete load lifecycle with pickup/delivery details, priority levels
  - Email Templates: Configurable templates for automated notifications
  - Email Logs: Audit trail of all sent communications
- **Relationships**: Foreign key constraints between loads, drivers, and customers

## Email System
- **Provider**: Nodemailer with SMTP configuration
- **Templates**: Dynamic template system with variable substitution
- **Triggers**: Automated emails based on load status changes
- **Logging**: Complete audit trail of email communications

## API Design
- **Pattern**: RESTful API endpoints following resource-based URLs
- **Error Handling**: Centralized error middleware with structured responses
- **Request Logging**: Automatic logging of API requests with timing and response data
- **Data Validation**: Zod schemas shared between frontend and backend

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting with connection pooling
- **Drizzle Kit**: Database migration and schema management tools

## Email Services
- **Nodemailer**: SMTP email delivery with Gmail integration support
- **Environment Variables**: SMTP credentials and configuration

## UI Libraries
- **Radix UI**: Comprehensive set of accessible UI primitives
- **Lucide React**: Icon library for consistent iconography
- **Tailwind CSS**: Utility-first CSS framework

## Development Tools
- **Vite**: Fast build tool with HMR and development server
- **TypeScript**: Type safety across the entire application
- **ESBuild**: Fast JavaScript bundler for production builds
- **Replit Integration**: Development environment with error modal and cartographer plugins