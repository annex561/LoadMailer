# Overview

LoadMaster is a comprehensive fleet management system designed for truck load tracking and logistics coordination. The application enables users to manage drivers, customers, loads, and automated email communications through a modern web interface. It provides real-time tracking of load statuses, automated email notifications for load lifecycle events, and comprehensive contact management for fleet operations.

**Critical Feature**: The system includes a robust load board scraper that pulls freight data from multiple load boards (DAT, Truckstop, etc.) every 10 seconds, ensuring continuous availability of fresh freight opportunities. The professional dashboard interface matches DAT One design with real-time load listings, search filters, and company sections.

**Automatic Load Offering**: Advanced location-based driver matching system that automatically evaluates every new load and sends Telegram notifications to eligible drivers based on proximity (150-mile radius), equipment type compatibility, availability status, and rate attractiveness. Equipment type filtering ensures drivers only receive loads for equipment they can handle (dry_van, refrigerated, flatbed, step_deck).

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

**Automatic Load Retry System (Aug 17, 2025)**
- Implemented intelligent load retry system for non-responsive drivers
- First timeout (3 minutes): Resends same load to original driver with reminder message
- Second timeout (3 minutes): Automatically forwards load to next eligible driver in vicinity
- Enhanced callback query handling for Telegram inline keyboard buttons (Book/Decline)
- Fixed critical issue where booking buttons weren't responding due to text vs callback handler mismatch
- Added comprehensive dispatcher notifications for load reassignments and driver availability status
- Schema updated with retry tracking fields (retryCount, lastSentAt) for load offers
- System ensures continuous load coverage with automatic fallback to nearby drivers

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