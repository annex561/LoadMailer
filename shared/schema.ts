import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, jsonb } from "drizzle-orm/pg-core";
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
  // Equipment type for load matching
  equipmentType: text("equipment_type").notNull().default("sprinter_van"), // sprinter_van, van_lift_gate, van_hotshot, straight_box_truck, moving_van, flatbed_hotshot, van
  // Equipment weight capacity
  weightCapacity: integer("weight_capacity").default(26000), // in pounds
  // Telegram bot integration
  telegramId: text("telegram_id").unique(),
  telegramUsername: text("telegram_username"),
  city: text("city"),
  enableTelegramNotifications: boolean("enable_telegram_notifications").notNull().default(false),
  // Mood tracking
  currentMood: text("current_mood").default("😐"), // emoji representing current mood
  moodUpdatedAt: timestamp("mood_updated_at"),
  moodNote: text("mood_note"), // optional note about mood
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
  weight: integer("weight").notNull(),
  priority: text("priority").notNull().default("standard"), // standard, high, urgent
  pickupAddress: text("pickup_address").notNull(),
  pickupDate: timestamp("pickup_date").notNull(),
  pickupTime: text("pickup_time").notNull(),
  deliveryAddress: text("delivery_address").notNull(),
  deliveryDate: timestamp("delivery_date").notNull(),
  deliveryTime: text("delivery_time").notNull(),
  specialInstructions: text("special_instructions"),
  status: text("status").notNull().default("scheduled"), // scheduled, assigned, in_transit, delivered, cancelled, expired
  // Temperature/Cooling fields
  equipmentType: text("equipment_type").notNull().default("sprinter_van"), // sprinter_van, van_lift_gate, van_hotshot, straight_box_truck, moving_van, flatbed_hotshot, van
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
  isUsed: boolean("is_used").notNull().default(false),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const driverLocations = pgTable("driver_locations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  altitude: real("altitude"),
  accuracy: real("accuracy"), // in meters
  speed: real("speed"), // in mph
  heading: real("heading"), // degrees from north
  timestamp: timestamp("timestamp").notNull(),
  address: text("address"), // Reverse geocoded address
  loadId: varchar("load_id").references(() => loads.id), // Associated load if any
  isActive: boolean("is_active").notNull().default(true), // Current location vs historical
  batteryLevel: integer("battery_level"), // Device battery percentage
  signalStrength: integer("signal_strength"), // GPS signal strength
  createdAt: timestamp("created_at").defaultNow(),
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

export const telegramBotConfig = pgTable("telegram_bot_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  botToken: text("bot_token").notNull(),
  dispatcherId: text("dispatcher_id").notNull(),
  botUsername: text("bot_username"),
  responseTimeoutMinutes: integer("response_timeout_minutes").notNull().default(3),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const loadOffers = pgTable("load_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  loadId: varchar("load_id").references(() => loads.id).notNull(),
  driverId: varchar("driver_id").references(() => drivers.id).notNull(),
  telegramMessageId: text("telegram_message_id"),
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

export const insertTelegramBotConfigSchema = createInsertSchema(telegramBotConfig).omit({
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

export type TelegramBotConfig = typeof telegramBotConfig.$inferSelect;
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
  
  // Telegram tracking
  telegramMessageId: text("telegram_message_id"),
  responseMethod: text("response_method").notNull().default("telegram"), // telegram, phone, email
  
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
  
  // Telegram details
  telegramChatId: text("telegram_chat_id").notNull(),
  telegramMessageId: text("telegram_message_id"),
  
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
