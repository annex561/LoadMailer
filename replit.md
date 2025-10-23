# Overview

Load Signal is a comprehensive fleet management system designed for truck load tracking and logistics coordination. It enables the management of drivers, customers, and loads, with a primary focus on real-time load status tracking, automated communication, and streamlined logistics. The system features a real Tennessee Load Feed, an SMS-based driver onboarding system, and real-time GPS tracking for drivers. A key ambition is to provide a robust platform for efficient freight management, integrating with modern communication tools for dispatch and driver interaction.

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
- **Unified Messaging Architecture**: One conversation stream per driver for all communications (load-specific and general)
- **SMS-Only Communication**: Twilio SMS for all driver communications and notifications via Messaging Service (MG759c5b67bf8baed3da1d6b031efbe62c)
- **Bidirectional SMS**: Drivers reply via SMS, messages automatically routed to their unified conversation thread
- **Smart Load Context Detection**: Automatically detects load numbers in messages and associates them with relevant loads
  - Supports multiple formats: LOAD-123, 603006, TN-789, etc.
  - Falls back to driver's current active load if no number detected
- **Thread Management**: One thread per driver (threadType='unified'), optional load context per message
- **SMS Delivery**: All phone numbers normalized to E.164 format (+1XXXXXXXXXX) for Twilio compatibility
- **MMS Support**: Drivers can send images via SMS (proof of delivery, BOL photos) that automatically link to loads
- **Sleek UI**: Modern chat interface at `/unified-messaging` optimized for dispatcher-driver communication
- **Sound Notifications**: Web Audio API-based alerts for incoming driver messages in Communication Dashboard
  - Browser autoplay-compliant (activates on first user interaction)
  - 800Hz tone plays when new unread dispatch messages arrive
  - Detects new conversations and message count increases
- **Email System**: Nodemailer for automated email notifications based on load status changes, using dynamic templates.

## API Design
- **Pattern**: RESTful API endpoints.
- **Error Handling**: Centralized middleware.
- **Data Validation**: Zod schemas shared between frontend and backend.

## Feature Specifications
- **Driver Management**: Comprehensive onboarding, status tracking, and payment workflows.
- **Load Matching**: Location-based (150-mile radius), equipment type compatibility, weight capacity checks, and driver availability filtering.
- **Automated Communication**: SMS notifications for all load offers and driver communications via Twilio.
- **Load Workflow**: Intelligent load retry system, post-confirmation messaging, and manual load entry for VA input.
- **UI/UX**: Consistent styling for forms and dropdowns, integrated document viewing, and a professional dashboard.
- **MMS Document Integration**: Drivers upload documents via SMS/MMS, which are automatically categorized and attached to loads, viewable in the Communication Dashboard and BOL document section.
- **Unified Messaging System**: Sleek dispatcher interface with one conversation per driver, smart load context detection, and real-time SMS integration for seamless communication.
- **Professional Document Management System**: Complete approval workflow with quality validation, automation, and cloud integrations
  - **Smart Categorization**: MMS documents auto-categorized based on load lifecycle (scheduled→BOL, in_transit→freight_photo, delivered→POD)
  - **Approval Workflow**: One-click approve/reject with dispatcher notes, automatic driver SMS notifications for rejections
  - **RequiredDocumentsChecklist Component**: Visual progress tracker showing document completion status with color-coded badges
  - **EnhancedDocumentViewer**: Fullscreen viewer with zoom/pan/rotate, grid view, side-by-side comparison, keyboard shortcuts
  - **Canvas Annotations**: Four drawing tools (rectangle, arrow, freehand, text) with color picker for marking up documents
  - **Audit Trail Timeline**: Complete document history showing uploads, approvals, rejections, recategorizations with timestamps
  - **Automated Reminders**: Cron job (30-minute intervals) sends SMS reminders for missing BOL/POD documents based on time triggers
  - **PDF Generation**: Professional document packages with cover page, load summary, and all approved documents using PDFKit
  - **Email Delivery**: Send complete document packages to customers/shippers with PDF attachments via Nodemailer
  - **Load Completion Gate**: Prevents loads from being marked "completed" without all required documents approved (override capability for emergencies)
  - **Object Storage Integration**: Document backup to cloud storage with presigned URL generation for secure uploads
  - **Document Types**: bol, pod, weight_ticket, inspection, receipt, fuel_receipt, scale_ticket, other
  - **Quality Metrics**: Image resolution, file size, quality score (0-100), quality warnings for low-quality uploads
  - **Version Control**: Document resubmission with parent-child relationships, isLatestVersion tracking
  - **Database Schema**: Enhanced loadDocuments table with 17 new fields (approvalStatus, qualityMetrics, audit fields)
  - **Standalone Document Management Page** (`/document-management`): Centralized hub for managing all documents across loads
    - **Manual Upload**: Drag-and-drop interface for uploading documents with load selector, document type picker, and quality validation
    - **Document Library**: Grid/list view toggle showing all documents with thumbnails and metadata
    - **Advanced Filters**: Filter by load, document type, approval status, and search by load number
    - **Bulk Actions**: Select multiple documents for bulk approve/reject, download, or recategorize operations
    - **Stats Dashboard**: Real-time metrics showing total documents, pending approvals, average quality scores, and recent uploads
    - **EnhancedDocumentViewer Integration**: Click any document to open fullscreen viewer with annotation tools
    - **Null-Safety**: Gracefully handles documents without associated loads (orphaned documents)
    - **Backend API**: GET `/api/documents/all` returns all documents with joined load details, POST `/api/documents` for manual uploads
    - **Zod Validation**: Request validation using insertLoadDocumentSchema for data integrity
    - **Drizzle Query Optimization**: Flattened leftJoin queries to prevent object conversion errors
