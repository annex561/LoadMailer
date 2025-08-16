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
  status: text("status").notNull().default("scheduled"), // scheduled, in_transit, delivered, cancelled, expired
  // Temperature/Cooling fields
  equipmentType: text("equipment_type").notNull().default("dry_van"), // dry_van, refrigerated, flatbed, step_deck
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
  latitude: text("latitude").notNull(),
  longitude: text("longitude").notNull(),
  accuracy: integer("accuracy"),
  speed: text("speed"),
  heading: text("heading"),
  timestamp: timestamp("timestamp").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
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
  schedule: text("schedule").notNull().default("*/1 * * * * *"), // Every 1 second
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

export const driverOnboardingSchema = createInsertSchema(drivers).omit({
  id: true,
  createdAt: true,
  status: true,
  isOnboarded: true,
}).extend({
  confirmPassword: z.string().min(1, "Password confirmation is required"),
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
};
