# Overview

TRAQ IQ is a comprehensive fleet management system for truck load tracking and logistics coordination. It manages drivers, customers, and loads, focusing on real-time load status tracking, automated communication, and streamlined logistics. Key features include a Tennessee Load Feed, an SMS-based driver onboarding system, real-time GPS tracking, and a professional document management system. The project aims to provide a robust platform for efficient freight management, integrating modern communication tools for dispatch and driver interaction, with ambitions to capture significant market share in the logistics sector.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
- **Framework**: React 18 with TypeScript and Vite.
- **UI Components**: Shadcn/ui (Radix UI primitives).
- **Styling**: Tailwind CSS with custom design tokens.
- **State Management**: TanStack Query (React Query) for server state.
- **Routing**: Wouter.
- **Form Handling**: React Hook Form with Zod validation.

## Backend
- **Framework**: Express.js with TypeScript.
- **Data Layer**: Drizzle ORM with PostgreSQL.
- **Database Adapter**: Neon Database serverless adapter.
- **Storage Interface**: Abstract storage interface with database implementation.
- **Scheduler**: Node-cron based job scheduling.

## Database Design
- **ORM**: Drizzle ORM with PostgreSQL dialect.
- **Schema**: Drivers, Customers, Loads, Email Templates, Email Logs with defined relationships.
- **IDs**: Nanoid-based collision-proof load number generation (LOAD-XXXXXX-nanoid).

## Communication System
- **Unified Messaging**: One conversation stream per driver with automatic thread creation.
  - **Auto-Thread Creation**: Unified threads automatically created when driver sends first message from mobile dashboard or SMS.
  - **Field Mapping**: API boundary maps database fields (`lastMessageText`/`lastMessageAt`) to frontend-expected names (`lastMessage`/`lastMessageTimestamp`).
- **SMS**: Twilio SMS for all driver communications, bidirectional with smart load context and MMS.
  - **Dashboard Link Format**: Simplified format with only truck emoji (🚛) to avoid carrier spam filters. No bullet point emojis (✅📍💬).
  - **Driver-to-Dispatcher SMS Relay**: Optional SMS notifications to dispatcher when driver sends in-app messages (requires `DISPATCHER_PHONE_NUMBER` env var).
- **Email**: Nodemailer for automated email notifications using dynamic templates.
- **In-App Messaging**: Real-time bidirectional messaging between drivers (mobile dashboard) and dispatchers (SMS Dispatch tab).
  - Mobile dashboard sends messages with `{threadId: 'auto', driverId, content, sender: 'driver'}`.
  - Backend auto-discovers or creates unified thread for driver.
  - Messages appear in Dispatcher Dashboard's SMS Dispatch tab (Recent Messages) and Activity Feed.

## API Design
- **Pattern**: RESTful API endpoints.
- **Error Handling**: Centralized middleware.
- **Data Validation**: Zod schemas shared between frontend and backend.

