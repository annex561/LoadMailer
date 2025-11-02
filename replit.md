# Overview

TRAQ IQ is a comprehensive fleet management system for truck load tracking and logistics coordination. It manages drivers, customers, and loads, focusing on real-time load status tracking, automated communication, and streamlined logistics. Key features include a Tennessee Load Feed, an SMS-based driver onboarding system, and real-time GPS tracking. The project aims to provide a robust platform for efficient freight management, integrating modern communication tools for dispatch and driver interaction, with ambitions to capture significant market share in the logistics sector.

# User Preferences

Preferred communication style: Simple, everyday language.

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
- **Collision-Proof IDs**: Implemented nanoid-based load number generation (LOAD-XXXXXX-nanoid) to prevent duplicate key conflicts.

## Communication System
- **Unified Messaging Architecture**: One conversation stream per driver for all communications.
- **SMS Communication**: Twilio SMS for all driver communications and notifications, with bidirectional capabilities and smart load context detection, including MMS support for image uploads.
- **Email System**: Nodemailer for automated email notifications based on load status changes, using dynamic templates.

## API Design
- **Pattern**: RESTful API endpoints.
- **Error Handling**: Centralized middleware.
- **Data Validation**: Zod schemas shared between frontend and backend.

## UI/UX Design System
- **Brand Colors**: Navy (#0A101A), Slate (#1E2733), Teal (#00B5B8 - primary accent), Whitesmoke (#F3F5F7), Success (#3AE374), Error (#E63946).
- **Typography**: Poppins (primary), Inter (secondary), JetBrains Mono (monospace).
- **Design Principles**: 8px border-radius, 0.2s ease transitions, button hover effects, 600 font weight for headings.
- **Theming**: CSS variables and theme tokens for automatic light/dark mode adaptation, using `hsl(var(--color))` for components.
- **Component Styling**: Shadcn/ui components are modernized with Teal brand color via `--primary` token, consistent focus states and hover effects.
- **Dark Mode**: Fully functional with Navy background, Slate cards, Teal accents, and Whitesmoke text.
- **Strict Color Usage**: No hard-coded hex values or utility classes like `bg-white`, `text-gray-X`, `border-gray-X`, `bg-teal` in UI components.

## Feature Specifications
- **Driver Management**: Onboarding, status tracking, payment workflows.
- **Load Matching**: Location-based, equipment type, weight capacity, and driver availability filtering.
- **Automated Communication**: SMS notifications for load offers and driver communications.
- **Load Workflow**: Intelligent load retry system, post-confirmation messaging, and manual load entry.
- **LoadOps Dashboard Navigation**: Consolidated sidebar with 5 organized sections: Core Operations, Driver Management, Communication, AI & Smart Features, and System & Reports.
- **Communication Dashboard**: Modern, optimized interface for driver communications with compact thread list, real-time message updates, status indicators, AI-assisted messaging, quick message templates, and MMS image preview.
- **Professional Document Management System**: Complete approval workflow with quality validation, automation, cloud integrations, smart categorization, enhanced viewer with annotations, audit trails, automated reminders, and PDF generation. Prevents load completion without required documents.
- **Real-Time GPS Tracking**: Mobile-optimized driver location tracking with secure token-based authentication, 60-second auto-updates, wake lock support, and a GPS health monitor.
- **Mobile Driver Dashboard (PWA)**: Installable Progressive Web App with dynamic authentication, driver stats, load history, WhatsApp-style chat, document upload, and profile management.
    - **PWA Features**: Offline functionality, app icons, smart install prompt.
    - **Authentication**: Dynamic driver authentication via `?driverId=xxx` with localStorage persistence.
    - **Query Guards**: `enabled: !!driverId` for TanStack Query hooks.
    - **Mobile Optimizations**: Pull-to-refresh, swipe gestures, wake lock.
    - **GPS-Based Intelligent Status Buttons**: Context-aware load progression based on 0.5-mile proximity to pickup/delivery locations using Haversine formula and server-side geocoding. Includes manual fallback.
    - **Enhanced Hamburger Menu**: Profile Settings, Help & Support, Contact Dispatch, Logout.
    - **AI-Powered Messaging**: ChatGPT-assisted message composition for drivers on the road.
        - **Smart Suggestions**: Generates 3 context-aware message variations using driver/load information
        - **Quick Messages**: Pre-built buttons for common updates ("At Pickup", "Running Late")
        - **OpenAI Integration**: Uses GPT-5 via Replit AI Integrations (no API key required)
        - **Message Enhancement**: Professional tone improvement while maintaining driver's intent
        - **Context-Aware**: Includes load details and conversation history for relevance
- **Driver Dashboard Link Distribution System**: Automated and manual SMS delivery of personalized driver dashboard links with multi-layer security (authorization, rate limiting, batch size limits, audit logging).
    - **Security Layers**: 3-tier authorization, rate limiting (1/hour/IP), batch size limit (100 max), audit logging.

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

# Recent Updates

## AI-Powered Driver Messaging (November 2, 2025)
**Added**: Intelligent ChatGPT-powered message assistance to help drivers compose quick, professional messages while on the road.

### Key Features
1. **Smart Message Suggestions**: Drivers can get 3 AI-generated message variations with one tap
   - Context-aware suggestions using driver name, load details, and conversation history
   - Professional tone suitable for dispatch communication
   - Optimized for trucking/logistics scenarios

2. **Quick Action Buttons**: Pre-built message templates for common updates
   - "At Pickup" - Instantly sends arrival confirmation
   - "Running Late" - Quick delay notification
   - "AI Help" - Triggers intelligent message generation

3. **Blank Messages Bug Fix**: Resolved issue where messages appeared blank in mobile dashboard
   - Added dedicated query to fetch messages from `/api/communication/messages/:threadId`
   - Messages now load properly when thread is selected
   - Cache invalidation ensures real-time updates after sending

### Technical Implementation
- **Backend** (`server/openai-helper.ts`):
  - `generateMessageSuggestions()` - Generates 3 contextual message variations
  - `improveMessage()` - Enhances user-typed messages for professionalism
  - Uses OpenAI GPT-5 via Replit AI Integrations (no API key management required)
  - Includes fallback suggestions for offline/error scenarios

- **API Endpoint** (`server/routes.ts`):
  - `POST /api/ai/message-suggestions` - Generates context-aware suggestions
  - Parameters: `{ input, context, driverId, loadId }`
  - Returns: `{ success: true, suggestions: string[] }`

- **Frontend** (`client/src/pages/mobile-driver-dashboard.tsx`):
  - AI Help button in Messages tab (visible when thread selected)
  - Suggestions panel displays 3 clickable options
  - Clicking suggestion populates message input
  - Loading states and error handling with fallbacks

### Impact
- Drivers can compose professional messages quickly while on the road
- Reduces typing on mobile devices during driving stops
- Maintains consistent, professional communication with dispatch
- AI adapts suggestions to current load and driver context

## Mobile Scrolling Performance Fix (November 2, 2025)
**Fixed**: Resolved scrolling glitches in mobile driver dashboard that made it difficult to scroll up and down.

### Problem
The driver dashboard had severe scrolling issues caused by:
- Fixed viewport-height containers (`h-screen overflow-y-auto`) creating nested scroll contexts
- Pull-to-refresh touch handlers interfering with normal scroll gestures
- Messages tab enforcing its own viewport-sized container
- Insufficient bottom padding causing content to hide behind fixed navigation

### Solution
1. **Natural Document Scrolling**: Removed fixed-height containers in favor of natural page flow
   - Main container: Changed from `h-screen overflow-y-auto` to `pb-24` with natural height
   - Messages tab: Changed from `h-[calc(100vh-80px)]` to `min-h-screen`
   - Pull-to-refresh: Now uses `window.scrollY` instead of container scroll position

2. **Optimized Touch Handlers**: 
   - Pull-to-refresh only activates when `window.scrollY === 0`
   - Added `preventDefault()` to prevent scroll conflicts during pull gesture
   - No interference with normal scrolling behavior

3. **Layout Improvements**:
   - Bottom padding (96px) ensures content clears fixed bottom navigation (80px)
   - Chat header in Messages tab is now sticky for better UX
   - All tabs use consistent scrolling behavior

### Impact
- Smooth, native scrolling across all tabs (Home, Loads, Messages, Documents, Profile)
- No scroll glitches or stuck scroll positions
- Pull-to-refresh works reliably without blocking scroll
- Better mobile UX with natural touch behavior

## Smart Mobile Document Capture (November 2, 2025)
**Added**: Intelligent document management system for mobile drivers with capture-first workflow, post-capture categorization, and robust editing capabilities.

### Key Features
1. **Capture-First Workflow**: Drivers take photos first, then select document type
   - No pre-selection confusion - just tap "Take Photo" or "Choose File"
   - Image preview shown in type selection modal
   - Supports camera capture and gallery selection
   
2. **Smart Categorization Modal**: Post-capture document type selection
   - Large, touch-friendly buttons for BOL, POD, Weight Ticket
   - Image preview to verify photo quality before categorization
   - Clear cancel option to retake photos
   
3. **Robust Edit Functionality**: Full document management capabilities
   - Edit menu (⋮) on each document card
   - Change document type if miscategorized
   - Delete documents with confirmation dialog
   - Real-time UI updates with toast notifications
   
4. **Security Implementation**: Comprehensive authentication and authorization
   - Backend endpoints require `driverId` authentication
   - Document ownership validation before mutations
   - Unauthorized attempts logged with warnings
   - Proper HTTP status codes (401 auth, 403 authz, 404 not found)

### Technical Implementation
- **Backend Endpoints** (`server/routes.ts`):
  - `POST /api/documents/:documentId/recategorize` - Change document type with ownership validation
  - `DELETE /api/documents/:documentId` - Delete document with ownership validation
  
- **Frontend** (`client/src/pages/mobile-driver-dashboard.tsx`):
  - State: `pendingFile`, `showTypeModal`, `editingDocument`, `showDeleteConfirm`
  - Modals: Type selection, edit type, delete confirmation
  - Enhanced document cards with image previews and edit menus
  - Teal branding for document section

### Security Model
- Authentication via `driverId` in request body
- Backend validates driver existence and document ownership
- Frontend guards against missing driverId
- All mutations invalidate relevant queries for UI consistency

## Driver Onboarding Enhancement (October 30, 2025)
**Changed**: Driver onboarding page now works with or without invitation tokens for maximum flexibility.

### Key Changes
1. **Token-Optional Flow**: `/driver-onboarding` accepts both invited and direct registration
   - **With Token** (`/driver-onboarding?token=xxx`): Pre-fills email from invitation, validates token
   - **Without Token** (`/driver-onboarding`): Allows manual entry of all driver information
   - Both flows use the same professional multi-step wizard (5 steps)

2. **Frontend Updates** (`client/src/pages/driver-onboarding.tsx`):
   - Removed "Invalid Invitation" error when no token provided
   - Token validation only happens if token exists in URL
   - Form proceeds normally without requiring invitation link

3. **Backend Updates** (`server/routes.ts`):
   - POST `/api/driver-onboarding` no longer requires token parameter
   - Token validation and marking as used only happens when token is provided
   - Duplicate detection still enforced for data integrity

### Driver Registration Methods
The system now supports three driver registration approaches:
1. **Driver Onboarding** (`/driver-onboarding`) - Multi-step wizard, works with or without token
2. **Simple Registration** (`/simple-registration`) - Quick single-page form for basic driver info
3. **Admin Creation** - Create drivers directly from Contacts page modal

### Routing Architecture
- **Standalone Pages** (no sidebar): Driver self-service pages
  - `/driver-onboarding` - Multi-step registration wizard
  - `/simple-registration` - Quick registration form
  - `/driver-dashboard` - Mobile PWA driver dashboard
- **Admin Pages** (with sidebar): All management interfaces routed through LoadOpsDashboard