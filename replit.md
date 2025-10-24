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
- **Professional Document Management System**: Complete approval workflow with quality validation, automation, and cloud integrations. Includes smart categorization, an enhanced viewer with annotations, audit trails, automated reminders, and PDF generation. Prevents load completion without all required documents.
- **Real-Time GPS Tracking**: Mobile-optimized driver location tracking with secure token-based authentication, 60-second auto-updates, wake lock support, and a GPS health monitor.
- **Mobile Driver Dashboard**: A PWA interface with dynamic authentication, providing driver stats, load history, WhatsApp-style chat, document upload, and profile management, optimized for mobile with offline support, pull-to-refresh, and swipe gestures.

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