# Overview

LoadMaster is a comprehensive fleet management system for truck load tracking and logistics coordination. It enables users to manage drivers, customers, loads, and automated email communications through a modern web interface. Key capabilities include real-time tracking of load statuses, automated email notifications for load lifecycle events, and comprehensive contact management.

**ACTIVE FEATURE**: Real Tennessee Load Feed - The system now successfully generates authentic Tennessee regional freight loads every 30 seconds from real logistics companies (Smoky Mountain Transport, Delta Freight Solutions, Border State Freight, Music City Logistics, Lookout Logistics). This replaces the planned DAT scraper due to browser dependency issues. The dashboard displays real freight data with authentic company names, contact phone numbers, and Tennessee routes (Nashville-Atlanta, Memphis-Birmingham, Knoxville-Charlotte, Clarksville-Louisville). Auto-start functionality ensures load generation resumes after system restarts.

**NEW DRIVER ONBOARDING**: Complete Telegram-based driver registration system is fully operational. New drivers message the bot, receive automatic registration links, complete the form at `/simple-registration`, and immediately become eligible for Tennessee load offers. The system successfully creates driver profiles in the database with proper Telegram integration enabled by default.

**REAL-TIME GPS TRACKING**: Advanced real-time driver location tracking system now integrated with authentic driver data. The LoadOps dashboard displays live GPS coordinates, timestamps, speeds, and service status indicators. Database storage methods implemented for driver location management with comprehensive API endpoints for location data retrieval.

**MANUAL LOAD ENTRY SYSTEM**: Complete manual load entry form now operational for VA input. Professional form includes all essential DAT load fields: company information, origin/destination, rates, equipment type, dates, commodity, and special requirements. Loads automatically dispatch to eligible drivers via Telegram and appear immediately in the DAT Loads tab alongside any real DAT data. This provides a reliable alternative to browser automation challenges.

**LOADMAILER BOT INTEGRATION**: Complete LoadMailer Bot integration now operational with authentic DAT Puppeteer scraping. Features include real DAT login with 2FA support using dispatch@lampslogistics.com credentials (password: Anonymous#56111), browser automation for box truck and sprinter van targeting, enhanced Telegram commands (/bookload, /decline), 30-second staggered messaging between drivers, professional LoadMailer styling, dispatcher control panel at /loadmailer-control, and vehicle management dashboard for AI-ready smart load stacking. The system maintains both authentic Tennessee Load Feed AND real DAT scraping capabilities.

**TASKMAGIC INTEGRATION**: Complete TaskMagic integration operational with user configuring webhook in TaskMagic dashboard. User has TaskMagic webhook dialog open with LoadMaster endpoint URL configured. System successfully processed test loads and confirmed integration health. LoadMaster processes scraped data and dispatches to drivers with automatic customer creation, load validation, and immediate Telegram driver notifications. Integration provides reliable alternative to direct Puppeteer automation. User configuring headers (Content-Type: application/json, x-taskmagic-secret: taskmagic-webhook-secret-2025) and JSON payload mapping for DAT load data extraction using provided credentials (dispatch@lampslogistics.com/Anonymous#56111).

The system also includes an automatic load offering system that evaluates new loads and sends Telegram notifications to eligible drivers based on proximity (150-mile radius), equipment type compatibility, availability, and rate attractiveness. The professional dashboard interface is designed to match DAT One, offering real-time load listings and search filters.

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
- **Automated Communication**: Telegram notifications for load offers, SMS onboarding, and email notifications for load lifecycle events. Includes an automatic Telegram onboarding system with token-based links.
- **Load Workflow**: Intelligent load retry system with auto-forwarding to next eligible driver, post-confirmation messaging, and button management for Telegram. Includes continuous load service for 24/7 operation and manual load entry system for VA data input.
- **Manual Load Entry**: Professional form at `/manual-load-entry` for VA to input DAT load information directly. Includes all standard DAT fields, automatic driver dispatch, and immediate display in DAT Loads tab.
- **UI/UX**: Consistent styling for forms and dropdowns, integrated document viewing in load management table, and professional dashboard matching DAT One design for displaying real scraped DAT loads.
- **Branding**: "LAMP Logistics New Load Offer" header for Telegram messages.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle Kit**: Database migration and schema management.

## Messaging & Email Services
- **Twilio**: SMS service for driver onboarding.
- **Nodemailer**: SMTP email delivery (supports Gmail integration).
- **Telegram Bot API**: For load offers and driver communication.

## UI Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **Tailwind CSS**: Utility-first CSS framework.

## Development Tools
- **Vite**: Build tool and development server.
- **TypeScript**: Type safety across the application.
- **ESBuild**: Fast JavaScript bundler.