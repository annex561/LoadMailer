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
- **SMS-Only Architecture**: Twilio SMS for all driver communications and notifications
- **Bidirectional Communication**: SMS supports incoming messages with smart routing to correct communication threads
- **Message Routing**: Automatic routing of incoming SMS messages to appropriate communication threads (load-specific or general) based on load number detection
- **Smart Load Number Detection**: Universal regex pattern supporting multiple formats:
  - Standard prefixed: LOAD-123, TEST-LOAD-001, LM-1234, BOL-123, REF-456, TN-789
  - Numeric only: 603006, 602951 (automatically matched to LOAD-603006, LOAD-602951)
  - Normalized comparison strips prefixes to ensure accurate thread matching
- **SMS Delivery**: All phone numbers normalized to E.164 format (+1XXXXXXXXXX) for Twilio compatibility
- **MMS Support**: Drivers can send images via SMS (proof of delivery, BOL photos) that automatically link to loads and appear in the BOL document section
- **Performance Optimization**: Load number caching to minimize database queries during message routing
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
- **Two-Tier Communication System**: Bidirectional SMS platform with distinct modes for general driver discussions and load-specific communications, featuring driver search and automatic thread type conversion.

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