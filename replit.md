# Overview

Load Signal is a comprehensive fleet management system for truck load tracking and logistics coordination. It manages drivers, customers, and loads, focusing on real-time load status tracking, automated communication, and streamlined logistics. Key features include a Tennessee Load Feed, an SMS-based driver onboarding system, and real-time GPS tracking. The project aims to provide a robust platform for efficient freight management, integrating modern communication tools for dispatch and driver interaction, with ambitions to capture significant market share in the logistics sector.

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
- **Scheduler**: Node-cron based job scheduling.

## Database Design
- **ORM**: Drizzle ORM with PostgreSQL dialect.
- **Schema Structure**: Includes Drivers, Customers, Loads, Email Templates, and Email Logs with defined relationships.

## Communication System
- **Unified Messaging Architecture**: One conversation stream per driver for all communications.
- **SMS Communication**: Twilio SMS for all driver communications and notifications, with bidirectional capabilities and smart load context detection.
- **MMS Support**: Allows drivers to send images (e.g., proof of delivery) via SMS, linked to loads.
- **Email System**: Nodemailer for automated email notifications based on load status changes, using dynamic templates.

## API Design
- **Pattern**: RESTful API endpoints.
- **Error Handling**: Centralized middleware.
- **Data Validation**: Zod schemas shared between frontend and backend.

## Feature Specifications
- **Driver Management**: Onboarding, status tracking, payment workflows.
- **Load Matching**: Location-based, equipment type, weight capacity, and driver availability filtering.
- **Automated Communication**: SMS notifications for load offers and driver communications.
- **Load Workflow**: Intelligent load retry system, post-confirmation messaging, and manual load entry.
- **UI/UX**: Consistent styling for forms and dropdowns, integrated document viewing, and a professional dashboard.
- **Communication Dashboard**: Modern, optimized interface for driver communications with compact thread list (320px fixed sidebar), real-time message updates (2s polling), status indicators (emerald/amber/gray dots), enhanced search/filter, AI-assisted messaging, and comprehensive empty/loading states. Features include quick message templates, MMS image preview, and WhatsApp-style chat interface.
- **Professional Document Management System**: Complete approval workflow with quality validation, automation, and cloud integrations. Includes smart categorization, an enhanced viewer with annotations, audit trails, automated reminders, and PDF generation. Prevents load completion without all required documents.
- **Real-Time GPS Tracking**: Mobile-optimized driver location tracking with secure token-based authentication, 60-second auto-updates, wake lock support, and a GPS health monitor.
- **Mobile Driver Dashboard**: A PWA (Progressive Web App) interface with dynamic authentication, providing driver stats, load history, WhatsApp-style chat, document upload, and profile management.
  - **PWA Features**: Installable to home screen without App Store, offline functionality via service worker, app icons in multiple sizes (192x192, 512x512, 180x180)
  - **Authentication Pattern**: Dynamic driver authentication via URL parameter `?driverId=xxx` with localStorage persistence for PWA launches
  - **Query Guards**: All driverId-dependent TanStack Query hooks use `enabled: !!driverId` to prevent malformed API calls
  - **Fallback UI**: Error screen displays when driverId is missing, directing drivers to use official dispatch link
  - **Mobile Optimizations**: Pull-to-refresh, swipe gestures, offline support, wake lock for GPS tracking, WhatsApp-style messaging interface
- **Driver Dashboard Link Distribution System**: Automated and manual SMS delivery of personalized driver dashboard links with multi-layer security.
  - **Automated Onboarding SMS**: New drivers automatically receive dashboard link via SMS upon account creation (non-blocking fire-and-forget)
  - **Individual Resend**: Green Smartphone button on each driver card allows dispatch to resend dashboard link to specific drivers
  - **Bulk Distribution**: "Send All Dashboards" button enables mass SMS distribution to all drivers with valid phone numbers
  - **Security Layers**: 3-tier authorization (session/API key/dev bypass), rate limiting (1/hour/IP), batch size limit (100 max), comprehensive audit logging
  - **Dashboard URL Format**: `https://{domain}/driver-dashboard?driverId={id}` - unique per driver for secure access
  - **SMS Message Template**: Welcome message with dashboard link and installation instructions for PWA home screen setup
  - **Cost Protection**: Rate limiting prevents spam, batch size caps prevent runaway Twilio costs, 500ms delays respect Twilio throttling
  - **Audit Trail**: All bulk sends logged with user identifier, IP address, and timestamp for compliance monitoring

# Production Readiness Testing

## Comprehensive End-to-End Load Lifecycle Testing (October 2025)
Successfully completed comprehensive mock trial of the entire load lifecycle from dispatch to driver payment, simulating both roles to verify system integrity.

### Testing Scope
- **Load Creation & Assignment**: Dispatch creates load and assigns to driver
- **Driver Communication**: SMS notifications and bidirectional messaging
- **Load Status Progression**: scheduled → assigned → picked_up → in_transit → delivered → completed
- **GPS Tracking**: Real-time location updates during transit
- **Document Management**: BOL and POD upload with approval workflow
- **Payment Processing**: Driver earnings calculation and stats update
- **Dashboard Verification**: Driver mobile dashboard data accuracy

### Critical Bugs Fixed
1. **Driver Stats Auto-Update**: Fixed total_loads, completed_loads, and total_revenue not updating when loads complete - now updates correctly in real-time
2. **Driver Status Management**: Fixed driver status not changing to 'on_route' when load assigned - now updates automatically
3. **API Load Filtering**: Fixed GET /api/loads?driverId query returning all loads instead of driver-specific loads - now filters correctly
4. **Status Serialization**: Fixed API responses returning null status values - now returns complete load objects with all fields
5. **Storage Layer Architecture**: Eliminated dual storage (PostgreSQL + in-memory Map) - PostgreSQL is now sole source of truth with collision-proof load number generation using nanoid

### Architecture Improvements
- **Single Source of Truth**: Removed in-memory Map fallback, all loads now stored exclusively in PostgreSQL
- **Collision-Proof IDs**: Implemented nanoid-based load number generation (LOAD-XXXXXX-nanoid) to prevent duplicate key conflicts
- **Database Integrity**: All driver-load relationships, documents, and stats properly persisted and queryable
- **Document Gate Working**: System correctly enforces approved BOL + POD requirements before load completion

### Test Results
- ✅ Complete load lifecycle verified working end-to-end
- ✅ Driver stats update correctly ($2500 revenue, +1 load, +1 completed)
- ✅ Driver status transitions properly ('available' → 'on_route')
- ✅ API filtering returns correct subset of loads (not all 827+)
- ✅ All API responses include complete data with proper serialization
- ✅ GPS tracking SMS sent with secure token-based authentication
- ✅ Document approval workflow prevents premature completion
- ✅ Database integrity maintained with no orphaned records

### Status
**PRODUCTION READY** - All critical bugs fixed and verified through comprehensive end-to-end testing. System is stable, consistent, and ready for deployment.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle Kit**: Database migration and schema management.

## Messaging & Email Services
- **Twilio SMS**: Primary communication for all driver notifications, supporting bidirectional communication.
- **Nodemailer**: SMTP email delivery for load lifecycle notifications.

## UI Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **Tailwind CSS**: Utility-first CSS framework.