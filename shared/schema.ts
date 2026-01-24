import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, jsonb, index, pgEnum, unique, foreignKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums for multi-tenant subscription system
export const userRoleEnum = pgEnum("user_role", ["admin", "dispatcher"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired"
]);
export const subscriptionPlanEnum = pgEnum("subscription_plan", ["starter", "pro", "enterprise"]);
export const paymentMethodTypeEnum = pgEnum("payment_method_type", ["card", "ach", "bank_transfer"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "open", "paid", "void", "uncollectible"]);

// ============================================================================
// REVENUE LOOP ENUMS - GA Loads, AR, Collections
// ============================================================================

export const loadLifecycleStatusEnum = pgEnum("load_lifecycle_status", [
  "new", "offered", "booked", "scheduled", "in_transit", "delivered", "cancelled", "expired"
]);

export const arInvoiceStatusEnum = pgEnum("ar_invoice_status", [
  "draft", "sent", "paid", "void", "disputed"
]);

export const collectionStageEnum = pgEnum("collection_stage", [
  "soft", "firm", "final", "escalated"
]);

export const collectionItemStatusEnum = pgEnum("collection_item_status", [
  "open", "in_progress", "promise", "escalated", "closed", "dispute"
]);

export const nextActionKindEnum = pgEnum("next_action_kind", [
  "EMAIL", "CALL", "TEXT", "SYSTEM"
]);

// Companies table - the organization/trucking company
export const companies = pgTable("companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // URL-friendly identifier
  stripeCustomerId: text("stripe_customer_id").unique(),
  trialEndsAt: timestamp("trial_ends_at"), // When trial expires
  billingEmail: text("billing_email").notNull(),
  website: text("website"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  country: text("country").default("US"),
  timezone: text("timezone").default("America/New_York"),
  isActive: boolean("is_active").notNull().default(true),
  settings: jsonb("settings"), // Company-specific settings
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Subscriptions table - tracks subscription status and plans
export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  planTier: subscriptionPlanEnum("plan_tier").notNull().default("starter"),
  status: subscriptionStatusEnum("status").notNull().default("trialing"),
  collectionMethod: text("collection_method").default("charge_automatically"), // charge_automatically, send_invoice
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  cancelAt: timestamp("cancel_at"),
  canceledAt: timestamp("canceled_at"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  trialStart: timestamp("trial_start"),
  trialEnd: timestamp("trial_end"),
  seatsPurchased: integer("seats_purchased").default(5), // Number of dispatcher seats
  metadata: jsonb("metadata"), // Additional subscription metadata
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Company Users junction table - links users to companies with roles
export const companyUsers = pgTable("company_users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: userRoleEnum("role").notNull().default("dispatcher"),
  invitedByUserId: varchar("invited_by_user_id").references(() => users.id),
  invitedAt: timestamp("invited_at").defaultNow(),
  acceptedAt: timestamp("accepted_at"),
  lastActiveAt: timestamp("last_active_at"),
  isPrimaryAdmin: boolean("is_primary_admin").notNull().default(false), // Company owner
  createdAt: timestamp("created_at").defaultNow(),
});

// Payment Methods table - stores payment methods
export const paymentMethods = pgTable("payment_methods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  stripePaymentMethodId: text("stripe_payment_method_id").unique().notNull(),
  type: paymentMethodTypeEnum("type").notNull(),
  // Card fields
  brand: text("brand"), // visa, mastercard, amex, etc.
  last4: text("last4"),
  expMonth: integer("exp_month"),
  expYear: integer("exp_year"),
  // ACH/Bank fields
  bankName: text("bank_name"),
  accountHolderName: text("account_holder_name"),
  accountType: text("account_type"), // checking, savings
  mandateStatus: text("mandate_status"), // active, pending, inactive
  isDefault: boolean("is_default").notNull().default(false),
  addedAt: timestamp("added_at").defaultNow(),
  detachedAt: timestamp("detached_at"), // When payment method was removed
});

// Billing History table - tracks invoices and payments
export const billingHistory = pgTable("billing_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  stripeInvoiceId: text("stripe_invoice_id").unique(),
  stripeInvoiceNumber: text("stripe_invoice_number"),
  amountDue: integer("amount_due").notNull(), // In cents
  amountPaid: integer("amount_paid").notNull().default(0), // In cents
  currency: text("currency").notNull().default("usd"),
  status: invoiceStatusEnum("status").notNull(),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  hostedInvoiceUrl: text("hosted_invoice_url"),
  invoicePdfUrl: text("invoice_pdf_url"),
  description: text("description"),
  attemptCount: integer("attempt_count").default(0),
  nextPaymentAttempt: timestamp("next_payment_attempt"),
  createdAt: timestamp("created_at").defaultNow(),
  paidAt: timestamp("paid_at"),
});