- **Real-Time GPS Tracking**: Mobile-optimized driver location tracking with secure token-based authentication
  - **Driver Tracker Page** (`/driver-tracker`): Mobile-optimized PWA interface using Leaflet maps for real-time driver location tracking
  - **60-Second Auto-Updates**: Battery-optimized GPS tracking with automatic position updates every 60 seconds
  - **Wake Lock Support**: Prevents device sleep during active tracking to maintain continuous location updates
  - **Token-Based Security**: Cryptographically secure tracking tokens (64-character hex) generated per driver to prevent location spoofing
  - **Authentication Flow**: Driver clicks "Start GPS Tracking" → Token generated via `POST /api/drivers/:driverId/generate-tracking-token` → Redirect to tracker with token in URL
  - **Location Updates**: `POST /api/driver-location/update` endpoint validates token before accepting GPS coordinates
  - **GPS Health Monitor**: Automatic background service that monitors GPS tracking health and sends reminders when tracking stops
    - Runs every 3 minutes checking loads with status "in_transit"
    - Detects stale GPS data (no updates in last 5 minutes)
    - Sends SMS reminder with tracking link when GPS tracking stops
    - Spam prevention: Maximum 1 reminder every 15 minutes per driver
    - SMS Format: "🚨 GPS tracking stopped for Load [NUMBER]. Please reopen: [tracking-link]"
    - Protocol detection: HTTP for localhost, HTTPS for production
  - **Security Features**:
    - Zod schema validation for all location data (lat: -90 to 90, lon: -180 to 180)
    - Rate limiting: 120 requests/hour per IP address
    - IP logging for all location updates and authentication failures
    - Token-driver ID binding validation (tokens only work for their assigned driver)
  - **Database Storage**: Driver locations stored in `driverLocations` table with full metadata (lat, lon, speed, heading, battery, timestamp)
  - **Real-Time Synchronization**: Location updates trigger React Query cache invalidation, immediately refreshing all components
    - Dashboard map refreshes instantly (no polling delay)
    - GPS tracking page updates immediately
    - Manual dispatch page shows current locations
    - All components query `/api/driver-locations/active` which returns real GPS data when available
  - **Dispatch Visibility**: Real-time driver locations visible on dispatch dashboard map at `/loadops-dashboard`
  - **Manual Update Button**: One-tap "Update Location Now" button for instant location sharing without automatic tracking

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle Kit**: Database migration and schema management.

## Messaging & Email Services
- **Twilio SMS**: Primary communication for all driver notifications. Supports bidirectional communication with smart thread routing.
- **Nodemailer**: SMTP email delivery for load lifecycle notifications.

## UI Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **Tailwind CSS**: Utility-first CSS framework.