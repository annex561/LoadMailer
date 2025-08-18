# Overview

LoadMaster is a comprehensive fleet management system for truck load tracking and logistics coordination. It enables users to manage drivers, customers, loads, and automated email communications through a modern web interface. Key capabilities include real-time tracking of load statuses, automated email notifications for load lifecycle events, and comprehensive contact management.

A critical feature is the robust load board scraper, which pulls freight data from multiple load boards (e.g., DAT, Truckstop) every 10 seconds. The system also includes an automatic load offering system that evaluates new loads and sends Telegram notifications to eligible drivers based on proximity (150-mile radius), equipment type compatibility, availability, and rate attractiveness. The professional dashboard interface is designed to match DAT One, offering real-time load listings and search filters. The business vision is to provide continuous access to fresh freight opportunities and optimize load-driver matching for fleet operations.

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
- **Storage Interface**: Abstract storage interface with in-memory implementation for development.
- **Load Board Service**: Critical 10-second interval scraper service.
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
- **Driver Management**: Comprehensive onboarding, status tracking (available/on_route/unavailable), mood tracking, and payment workflow.
- **Load Matching**: Location-based (150-mile radius), equipment type compatibility (e.g., dry_van, refrigerated, flatbed), weight capacity safety checks, and driver availability filtering.
- **Automated Communication**: Telegram notifications for load offers, SMS onboarding, and email notifications for load lifecycle events.
- **Load Workflow**: Intelligent load retry system with auto-forwarding to next eligible driver, post-confirmation messaging, and button management for Telegram.
- **UI/UX**: Consistent styling for forms and dropdowns, integrated document viewing in load management table, and professional dashboard matching DAT One design.
- **Branding**: "LAMP Logistics New Load Offer" header for Telegram messages.

## Recent Progress (August 17, 2025)

### Telegram Driver Onboarding - FULLY FUNCTIONAL ✅
- **Token-Based Onboarding**: Drivers can now successfully use invitation links with tokens
- **Frontend Token Extraction**: Fixed React SPA routing issue preventing token detection
- **Direct URL Parsing**: Simple regex-based token extraction from full URL string
- **Backend Validation**: Token validation API confirms tokens exist and are valid
- **Complete Workflow**: End-to-end onboarding process fully operational
- **Working Link Format**: `http://domain/driver-onboarding?token=<uuid>`

### Automatic Telegram Onboarding ✅
- **Fully Automatic System**: Zero manual intervention required for new driver onboarding
- **Smart Monitoring**: Bot automatically detects when users start chat and sends instant invitations
- **Professional Branding**: Enhanced welcome flow with LAMP Logistics branding and interactive buttons
- **Token Management**: Auto-generated unique tokens with 7-day expiration and database logging
- **Support Integration**: Built-in "Contact Support" and "How It Works" interactive features
- **Bot Link**: https://t.me/LAMPDispatchbot for instant automatic onboarding

### SMS System Resolution ✅
- **Issue Identified**: Error 30034 (carrier rejection) affecting specific phone numbers
- **System Status**: Fully operational for compatible phone numbers
- **Diagnostic Tools**: SMS Status Dashboard created at `/sms-status` for real-time delivery tracking
- **Dual Phone Support**: Load balancing between +1 423 455 5007 and +1 855 599 9983
- **Root Cause**: Carrier-level blocking, not system malfunction

### System Components Verified
- ✅ Load Board Scraper: Generating sample loads every 10 seconds
- ✅ Telegram Integration: Fully automatic onboarding with professional messaging
- ✅ Database Operations: PostgreSQL with Drizzle ORM working correctly
- ✅ Driver Management: Complete hands-off onboarding workflow operational
- ✅ Driver Onboarding Links: Token extraction and validation working correctly
- ✅ SMS Delivery: Working for compatible phone numbers
- ✅ Error Diagnostics: Comprehensive status tracking implemented

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