export const drivers = pgTable("drivers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }), // Multi-tenant: nullable during migration
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
  
  trackingToken: varchar("tracking_token", { length: 64 }).unique(),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_drivers_company_id").on(table.companyId),
  unique("drivers_id_company_id_unique").on(table.id, table.companyId),
]);

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }), // Multi-tenant: nullable during migration
  name: text("name").notNull(),
  contactPerson: text("contact_person").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  status: text("status").notNull().default("active"), // active, inactive
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_customers_company_id").on(table.companyId),
  unique("customers_id_company_id_unique").on(table.id, table.companyId),
]);

export const loads = pgTable("loads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }), // Multi-tenant: nullable during migration
  loadNumber: text("load_number").notNull().unique(),
  customerId: varchar("customer_id").notNull(),
  driverId: varchar("driver_id"),
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
  // GPS tracking SMS throttle - prevents spam by tracking last send time
  gpsTrackingSmsLastSentAt: timestamp("gps_tracking_sms_last_sent_at"),
  
  // Revenue Loop Pipeline Fields
  truckId: varchar("truck_id").references(() => trucks.id),
  lifecycleStatus: loadLifecycleStatusEnum("lifecycle_status").default("new"),
  originCity: text("origin_city"),
  originState: text("origin_state"),
  destCity: text("dest_city"),
  destState: text("dest_state"),
  offeredRate: real("offered_rate"),
  rpm: real("rpm"),
  score: integer("score"),
  offeredAt: timestamp("offered_at"),
  bookedAt: timestamp("booked_at"),
  deliveredAt: timestamp("delivered_at"),
  rateconPath: text("ratecon_path"),
  podPath: text("pod_path"),
  overrideReason: text("override_reason"),
  
  // EV SOP Checklist Fields
  sopProgress: jsonb("sop_progress").default({}),
  fuelCost: real("fuel_cost"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_loads_company_id").on(table.companyId),
  index("idx_loads_lifecycle_status").on(table.lifecycleStatus),
  unique("loads_id_company_id_unique").on(table.id, table.companyId),
  foreignKey({
    columns: [table.customerId, table.companyId],
    foreignColumns: [customers.id, customers.companyId],
    name: "loads_customer_company_fk"
  }),
  foreignKey({
    columns: [table.driverId, table.companyId],
    foreignColumns: [drivers.id, drivers.companyId],
    name: "loads_driver_company_fk"
  }),
]);

// ============================================================================
// REVENUE LOOP TABLES - AR Invoices, Collections, Activity Log
// ============================================================================

export const arInvoices = pgTable("ar_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }).notNull(),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  status: arInvoiceStatusEnum("status").default("draft"),
  
  totalAmountCents: integer("total_amount_cents").notNull(),
  balanceDueCents: integer("balance_due_cents").notNull(),
  
  createdAt: timestamp("created_at").defaultNow(),
  sentAt: timestamp("sent_at"),
  dueDate: timestamp("due_date").notNull(),
  paidAt: timestamp("paid_at"),
  
  paymentMethod: text("payment_method"),
  paymentReference: text("payment_reference"),
}, (table) => [
  index("idx_ar_invoices_company_id").on(table.companyId),
  index("idx_ar_invoices_status").on(table.status),
  index("idx_ar_invoices_due_date").on(table.dueDate),
]);

export const collectionsItems = pgTable("collections_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").references(() => arInvoices.id).notNull(),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }).notNull(),
  
  status: collectionItemStatusEnum("status").default("open"),
  stage: collectionStageEnum("stage").default("soft"),
  owner: text("owner"),
  
  lastTouchAt: timestamp("last_touch_at"),
  promiseDate: timestamp("promise_date"),
  nextActionAt: timestamp("next_action_at"),
  nextActionKind: nextActionKindEnum("next_action_kind").default("SYSTEM"),
  
  escalationLevel: text("escalation_level").default("L0"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_collections_company_id").on(table.companyId),
  index("idx_collections_status").on(table.status),
  index("idx_collections_stage").on(table.stage),
  index("idx_collections_next_action").on(table.nextActionAt),
]);

export const activityLog = pgTable("activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_activity_log_company_id").on(table.companyId),
  index("idx_activity_log_entity").on(table.entityType, table.entityId),
  index("idx_activity_log_created_at").on(table.createdAt),
]);

export const complianceDocuments = pgTable("compliance_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }).notNull(),
  truckId: varchar("truck_id").references(() => trucks.id),
  driverId: varchar("driver_id").references(() => drivers.id),
  type: text("type").notNull(),
  expiryDate: timestamp("expiry_date").notNull(),
  filePath: text("file_path"),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_compliance_docs_company_id").on(table.companyId),
  index("idx_compliance_docs_expiry").on(table.expiryDate),
  index("idx_compliance_docs_status").on(table.status),
]);

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
  source: text("source").notNull().default("simulated"), // 'gps' for real device GPS, 'simulated' for background service
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

