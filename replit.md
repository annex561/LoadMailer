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
- **Primary Communication**: Zello Work WebSocket for all driver notifications and load offers. This is the exclusive channel for load-related communications, replacing SMS and other services.
- **Email System**: Nodemailer for automated email notifications based on load status changes, using dynamic templates.

## API Design
- **Pattern**: RESTful API endpoints.
- **Error Handling**: Centralized middleware.
- **Data Validation**: Zod schemas shared between frontend and backend.

## Feature Specifications
- **Driver Management**: Comprehensive onboarding, status tracking, and payment workflows.
- **Load Matching**: Location-based (150-mile radius), equipment type compatibility, weight capacity checks, and driver availability filtering.
- **Automated Communication**: Zello WebSocket notifications for all load offers and driver communications.
- **Load Workflow**: Intelligent load retry system, post-confirmation messaging, and manual load entry for VA input.
- **UI/UX**: Consistent styling for forms and dropdowns, integrated document viewing, and a professional dashboard.
- **Zello Document Integration**: Drivers upload documents via Zello, which are categorized and attached to loads, viewable in the Communication Dashboard.
- **Two-Tier Communication System**: Bidirectional platform with distinct modes for general driver discussions and load-specific communications, featuring driver search and automatic thread type conversion.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle Kit**: Database migration and schema management.

## Messaging & Email Services
- **Zello Work WebSocket**: Primary communication system for all driver notifications and load offers (wss://zellowork.io/ws/lamp1).
- **Nodemailer**: SMTP email delivery for load lifecycle notifications.

## UI Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **Tailwind CSS**: Utility-first CSS framework.