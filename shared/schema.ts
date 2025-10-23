import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, jsonb, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const drivers = pgTable("drivers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  status: text("status").notNull().default("available"), // available, on_route, unavailable
  licenseNumber: text("license_number"),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),
  isOnboarded: boolean("is_onboarded").notNull().default(false),
  // Equipment type for load matching - comprehensive industry standard types
  equipmentType: text("equipment_type").notNull().default("dry_van"), // dry_van, refrigerated, flatbed, step_deck, lowboy, power_only, container, car_carrier, tanker, dump_truck, conestoga, removable_gooseneck, vans_standard, van_lift_gate, van_hotshot, straight_box_truck, moving_van, flatbed_hotshot
  // Load preferences for matching - matching "Full & Partial" from load boards
  loadType: text("load_type").default("full_partial"), // full, partial, full_partial
  maxLength: integer("max_length").default(53), // Length ft - matching load board spec
  maxWeight: integer("max_weight").default(26000), // Weight lbs - matching load board spec

  // SMS integration
  phoneNumber: text("phone_number").unique(),
  city: text("city"),
  enableSmsNotifications: boolean("enable_sms_notifications").notNull().default(false),
  // Mood tracking
  currentMood: text("current_mood").default("😐"), // emoji representing current mood
  moodUpdatedAt: timestamp("mood_updated_at"),
  moodNote: text("mood_note"), // optional note about mood
  
  // Performance metrics for contextual visualization
  totalLoads: integer("total_loads").default(0),
  completedLoads: integer("completed_loads").default(0),
  averageRating: real("average_rating").default(0.0), // 1-5 rating
  totalRatings: integer("total_ratings").default(0),
  totalMiles: integer("total_miles").default(0),
  totalRevenue: real("total_revenue").default(0.0),
  onTimeDeliveries: integer("on_time_deliveries").default(0),
  lateDeliveries: integer("late_deliveries").default(0),
  cancelledLoads: integer("cancelled_loads").default(0),
  lastLoadDate: timestamp("last_load_date"),
  bestStreak: integer("best_streak").default(0), // consecutive successful deliveries
  currentStreak: integer("current_streak").default(0),
  averageDeliveryTime: real("average_delivery_time").default(0.0), // in hours
  fuelEfficiency: real("fuel_efficiency").default(0.0), // miles per gallon
  maintenanceScore: real("maintenance_score").default(100.0), // 0-100 health score
  safetyScore: real("safety_score").default(100.0), // 0-100 safety rating
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  contactPerson: text("contact_person").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  status: text("status").notNull().default("active"), // active, inactive
  createdAt: timestamp("created_at").defaultNow(),
});