// Load Documents Table - Professional document management with approval workflow
export const loadDocuments = pgTable("load_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  
  // Document categorization - Expanded to support all common freight document types
  documentType: text("document_type").notNull(), // 'bol', 'pod', 'weight_ticket', 'inspection', 'receipt', 'fuel_receipt', 'scale_ticket', 'other'
  
  // File details
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(), // URL to object storage
  fileSize: integer("file_size"), // File size in bytes
  mimeType: text("mime_type"),
  
  // Legacy fields for BOL compatibility
  signerName: text("signer_name"), // Name of person who signed BOL
  notes: text("notes"), // Driver-provided notes about the document
  
  // Approval Workflow - Track document review and approval process
  approvalStatus: text("approval_status").notNull().default("pending"), // 'pending', 'approved', 'rejected'
  approvedBy: varchar("approved_by"), // User/dispatcher ID who approved
  approvedAt: timestamp("approved_at"), // When document was approved
  rejectedBy: varchar("rejected_by"), // User/dispatcher ID who rejected
  rejectedAt: timestamp("rejected_at"), // When document was rejected
  rejectionReason: text("rejection_reason"), // Explanation for rejection
  dispatcherNotes: text("dispatcher_notes"), // Internal dispatcher comments
  
  // Quality Metrics - Automated document quality assessment
  imageWidth: integer("image_width"), // Image resolution width in pixels
  imageHeight: integer("image_height"), // Image resolution height in pixels
  qualityScore: integer("quality_score"), // Auto-calculated quality rating 0-100
  qualityWarnings: text("quality_warnings").array(), // Array of quality issues detected
  
  // Versioning & Audit - Track document resubmissions and changes
  version: integer("version").notNull().default(1), // Version number for resubmissions
  parentDocumentId: varchar("parent_document_id"), // Self-reference to previous version
  isLatestVersion: boolean("is_latest_version").notNull().default(true), // Is this the current version?
  uploadSource: text("upload_source").notNull().default("web"), // 'mms', 'web', 'mobile_app'
  
  // Required Document Tracking - Flag critical documents
  isRequired: boolean("is_required").notNull().default(false), // Is this document required for load completion?
  requiredCategory: text("required_category"), // Which doc type is required for this load
  
  // Timestamps
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Document Annotations - Canvas-based annotations on documents for review workflow
export const documentAnnotations = pgTable("document_annotations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => loadDocuments.id).notNull(),
  
  // Annotation details
  annotationType: text("annotation_type").notNull(), // 'rectangle', 'arrow', 'freehand', 'text'
  color: text("color").notNull().default("#ff0000"), // Hex color code
  
  // Position and dimensions (normalized 0-1 coordinates relative to image)
  x: real("x").notNull(),
  y: real("y").notNull(),
  width: real("width"),
  height: real("height"),
  
  // Path data for freehand annotations
  pathData: jsonb("path_data"), // Array of {x, y} points
  
  // Text annotation content
  textContent: text("text_content"),
  fontSize: integer("font_size").default(14),
  
  // Arrow annotation
  endX: real("end_x"),
  endY: real("end_y"),
  
  // Metadata
  note: text("note"), // Optional note about this annotation
  createdBy: varchar("created_by"), // User/dispatcher who created
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Document Audit Log - Track all document actions for complete history
export const documentAuditLog = pgTable("document_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => loadDocuments.id).notNull(),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  
  // Action details
  action: text("action").notNull(), // 'uploaded', 'approved', 'rejected', 'recategorized', 'resubmitted', 'annotated', 'deleted'
  performedBy: varchar("performed_by"), // User/driver ID who performed action
  performedByRole: text("performed_by_role").notNull(), // 'driver', 'dispatcher', 'system'
  performedByName: text("performed_by_name").notNull(), // Display name
  
  // Action-specific data
  previousValue: text("previous_value"), // Previous status/category/etc
  newValue: text("new_value"), // New status/category/etc
  reason: text("reason"), // Rejection reason or recategorization reason
  notes: text("notes"), // Additional notes
  
  // Versioning
  documentVersion: integer("document_version").default(1),
  
  // Metadata
  metadata: jsonb("metadata").default({}), // Additional action-specific data
  
  createdAt: timestamp("created_at").defaultNow(),
});

// AI Document Extractions - Store AI-extracted data from documents (BOL, Recon, Driver Sheets)
export const documentExtractions = pgTable("document_extractions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => loadDocuments.id).notNull(),
  documentType: text("document_type").notNull(), // 'bol', 'recon', 'driver_sheet'
  extractedData: jsonb("extracted_data").notNull(), // Full extracted data object from AI
  confidence: real("confidence").notNull(), // AI confidence score 0-1
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Extraction Verifications - Track field-level corrections to AI extractions
export const extractionVerifications = pgTable("extraction_verifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  extractionId: varchar("extraction_id").references(() => documentExtractions.id).notNull(),
  field: text("field").notNull(), // Which field was verified/edited
  originalValue: text("original_value"),
  correctedValue: text("corrected_value"),
  verifiedBy: text("verified_by").notNull(),
  verifiedAt: timestamp("verified_at").defaultNow(),
});

// Driver Communication Threads - Unified messaging hub for all driver-dispatcher communication
// One thread per driver containing all messages (load-specific and general)
export const loadCommunicationThreads = pgTable("load_communication_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }), // Multi-tenant: nullable during migration
  // Thread type - always 'unified' for the new simplified messaging system
  threadType: text("thread_type").notNull().default("unified"), // 'unified' for all driver communication
  loadId: varchar("load_id"), // Current/active load context (optional)
  driverId: varchar("driver_id").notNull(),
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
}, (table) => ({
  uniqueDriverUnifiedThread: index("idx_unique_driver_unified_thread")
    .on(table.driverId)
    .where(sql`thread_type = 'unified'`),
  companyIdIndex: index("idx_threads_company_id").on(table.companyId),
  loadCompanyFk: foreignKey({
    columns: [table.loadId, table.companyId],
    foreignColumns: [loads.id, loads.companyId],
    name: "threads_load_company_fk"
  }),
  driverCompanyFk: foreignKey({
    columns: [table.driverId, table.companyId],
    foreignColumns: [drivers.id, drivers.companyId],
    name: "threads_driver_company_fk"
  }),
}));

