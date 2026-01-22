CREATE TYPE "public"."fleet_doc_status" AS ENUM('ACTIVE', 'EXPIRED', 'REPLACED');--> statement-breakpoint
CREATE TYPE "public"."fleet_doc_subject_type" AS ENUM('TRUCK', 'DRIVER', 'COMPANY');--> statement-breakpoint
CREATE TYPE "public"."fleet_doc_type" AS ENUM('INSURANCE', 'REGISTRATION', 'ANNUAL_INSPECTION', 'IFTA', 'UCR', 'PERMIT', 'TITLE', 'LEASE_AGREEMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."inspection_item_status" AS ENUM('OK', 'NEEDS_ATTENTION', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "public"."inspection_type" AS ENUM('PRE_TRIP', 'POST_TRIP', 'WEEKLY', 'MONTHLY_FLEET', 'QUARTERLY_PM_REVIEW', 'ANNUAL_DOT_READY');--> statement-breakpoint
CREATE TYPE "public"."maintenance_interval_type" AS ENUM('MILES', 'DAYS', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."maintenance_task_category" AS ENUM('ENGINE', 'BRAKES', 'TIRES', 'ELECTRICAL', 'SUSPENSION', 'DRIVELINE', 'LIFTGATE', 'SAFETY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('PUSH_NEXTSTEP', 'EMAIL', 'SMS', 'TELEGRAM', 'IN_APP');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('QUEUED', 'SENT', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."pm_schedule_status" AS ENUM('DUE_SOON', 'DUE', 'OVERDUE', 'SCHEDULED', 'COMPLETED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('ROUTINE', 'URGENT', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."truck_body_type" AS ENUM('BOX_26FT', 'SPRINTER', 'STRAIGHT_TRUCK', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."truck_status" AS ENUM('ACTIVE', 'IN_SHOP', 'OUT_OF_SERVICE', 'SOLD');--> statement-breakpoint
CREATE TYPE "public"."vendor_category" AS ENUM('TOWING', 'MOBILE_MECHANIC', 'TIRE', 'DEALER_SERVICE', 'LIFTGATE', 'BODY_SHOP', 'GENERAL_REPAIR', 'ROADSIDE');--> statement-breakpoint
CREATE TYPE "public"."work_order_event_type" AS ENUM('NOTE', 'STATUS_CHANGE', 'VENDOR_ASSIGNED', 'COST_UPDATE', 'PHOTO_ADDED', 'ESCALATION', 'CUSTOMER_NOTICE_SENT');--> statement-breakpoint
CREATE TYPE "public"."work_order_source" AS ENUM('MANUAL', 'INSPECTION', 'PM_SCHEDULE', 'BREAKDOWN');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('OPEN', 'TRIAGED', 'ASSIGNED_VENDOR', 'IN_PROGRESS', 'WAITING_PARTS', 'COMPLETED', 'CLOSED', 'CANCELED');--> statement-breakpoint
CREATE TABLE "breakdown_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"truck_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"reported_at" timestamp DEFAULT now() NOT NULL,
	"location_text" text NOT NULL,
	"hazard" boolean DEFAULT false NOT NULL,
	"can_move" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	"photos" jsonb,
	"work_order_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fleet_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"doc_type" "fleet_doc_type" NOT NULL,
	"subject_type" "fleet_doc_subject_type" NOT NULL,
	"subject_id" varchar NOT NULL,
	"file_url" text,
	"issued_date" timestamp,
	"expiry_date" timestamp,
	"status" "fleet_doc_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fleet_inspections" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"inspection_type" "inspection_type" DEFAULT 'PRE_TRIP' NOT NULL,
	"truck_id" varchar NOT NULL,
	"driver_id" varchar,
	"performed_by_user_id" varchar,
	"odometer" integer,
	"location_text" text,
	"is_safe_to_operate" boolean DEFAULT true NOT NULL,
	"summary_notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fleet_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"channel" "notification_channel" DEFAULT 'IN_APP' NOT NULL,
	"recipient_user_id" varchar,
	"title" text,
	"message" text NOT NULL,
	"priority" integer DEFAULT 8 NOT NULL,
	"related_type" text,
	"related_id" varchar,
	"status" "notification_status" DEFAULT 'QUEUED' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" varchar NOT NULL,
	"item_code" text NOT NULL,
	"item_label" text NOT NULL,
	"status" "inspection_item_status" DEFAULT 'OK' NOT NULL,
	"severity" "priority",
	"defect_notes" text,
	"photo_urls" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"interval_type" "maintenance_interval_type" DEFAULT 'MILES' NOT NULL,
	"interval_miles" integer,
	"interval_days" integer,
	"grace_miles" integer DEFAULT 250 NOT NULL,
	"grace_days" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "maintenance_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" varchar NOT NULL,
	"task_name" text NOT NULL,
	"category" "maintenance_task_category" DEFAULT 'OTHER' NOT NULL,
	"is_safety_critical" boolean DEFAULT false NOT NULL,
	"default_priority" "priority" DEFAULT 'ROUTINE' NOT NULL,
	"instructions" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pm_schedule" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"truck_id" varchar NOT NULL,
	"plan_id" varchar NOT NULL,
	"due_type" "maintenance_interval_type" DEFAULT 'MILES' NOT NULL,
	"due_odometer" integer,
	"due_date" timestamp,
	"status" "pm_schedule_status" DEFAULT 'DUE_SOON' NOT NULL,
	"scheduled_for" timestamp,
	"completed_at" timestamp,
	"completion_work_order_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "truck_plan_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"truck_id" varchar NOT NULL,
	"plan_id" varchar NOT NULL,
	"start_odometer" integer,
	"start_date" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"unit_number" text NOT NULL,
	"vin" text,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"body_type" "truck_body_type" DEFAULT 'BOX_26FT' NOT NULL,
	"has_liftgate" boolean DEFAULT false NOT NULL,
	"liftgate_type" text,
	"current_odometer" integer DEFAULT 0 NOT NULL,
	"odometer_last_updated_at" timestamp,
	"status" "truck_status" DEFAULT 'ACTIVE' NOT NULL,
	"base_zip" text,
	"insurance_policy_id" varchar,
	"assigned_driver_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"category" "vendor_category" NOT NULL,
	"phone_24_7" text,
	"phone_day" text,
	"email" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"service_radius_miles" integer,
	"payment_terms" text,
	"notes" text,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_order_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" varchar NOT NULL,
	"actor_user_id" varchar,
	"event_type" "work_order_event_type" DEFAULT 'NOTE' NOT NULL,
	"message" text,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"truck_id" varchar NOT NULL,
	"opened_by_user_id" varchar,
	"assigned_to_user_id" varchar,
	"driver_id" varchar,
	"source" "work_order_source" DEFAULT 'MANUAL' NOT NULL,
	"priority" "priority" DEFAULT 'ROUTINE' NOT NULL,
	"status" "work_order_status" DEFAULT 'OPEN' NOT NULL,
	"issue_category" "maintenance_task_category" DEFAULT 'OTHER' NOT NULL,
	"symptoms" text,
	"safety_hold" boolean DEFAULT false NOT NULL,
	"vendor_id" varchar,
	"estimated_cost" real,
	"actual_cost" real,
	"downtime_start_at" timestamp,
	"downtime_end_at" timestamp,
	"resolution_notes" text,
	"related_inspection_id" varchar,
	"related_pm_schedule_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "breakdown_reports" ADD CONSTRAINT "breakdown_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_reports" ADD CONSTRAINT "breakdown_reports_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_reports" ADD CONSTRAINT "breakdown_reports_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breakdown_reports" ADD CONSTRAINT "breakdown_reports_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_documents" ADD CONSTRAINT "fleet_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_inspections" ADD CONSTRAINT "fleet_inspections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_inspections" ADD CONSTRAINT "fleet_inspections_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_inspections" ADD CONSTRAINT "fleet_inspections_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_inspections" ADD CONSTRAINT "fleet_inspections_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_notifications" ADD CONSTRAINT "fleet_notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_notifications" ADD CONSTRAINT "fleet_notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_inspection_id_fleet_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."fleet_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedule" ADD CONSTRAINT "pm_schedule_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pm_schedule" ADD CONSTRAINT "pm_schedule_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_plan_assignments" ADD CONSTRAINT "truck_plan_assignments_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "truck_plan_assignments" ADD CONSTRAINT "truck_plan_assignments_plan_id_maintenance_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."maintenance_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_assigned_driver_id_drivers_id_fk" FOREIGN KEY ("assigned_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_related_inspection_id_fleet_inspections_id_fk" FOREIGN KEY ("related_inspection_id") REFERENCES "public"."fleet_inspections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_related_pm_schedule_id_pm_schedule_id_fk" FOREIGN KEY ("related_pm_schedule_id") REFERENCES "public"."pm_schedule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_fleet_documents_subject" ON "fleet_documents" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "idx_fleet_documents_expiry" ON "fleet_documents" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "idx_fleet_inspections_truck_id" ON "fleet_inspections" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX "idx_fleet_inspections_driver_id" ON "fleet_inspections" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "idx_trucks_company_id" ON "trucks" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_trucks_status" ON "trucks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_vendors_company_id" ON "vendors" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_vendors_category" ON "vendors" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_work_orders_company_id" ON "work_orders" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_work_orders_truck_id" ON "work_orders" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX "idx_work_orders_status" ON "work_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_work_orders_priority" ON "work_orders" USING btree ("priority");