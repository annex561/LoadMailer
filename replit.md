# Overview

TRAQ IQ is a comprehensive fleet management system designed for truck load tracking and logistics coordination. Its core purpose is to manage drivers, customers, and loads efficiently, with a strong emphasis on real-time load status updates, automated communication, and streamlined logistics. Key features include a Tennessee Load Feed, an SMS-based driver onboarding system, real-time GPS tracking, and a professional document management system. The project aims to establish a robust platform for efficient freight management, integrating modern communication tools for dispatch and driver interaction, with significant market potential in the logistics sector.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
The frontend is built with React 18 (TypeScript, Vite), using Shadcn/ui (Radix UI) for components, Tailwind CSS for styling, TanStack Query for state management, Wouter for routing, and React Hook Form with Zod for form handling.

## Backend
The backend utilizes Express.js with TypeScript, Drizzle ORM for PostgreSQL (via Neon Database serverless adapter), and Node-cron for job scheduling. It features an abstract storage interface.

## Database Design
Drizzle ORM is used with a PostgreSQL dialect, defining schemas for Drivers, Customers, Loads, Email Templates, and Email Logs. Load numbers use Nanoid for collision-proof generation. The system implements a multi-tenant architecture with `company_id` for data isolation across Companies, Subscriptions (Stripe integrated), Company Users (role-based access), Payment Methods, and Billing History. Indexes are applied on `company_id` for performance, and database-level security prevents cross-tenant data leakage.

## Communication System
The system features unified messaging with a single conversation stream per driver, including auto-thread creation and field mapping for API consistency. Twilio SMS handles all driver communications, featuring E.164 phone number normalization, simplified dashboard link formats, optional driver-to-dispatcher SMS relay, and a dual-routing architecture for incoming driver SMS to multiple load contexts. Nodemailer is used for automated email notifications. In-app messaging provides real-time bidirectional communication between drivers (mobile dashboard) and dispatchers (SMS Dispatch tab), with notification sounds, clear sender labels, and dedicated API endpoints.

## API Design
The project uses RESTful API endpoints with centralized error handling and shared Zod schemas for frontend and backend data validation.

## UI/UX Design System
The design system employs a consistent brand palette (Navy, Slate, Teal, Whitesmoke) and typography (Poppins, Inter, JetBrains Mono). It adheres to principles like 8px border-radius, 0.2s ease transitions, and 600 font weight for headings. Theming is managed with CSS variables and tokens for light/dark mode, with Shadcn/ui components customized with the Teal brand color. Dark mode is fully supported.

## Feature Specifications
- **Driver Management**: Onboarding, status tracking, payment.
- **Load Matching**: Filters by location, equipment, weight, and driver availability.
- **Automated Communication**: SMS for load offers and driver interactions.
- **Load Workflow**: Intelligent load retry, post-confirmation messaging, manual entry.
- **Unified Dispatcher Dashboard**: A central workspace with four tabs:
    - **Overview**: Quick stats, active loads, available drivers, activity feed, quick actions, smart search.
    - **GPS Tracking**: Live map integration, driver telemetry cards, 60-second auto-refresh.
    - **Documents**: Approval workflow, filterable document cards, quick approve/reject, 30-second auto-refresh.
    - **SMS Dispatch**: Driver selection, message textarea, quick templates, recent messages, 15-second auto-refresh.
- **Streamlined Navigation**: Consolidated sidebar with the Dispatcher Dashboard as the primary access point for core operations.
- **Communication Dashboard**: Modern interface for driver communications with real-time updates and quick message templates.
- **Professional Document Management**: Approval workflow, quality validation, cloud integrations, smart categorization, and PDF generation, blocking load completion without required documents.
- **Real-Time GPS Tracking**: Mobile-optimized, secure, with 60-second auto-updates and a GPS health monitor.
- **Mobile Driver Dashboard (PWA)**: Installable PWA with dynamic authentication, driver stats, load history, chat, document upload, and profile management. Includes GPS-based intelligent status buttons, an enhanced hamburger menu, and AI-powered messaging for drivers. Features debounced typing protection for message input.
- **Driver Dashboard Link Distribution System**: Automated and manual SMS delivery of personalized links with security measures.
- **Driver Onboarding**: Multi-step wizard supporting token-optional flows for invited and direct registrations, focusing on mobile driver dashboard access.
- **GA Loads Inbox**: A dedicated load scoring and management system using SQLite for lightweight load data:
    - **Load Scoring**: Algorithm-based scoring (0-100) considering RPM (50pts), deadhead penalty (-20pts), urgency bonus (10pts), equipment fit (10pts), and lane fit (10pts).
    - **Shortlist**: Top 10 highest-scored new loads for quick action.
    - **Workflow Actions**: Quote (generates email template), Book, Dismiss with status tracking.
    - **API Endpoints**: `/api/ga/loads/ingest`, `/api/ga/loads`, `/api/ga/loads/shortlist`, `/api/ga/loads/:id/quote`, `/api/ga/loads/:id/book`, `/api/ga/loads/:id/dismiss`.
    - **Frontend**: Dual-table view with score filter slider, located at `/loads-inbox`.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle Kit**: Database migration and schema management.

## Messaging & Email Services
- **Twilio SMS**: Primary communication for all driver notifications and bidirectional messaging.
- **Nodemailer**: SMTP email delivery for load lifecycle notifications.

## Payment Processing
- **Stripe**: Payment processing integrated via `stripe-replit-sync` library for automatic schema management and data synchronization (products, prices, customers, subscriptions).

## UI Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **Tailwind CSS**: Utility-first CSS framework.