// Load Messages - All communication within a load thread
export const loadMessages = pgTable("load_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }), // Multi-tenant: nullable during migration
  threadId: varchar("thread_id").references(() => loadCommunicationThreads.id).notNull(),
  loadId: varchar("load_id"), // nullable for general conversations
  senderId: varchar("sender_id"), // driver ID or null for dispatch
  senderRole: text("sender_role").notNull(), // 'driver', 'dispatch', 'assistant', 'system'
  senderName: text("sender_name").notNull(), // Display name
  
  // Message content
  messageType: text("message_type").notNull().default("text"), // text, image, document, location, status_update
  textContent: text("text_content"),
  mediaUrl: text("media_url"), // MMS image/media URL from Twilio
  mediaType: text("media_type"), // MIME type of the media (e.g., image/jpeg, video/mp4)
  
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
}, (table) => [
  index("idx_messages_company_id").on(table.companyId),
  foreignKey({
    columns: [table.loadId, table.companyId],
    foreignColumns: [loads.id, loads.companyId],
    name: "messages_load_company_fk"
  }),
]);

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
}).extend({
  // Document type validation - enforce valid document categories
  documentType: z.enum(['bol', 'pod', 'weight_ticket', 'inspection', 'receipt', 'fuel_receipt', 'scale_ticket', 'other']),
  
  // Approval status validation - only allow specific statuses
  approvalStatus: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  
  // Quality score validation - must be between 0-100 or null
  qualityScore: z.number().int().min(0).max(100).optional(),
  
  // Upload source validation - enforce known sources
  uploadSource: z.enum(['mms', 'web', 'mobile_app']).default('web'),
  
  // Version must be positive integer
  version: z.number().int().min(1).default(1),
  
  // Boolean validations with defaults
  isLatestVersion: z.boolean().default(true),
  isRequired: z.boolean().default(false),
});