## UI/UX Design System
- **Brand Colors**: Navy (#0A101A), Slate (#1E2733), Teal (#00B5B8 - primary), Whitesmoke (#F3F5F7), Success (#3AE374), Error (#E63946).
- **Typography**: Poppins (primary), Inter (secondary), JetBrains Mono (monospace).
- **Design Principles**: 8px border-radius, 0.2s ease transitions, button hover effects, 600 font weight for headings.
- **Theming**: CSS variables and theme tokens for light/dark mode adaptation (`hsl(var(--color))`).
- **Component Styling**: Shadcn/ui components modernized with Teal brand color via `--primary` token.
- **Dark Mode**: Fully functional with Navy background, Slate cards, Teal accents, and Whitesmoke text.
- **Strict Color Usage**: No hard-coded hex values or utility classes in UI components.
- **Sidebar Background Fix**: Use `bg-[hsl(var(--sidebar))]` instead of `bg-sidebar` to prevent alpha transparency issues while maintaining theme support.

## Feature Specifications
- **Driver Management**: Onboarding, status tracking, payment.
- **Load Matching**: Location, equipment, weight, driver availability filtering.
- **Automated Communication**: SMS for load offers and driver communications.
- **Load Workflow**: Intelligent load retry, post-confirmation messaging, manual entry.
- **Unified Dispatcher Dashboard**: Mission control center consolidating all dispatcher tools into one workspace with tabbed interface. Features include:
    - **Four-Tab Layout**: Overview, GPS Tracking, Documents, SMS Dispatch tabs for complete dispatcher workflow.
    - **Overview Tab**: 
        - Quick Stats Cards: Real-time metrics for Active Loads, Available Drivers, Pending Assignments, and Today's Pickups.
        - Three-Panel Layout: Active Loads (left), Available Drivers (center), Activity Feed (right) with color-coded status badges and quick actions.
        - Quick Actions Bar: Create Load, Assign Driver, Send Message, View GPS - all accessible from top bar.
        - Smart Search: Live filtering across loads (by number, customer, status) and drivers (by name, equipment).
    - **GPS Tracking Tab**: 
        - Live map integration using DriverLocationMap component showing all active driver locations.
        - Driver telemetry cards displaying: current address, speed, battery level, last update timestamp, moving/stationary status.
        - Empty state handling for no active GPS data.
        - Auto-refresh: 60-second intervals for driver locations.
    - **Documents Tab**: 
        - Document approval workflow with filter dropdown (all/pending/approved/rejected).
        - Document cards showing: type, load number, driver name, upload time, status badge.
        - Quick approve/reject buttons with driver SMS notifications.
        - Pending document count badge on tab (red).
        - Auto-refresh: 30-second intervals for documents.
    - **SMS Dispatch Tab**: 
        - Driver selection dropdown and message textarea.
        - Quick message templates: Check Availability, Status Update, Load Assigned.
        - Form validation (driver and message required).
        - Recent messages section showing last 10 threads.
        - Auto-refresh: 15-second intervals for communication threads.
    - **Auto-Refresh Strategy**: Optimized polling intervals (loads: 30s, drivers/locations: 60s, activity/threads: 15s, documents: 30s) for real-time updates.
    - **Professional Styling**: Teal/Navy brand colors, responsive design, loading states, empty states, toast notifications.
- **Streamlined Navigation**: Consolidated sidebar with Dispatcher Dashboard at top of Core Operations. Removed redundant items (Loads, DAT Loads, Manual Load Entry, Driver Management, Driver Messages, GPS Tracking, Document Management) now accessible via unified dashboard.
- **Communication Dashboard**: Modern interface for driver communications with compact thread list, real-time updates, status indicators, AI-assisted messaging, quick message templates, and MMS preview.
- **Professional Document Management**: Approval workflow, quality validation, cloud integrations, smart categorization, enhanced viewer, audit trails, automated reminders, PDF generation. Prevents load completion without required documents.
- **Real-Time GPS Tracking**: Mobile-optimized, secure token-based authentication, 60-second auto-updates, wake lock, GPS health monitor.
- **Mobile Driver Dashboard (PWA)**: Installable PWA with dynamic authentication, driver stats, load history, WhatsApp-style chat, document upload, profile management.
    - **PWA Configuration**: 
        - Manifest: `start_url: /mobile-driver-dashboard`, `theme_color: #00B5B8` (teal), `scope: /`, standalone display mode.
        - Professional icons: Teal-branded 192x192 and 512x512 app icons with truck logo.
        - Service Worker: SPA-aware routing with network-first strategy for navigation, offline fallback to cached shell, cache-first for assets.
        - Offline Support: App shell cached for offline operation, React Router handles client-side navigation.
    - **Authentication**: Dynamic driver authentication via `?driverId=xxx` with localStorage persistence.
    - **Query Guards**: `enabled: !!driverId` for TanStack Query hooks.
    - **Mobile Optimizations**: Pull-to-refresh, swipe gestures, wake lock.
    - **GPS-Based Intelligent Status Buttons**: Context-aware load progression based on 0.5-mile proximity to pickup/delivery locations (Haversine formula, server-side geocoding), with manual fallback.
    - **Enhanced Hamburger Menu**: Profile Settings, Help & Support, Contact Dispatch, Logout.
    - **AI-Powered Messaging**: ChatGPT-assisted message composition for drivers. Generates 3 context-aware variations, quick message buttons, OpenAI integration (via Replit AI Integrations), context-aware message enhancement for professionalism.
    - **Debounced Typing Protection**: Message input uses debounced typing detection (3s inactivity window) to pause polling during active typing, preventing input field from disappearing due to re-renders. Polling automatically resumes after inactivity or message send.
- **Driver Dashboard Link Distribution System**: Automated and manual SMS delivery of personalized links with multi-layer security (authorization, rate limiting, batch limits, audit logging).
- **Driver Onboarding**: Supports token-optional flow for both invited and direct registrations, using a multi-step wizard. Also supports simple registration and admin creation.
    - **Completion Flow**: Registration success screen focuses on mobile driver dashboard access (NO Zello references). Auto-redirects to `/mobile-driver-dashboard?driverId=${id}` after 2 seconds with manual override button. Cache invalidation ensures new drivers immediately appear in dispatcher's driver list.

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