export const loads = pgTable("loads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadNumber: text("load_number").notNull().unique(),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("standard"), // standard, high, urgent
  pickupAddress: text("pickup_address").notNull(),
  pickupDate: timestamp("pickup_date").notNull(),
  pickupTime: text("pickup_time").notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  deliveryDate: timestamp("delivery_date").notNull(),
  deliveryTime: text("delivery_time").notNull(),
  specialInstructions: text("special_instructions"),
  status: text("status").notNull().default("scheduled"), // scheduled, assigned, in_transit, delivered, cancelled, expired
  // Load characteristics
  loadType: text("load_type").default("full"), // full, partial
  length: integer("length"), // Length in feet
  // Equipment type - matching driver equipment types for consistency
  equipmentType: text("equipment_type").notNull().default("dry_van"), // dry_van, refrigerated, flatbed, step_deck, lowboy, power_only, container, car_carrier, tanker, dump_truck, conestoga, removable_gooseneck, vans_standard, van_lift_gate, van_hotshot, straight_box_truck, moving_van, flatbed_hotshot
  temperatureRequired: boolean("temperature_required").notNull().default(false),
  minTemperature: integer("min_temperature"), // in Fahrenheit
  maxTemperature: integer("max_temperature"), // in Fahrenheit
  temperatureUnit: text("temperature_unit").default("F"), // F or C
  // Load expiration
  expiresAt: timestamp("expires_at"), // When this load should no longer be available
  isExpired: boolean("is_expired").notNull().default(false),
  // DAT-style fields
  rate: real("rate"), // Rate in dollars
  miles: integer("miles"), // Distance in miles
  weight: integer("weight"), // Weight in pounds
  company: text("company"), // Shipping company
  contactPhone: text("contact_phone"), // Contact phone number
  sourceBoard: text("source_board").default("manual"), // manual, dat, loadboard
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  trigger: text("trigger").notNull(), // load_created, pickup_confirmed, in_transit, delivered
  recipients: text("recipients").notNull(), // driver, customer, both
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailLogs = pgTable("email_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadId: varchar("load_id").references(() => loads.id),
  templateId: varchar("template_id").references(() => emailTemplates.id),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull(), // sent, failed, pending
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const onboardingTokens = pgTable("onboarding_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  telegramChatId: text("telegram_chat_id"), // Store the Telegram chat ID for linking
  isUsed: boolean("is_used").notNull().default(false),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const driverLocations = pgTable("driver_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  accuracy: real("accuracy"), // in meters
  speed: real("speed"), // in mph
  heading: real("heading"), // degrees from north
  timestamp: timestamp("timestamp").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  altitude: real("altitude"),
  address: text("address"), // Reverse geocoded address
  loadId: varchar("load_id").references(() => loads.id), // Associated load if any
  isActive: boolean("is_active").notNull().default(true), // Current location vs historical
  batteryLevel: integer("battery_level"), // Device battery percentage
  signalStrength: integer("signal_strength"), // GPS signal strength
});

export const geofences = pgTable("geofences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull(), // pickup, delivery, depot, restricted
  centerLatitude: real("center_latitude").notNull(),
  centerLongitude: real("center_longitude").notNull(),
  radius: real("radius").notNull(), // in meters
  loadId: varchar("load_id").references(() => loads.id), // Associated load for pickup/delivery zones
  customerId: varchar("customer_id").references(() => customers.id), // Customer-specific geofences
  isActive: boolean("is_active").notNull().default(true),
  notificationSettings: jsonb("notification_settings").default({}), // When to alert
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const geofenceEvents = pgTable("geofence_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  geofenceId: varchar("geofence_id").references(() => geofences.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  eventType: text("event_type").notNull(), // entered, exited, dwelling
  timestamp: timestamp("timestamp").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  dwellTime: integer("dwell_time"), // minutes spent in geofence
  loadId: varchar("load_id").references(() => loads.id),
  wasNotified: boolean("was_notified").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const routes = pgTable("routes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  status: text("status").notNull().default("planned"), // planned, active, completed, deviated
  startLatitude: real("start_latitude").notNull(),
  startLongitude: real("start_longitude").notNull(),
  endLatitude: real("end_latitude").notNull(),
  endLongitude: real("end_longitude").notNull(),
  plannedRoute: jsonb("planned_route"), // Array of coordinates
  actualRoute: jsonb("actual_route"), // Array of actual coordinates
  plannedDistance: real("planned_distance"), // in miles
  actualDistance: real("actual_distance"), // in miles
  plannedDuration: integer("planned_duration"), // in minutes
  actualDuration: integer("actual_duration"), // in minutes
  estimatedArrival: timestamp("estimated_arrival"),
  actualArrival: timestamp("actual_arrival"),
  deviationAlerts: jsonb("deviation_alerts").default([]), // Array of deviation events
  trafficData: jsonb("traffic_data").default({}), // Traffic information
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const gpsDevices = pgTable("gps_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  deviceId: text("device_id").notNull().unique(), // Device IMEI or unique identifier
  deviceType: text("device_type").notNull().default("mobile"), // mobile, eld, standalone
  status: text("status").notNull().default("active"), // active, inactive, offline
  lastHeartbeat: timestamp("last_heartbeat"),
  firmwareVersion: text("firmware_version"),
  batteryLevel: integer("battery_level"),
  settings: jsonb("settings").default({}), // Device-specific settings
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Analytics and Reporting Tables
export const driverPerformanceMetrics = pgTable("driver_performance_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  period: text("period").notNull(), // 'daily', 'weekly', 'monthly'
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  loadsCompleted: integer("loads_completed").notNull().default(0),
  onTimeDeliveries: integer("on_time_deliveries").notNull().default(0),
  totalMiles: real("total_miles").notNull().default(0),
  totalRevenue: real("total_revenue").notNull().default(0),
  averageRating: real("average_rating").default(0),
  fuelEfficiency: real("fuel_efficiency").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const customerAnalytics = pgTable("customer_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").references(() => customers.id).notNull(),
  period: text("period").notNull(), // 'daily', 'weekly', 'monthly', 'yearly'
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalLoads: integer("total_loads").notNull().default(0),
  totalRevenue: real("total_revenue").notNull().default(0),
  averageLoadValue: real("average_load_value").default(0),
  onTimeDeliveryRate: real("on_time_delivery_rate").default(0),
  repeatCustomerScore: real("repeat_customer_score").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const businessMetrics = pgTable("business_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  metricType: text("metric_type").notNull(), // 'revenue', 'loads', 'efficiency', 'costs'
  period: text("period").notNull(), // 'daily', 'weekly', 'monthly', 'yearly'
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  value: real("value").notNull(),
  target: real("target").default(0),
  previousPeriodValue: real("previous_period_value").default(0),
  growthRate: real("growth_rate").default(0),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

export const reportTemplates = pgTable("report_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  reportType: text("report_type").notNull(), // 'driver_performance', 'customer_analytics', 'business_overview', 'custom'
  filters: jsonb("filters").default({}),
  chartTypes: jsonb("chart_types").default([]),
  metrics: jsonb("metrics").default([]),
  schedule: text("schedule"), // 'daily', 'weekly', 'monthly', null for on-demand
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Lane Preferences for Telegram Bot
export const lanePreferences = pgTable("lane_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromStates: jsonb("from_states").notNull(), // ["FL", "GA"]
  toStates: jsonb("to_states").notNull(), // ["NC", "SC"]
  minRPM: real("min_rpm").notNull(), // Minimum rate per mile
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const avoidLocations = pgTable("avoid_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  location: text("location").notNull(), // "NYC", "CA", "Chicago"
  type: text("type").notNull().default("city"), // city, state, region
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const smsConfig = pgTable("sms_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  twilioAccountSid: text("twilio_account_sid").notNull(),
  twilioAuthToken: text("twilio_auth_token").notNull(),
  twilioPhoneNumber: text("twilio_phone_number").notNull(),
  dispatcherPhoneNumber: text("dispatcher_phone_number").notNull(),
  responseTimeoutMinutes: integer("response_timeout_minutes").notNull().default(3),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const loadOffers = pgTable("load_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  smsMessageId: text("sms_message_id"),
  status: text("status").notNull().default("pending"), // pending, accepted, declined, timeout
  sentAt: timestamp("sent_at").notNull(),
  respondedAt: timestamp("responded_at"),
  timeoutAt: timestamp("timeout_at").notNull(),
  retryCount: integer("retry_count").default(0), // Track number of retries sent to same driver
  lastSentAt: timestamp("last_sent_at"), // When the last retry was sent
  
  // Two-step booking workflow fields
  dispatcherRate: real("dispatcher_rate"), // Rate set by dispatcher
  deadheadDistance: real("deadhead_distance"), // Distance to pickup
  awaitingDriverConfirmation: boolean("awaiting_driver_confirmation").default(false),
  driverConfirmedAt: timestamp("driver_confirmed_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Load Documents Table for BOL and freight photos
export const loadDocuments = pgTable("load_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  documentType: text("document_type").notNull(), // 'bol', 'freight_photo', 'signature', 'delivery_receipt'
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(), // URL to object storage
  fileSize: integer("file_size"), // File size in bytes
  mimeType: text("mime_type"),
  signerName: text("signer_name"), // Name of person who signed BOL
  notes: text("notes"), // Additional notes about the document
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Driver Communication Threads - Unified messaging hub for all driver-dispatcher communication
// One thread per driver containing all messages (load-specific and general)
export const loadCommunicationThreads = pgTable("load_communication_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Thread type - always 'unified' for the new simplified messaging system
  threadType: text("thread_type").notNull().default("unified"), // 'unified' for all driver communication
  loadId: varchar("load_id").references(() => loads.id), // Current/active load context (optional)
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  status: text("status").notNull().default("active"), // active, archived, closed
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  messageCount: integer("message_count").notNull().default(0),
  unreadDriverMessages: integer("unread_driver_messages").notNull().default(0),
  unreadDispatchMessages: integer("unread_dispatch_messages").notNull().default(0),
  // Load offer tracking
  loadOfferId: varchar("load_offer_id"), // ID of the load being offered (for general threads)
  loadOfferStatus: text("load_offer_status"), // 'pending', 'accepted', 'declined', 'expired'
  loadOfferSentAt: timestamp("load_offer_sent_at"),
  loadOfferRespondedAt: timestamp("load_offer_responded_at"),
  // AI Assistant features
  assistantEnabled: boolean("assistant_enabled").notNull().default(true),
  assistantMode: text("assistant_mode").notNull().default("suggest"), // suggest, autosend, off
  contextSummary: text("context_summary"),
  lastSummarizedMessageId: varchar("last_summarized_message_id"),
  systemPrompt: text("system_prompt"),
  aiConfig: jsonb("ai_config").default({}), // {model, temperature, maxContextMessages}
  autoSendConfidence: integer("auto_send_confidence").notNull().default(80),
  // Load location info for display
  loadOrigin: text("load_origin"),
  loadDestination: text("load_destination"),
  // Driver info for display
  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  // Additional metadata
  loadNumber: text("load_number"), // For quick reference
  lastMessageText: text("last_message_text"), // Preview of last message
  lastMessageSender: text("last_message_sender"), // 'driver' or 'dispatch'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Load Messages - All communication within a load thread
export const loadMessages = pgTable("load_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").references(() => loadCommunicationThreads.id).notNull(),
  loadId: varchar("load_id").references(() => loads.id), // nullable for general conversations
  senderId: varchar("sender_id"), // driver ID or null for dispatch
  senderRole: text("sender_role").notNull(), // 'driver', 'dispatch', 'assistant', 'system'
  senderName: text("sender_name").notNull(), // Display name
  
  // Message content
  messageType: text("message_type").notNull().default("text"), // text, image, document, location, status_update
  textContent: text("text_content"),
  
  // SMS integration
  smsMessageId: text("sms_message_id"),
  
  // Status tracking
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),
  deliveredAt: timestamp("delivered_at"),
  
  // AI Assistant features
  isSuggested: boolean("is_suggested").notNull().default(false),
  isSent: boolean("is_sent").notNull().default(false),
  approvedBy: varchar("approved_by"), // dispatcher ID who approved
  approvedAt: timestamp("approved_at"),
  aiData: jsonb("ai_data").default({}), // {model, promptTokens, completionTokens, latencyMs, confidence, toolsUsed}
  visibility: text("visibility").notNull().default("external"), // external, internal
  
  // Message metadata
  metadata: jsonb("metadata").default({}), // Extra data like location coords, status details
  replyToMessageId: varchar("reply_to_message_id").references(() => loadMessages.id), // Thread replies
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Message Attachments - Images, documents, signatures linked to messages
export const messageAttachments = pgTable("message_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").references(() => loadMessages.id),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id), // Track who uploaded
  
  // File details
  attachmentType: text("attachment_type").notNull(), // 'image', 'document', 'signature', 'location_screenshot'
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(), // Object storage URL
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  
  // Document categorization
  documentCategory: text("document_category"), // 'pod', 'bol', 'inspection', 'damage_photo', 'pickup_confirmation', 'delivery_confirmation', 'other'
  documentStatus: text("document_status").notNull().default("pending_review"), // 'pending_review', 'approved', 'rejected', 'archived'
  
  // Review tracking
  reviewedBy: varchar("reviewed_by"), // Dispatcher who reviewed
  reviewedAt: timestamp("reviewed_at"),
  reviewNotes: text("review_notes"), // Feedback on rejection or notes
  
  // Telegram file details
  telegramFileId: text("telegram_file_id"),
  telegramFileUniqueId: text("telegram_file_unique_id"),
  
  // Attachment metadata
  width: integer("width"), // For images
  height: integer("height"), // For images
  caption: text("caption"), // Image/document caption
  isPrimary: boolean("is_primary").notNull().default(false), // Main document for category
  isRequired: boolean("is_required").notNull().default(false), // Required for load completion
  
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Quick Reply Templates - Predefined responses for common updates
export const quickReplyTemplates = pgTable("quick_reply_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateKey: text("template_key").notNull().unique(), // 'arrived_pickup', 'loaded', 'departed', 'delivered'
  displayText: text("display_text").notNull(), // Button text shown to user
  messageTemplate: text("message_template").notNull(), // Actual message sent
  category: text("category").notNull().default("status"), // status, location, eta, custom
  order: integer("order").notNull().default(0), // Display order
  isActive: boolean("is_active").notNull().default(true),
  isForDriver: boolean("is_for_driver").notNull().default(true),
  isForDispatch: boolean("is_for_dispatch").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Communication Analytics and Logs
export const communicationLogs = pgTable("communication_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  threadId: varchar("thread_id").references(() => loadCommunicationThreads.id),
  action: text("action").notNull(), // 'thread_created', 'message_sent', 'attachment_uploaded', 'status_updated', 'ai_suggestion', 'ai_message_sent', 'ai_message_rejected', 'ai_autosend_toggle'
  actorId: varchar("actor_id"), // Who performed the action
  actorRole: text("actor_role").notNull(), // driver, dispatch, system, assistant
  details: jsonb("details").default({}), // Action-specific details - includes confidence and latency for AI actions
  timestamp: timestamp("timestamp").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Vehicle Management and Maintenance Tables
export const vehicles = pgTable("vehicles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleNumber: text("vehicle_number").notNull().unique(),
  driverId: varchar("driver_id").references(() => drivers.id),
  
  // Vehicle identification
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  vin: text("vin").notNull().unique(),
  licensePlate: text("license_plate").notNull(),
  
  // Vehicle specifications
  equipmentType: text("equipment_type").notNull(), // same as driver equipmentType
  engineType: text("engine_type").notNull().default("diesel"), // diesel, gas, electric, hybrid
  engineModel: text("engine_model"),
  fuelCapacity: real("fuel_capacity").default(0), // gallons
  weightCapacity: integer("weight_capacity").default(26000), // pounds
  
  // Current metrics
  currentMileage: integer("current_mileage").notNull().default(0),
  currentEngineHours: real("current_engine_hours").default(0),
  lastServiceMileage: integer("last_service_mileage").default(0),
  nextServiceDue: integer("next_service_due").default(0),
  
  // Maintenance history tracking
  oilChangeInterval: integer("oil_change_interval").default(15000), // miles
  lastOilChange: timestamp("last_oil_change"),
  nextOilChangeDue: integer("next_oil_change_due").default(0),
  
  tireRotationInterval: integer("tire_rotation_interval").default(12000), // miles
  lastTireRotation: timestamp("last_tire_rotation"),
  nextTireRotationDue: integer("next_tire_rotation_due").default(0),
  
  brakeInspectionInterval: integer("brake_inspection_interval").default(30000), // miles
  lastBrakeInspection: timestamp("last_brake_inspection"),
  nextBrakeInspectionDue: integer("next_brake_inspection_due").default(0),
  
  // Vehicle status and health
  status: text("status").notNull().default("active"), // active, maintenance, out_of_service, retired
  healthScore: real("health_score").default(100), // 0-100 calculated health score
  fuelEfficiency: real("fuel_efficiency").default(0), // miles per gallon
  
  // Insurance and registration
  insuranceExpiry: timestamp("insurance_expiry"),
  registrationExpiry: timestamp("registration_expiry"),
  inspectionExpiry: timestamp("inspection_expiry"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const maintenanceAlerts = pgTable("maintenance_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id).notNull(),
  alertType: text("alert_type").notNull(), // 'due_soon', 'overdue', 'critical', 'predictive'
  maintenanceType: text("maintenance_type").notNull(), // 'oil_change', 'tire_rotation', 'brake_inspection', 'general_service', 'engine_diagnostic'
  
  severity: text("severity").notNull().default("medium"), // low, medium, high, critical
  title: text("title").notNull(),
  description: text("description").notNull(),
  
  // Scheduling details
  currentMileage: integer("current_mileage").notNull(),
  dueMileage: integer("due_mileage"),
  mileageOverdue: integer("mileage_overdue").default(0),
  
  dueDate: timestamp("due_date"),
  daysOverdue: integer("days_overdue").default(0),
  
  // Predictive factors
  predictiveFactors: jsonb("predictive_factors").default({}), // ML factors and scores
  riskScore: real("risk_score").default(0), // 0-100 risk of failure
  estimatedCost: real("estimated_cost").default(0),
  
  // Alert status
  status: text("status").notNull().default("active"), // active, acknowledged, resolved, ignored
  priority: integer("priority").notNull().default(3), // 1-5 priority level
  
  // Action tracking
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  notes: text("notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const maintenanceRecords = pgTable("maintenance_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id).notNull(),
  alertId: varchar("alert_id").references(() => maintenanceAlerts.id), // linked alert if applicable
  
  maintenanceType: text("maintenance_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  
  // Service details
  serviceDate: timestamp("service_date").notNull(),
  mileageAtService: integer("mileage_at_service").notNull(),
  engineHoursAtService: real("engine_hours_at_service"),
  
  // Service provider
  serviceProvider: text("service_provider"), // shop name or mechanic
  serviceLocation: text("service_location"),
  invoiceNumber: text("invoice_number"),
  
  // Costs
  laborCost: real("labor_cost").default(0),
  partsCost: real("parts_cost").default(0),
  totalCost: real("total_cost").notNull(),
  
  // Parts and work performed
  partsReplaced: jsonb("parts_replaced").default([]), // array of parts
  workPerformed: jsonb("work_performed").default([]), // array of work items
  
  // Quality tracking
  serviceRating: integer("service_rating"), // 1-5 rating
  warrantyPeriod: integer("warranty_period"), // warranty in days
  warrantyExpiry: timestamp("warranty_expiry"),
  
  // Documentation
  receipts: jsonb("receipts").default([]), // array of receipt URLs
  photos: jsonb("photos").default([]), // array of photo URLs
  
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const vehicleMetrics = pgTable("vehicle_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vehicleId: varchar("vehicle_id").references(() => vehicles.id).notNull(),
  
  // Time period
  recordDate: timestamp("record_date").notNull(),
  mileage: integer("mileage").notNull(),
  engineHours: real("engine_hours"),
  
  // Performance metrics
  fuelUsed: real("fuel_used").default(0), // gallons
  fuelEfficiency: real("fuel_efficiency").default(0), // mpg
  idleTime: real("idle_time").default(0), // hours
  averageSpeed: real("average_speed").default(0), // mph
  maxSpeed: real("max_speed").default(0), // mph
  
  // Engine diagnostics
  engineLoad: real("engine_load").default(0), // percentage
  coolantTemp: real("coolant_temp").default(0), // fahrenheit
  oilPressure: real("oil_pressure").default(0), // psi
  batteryVoltage: real("battery_voltage").default(0), // volts
  
  // Driving behavior
  harshBraking: integer("harsh_braking").default(0), // count
  harshAcceleration: integer("harsh_acceleration").default(0), // count
  sharpTurns: integer("sharp_turns").default(0), // count
  
  // Calculated health indicators
  engineHealthScore: real("engine_health_score").default(100),
  brakeHealthScore: real("brake_health_score").default(100),
  transmissionHealthScore: real("transmission_health_score").default(100),
  overallHealthScore: real("overall_health_score").default(100),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// DAT Scraper Tables
export const scraperConfigs = pgTable("scraper_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  type: text("type").notNull().default("dat"), // 'dat', 'loadboard', 'custom'
  enabled: boolean("enabled").notNull().default(false),
  loginUrl: text("login_url").notNull(),
  searchUrl: text("search_url").notNull(),
  username: text("username"),
  password: text("password"), // Should be encrypted in production
  searchCriteria: jsonb("search_criteria").default({}),
  schedule: text("schedule").notNull().default("*/10 * * * * *"), // Every 10 seconds
  autoCreateLoads: boolean("auto_create_loads").notNull().default(true),
  defaultCustomerId: varchar("default_customer_id").references(() => customers.id),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const scraperLogs = pgTable("scraper_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  configId: varchar("config_id").references(() => scraperConfigs.id).notNull(),
  status: text("status").notNull(), // 'success', 'error', 'running'
  loadsScraped: integer("loads_scraped").notNull().default(0),
  loadsCreated: integer("loads_created").notNull().default(0),
  errorMessage: text("error_message"),
  executionTime: integer("execution_time"), // milliseconds
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertDriverSchema = createInsertSchema(drivers).omit({
  id: true,
  createdAt: true,
});

export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
});

export const insertLoadSchema = createInsertSchema(loads).omit({
  id: true,
  loadNumber: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  pickupDate: z.string(),
  deliveryDate: z.string(),
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({
  id: true,
  createdAt: true,
});

export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({
  id: true,
  createdAt: true,
});

export const insertOnboardingTokenSchema = createInsertSchema(onboardingTokens).omit({
  id: true,
  createdAt: true,
});

export const insertDriverLocationSchema = createInsertSchema(driverLocations).omit({
  id: true,
  createdAt: true,
});

export const insertGeofenceSchema = createInsertSchema(geofences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGeofenceEventSchema = createInsertSchema(geofenceEvents).omit({
  id: true,
  createdAt: true,
});

export const insertRouteSchema = createInsertSchema(routes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertGpsDeviceSchema = createInsertSchema(gpsDevices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDriverPerformanceMetricsSchema = createInsertSchema(driverPerformanceMetrics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCustomerAnalyticsSchema = createInsertSchema(customerAnalytics).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBusinessMetricsSchema = createInsertSchema(businessMetrics).omit({
  id: true,
  createdAt: true,
});

export const insertReportTemplateSchema = createInsertSchema(reportTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScraperConfigSchema = createInsertSchema(scraperConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScraperLogSchema = createInsertSchema(scraperLogs).omit({
  id: true,
  createdAt: true,
});

export const insertLanePreferenceSchema = createInsertSchema(lanePreferences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAvoidLocationSchema = createInsertSchema(avoidLocations).omit({
  id: true,
  createdAt: true,
});

export const insertSmsConfigSchema = createInsertSchema(smsConfig).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLoadOfferSchema = createInsertSchema(loadOffers).omit({
  id: true,
  createdAt: true,
});

export const insertLoadDocumentSchema = createInsertSchema(loadDocuments).omit({
  id: true,
  createdAt: true,
  uploadedAt: true,
});

export const insertVehicleSchema = createInsertSchema(vehicles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMaintenanceAlertSchema = createInsertSchema(maintenanceAlerts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMaintenanceRecordSchema = createInsertSchema(maintenanceRecords).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVehicleMetricsSchema = createInsertSchema(vehicleMetrics).omit({
  id: true,
  createdAt: true,
});

export const driverOnboardingSchema = createInsertSchema(drivers).omit({
  id: true,
  createdAt: true,
  status: true,
  isOnboarded: true,
}).extend({
  confirmPassword: z.string().min(1, "Password confirmation is required"),
  telegramId: z.string().optional(),
  telegramUsername: z.string().optional(),
  city: z.string().min(1, "City is required for load matching"),
  enableTelegramNotifications: z.boolean().default(false),
});

// Types
export type Driver = typeof drivers.$inferSelect;
export type InsertDriver = z.infer<typeof insertDriverSchema>;

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;

export type Load = typeof loads.$inferSelect;
export type InsertLoad = z.infer<typeof insertLoadSchema>;

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;

export type EmailLog = typeof emailLogs.$inferSelect;
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;

export type OnboardingToken = typeof onboardingTokens.$inferSelect;
export type InsertOnboardingToken = z.infer<typeof insertOnboardingTokenSchema>;

export type DriverLocation = typeof driverLocations.$inferSelect;
export type InsertDriverLocation = z.infer<typeof insertDriverLocationSchema>;

export type DriverPerformanceMetrics = typeof driverPerformanceMetrics.$inferSelect;
export type InsertDriverPerformanceMetrics = z.infer<typeof insertDriverPerformanceMetricsSchema>;

export type CustomerAnalytics = typeof customerAnalytics.$inferSelect;
export type InsertCustomerAnalytics = z.infer<typeof insertCustomerAnalyticsSchema>;

export type BusinessMetrics = typeof businessMetrics.$inferSelect;
export type InsertBusinessMetrics = z.infer<typeof insertBusinessMetricsSchema>;

export type ReportTemplate = typeof reportTemplates.$inferSelect;
export type InsertReportTemplate = z.infer<typeof insertReportTemplateSchema>;

export type ScraperConfig = typeof scraperConfigs.$inferSelect;
export type InsertScraperConfig = z.infer<typeof insertScraperConfigSchema>;

export type ScraperLog = typeof scraperLogs.$inferSelect;
export type InsertScraperLog = z.infer<typeof insertScraperLogSchema>;

export type LanePreference = typeof lanePreferences.$inferSelect;
export type InsertLanePreference = z.infer<typeof insertLanePreferenceSchema>;

export type AvoidLocation = typeof avoidLocations.$inferSelect;
export type InsertAvoidLocation = z.infer<typeof insertAvoidLocationSchema>;

export type SmsConfig = typeof smsConfig.$inferSelect;
export type InsertTelegramBotConfig = z.infer<typeof insertTelegramBotConfigSchema>;

export type LoadOffer = typeof loadOffers.$inferSelect;
export type InsertLoadOffer = z.infer<typeof insertLoadOfferSchema>;

export type LoadDocument = typeof loadDocuments.$inferSelect;
export type InsertLoadDocument = z.infer<typeof insertLoadDocumentSchema>;

export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;

export type MaintenanceAlert = typeof maintenanceAlerts.$inferSelect;
export type InsertMaintenanceAlert = z.infer<typeof insertMaintenanceAlertSchema>;

export type MaintenanceRecord = typeof maintenanceRecords.$inferSelect;
export type InsertMaintenanceRecord = z.infer<typeof insertMaintenanceRecordSchema>;

export type VehicleMetrics = typeof vehicleMetrics.$inferSelect;
export type InsertVehicleMetrics = z.infer<typeof insertVehicleMetricsSchema>;

export type DriverOnboarding = z.infer<typeof driverOnboardingSchema>;

// Extended types with relations
export type LoadWithRelations = Load & {
  customer: Customer;
  driver: Driver | null;
};

export type EmailLogWithRelations = EmailLog & {
  load?: Load;
  template?: EmailTemplate;
};

export type DriverWithLocation = Driver & {
  currentLocation?: DriverLocation;
  gpsDevice?: GpsDevice;
};

export type Geofence = typeof geofences.$inferSelect;
export type InsertGeofence = z.infer<typeof insertGeofenceSchema>;

export type GeofenceEvent = typeof geofenceEvents.$inferSelect;
export type InsertGeofenceEvent = z.infer<typeof insertGeofenceEventSchema>;

export type Route = typeof routes.$inferSelect;
export type InsertRoute = z.infer<typeof insertRouteSchema>;

export type GpsDevice = typeof gpsDevices.$inferSelect;
export type InsertGpsDevice = z.infer<typeof insertGpsDeviceSchema>;

export type LoadWithRoute = LoadWithRelations & {
  route?: Route;
  geofences?: Geofence[];
};

export type DriverLocationUpdate = {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: Date;
  batteryLevel?: number;
  signalStrength?: number;
};

// Load Board Integration Tables
export const loadBoardSources = pgTable("load_board_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // DAT, Truckstop.com, Sylectus, etc.
  displayName: text("display_name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiEndpoint: text("api_endpoint"),
  requiresAuth: boolean("requires_auth").notNull().default(false),
  authType: text("auth_type"), // api_key, oauth, basic_auth, session
  isActive: boolean("is_active").notNull().default(true),
  rateLimit: integer("rate_limit").default(60), // requests per minute
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const loadBoardConfigurations = pgTable("load_board_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id").references(() => loadBoardSources.id).notNull(),
  name: text("name").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  credentials: jsonb("credentials").notNull().default({}), // encrypted auth data
  searchFilters: jsonb("search_filters").notNull().default({}), // search criteria
  scrapingInterval: integer("scraping_interval").notNull().default(300), // seconds
  maxLoadsPerRun: integer("max_loads_per_run").default(100),
  lastScrapedAt: timestamp("last_scraped_at"),
  lastError: text("last_error"),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const scrapedLoads = pgTable("scraped_loads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceId: varchar("source_id").references(() => loadBoardSources.id).notNull(),
  configId: varchar("config_id").references(() => loadBoardConfigurations.id).notNull(),
  externalId: text("external_id").notNull(), // load ID from source
  loadNumber: text("load_number"),
  
  // Load details
  pickupCity: text("pickup_city").notNull(),
  pickupState: text("pickup_state").notNull(),
  pickupZip: text("pickup_zip"),
  pickupAddress: text("pickup_address"),
  pickupDate: timestamp("pickup_date").notNull(),
  pickupTimeWindow: text("pickup_time_window"),
  
  deliveryCity: text("delivery_city").notNull(),
  deliveryState: text("delivery_state").notNull(),
  deliveryZip: text("delivery_zip"),
  deliveryAddress: text("delivery_address"),
  deliveryDate: timestamp("delivery_date").notNull(),
  deliveryTimeWindow: text("delivery_time_window"),
  
  // Financial details
  rate: real("rate"),
  rateType: text("rate_type"), // flat, per_mile, percentage
  mileage: integer("mileage"),
  ratePerMile: real("rate_per_mile"),
  fuelSurcharge: real("fuel_surcharge"),
  totalPay: real("total_pay"),
  
  // Load specifications
  weight: integer("weight"),
  commodity: text("commodity"),
  equipmentType: text("equipment_type"), // dry_van, flatbed, reefer, etc.
  truckLength: integer("truck_length"),
  specialRequirements: text("special_requirements"),
  
  // Contact information
  brokerName: text("broker_name"),
  brokerPhone: text("broker_phone"),
  brokerEmail: text("broker_email"),
  brokerMcNumber: text("broker_mc_number"),
  
  // Load status and metadata
  status: text("status").notNull().default("available"), // available, booked, expired, cancelled
  priority: text("priority").default("standard"), // standard, high, urgent
  isExpedited: boolean("is_expedited").notNull().default(false),
  postedAt: timestamp("posted_at"),
  expiresAt: timestamp("expires_at"),
  
  // Matching and processing
  isMatched: boolean("is_matched").notNull().default(false),
  matchScore: real("match_score"), // 0-100 compatibility score
  matchedDriverId: varchar("matched_driver_id").references(() => drivers.id),
  isImported: boolean("is_imported").notNull().default(false),
  importedLoadId: varchar("imported_load_id").references(() => loads.id),
  
  // Raw data and metadata
  rawData: jsonb("raw_data").notNull().default({}), // original scraped data
  scrapedAt: timestamp("scraped_at").defaultNow(),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow(),
});

export const scraperConfigurations = pgTable("scraper_configurations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  
  // Scraping schedule
  scheduleType: text("schedule_type").notNull().default("interval"), // interval, cron, manual
  intervalMinutes: integer("interval_minutes").default(15), // for interval type
  cronExpression: text("cron_expression"), // for cron type
  
  // Scraping filters and preferences
  searchCriteria: jsonb("search_criteria").notNull().default({}),
  preferredLanes: jsonb("preferred_lanes").notNull().default([]), // origin/destination preferences
  avoidLanes: jsonb("avoid_lanes").notNull().default([]),
  minRate: real("min_rate"),
  maxRate: real("max_rate"),
  minRatePerMile: real("min_rate_per_mile"),
  minMileage: integer("min_mileage"),
  maxMileage: integer("max_mileage"),
  equipmentTypes: jsonb("equipment_types").notNull().default([]),
  maxWeight: integer("max_weight"),
  
  // Processing settings
  autoImportMatches: boolean("auto_import_matches").notNull().default(false),
  autoAssignDrivers: boolean("auto_assign_drivers").notNull().default(false),
  minimumMatchScore: real("minimum_match_score").default(75.0),
  notifyOnNewMatches: boolean("notify_on_new_matches").notNull().default(true),
  
  // Performance tracking
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  averageRunTimeMs: integer("average_run_time_ms"),
  totalLoadsScraped: integer("total_loads_scraped").notNull().default(0),
  totalMatchesFound: integer("total_matches_found").notNull().default(0),
  lastError: text("last_error"),
  errorCount: integer("error_count").notNull().default(0),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for new tables
export const insertLoadBoardSourceSchema = createInsertSchema(loadBoardSources).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLoadBoardConfigurationSchema = createInsertSchema(loadBoardConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastScrapedAt: true,
  successCount: true,
  errorCount: true,
});

export const insertScrapedLoadSchema = createInsertSchema(scrapedLoads).omit({
  id: true,
  scrapedAt: true,
  lastUpdatedAt: true,
});

export const insertScraperConfigurationSchema = createInsertSchema(scraperConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastRunAt: true,
  nextRunAt: true,
  totalLoadsScraped: true,
  totalMatchesFound: true,
  errorCount: true,
});

// Type exports for new tables
export type LoadBoardSource = typeof loadBoardSources.$inferSelect;
export type InsertLoadBoardSource = z.infer<typeof insertLoadBoardSourceSchema>;

export type LoadBoardConfiguration = typeof loadBoardConfigurations.$inferSelect;
export type InsertLoadBoardConfiguration = z.infer<typeof insertLoadBoardConfigurationSchema>;

export type ScrapedLoad = typeof scrapedLoads.$inferSelect;
export type InsertScrapedLoad = z.infer<typeof insertScrapedLoadSchema>;

export type ScraperConfiguration = typeof scraperConfigurations.$inferSelect;
export type InsertScraperConfiguration = z.infer<typeof insertScraperConfigurationSchema>;

// Extended types with relations
export type ScrapedLoadWithRelations = ScrapedLoad & {
  source: LoadBoardSource;
  config: LoadBoardConfiguration;
  matchedDriver?: Driver;
  importedLoad?: LoadWithRelations;
};

export type LoadBoardConfigurationWithSource = LoadBoardConfiguration & {
  source: LoadBoardSource;
};

// Load Bidding System Tables
export const loadBids = pgTable("load_bids", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadId: varchar("load_id").references(() => loads.id),
  scrapedLoadId: varchar("scraped_load_id").references(() => scrapedLoads.id),
  loadNumber: text("load_number").notNull(),
  brokerName: text("broker_name").notNull(),
  brokerEmail: text("broker_email"),
  brokerPhone: text("broker_phone"),
  
  // Bid details
  bidAmount: real("bid_amount").notNull(),
  recommendedAmount: real("recommended_amount"),
  margin: real("margin"), // profit margin
  ratePerMile: real("rate_per_mile"),
  
  // Load details for bidding
  pickupAddress: text("pickup_address").notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  pickupDate: timestamp("pickup_date").notNull(),
  deliveryDate: timestamp("delivery_date").notNull(),
  weight: integer("weight"),
  commodity: text("commodity"),
  equipmentType: text("equipment_type").notNull().default("dry_van"),
  miles: integer("miles"),
  
  // Bidding workflow
  status: text("status").notNull().default("pending_driver"), // pending_driver, driver_accepted, driver_declined, bid_submitted, won, lost, expired
  requiresEmail: boolean("requires_email").notNull().default(true),
  bidMethod: text("bid_method").notNull().default("email"), // email, phone, platform
  
  // Driver assignment and response
  assignedDriverId: varchar("assigned_driver_id").references(() => drivers.id),
  driverResponse: text("driver_response"), // accepted, declined, no_response
  driverResponseAt: timestamp("driver_response_at"),
  driverNotes: text("driver_notes"),
  
  // Bid submission
  bidSubmittedAt: timestamp("bid_submitted_at"),
  bidExpiresAt: timestamp("bid_expires_at"),
  brokerResponseAt: timestamp("broker_response_at"),
  brokerResponse: text("broker_response"), // accepted, rejected, countered
  
  // Email campaign tracking
  emailCampaignId: varchar("email_campaign_id"),
  
  // Results
  finalRate: real("final_rate"),
  actualMargin: real("actual_margin"),
  notes: text("notes"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const bidResponses = pgTable("bid_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => loadBids.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  response: text("response").notNull(), // accepted, declined, negotiate
  responseTime: timestamp("response_time").notNull(),
  
  // Driver feedback
  counterOffer: real("counter_offer"),
  reason: text("reason"), // rate_too_low, bad_location, equipment_mismatch, scheduling_conflict
  notes: text("notes"),
  
  // SMS tracking
  smsMessageId: text("sms_message_id"),
  responseMethod: text("response_method").notNull().default("sms"), // sms, phone, email
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailCampaigns = pgTable("email_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => loadBids.id).notNull(),
  brokerEmail: text("broker_email").notNull(),
  brokerName: text("broker_name").notNull(),
  
  // Campaign details
  subject: text("subject").notNull(),
  initialEmailBody: text("initial_email_body").notNull(),
  bidAmount: real("bid_amount").notNull(),
  
  // Campaign status
  status: text("status").notNull().default("active"), // active, won, lost, expired
  totalEmails: integer("total_emails").notNull().default(0),
  lastEmailSentAt: timestamp("last_email_sent_at"),
  
  // Results
  brokerLastResponseAt: timestamp("broker_last_response_at"),
  brokerLastResponse: text("broker_last_response"),
  finalOutcome: text("final_outcome"), // won, lost_price, lost_other, expired, no_response
  winningRate: real("winning_rate"),
  
  // Follow-up schedule
  nextFollowUpAt: timestamp("next_follow_up_at"),
  followUpCount: integer("follow_up_count").notNull().default(0),
  maxFollowUps: integer("max_follow_ups").notNull().default(3),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const emailFollowUps = pgTable("email_follow_ups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").references(() => emailCampaigns.id).notNull(),
  bidId: varchar("bid_id").references(() => loadBids.id).notNull(),
  
  // Email details
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at").notNull(),
  
  // Follow-up type and strategy
  followUpType: text("follow_up_type").notNull(), // initial, follow_up_1, follow_up_2, final_push, response_to_broker
  strategy: text("strategy").notNull(), // rate_highlight, urgency, relationship, compromise
  
  // Broker response tracking
  brokerReplied: boolean("broker_replied").notNull().default(false),
  brokerReplyAt: timestamp("broker_reply_at"),
  brokerReplyContent: text("broker_reply_content"),
  brokerSentiment: text("broker_sentiment"), // positive, negative, neutral, interested, not_interested
  
  // Email performance
  emailDelivered: boolean("email_delivered").notNull().default(true),
  emailOpened: boolean("email_opened").notNull().default(false),
  emailClicked: boolean("email_clicked").notNull().default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const dispatcherNotifications = pgTable("dispatcher_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bidId: varchar("bid_id").references(() => loadBids.id),
  loadId: varchar("load_id").references(() => loads.id),
  
  // Notification details
  notificationType: text("notification_type").notNull(), // driver_accepted, load_won, load_lost, bid_expired, urgent_follow_up
  priority: text("priority").notNull().default("normal"), // low, normal, high, urgent
  message: text("message").notNull(),
  
  // SMS details
  phoneNumber: text("phone_number").notNull(),
  smsMessageId: text("sms_message_id"),
  
  // Status tracking
  status: text("status").notNull().default("pending"), // pending, sent, delivered, failed
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  errorMessage: text("error_message"),
  
  // Dispatcher response
  dispatcherResponse: text("dispatcher_response"),
  dispatcherResponseAt: timestamp("dispatcher_response_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas for bidding tables
export const insertLoadBidSchema = createInsertSchema(loadBids).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBidResponseSchema = createInsertSchema(bidResponses).omit({
  id: true,
  createdAt: true,
});

export const insertEmailCampaignSchema = createInsertSchema(emailCampaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  totalEmails: true,
  followUpCount: true,
});

export const insertEmailFollowUpSchema = createInsertSchema(emailFollowUps).omit({
  id: true,
  createdAt: true,
});

export const insertDispatcherNotificationSchema = createInsertSchema(dispatcherNotifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Type exports for bidding tables
export type LoadBid = typeof loadBids.$inferSelect;
export type InsertLoadBid = z.infer<typeof insertLoadBidSchema>;

export type BidResponse = typeof bidResponses.$inferSelect;
export type InsertBidResponse = z.infer<typeof insertBidResponseSchema>;

export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;

export type EmailFollowUp = typeof emailFollowUps.$inferSelect;
export type InsertEmailFollowUp = z.infer<typeof insertEmailFollowUpSchema>;

export type DispatcherNotification = typeof dispatcherNotifications.$inferSelect;
export type InsertDispatcherNotification = z.infer<typeof insertDispatcherNotificationSchema>;

// Extended types with relations for bidding
export type LoadBidWithRelations = LoadBid & {
  driver?: Driver;
  load?: LoadWithRelations;
  scrapedLoad?: ScrapedLoad;
  responses?: BidResponse[];
  emailCampaign?: EmailCampaign;
};

export type EmailCampaignWithFollowUps = EmailCampaign & {
  followUps: EmailFollowUp[];
  bid: LoadBid;
};

export type BidResponseWithDriver = BidResponse & {
  driver: Driver;
  bid: LoadBid;
};

// Smart Load Matching and Predictive Analytics Tables
export const driverLoadHistory = pgTable("driver_load_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  
  // Load characteristics
  originState: text("origin_state").notNull(),
  destinationState: text("destination_state").notNull(),
  originCity: text("origin_city").notNull(),
  destinationCity: text("destination_city").notNull(),
  equipmentType: text("equipment_type").notNull(),
  loadType: text("load_type").notNull(),
  
  // Financial data
  acceptedRate: real("accepted_rate").notNull(),
  actualRate: real("actual_rate"), // Final rate after delivery
  ratePerMile: real("rate_per_mile").notNull(),
  totalMiles: integer("total_miles").notNull(),
  deadheadMiles: integer("deadhead_miles").default(0),
  
  // Performance metrics
  acceptedAt: timestamp("accepted_at").notNull(),
  pickedUpAt: timestamp("picked_up_at"),
  deliveredAt: timestamp("delivered_at"),
  wasOnTime: boolean("was_on_time").default(true),
  deliveryRating: integer("delivery_rating").default(5), // 1-5 stars
  
  // Costs and profitability
  fuelCost: real("fuel_cost").default(0),
  tollCost: real("toll_cost").default(0),
  otherExpenses: real("other_expenses").default(0),
  totalExpenses: real("total_expenses").default(0),
  netProfit: real("net_profit").default(0),
  profitMargin: real("profit_margin").default(0), // percentage
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const marketRateTrends = pgTable("market_rate_trends", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  originState: text("origin_state").notNull(),
  destinationState: text("destination_state").notNull(),
  equipmentType: text("equipment_type").notNull(),
  
  // Rate analysis
  averageRate: real("average_rate").notNull(),
  medianRate: real("median_rate").notNull(),
  highRate: real("high_rate").notNull(),
  lowRate: real("low_rate").notNull(),
  ratePerMile: real("rate_per_mile").notNull(),
  
  // Market conditions
  loadVolume: integer("load_volume").default(0), // Number of loads
  truckDemand: real("truck_demand").default(0), // Load-to-truck ratio
  seasonalFactor: real("seasonal_factor").default(1.0), // Seasonal multiplier
  
  // Time period
  weekOf: timestamp("week_of").notNull(),
  period: text("period").notNull().default("weekly"), // daily, weekly, monthly
  
  // Analysis metadata
  dataSource: text("data_source").notNull().default("scraped"), // scraped, manual, api
  sampleSize: integer("sample_size").default(0),
  lastUpdated: timestamp("last_updated").defaultNow(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const backhaulOpportunities = pgTable("backhaul_opportunities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  primaryLoadId: varchar("primary_load_id").references(() => loads.id).notNull(),
  backhaulLoadId: varchar("backhaul_load_id").references(() => loads.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  
  // Route optimization
  deliveryLocation: text("delivery_location").notNull(),
  backhaulOrigin: text("backhaul_origin").notNull(),
  deadheadToBackhaul: integer("deadhead_to_backhaul").notNull(), // miles
  totalRoundTripMiles: integer("total_round_trip_miles").notNull(),
  
  // Financial analysis
  primaryLoadRate: real("primary_load_rate").notNull(),
  backhaulRate: real("backhaul_rate").notNull(),
  combinedRate: real("combined_rate").notNull(),
  deadheadSavings: real("deadhead_savings").notNull(),
  totalProfit: real("total_profit").notNull(),
  profitImprovement: real("profit_improvement").notNull(), // vs single load
  
  // Timing
  deliveryTime: timestamp("delivery_time").notNull(),
  backhaulPickupTime: timestamp("backhaul_pickup_time").notNull(),
  layoverTime: integer("layover_time").notNull(), // hours between loads
  
  // Opportunity scoring
  matchScore: real("match_score").notNull(), // 0-100 compatibility score
  timeEfficiency: real("time_efficiency").notNull(), // 0-100 time optimization
  profitScore: real("profit_score").notNull(), // 0-100 profitability score
  
  status: text("status").notNull().default("available"), // available, offered, accepted, expired
  expiresAt: timestamp("expires_at").notNull(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const loadRecommendations = pgTable("load_recommendations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  
  // AI-powered scoring
  aiScore: real("ai_score").notNull(), // 0-100 AI recommendation score
  historicalPerformanceScore: real("historical_performance_score").notNull(),
  marketConditionScore: real("market_condition_score").notNull(),
  profitabilityScore: real("profitability_score").notNull(),
  routeOptimizationScore: real("route_optimization_score").notNull(),
  
  // Detailed analysis
  predictedProfit: real("predicted_profit").notNull(),
  predictedMargin: real("predicted_margin").notNull(),
  riskScore: real("risk_score").notNull(), // 0-100 risk assessment
  confidenceLevel: real("confidence_level").notNull(), // 0-100 AI confidence
  
  // Reasoning factors
  reasoningFactors: jsonb("reasoning_factors").default({}), // Why this was recommended
  similarLoadsPerformed: integer("similar_loads_performed").default(0),
  averagePerformanceOnRoute: real("average_performance_on_route").default(0),
  
  // Market intelligence
  competitiveRatePosition: text("competitive_rate_position"), // below_market, at_market, above_market
  demandLevel: text("demand_level"), // low, medium, high
  seasonalAdjustment: real("seasonal_adjustment").default(1.0),
  
  // Status tracking
  status: text("status").notNull().default("pending"), // pending, sent, accepted, declined, expired
  sentAt: timestamp("sent_at"),
  respondedAt: timestamp("responded_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiAnalytics = pgTable("ai_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  analysisType: text("analysis_type").notNull(), // rate_prediction, load_matching, backhaul_optimization, profit_analysis
  entityId: varchar("entity_id").notNull(), // driver_id, load_id, etc.
  entityType: text("entity_type").notNull(), // driver, load, route, market
  
  // Analysis results
  analysis: jsonb("analysis").notNull(), // Detailed AI analysis results
  predictions: jsonb("predictions").default({}), // Future predictions
  recommendations: jsonb("recommendations").default([]), // Action recommendations
  
  // Model information
  modelVersion: text("model_version").notNull().default("1.0"),
  inputData: jsonb("input_data").default({}), // Input parameters used
  confidence: real("confidence").notNull(), // 0-100 confidence in analysis
  processingTime: integer("processing_time").default(0), // milliseconds
  
  // Validation and performance
  actualOutcome: jsonb("actual_outcome").default({}), // Actual results for validation
  accuracyScore: real("accuracy_score"), // How accurate the prediction was
  validatedAt: timestamp("validated_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Communication Insights Dashboard tables
export const communicationInsights = pgTable("communication_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  period: text("period").notNull(), // daily, weekly, monthly
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  insightType: text("insight_type").notNull(), // daily_summary, weekly_summary, driver_engagement, ai_performance
  
  // Metrics (non-negative - validated in application layer)
  totalMessages: integer("total_messages").notNull().default(0),
  driverMessages: integer("driver_messages").notNull().default(0),
  dispatchMessages: integer("dispatch_messages").notNull().default(0),
  aiSuggestions: integer("ai_suggestions").notNull().default(0),
  aiSuggestionsAccepted: integer("ai_suggestions_accepted").notNull().default(0),
  aiSuggestionsRejected: integer("ai_suggestions_rejected").notNull().default(0),
  aiAutoSent: integer("ai_auto_sent").notNull().default(0),
  
  // Response time metrics (in minutes, non-negative)
  avgResponseTimeMinutes: real("avg_response_time_minutes").default(0),
  medianResponseTimeMinutes: real("median_response_time_minutes").default(0),
  
  // Engagement metrics
  activeDrivers: integer("active_drivers").notNull().default(0),
  totalActiveThreads: integer("total_active_threads").notNull().default(0),
  
  // Additional insights data
  insights: jsonb("insights").default({}), // Additional computed insights
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Unique constraint to prevent duplicate aggregations
  uniqueInsight: sql`UNIQUE (period, period_start, insight_type)`,
  // Indexes for query performance
  periodStartIdx: sql`CREATE INDEX CONCURRENTLY communication_insights_period_start_idx ON communication_insights (period, period_start)`,
  insightTypeIdx: sql`CREATE INDEX CONCURRENTLY communication_insights_insight_type_idx ON communication_insights (insight_type, period_start)`,
}));

export const aiPerformanceMetrics = pgTable("ai_performance_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  period: text("period").notNull(), // daily, weekly, monthly
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  threadId: varchar("thread_id").references(() => loadCommunicationThreads.id),
  driverId: varchar("driver_id").references(() => drivers.id),
  
  // AI suggestion metrics (non-negative - validated in application layer)
  totalSuggestions: integer("total_suggestions").notNull().default(0),
  acceptedSuggestions: integer("accepted_suggestions").notNull().default(0),
  rejectedSuggestions: integer("rejected_suggestions").notNull().default(0),
  autoSentMessages: integer("auto_sent_messages").notNull().default(0),
  
  // Performance metrics (non-negative - validated in application layer)
  avgConfidence: real("avg_confidence").default(0), // 0-100
  avgProcessingTimeMs: integer("avg_processing_time_ms").default(0), // milliseconds as integer
  avgTokensUsed: real("avg_tokens_used").default(0),
  
  // Success metrics (removed derived suggestionAcceptanceRate - compute on demand)
  avgTimeBetweenSuggestionAndResponseMs: integer("avg_time_between_suggestion_and_response_ms").default(0), // milliseconds as integer
  
  // Detailed metrics data
  metrics: jsonb("metrics").default({}), // Additional detailed metrics
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Unique constraint per driver/thread/period (nulls allowed for thread/driver)
  uniqueMetric: sql`UNIQUE (period, period_start, driver_id, thread_id)`,
  // Indexes for query performance
  dateIdx: sql`CREATE INDEX CONCURRENTLY ai_performance_metrics_period_start_idx ON ai_performance_metrics (period_start)`,
  driverDateIdx: sql`CREATE INDEX CONCURRENTLY ai_performance_metrics_driver_date_idx ON ai_performance_metrics (driver_id, period_start)`,
  threadDateIdx: sql`CREATE INDEX CONCURRENTLY ai_performance_metrics_thread_date_idx ON ai_performance_metrics (thread_id, period_start)`,
}));

export const driverEngagementMetrics = pgTable("driver_engagement_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  period: text("period").notNull(), // daily, weekly, monthly
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  
  // Message activity (non-negative - validated in application layer)
  messagesReceived: integer("messages_received").notNull().default(0),
  messagesSent: integer("messages_sent").notNull().default(0),
  attachmentsSent: integer("attachments_sent").notNull().default(0),
  
  // Response metrics (in milliseconds, non-negative)
  avgResponseTimeMs: integer("avg_response_time_ms").default(0), // milliseconds as integer
  totalResponseTimeMs: integer("total_response_time_ms").default(0), // For computing rolling averages
  responseCount: integer("response_count").default(0),
  
  // Engagement quality
  threadsParticipated: integer("threads_participated").notNull().default(0),
  lastActiveAt: timestamp("last_active_at"),
  engagementScore: real("engagement_score").default(0), // 0-100 computed engagement score
  
  // Communication patterns
  preferredResponseTime: text("preferred_response_time"), // morning, afternoon, evening, night
  communicationStyle: text("communication_style"), // brief, detailed, emoji_heavy, formal
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Unique constraint per driver/period
  uniqueDriverPeriod: sql`UNIQUE (driver_id, period, period_start)`,
  // Indexes for query performance
  driverPeriodIdx: sql`CREATE INDEX CONCURRENTLY driver_engagement_metrics_driver_period_idx ON driver_engagement_metrics (driver_id, period_start)`,
  periodIdx: sql`CREATE INDEX CONCURRENTLY driver_engagement_metrics_period_idx ON driver_engagement_metrics (period_start)`,
}));

export const costCalculations = pgTable("cost_calculations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  
  // Route details
  totalMiles: integer("total_miles").notNull(),
  deadheadMiles: integer("deadhead_miles").default(0),
  estimatedDrivingTime: integer("estimated_driving_time").notNull(), // minutes
  
  // Fuel calculations
  fuelPrice: real("fuel_price").notNull(), // per gallon
  vehicleMpg: real("vehicle_mpg").notNull(),
  estimatedFuelCost: real("estimated_fuel_cost").notNull(),
  
  // Toll calculations
  estimatedTolls: real("estimated_tolls").default(0),
  tollRoutes: jsonb("toll_routes").default([]), // Specific toll roads
  
  // Time-based costs
  hourlyDriverRate: real("hourly_driver_rate").default(25), // driver compensation per hour
  estimatedLaborCost: real("estimated_labor_cost").notNull(),
  
  // Vehicle costs
  vehicleOperatingCost: real("vehicle_operating_cost").default(0.58), // per mile
  maintenanceCost: real("maintenance_cost").default(0),
  depreciationCost: real("depreciation_cost").default(0),
  
  // Total calculations
  totalEstimatedCosts: real("total_estimated_costs").notNull(),
  grossRevenue: real("gross_revenue").notNull(),
  netProfit: real("net_profit").notNull(),
  profitMargin: real("profit_margin").notNull(),
  ratePerMile: real("rate_per_mile").notNull(),
  
  // Market comparison
  marketAverageRate: real("market_average_rate").default(0),
  rateCompetitiveness: text("rate_competitiveness"), // below_market, competitive, above_market
  
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas and types for Smart Load Matching tables
export const insertDriverLoadHistorySchema = createInsertSchema(driverLoadHistory).omit({
  id: true,
  createdAt: true,
});

export const insertMarketRateTrendsSchema = createInsertSchema(marketRateTrends).omit({
  id: true,
  lastUpdated: true,
  createdAt: true,
});

export const insertBackhaulOpportunitiesSchema = createInsertSchema(backhaulOpportunities).omit({
  id: true,
  createdAt: true,
});

export const insertLoadRecommendationsSchema = createInsertSchema(loadRecommendations).omit({
  id: true,
  createdAt: true,
});

export const insertAiAnalyticsSchema = createInsertSchema(aiAnalytics).omit({
  id: true,
  createdAt: true,
});

export const insertCostCalculationsSchema = createInsertSchema(costCalculations).omit({
  id: true,
  createdAt: true,
});

export type DriverLoadHistory = typeof driverLoadHistory.$inferSelect;
export type InsertDriverLoadHistory = z.infer<typeof insertDriverLoadHistorySchema>;

export type MarketRateTrends = typeof marketRateTrends.$inferSelect;
export type InsertMarketRateTrends = z.infer<typeof insertMarketRateTrendsSchema>;

export type BackhaulOpportunities = typeof backhaulOpportunities.$inferSelect;
export type InsertBackhaulOpportunities = z.infer<typeof insertBackhaulOpportunitiesSchema>;

export type LoadRecommendations = typeof loadRecommendations.$inferSelect;
export type InsertLoadRecommendations = z.infer<typeof insertLoadRecommendationsSchema>;

export type AiAnalytics = typeof aiAnalytics.$inferSelect;
export type InsertAiAnalytics = z.infer<typeof insertAiAnalyticsSchema>;

export type CostCalculations = typeof costCalculations.$inferSelect;
export type InsertCostCalculations = z.infer<typeof insertCostCalculationsSchema>;

// Communication System Types
export type InsertLoadCommunicationThread = typeof loadCommunicationThreads.$inferInsert;
export type LoadCommunicationThread = typeof loadCommunicationThreads.$inferSelect;

export type InsertLoadMessage = typeof loadMessages.$inferInsert;
export type LoadMessage = typeof loadMessages.$inferSelect;

export type InsertMessageAttachment = typeof messageAttachments.$inferInsert;
export type MessageAttachment = typeof messageAttachments.$inferSelect;

export type InsertQuickReplyTemplate = typeof quickReplyTemplates.$inferInsert;
export type QuickReplyTemplate = typeof quickReplyTemplates.$inferSelect;

export type InsertCommunicationLog = typeof communicationLogs.$inferInsert;
export type CommunicationLog = typeof communicationLogs.$inferSelect;

// Define Drizzle Relations
export const driversRelations = relations(drivers, ({ many }) => ({
  loads: many(loads),
  locations: many(driverLocations),
  loadOffers: many(loadOffers),
  bidResponses: many(bidResponses),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  loads: many(loads),
  geofences: many(geofences),
}));

export const loadsRelations = relations(loads, ({ one, many }) => ({
  driver: one(drivers, {
    fields: [loads.driverId],
    references: [drivers.id],
  }),
  customer: one(customers, {
    fields: [loads.customerId],
    references: [customers.id],
  }),
  documents: many(loadDocuments),
  offers: many(loadOffers),
  routes: many(routes),
  communicationThread: one(loadCommunicationThreads, {
    fields: [loads.id],
    references: [loadCommunicationThreads.loadId],
  }),
  messages: many(loadMessages),
  communicationLogs: many(communicationLogs),
}));

export const driverLocationsRelations = relations(driverLocations, ({ one }) => ({
  driver: one(drivers, {
    fields: [driverLocations.driverId],
    references: [drivers.id],
  }),
  load: one(loads, {
    fields: [driverLocations.loadId],
    references: [loads.id],
  }),
}));

export const geofencesRelations = relations(geofences, ({ one, many }) => ({
  load: one(loads, {
    fields: [geofences.loadId],
    references: [loads.id],
  }),
  customer: one(customers, {
    fields: [geofences.customerId],
    references: [customers.id],
  }),
  events: many(geofenceEvents),
}));

export const geofenceEventsRelations = relations(geofenceEvents, ({ one }) => ({
  geofence: one(geofences, {
    fields: [geofenceEvents.geofenceId],
    references: [geofences.id],
  }),
  driver: one(drivers, {
    fields: [geofenceEvents.driverId],
    references: [drivers.id],
  }),
  load: one(loads, {
    fields: [geofenceEvents.loadId],
    references: [loads.id],
  }),
}));

export const routesRelations = relations(routes, ({ one }) => ({
  load: one(loads, {
    fields: [routes.loadId],
    references: [loads.id],
  }),
  driver: one(drivers, {
    fields: [routes.driverId],
    references: [drivers.id],
  }),
}));

export const loadOffersRelations = relations(loadOffers, ({ one }) => ({
  load: one(loads, {
    fields: [loadOffers.loadId],
    references: [loads.id],
  }),
  driver: one(drivers, {
    fields: [loadOffers.driverId],
    references: [drivers.id],
  }),
}));

export const loadDocumentsRelations = relations(loadDocuments, ({ one }) => ({
  load: one(loads, {
    fields: [loadDocuments.loadId],
    references: [loads.id],
  }),
  driver: one(drivers, {
    fields: [loadDocuments.driverId],
    references: [drivers.id],
  }),
}));

export const emailLogsRelations = relations(emailLogs, ({ one }) => ({
  load: one(loads, {
    fields: [emailLogs.loadId],
    references: [loads.id],
  }),
  template: one(emailTemplates, {
    fields: [emailLogs.templateId],
    references: [emailTemplates.id],
  }),
}));

export const scraperConfigsRelations = relations(scraperConfigs, ({ one, many }) => ({
  customer: one(customers, {
    fields: [scraperConfigs.defaultCustomerId],
    references: [customers.id],
  }),
  logs: many(scraperLogs),
}));

export const scraperLogsRelations = relations(scraperLogs, ({ one }) => ({
  config: one(scraperConfigs, {
    fields: [scraperLogs.configId],
    references: [scraperConfigs.id],
  }),
}));

// Communication System Relations
export const loadCommunicationThreadsRelations = relations(loadCommunicationThreads, ({ one, many }) => ({
  load: one(loads, {
    fields: [loadCommunicationThreads.loadId],
    references: [loads.id],
  }),
  driver: one(drivers, {
    fields: [loadCommunicationThreads.driverId],
    references: [drivers.id],
  }),
  messages: many(loadMessages),
}));

export const loadMessagesRelations = relations(loadMessages, ({ one, many }) => ({
  thread: one(loadCommunicationThreads, {
    fields: [loadMessages.threadId],
    references: [loadCommunicationThreads.id],
  }),
  load: one(loads, {
    fields: [loadMessages.loadId],
    references: [loads.id],
  }),
  sender: one(drivers, {
    fields: [loadMessages.senderId],
    references: [drivers.id],
  }),
  attachments: many(messageAttachments),
  replyTo: one(loadMessages, {
    fields: [loadMessages.replyToMessageId],
    references: [loadMessages.id],
  }),
}));

export const messageAttachmentsRelations = relations(messageAttachments, ({ one }) => ({
  message: one(loadMessages, {
    fields: [messageAttachments.messageId],
    references: [loadMessages.id],
  }),
  load: one(loads, {
    fields: [messageAttachments.loadId],
    references: [loads.id],
  }),
}));

export const communicationLogsRelations = relations(communicationLogs, ({ one }) => ({
  load: one(loads, {
    fields: [communicationLogs.loadId],
    references: [loads.id],
  }),
  thread: one(loadCommunicationThreads, {
    fields: [communicationLogs.threadId],
    references: [loadCommunicationThreads.id],
  }),
}));

// Communication Insights Dashboard Relations
export const aiPerformanceMetricsRelations = relations(aiPerformanceMetrics, ({ one }) => ({
  thread: one(loadCommunicationThreads, {
    fields: [aiPerformanceMetrics.threadId],
    references: [loadCommunicationThreads.id],
  }),
  driver: one(drivers, {
    fields: [aiPerformanceMetrics.driverId],
    references: [drivers.id],
  }),
}));

export const driverEngagementMetricsRelations = relations(driverEngagementMetrics, ({ one }) => ({
  driver: one(drivers, {
    fields: [driverEngagementMetrics.driverId],
    references: [drivers.id],
  }),
}));

// Insert Schemas for Communication Insights
export const insertCommunicationInsightsSchema = createInsertSchema(communicationInsights).omit({
  id: true,
  createdAt: true,
});

export const insertAiPerformanceMetricsSchema = createInsertSchema(aiPerformanceMetrics).omit({
  id: true,
  createdAt: true,
});

export const insertDriverEngagementMetricsSchema = createInsertSchema(driverEngagementMetrics).omit({
  id: true,
  createdAt: true,
});


// Insert Types
export type InsertCommunicationInsights = z.infer<typeof insertCommunicationInsightsSchema>;
export type InsertAiPerformanceMetrics = z.infer<typeof insertAiPerformanceMetricsSchema>;
export type InsertDriverEngagementMetrics = z.infer<typeof insertDriverEngagementMetricsSchema>;

// Select Types
export type CommunicationInsights = typeof communicationInsights.$inferSelect;
export type AiPerformanceMetrics = typeof aiPerformanceMetrics.$inferSelect;
export type DriverEngagementMetrics = typeof driverEngagementMetrics.$inferSelect;

// Session storage table - REQUIRED for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table - REQUIRED for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User types for Replit Auth
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