export const insertDocumentAnnotationSchema = createInsertSchema(documentAnnotations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  annotationType: z.enum(['rectangle', 'arrow', 'freehand', 'text']),
  color: z.string().default('#ff0000'),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const insertDocumentAuditLogSchema = createInsertSchema(documentAuditLog).omit({
  id: true,
  createdAt: true,
}).extend({
  action: z.enum(['uploaded', 'approved', 'rejected', 'recategorized', 'resubmitted', 'annotated', 'deleted']),
  performedByRole: z.enum(['driver', 'dispatcher', 'system']),
});

export const insertDocumentExtractionSchema = createInsertSchema(documentExtractions).omit({
  id: true,
  createdAt: true,
}).extend({
  documentType: z.enum(['bol', 'recon', 'driver_sheet']),
  confidence: z.number().min(0).max(1),
  isVerified: z.boolean().default(false),
});

export const insertExtractionVerificationSchema = createInsertSchema(extractionVerifications).omit({
  id: true,
  verifiedAt: true,
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

export type DocumentAnnotation = typeof documentAnnotations.$inferSelect;
export type InsertDocumentAnnotation = z.infer<typeof insertDocumentAnnotationSchema>;

export type DocumentAuditLog = typeof documentAuditLog.$inferSelect;
export type InsertDocumentAuditLog = z.infer<typeof insertDocumentAuditLogSchema>;

export type DocumentExtraction = typeof documentExtractions.$inferSelect;
export type InsertDocumentExtraction = z.infer<typeof insertDocumentExtractionSchema>;

export type ExtractionVerification = typeof extractionVerifications.$inferSelect;
export type InsertExtractionVerification = z.infer<typeof insertExtractionVerificationSchema>;

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

// Insert Schemas for Multi-Tenant Subscription System
export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertCompanyUserSchema = createInsertSchema(companyUsers).omit({
  id: true,
  createdAt: true,
});

export const insertPaymentMethodSchema = createInsertSchema(paymentMethods).omit({
  id: true,
  addedAt: true,
});

export const insertBillingHistorySchema = createInsertSchema(billingHistory).omit({
  id: true,
  createdAt: true,
});

// Insert Types
export type InsertCommunicationInsights = z.infer<typeof insertCommunicationInsightsSchema>;
export type InsertAiPerformanceMetrics = z.infer<typeof insertAiPerformanceMetricsSchema>;
export type InsertDriverEngagementMetrics = z.infer<typeof insertDriverEngagementMetricsSchema>;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type InsertCompanyUser = z.infer<typeof insertCompanyUserSchema>;
export type InsertPaymentMethod = z.infer<typeof insertPaymentMethodSchema>;
export type InsertBillingHistory = z.infer<typeof insertBillingHistorySchema>;

// Select Types
export type CommunicationInsights = typeof communicationInsights.$inferSelect;
export type AiPerformanceMetrics = typeof aiPerformanceMetrics.$inferSelect;
export type DriverEngagementMetrics = typeof driverEngagementMetrics.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type CompanyUser = typeof companyUsers.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type BillingHistory = typeof billingHistory.$inferSelect;

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

// ============================================================================
// MVFRS (Minimum Viable Fleet Reliability System) Tables
// ============================================================================

// Enums for MVFRS
export const truckBodyTypeEnum = pgEnum("truck_body_type", ["BOX_26FT", "SPRINTER", "STRAIGHT_TRUCK", "OTHER"]);
export const truckStatusEnum = pgEnum("truck_status", ["ACTIVE", "IN_SHOP", "OUT_OF_SERVICE", "SOLD"]);
export const vendorCategoryEnum = pgEnum("vendor_category", ["TOWING", "MOBILE_MECHANIC", "TIRE", "DEALER_SERVICE", "LIFTGATE", "BODY_SHOP", "GENERAL_REPAIR", "ROADSIDE"]);
export const maintenanceIntervalTypeEnum = pgEnum("maintenance_interval_type", ["MILES", "DAYS", "BOTH"]);
export const maintenanceTaskCategoryEnum = pgEnum("maintenance_task_category", ["ENGINE", "BRAKES", "TIRES", "ELECTRICAL", "SUSPENSION", "DRIVELINE", "LIFTGATE", "SAFETY", "OTHER"]);
export const priorityEnum = pgEnum("priority", ["ROUTINE", "URGENT", "CRITICAL"]);
export const pmScheduleStatusEnum = pgEnum("pm_schedule_status", ["DUE_SOON", "DUE", "OVERDUE", "SCHEDULED", "COMPLETED", "SKIPPED"]);
export const inspectionTypeEnum = pgEnum("inspection_type", ["PRE_TRIP", "POST_TRIP", "WEEKLY", "MONTHLY_FLEET", "QUARTERLY_PM_REVIEW", "ANNUAL_DOT_READY"]);
export const inspectionItemStatusEnum = pgEnum("inspection_item_status", ["OK", "NEEDS_ATTENTION", "NOT_APPLICABLE"]);
export const workOrderSourceEnum = pgEnum("work_order_source", ["MANUAL", "INSPECTION", "PM_SCHEDULE", "BREAKDOWN"]);
export const workOrderStatusEnum = pgEnum("work_order_status", ["OPEN", "TRIAGED", "ASSIGNED_VENDOR", "IN_PROGRESS", "WAITING_PARTS", "COMPLETED", "CLOSED", "CANCELED"]);
export const workOrderEventTypeEnum = pgEnum("work_order_event_type", ["NOTE", "STATUS_CHANGE", "VENDOR_ASSIGNED", "COST_UPDATE", "PHOTO_ADDED", "ESCALATION", "CUSTOMER_NOTICE_SENT"]);
export const fleetDocTypeEnum = pgEnum("fleet_doc_type", ["INSURANCE", "REGISTRATION", "ANNUAL_INSPECTION", "IFTA", "UCR", "PERMIT", "TITLE", "LEASE_AGREEMENT", "OTHER"]);
export const fleetDocSubjectTypeEnum = pgEnum("fleet_doc_subject_type", ["TRUCK", "DRIVER", "COMPANY"]);
export const fleetDocStatusEnum = pgEnum("fleet_doc_status", ["ACTIVE", "EXPIRED", "REPLACED"]);
export const notificationChannelEnum = pgEnum("notification_channel", ["PUSH_NEXTSTEP", "EMAIL", "SMS", "TELEGRAM", "IN_APP"]);
export const notificationStatusEnum = pgEnum("notification_status", ["QUEUED", "SENT", "FAILED"]);

// Dispatch Gate Status Enum
export const dispatchGateStatusEnum = pgEnum("dispatch_gate_status", ["GREEN", "YELLOW", "RED"]);

// TRUCKS table
export const trucks = pgTable("trucks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),
  unitNumber: text("unit_number").notNull(),
  vin: text("vin"),
  year: integer("year").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  bodyType: truckBodyTypeEnum("body_type").notNull().default("BOX_26FT"),
  hasLiftgate: boolean("has_liftgate").notNull().default(false),
  liftgateType: text("liftgate_type"),
  currentOdometer: integer("current_odometer").notNull().default(0),
  odometerLastUpdatedAt: timestamp("odometer_last_updated_at"),
  status: truckStatusEnum("status").notNull().default("ACTIVE"),
  baseZip: text("base_zip"),
  insurancePolicyId: varchar("insurance_policy_id"),
  assignedDriverId: varchar("assigned_driver_id").references(() => drivers.id),
  
  // Risk Score Fields (0-100 scale, lower is better)
  riskScore: integer("risk_score").notNull().default(0),
  riskScoreLastCalculatedAt: timestamp("risk_score_last_calculated_at"),
  
  // Risk Score Components
  inspectionRiskPoints: integer("inspection_risk_points").notNull().default(0),
  maintenanceRiskPoints: integer("maintenance_risk_points").notNull().default(0),
  breakdownRiskPoints: integer("breakdown_risk_points").notNull().default(0),
  complianceRiskPoints: integer("compliance_risk_points").notNull().default(0),
  ageRiskPoints: integer("age_risk_points").notNull().default(0),
  
  // Dispatch Gate (GREEN = go, YELLOW = caution/manager approval, RED = no dispatch)
  dispatchGateStatus: dispatchGateStatusEnum("dispatch_gate_status").notNull().default("GREEN"),
  dispatchGateReason: text("dispatch_gate_reason"),
  dispatchGateOverrideBy: varchar("dispatch_gate_override_by").references(() => users.id),
  dispatchGateOverrideAt: timestamp("dispatch_gate_override_at"),
  dispatchGateOverrideReason: text("dispatch_gate_override_reason"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_trucks_company_id").on(table.companyId),
  index("idx_trucks_status").on(table.status),
  index("idx_trucks_risk_score").on(table.riskScore),
  index("idx_trucks_dispatch_gate").on(table.dispatchGateStatus),
]);

// VENDORS table (repair network)
export const vendors = pgTable("vendors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  category: vendorCategoryEnum("category").notNull(),
  phone24_7: text("phone_24_7"),
  phoneDay: text("phone_day"),
  email: text("email"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  serviceRadiusMiles: integer("service_radius_miles"),
  paymentTerms: text("payment_terms"),
  notes: text("notes"),
  isPreferred: boolean("is_preferred").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_vendors_company_id").on(table.companyId),
  index("idx_vendors_category").on(table.category),
]);

// MAINTENANCE_PLANS table (PM templates)
export const maintenancePlans = pgTable("maintenance_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  intervalType: maintenanceIntervalTypeEnum("interval_type").notNull().default("MILES"),
  intervalMiles: integer("interval_miles"),
  intervalDays: integer("interval_days"),
  graceMiles: integer("grace_miles").notNull().default(250),
  graceDays: integer("grace_days").notNull().default(3),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// MAINTENANCE_TASKS table (what's inside a plan)
export const maintenanceTasks = pgTable("maintenance_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").references(() => maintenancePlans.id, { onDelete: "cascade" }).notNull(),
  taskName: text("task_name").notNull(),
  category: maintenanceTaskCategoryEnum("category").notNull().default("OTHER"),
  isSafetyCritical: boolean("is_safety_critical").notNull().default(false),
  defaultPriority: priorityEnum("default_priority").notNull().default("ROUTINE"),
  instructions: text("instructions"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// TRUCK_PLAN_ASSIGNMENTS table
export const truckPlanAssignments = pgTable("truck_plan_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckId: varchar("truck_id").references(() => trucks.id, { onDelete: "cascade" }).notNull(),
  planId: varchar("plan_id").references(() => maintenancePlans.id, { onDelete: "cascade" }).notNull(),
  startOdometer: integer("start_odometer"),
  startDate: timestamp("start_date"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// PM_SCHEDULE table (generated due items per truck)
export const pmSchedule = pgTable("pm_schedule", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  truckId: varchar("truck_id").references(() => trucks.id, { onDelete: "cascade" }).notNull(),
  planId: varchar("plan_id").references(() => maintenancePlans.id, { onDelete: "cascade" }).notNull(),
  dueType: maintenanceIntervalTypeEnum("due_type").notNull().default("MILES"),
  dueOdometer: integer("due_odometer"),
  dueDate: timestamp("due_date"),
  status: pmScheduleStatusEnum("status").notNull().default("DUE_SOON"),
  scheduledFor: timestamp("scheduled_for"),
  completedAt: timestamp("completed_at"),
  completionWorkOrderId: varchar("completion_work_order_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// INSPECTIONS table (DVIR + company inspections)
export const fleetInspections = pgTable("fleet_inspections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),
  inspectionType: inspectionTypeEnum("inspection_type").notNull().default("PRE_TRIP"),
  truckId: varchar("truck_id").references(() => trucks.id, { onDelete: "cascade" }).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id),
  performedByUserId: varchar("performed_by_user_id").references(() => users.id),
  odometer: integer("odometer"),
  locationText: text("location_text"),
  isSafeToOperate: boolean("is_safe_to_operate").notNull().default(true),
  summaryNotes: text("summary_notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_fleet_inspections_truck_id").on(table.truckId),
  index("idx_fleet_inspections_driver_id").on(table.driverId),
]);

// INSPECTION_ITEMS table (checklist results)
export const inspectionItems = pgTable("inspection_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inspectionId: varchar("inspection_id").references(() => fleetInspections.id, { onDelete: "cascade" }).notNull(),
  itemCode: text("item_code").notNull(),
  itemLabel: text("item_label").notNull(),
  status: inspectionItemStatusEnum("status").notNull().default("OK"),
  severity: priorityEnum("severity"),
  defectNotes: text("defect_notes"),
  photoUrls: jsonb("photo_urls"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// WORK_ORDERS table (the operational heart)
export const workOrders = pgTable("work_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),
  truckId: varchar("truck_id").references(() => trucks.id, { onDelete: "cascade" }).notNull(),
  openedByUserId: varchar("opened_by_user_id").references(() => users.id),
  assignedToUserId: varchar("assigned_to_user_id").references(() => users.id),
  driverId: varchar("driver_id").references(() => drivers.id),
  source: workOrderSourceEnum("source").notNull().default("MANUAL"),
  priority: priorityEnum("priority").notNull().default("ROUTINE"),
  status: workOrderStatusEnum("status").notNull().default("OPEN"),
  issueCategory: maintenanceTaskCategoryEnum("issue_category").notNull().default("OTHER"),
  symptoms: text("symptoms"),
  safetyHold: boolean("safety_hold").notNull().default(false),
  vendorId: varchar("vendor_id").references(() => vendors.id),
  estimatedCost: real("estimated_cost"),
  actualCost: real("actual_cost"),
  downtimeStartAt: timestamp("downtime_start_at"),
  downtimeEndAt: timestamp("downtime_end_at"),
  resolutionNotes: text("resolution_notes"),
  relatedInspectionId: varchar("related_inspection_id").references(() => fleetInspections.id),
  relatedPmScheduleId: varchar("related_pm_schedule_id").references(() => pmSchedule.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_work_orders_company_id").on(table.companyId),
  index("idx_work_orders_truck_id").on(table.truckId),
  index("idx_work_orders_status").on(table.status),
  index("idx_work_orders_priority").on(table.priority),
]);

// WORK_ORDER_EVENTS table (audit trail + communications)
export const workOrderEvents = pgTable("work_order_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workOrderId: varchar("work_order_id").references(() => workOrders.id, { onDelete: "cascade" }).notNull(),
  actorUserId: varchar("actor_user_id").references(() => users.id),
  eventType: workOrderEventTypeEnum("event_type").notNull().default("NOTE"),
  message: text("message"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").defaultNow(),
});

// BREAKDOWN_REPORTS table (war room trigger)
export const breakdownReports = pgTable("breakdown_reports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),
  truckId: varchar("truck_id").references(() => trucks.id, { onDelete: "cascade" }).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  reportedAt: timestamp("reported_at").notNull().defaultNow(),
  locationText: text("location_text").notNull(),
  hazard: boolean("hazard").notNull().default(false),
  canMove: boolean("can_move").notNull().default(false),
  description: text("description").notNull(),
  photos: jsonb("photos"),
  workOrderId: varchar("work_order_id").references(() => workOrders.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// FLEET_DOCUMENTS table (expirations + compliance)
export const fleetDocuments = pgTable("fleet_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),
  docType: fleetDocTypeEnum("doc_type").notNull(),
  subjectType: fleetDocSubjectTypeEnum("subject_type").notNull(),
  subjectId: varchar("subject_id").notNull(),
  fileUrl: text("file_url"),
  issuedDate: timestamp("issued_date"),
  expiryDate: timestamp("expiry_date"),
  status: fleetDocStatusEnum("status").notNull().default("ACTIVE"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_fleet_documents_subject").on(table.subjectType, table.subjectId),
  index("idx_fleet_documents_expiry").on(table.expiryDate),
]);

// FLEET_NOTIFICATIONS table (log what got sent)
export const fleetNotifications = pgTable("fleet_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: varchar("company_id").references(() => companies.id, { onDelete: "restrict" }),
  channel: notificationChannelEnum("channel").notNull().default("IN_APP"),
  recipientUserId: varchar("recipient_user_id").references(() => users.id),
  title: text("title"),
  message: text("message").notNull(),
  priority: integer("priority").notNull().default(8),
  relatedType: text("related_type"),
  relatedId: varchar("related_id"),
  status: notificationStatusEnum("status").notNull().default("QUEUED"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ============================================================================
// GMAIL ACCOUNTS for Multi-Account Email Ingestion
// ============================================================================

export const gmailAccounts = pgTable("gmail_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyId: text("company_id").notNull(), // Links to the specific company
  email: text("email").notNull(), // The Gmail address (e.g. annex@...)
  refreshToken: text("refresh_token").notNull(), // The "Magic Key" for this user
  isActive: boolean("is_active").default(true),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_gmail_accounts_company").on(table.companyId),
]);

export const insertGmailAccountSchema = createInsertSchema(gmailAccounts).omit({
  id: true,
  lastSyncedAt: true,
  createdAt: true,
});

export type GmailAccount = typeof gmailAccounts.$inferSelect;
export type InsertGmailAccount = z.infer<typeof insertGmailAccountSchema>;

// ============================================================================
// MVFRS Insert Schemas
// ============================================================================

export const insertTruckSchema = createInsertSchema(trucks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertVendorSchema = createInsertSchema(vendors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMaintenancePlanSchema = createInsertSchema(maintenancePlans).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMaintenanceTaskSchema = createInsertSchema(maintenanceTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTruckPlanAssignmentSchema = createInsertSchema(truckPlanAssignments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPmScheduleSchema = createInsertSchema(pmSchedule).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFleetInspectionSchema = createInsertSchema(fleetInspections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertInspectionItemSchema = createInsertSchema(inspectionItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkOrderSchema = createInsertSchema(workOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertWorkOrderEventSchema = createInsertSchema(workOrderEvents).omit({
  id: true,
  createdAt: true,
});

export const insertBreakdownReportSchema = createInsertSchema(breakdownReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFleetDocumentSchema = createInsertSchema(fleetDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertFleetNotificationSchema = createInsertSchema(fleetNotifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ============================================================================
// MVFRS Types
// ============================================================================

export type Truck = typeof trucks.$inferSelect;
export type InsertTruck = z.infer<typeof insertTruckSchema>;

export type Vendor = typeof vendors.$inferSelect;
export type InsertVendor = z.infer<typeof insertVendorSchema>;

export type MaintenancePlan = typeof maintenancePlans.$inferSelect;
export type InsertMaintenancePlan = z.infer<typeof insertMaintenancePlanSchema>;

export type MaintenanceTask = typeof maintenanceTasks.$inferSelect;
export type InsertMaintenanceTask = z.infer<typeof insertMaintenanceTaskSchema>;

export type TruckPlanAssignment = typeof truckPlanAssignments.$inferSelect;
export type InsertTruckPlanAssignment = z.infer<typeof insertTruckPlanAssignmentSchema>;

export type PmSchedule = typeof pmSchedule.$inferSelect;
export type InsertPmSchedule = z.infer<typeof insertPmScheduleSchema>;

export type FleetInspection = typeof fleetInspections.$inferSelect;
export type InsertFleetInspection = z.infer<typeof insertFleetInspectionSchema>;

export type InspectionItem = typeof inspectionItems.$inferSelect;
export type InsertInspectionItem = z.infer<typeof insertInspectionItemSchema>;

export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;

export type WorkOrderEvent = typeof workOrderEvents.$inferSelect;
export type InsertWorkOrderEvent = z.infer<typeof insertWorkOrderEventSchema>;

export type BreakdownReport = typeof breakdownReports.$inferSelect;
export type InsertBreakdownReport = z.infer<typeof insertBreakdownReportSchema>;

export type FleetDocument = typeof fleetDocuments.$inferSelect;
export type InsertFleetDocument = z.infer<typeof insertFleetDocumentSchema>;

export type FleetNotification = typeof fleetNotifications.$inferSelect;
export type InsertFleetNotification = z.infer<typeof insertFleetNotificationSchema>;

// Extended types with relations
export type TruckWithRelations = Truck & {
  driver?: Driver;
  workOrders?: WorkOrder[];
  inspections?: FleetInspection[];
};

export type WorkOrderWithRelations = WorkOrder & {
  truck: Truck;
  vendor?: Vendor;
  driver?: Driver;
  events?: WorkOrderEvent[];
  inspection?: FleetInspection;
};

export type FleetInspectionWithRelations = FleetInspection & {
  truck: Truck;
  driver?: Driver;
  items: InspectionItem[];
};

// ============================================================================
// REVENUE LOOP Types & Schemas
// ============================================================================

export const insertArInvoiceSchema = createInsertSchema(arInvoices).omit({
  id: true,
  createdAt: true,
});

export const insertCollectionsItemSchema = createInsertSchema(collectionsItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLog).omit({
  id: true,
  createdAt: true,
});

export const insertComplianceDocumentSchema = createInsertSchema(complianceDocuments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ArInvoice = typeof arInvoices.$inferSelect;
export type InsertArInvoice = z.infer<typeof insertArInvoiceSchema>;

export type CollectionsItem = typeof collectionsItems.$inferSelect;
export type InsertCollectionsItem = z.infer<typeof insertCollectionsItemSchema>;

export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type InsertActivityLogEntry = z.infer<typeof insertActivityLogSchema>;

export type ComplianceDocument = typeof complianceDocuments.$inferSelect;
export type InsertComplianceDocument = z.infer<typeof insertComplianceDocumentSchema>;

export type ArInvoiceWithRelations = ArInvoice & {
  load?: Load;
  collectionItem?: CollectionsItem;
};

export type CollectionsItemWithRelations = CollectionsItem & {
  invoice: ArInvoice;
  load?: Load;
};
