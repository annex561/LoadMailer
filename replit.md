# Overview

LoadMaster is a comprehensive fleet management system designed for truck load tracking and logistics coordination. The application enables users to manage drivers, customers, loads, and automated email communications through a modern web interface. It provides real-time tracking of load statuses, automated email notifications for load lifecycle events, and comprehensive contact management for fleet operations.

# User Preferences

Preferred communication style: Simple, everyday language.

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