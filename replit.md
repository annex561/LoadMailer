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
- **Unified Messaging**: One conversation stream per driver.
- **SMS**: Twilio SMS for all driver communications, bidirectional with smart load context and MMS.
- **Email**: Nodemailer for automated email notifications using dynamic templates.

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

## Feature Specifications
- **Driver Management**: Onboarding, status tracking, payment.
- **Load Matching**: Location, equipment, weight, driver availability filtering.
- **Automated Communication**: SMS for load offers and driver communications.
- **Load Workflow**: Intelligent load retry, post-confirmation messaging, manual entry.
- **LoadOps Dashboard Navigation**: Consolidated sidebar with Core Operations, Driver Management, Communication, AI & Smart Features, System & Reports.
- **Communication Dashboard**: Modern interface for driver communications with compact thread list, real-time updates, status indicators, AI-assisted messaging, quick message templates, and MMS preview.
- **Professional Document Management**: Approval workflow, quality validation, cloud integrations, smart categorization, enhanced viewer, audit trails, automated reminders, PDF generation. Prevents load completion without required documents.
- **Real-Time GPS Tracking**: Mobile-optimized, secure token-based authentication, 60-second auto-updates, wake lock, GPS health monitor.
- **Mobile Driver Dashboard (PWA)**: Installable PWA with dynamic authentication, driver stats, load history, WhatsApp-style chat, document upload, profile management.
    - **PWA Features**: Offline functionality, app icons, smart install prompt.
    - **Authentication**: Dynamic driver authentication via `?driverId=xxx` with localStorage persistence.
    - **Query Guards**: `enabled: !!driverId` for TanStack Query hooks.
    - **Mobile Optimizations**: Pull-to-refresh, swipe gestures, wake lock.
    - **GPS-Based Intelligent Status Buttons**: Context-aware load progression based on 0.5-mile proximity to pickup/delivery locations (Haversine formula, server-side geocoding), with manual fallback.
    - **Enhanced Hamburger Menu**: Profile Settings, Help & Support, Contact Dispatch, Logout.
    - **AI-Powered Messaging**: ChatGPT-assisted message composition for drivers. Generates 3 context-aware variations, quick message buttons, OpenAI integration (via Replit AI Integrations), context-aware message enhancement for professionalism.
- **Driver Dashboard Link Distribution System**: Automated and manual SMS delivery of personalized links with multi-layer security (authorization, rate limiting, batch limits, audit logging).
- **Driver Onboarding**: Supports token-optional flow for both invited and direct registrations, using a multi-step wizard. Also supports simple registration and admin creation.

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