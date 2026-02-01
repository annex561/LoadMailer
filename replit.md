# Overview

TRAQ IQ is a comprehensive fleet management system for truck load tracking and logistics coordination. It aims to efficiently manage drivers, customers, and loads through real-time status updates, automated communication, and streamlined logistics. Key capabilities include a Tennessee Load Feed, SMS-based driver onboarding, real-time GPS tracking, and professional document management, positioning it as a robust platform for efficient freight management with significant market potential.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
The frontend uses React 18 (TypeScript, Vite), with Shadcn/ui (Radix UI) for components, Tailwind CSS for styling, TanStack Query for state management, Wouter for routing, and React Hook Form with Zod for form handling.

## Backend
The backend is built with Express.js (TypeScript), Drizzle ORM for PostgreSQL (via Neon Database serverless adapter), and Node-cron for job scheduling, featuring an abstract storage interface.

## Database Design
Drizzle ORM defines schemas for Drivers, Customers, Loads, Email Templates, and Email Logs in PostgreSQL. Load numbers use Nanoid. The system supports multi-tenancy with `company_id` for data isolation across Companies, Subscriptions, Company Users, Payment Methods, and Billing History. Indexes on `company_id` and database-level security prevent cross-tenant data leakage.

### Revenue Loop Schema
The Revenue Loop integrates the Offer → Book → RateCon → Invoice → Payment pipeline, including `loads` with extended fields, `ar_invoices` for tracking, `collections_items` for accounts receivable management with automated follow-ups, `activity_log` for audit trails, and `compliance_documents` for document tracking.

### Dispatch Gate (Trucks)
The `trucks` table incorporates `dispatch_gate_status` (GREEN, YELLOW, RED) and a `risk_score` (0-100) based on various components, with override capabilities.

## Communication System
A unified messaging system provides a single conversation stream per driver via Twilio SMS, featuring auto-threading, E.164 normalization, optional driver-to-dispatcher relay, and dual-routing for incoming messages. Nodemailer handles automated email notifications. In-app messaging offers real-time bidirectional communication between drivers (mobile dashboard) and dispatchers (SMS Dispatch tab), with notification sounds and dedicated API endpoints.

## API Design
The system uses RESTful API endpoints with centralized error handling and shared Zod schemas for validation.

## UI/UX Design System
A consistent brand palette (Navy, Slate, Teal, Whitesmoke) and typography (Poppins, Inter, JetBrains Mono) are used. Design principles include 8px border-radius, 0.2s ease transitions, and 600 font weight for headings. Theming uses CSS variables and tokens for light/dark mode, with customized Shadcn/ui components.

## Feature Specifications
- **Driver Management**: Onboarding, status tracking, payment.
- **Load Matching**: Filters by location, equipment, weight, and driver availability.
- **Automated Communication**: SMS for load offers and driver interactions.
- **Load Workflow**: Intelligent load retry, post-confirmation messaging, manual entry.
- **Unified Dispatcher Dashboard**: A central workspace with tabs for Overview, GPS Tracking, Documents, and SMS Dispatch (modern messaging interface).
- **Communication Dashboard**: Modern interface for driver communications with real-time updates and quick message templates.
- **Professional Document Management**: Approval workflow, quality validation, cloud integrations, smart categorization, and PDF generation, blocking load completion without required documents.
- **Real-Time GPS Tracking**: Mobile-optimized, secure, with 60-second auto-updates and a GPS health monitor.
- **Mobile Driver Dashboard (PWA)**: Installable PWA with dynamic authentication, driver stats, load history, chat, document upload, profile management, GPS-based intelligent status buttons, and AI-powered messaging.
- **Driver Dashboard Link Distribution System**: Automated and manual SMS delivery of personalized links.
- **Driver Onboarding**: Multi-step wizard supporting token-optional flows.
- **RateCon Inbox (Gmail Integration)**: Automatic rate confirmation email processing including Gmail scanning, PDF parsing (pdf2json), AI extraction (OpenAI GPT-4o) of 17 data fields, auto-customer creation, database integration (PostgreSQL), duplicate detection, and driver notification.
- **GA Loads Inbox**: A dedicated load scoring (0-100 based on RPM, deadhead, urgency, equipment, lane fit) and management system using SQLite. Features a shortlist, workflow actions (Quote, Book, Dismiss), distance calculation (OpenStreetMap/OSRM), and driver notification on booking.
- **Items (Collections) System**: Accounts receivable management with aging buckets, automated next action scheduling (SOFT, PAST_DUE, FINAL touch, Promise, Escalate), and workflow states (open, in_progress, promised, escalated, closed).
- **True RPM Calculator**: Profitability analysis tool for loads, calculating True RPM based on load pay, load miles, and deadhead miles (via OpenStreetMap/OSRM). Includes AI screenshot extraction (GPT-4o Vision), GPS auto-location, saved destinations, recent calculations, smart mode (time-based recommendations), and Loads Inbox integration.

# External Dependencies

## Database Services
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle Kit**: Database migration and schema management.

## Messaging & Email Services
- **Twilio SMS**: Primary communication for all driver notifications and bidirectional messaging.
- **Nodemailer**: SMTP email delivery for load lifecycle notifications.

## Payment Processing
- **Stripe**: Payment processing integrated via `stripe-replit-sync` library.

## UI Libraries
- **Radix UI**: Accessible UI primitives.
- **Lucide React**: Icon library.
- **Tailwind CSS**: Utility-first CSS framework.

## AI Services
- **OpenAI GPT-4o**: Used for AI extraction of load details from PDFs and screenshots.

## Mapping & Geocoding
- **OpenStreetMap APIs (Nominatim, OSRM)**: Used for geocoding and routing for distance calculations.