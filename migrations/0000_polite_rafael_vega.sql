CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'open', 'paid', 'void', 'uncollectible');--> statement-breakpoint
CREATE TYPE "public"."payment_method_type" AS ENUM('card', 'ach', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."subscription_plan" AS ENUM('starter', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'dispatcher');--> statement-breakpoint
CREATE TABLE "ai_analytics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_type" text NOT NULL,
	"entity_id" varchar NOT NULL,
	"entity_type" text NOT NULL,
	"analysis" jsonb NOT NULL,
	"predictions" jsonb DEFAULT '{}'::jsonb,
	"recommendations" jsonb DEFAULT '[]'::jsonb,
	"model_version" text DEFAULT '1.0' NOT NULL,
	"input_data" jsonb DEFAULT '{}'::jsonb,
	"confidence" real NOT NULL,
	"processing_time" integer DEFAULT 0,
	"actual_outcome" jsonb DEFAULT '{}'::jsonb,
	"accuracy_score" real,
	"validated_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_performance_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"thread_id" varchar,
	"driver_id" varchar,
	"total_suggestions" integer DEFAULT 0 NOT NULL,
	"accepted_suggestions" integer DEFAULT 0 NOT NULL,
	"rejected_suggestions" integer DEFAULT 0 NOT NULL,
	"auto_sent_messages" integer DEFAULT 0 NOT NULL,
	"avg_confidence" real DEFAULT 0,
	"avg_processing_time_ms" integer DEFAULT 0,
	"avg_tokens_used" real DEFAULT 0,
	"avg_time_between_suggestion_and_response_ms" integer DEFAULT 0,
	"metrics" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "avoid_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location" text NOT NULL,
	"type" text DEFAULT 'city' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "backhaul_opportunities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"primary_load_id" varchar NOT NULL,
	"backhaul_load_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"delivery_location" text NOT NULL,
	"backhaul_origin" text NOT NULL,
	"deadhead_to_backhaul" integer NOT NULL,
	"total_round_trip_miles" integer NOT NULL,
	"primary_load_rate" real NOT NULL,
	"backhaul_rate" real NOT NULL,
	"combined_rate" real NOT NULL,
	"deadhead_savings" real NOT NULL,
	"total_profit" real NOT NULL,
	"profit_improvement" real NOT NULL,
	"delivery_time" timestamp NOT NULL,
	"backhaul_pickup_time" timestamp NOT NULL,
	"layover_time" integer NOT NULL,
	"match_score" real NOT NULL,
	"time_efficiency" real NOT NULL,
	"profit_score" real NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bid_responses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"response" text NOT NULL,
	"response_time" timestamp NOT NULL,
	"counter_offer" real,
	"reason" text,
	"notes" text,
	"sms_message_id" text,
	"response_method" text DEFAULT 'sms' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "billing_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"stripe_invoice_id" text,
	"stripe_invoice_number" text,
	"amount_due" integer NOT NULL,
	"amount_paid" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" "invoice_status" NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"hosted_invoice_url" text,
	"invoice_pdf_url" text,
	"description" text,
	"attempt_count" integer DEFAULT 0,
	"next_payment_attempt" timestamp,
	"created_at" timestamp DEFAULT now(),
	"paid_at" timestamp,
	CONSTRAINT "billing_history_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "business_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_type" text NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"value" real NOT NULL,
	"target" real DEFAULT 0,
	"previous_period_value" real DEFAULT 0,
	"growth_rate" real DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "communication_insights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"insight_type" text NOT NULL,
	"total_messages" integer DEFAULT 0 NOT NULL,
	"driver_messages" integer DEFAULT 0 NOT NULL,
	"dispatch_messages" integer DEFAULT 0 NOT NULL,
	"ai_suggestions" integer DEFAULT 0 NOT NULL,
	"ai_suggestions_accepted" integer DEFAULT 0 NOT NULL,
	"ai_suggestions_rejected" integer DEFAULT 0 NOT NULL,
	"ai_auto_sent" integer DEFAULT 0 NOT NULL,
	"avg_response_time_minutes" real DEFAULT 0,
	"median_response_time_minutes" real DEFAULT 0,
	"active_drivers" integer DEFAULT 0 NOT NULL,
	"total_active_threads" integer DEFAULT 0 NOT NULL,
	"insights" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "communication_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" varchar NOT NULL,
	"thread_id" varchar,
	"action" text NOT NULL,
	"actor_id" varchar,
	"actor_role" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"timestamp" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"stripe_customer_id" text,
	"trial_ends_at" timestamp,
	"billing_email" text NOT NULL,
	"website" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip_code" text,
	"country" text DEFAULT 'US',
	"timezone" text DEFAULT 'America/New_York',
	"is_active" boolean DEFAULT true NOT NULL,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "companies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "companies_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "company_users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" "user_role" DEFAULT 'dispatcher' NOT NULL,
	"invited_by_user_id" varchar,
	"invited_at" timestamp DEFAULT now(),
	"accepted_at" timestamp,
	"last_active_at" timestamp,
	"is_primary_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cost_calculations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"total_miles" integer NOT NULL,
	"deadhead_miles" integer DEFAULT 0,
	"estimated_driving_time" integer NOT NULL,
	"fuel_price" real NOT NULL,
	"vehicle_mpg" real NOT NULL,
	"estimated_fuel_cost" real NOT NULL,
	"estimated_tolls" real DEFAULT 0,
	"toll_routes" jsonb DEFAULT '[]'::jsonb,
	"hourly_driver_rate" real DEFAULT 25,
	"estimated_labor_cost" real NOT NULL,
	"vehicle_operating_cost" real DEFAULT 0.58,
	"maintenance_cost" real DEFAULT 0,
	"depreciation_cost" real DEFAULT 0,
	"total_estimated_costs" real NOT NULL,
	"gross_revenue" real NOT NULL,
	"net_profit" real NOT NULL,
	"profit_margin" real NOT NULL,
	"rate_per_mile" real NOT NULL,
	"market_average_rate" real DEFAULT 0,
	"rate_competitiveness" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customer_analytics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" varchar NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"total_loads" integer DEFAULT 0 NOT NULL,
	"total_revenue" real DEFAULT 0 NOT NULL,
	"average_load_value" real DEFAULT 0,
	"on_time_delivery_rate" real DEFAULT 0,
	"repeat_customer_score" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"contact_person" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dispatcher_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar,
	"load_id" varchar,
	"notification_type" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"message" text NOT NULL,
	"phone_number" text NOT NULL,
	"sms_message_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"error_message" text,
	"dispatcher_response" text,
	"dispatcher_response_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_annotations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar NOT NULL,
	"annotation_type" text NOT NULL,
	"color" text DEFAULT '#ff0000' NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"width" real,
	"height" real,
	"path_data" jsonb,
	"text_content" text,
	"font_size" integer DEFAULT 14,
	"end_x" real,
	"end_y" real,
	"note" text,
	"created_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar NOT NULL,
	"load_id" varchar NOT NULL,
	"action" text NOT NULL,
	"performed_by" varchar,
	"performed_by_role" text NOT NULL,
	"performed_by_name" text NOT NULL,
	"previous_value" text,
	"new_value" text,
	"reason" text,
	"notes" text,
	"document_version" integer DEFAULT 1,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_extractions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" varchar NOT NULL,
	"document_type" text NOT NULL,
	"extracted_data" jsonb NOT NULL,
	"confidence" real NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_by" text,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_engagement_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"messages_received" integer DEFAULT 0 NOT NULL,
	"messages_sent" integer DEFAULT 0 NOT NULL,
	"attachments_sent" integer DEFAULT 0 NOT NULL,
	"avg_response_time_ms" integer DEFAULT 0,
	"total_response_time_ms" integer DEFAULT 0,
	"response_count" integer DEFAULT 0,
	"threads_participated" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp,
	"engagement_score" real DEFAULT 0,
	"preferred_response_time" text,
	"communication_style" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_load_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL,
	"load_id" varchar NOT NULL,
	"origin_state" text NOT NULL,
	"destination_state" text NOT NULL,
	"origin_city" text NOT NULL,
	"destination_city" text NOT NULL,
	"equipment_type" text NOT NULL,
	"load_type" text NOT NULL,
	"accepted_rate" real NOT NULL,
	"actual_rate" real,
	"rate_per_mile" real NOT NULL,
	"total_miles" integer NOT NULL,
	"deadhead_miles" integer DEFAULT 0,
	"accepted_at" timestamp NOT NULL,
	"picked_up_at" timestamp,
	"delivered_at" timestamp,
	"was_on_time" boolean DEFAULT true,
	"delivery_rating" integer DEFAULT 5,
	"fuel_cost" real DEFAULT 0,
	"toll_cost" real DEFAULT 0,
	"other_expenses" real DEFAULT 0,
	"total_expenses" real DEFAULT 0,
	"net_profit" real DEFAULT 0,
	"profit_margin" real DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "driver_locations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"accuracy" real,
	"speed" real,
	"heading" real,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"altitude" real,
	"address" text,
	"load_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"battery_level" integer,
	"signal_strength" integer,
	"source" text DEFAULT 'simulated' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_performance_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"loads_completed" integer DEFAULT 0 NOT NULL,
	"on_time_deliveries" integer DEFAULT 0 NOT NULL,
	"total_miles" real DEFAULT 0 NOT NULL,
	"total_revenue" real DEFAULT 0 NOT NULL,
	"average_rating" real DEFAULT 0,
	"fuel_efficiency" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"license_number" text,
	"emergency_contact" text,
	"emergency_phone" text,
	"is_onboarded" boolean DEFAULT false NOT NULL,
	"equipment_type" text DEFAULT 'dry_van' NOT NULL,
	"load_type" text DEFAULT 'full_partial',
	"max_length" integer DEFAULT 53,
	"max_weight" integer DEFAULT 26000,
	"phone_number" text,
	"city" text,
	"enable_sms_notifications" boolean DEFAULT false NOT NULL,
	"current_mood" text DEFAULT '😐',
	"mood_updated_at" timestamp,
	"mood_note" text,
	"total_loads" integer DEFAULT 0,
	"completed_loads" integer DEFAULT 0,
	"average_rating" real DEFAULT 0,
	"total_ratings" integer DEFAULT 0,
	"total_miles" integer DEFAULT 0,
	"total_revenue" real DEFAULT 0,
	"on_time_deliveries" integer DEFAULT 0,
	"late_deliveries" integer DEFAULT 0,
	"cancelled_loads" integer DEFAULT 0,
	"last_load_date" timestamp,
	"best_streak" integer DEFAULT 0,
	"current_streak" integer DEFAULT 0,
	"average_delivery_time" real DEFAULT 0,
	"fuel_efficiency" real DEFAULT 0,
	"maintenance_score" real DEFAULT 100,
	"safety_score" real DEFAULT 100,
	"tracking_token" varchar(64),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "drivers_email_unique" UNIQUE("email"),
	CONSTRAINT "drivers_phone_number_unique" UNIQUE("phone_number"),
	CONSTRAINT "drivers_tracking_token_unique" UNIQUE("tracking_token")
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bid_id" varchar NOT NULL,
	"broker_email" text NOT NULL,
	"broker_name" text NOT NULL,
	"subject" text NOT NULL,
	"initial_email_body" text NOT NULL,
	"bid_amount" real NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"total_emails" integer DEFAULT 0 NOT NULL,
	"last_email_sent_at" timestamp,
	"broker_last_response_at" timestamp,
	"broker_last_response" text,
	"final_outcome" text,
	"winning_rate" real,
	"next_follow_up_at" timestamp,
	"follow_up_count" integer DEFAULT 0 NOT NULL,
	"max_follow_ups" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_follow_ups" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" varchar NOT NULL,
	"bid_id" varchar NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp NOT NULL,
	"follow_up_type" text NOT NULL,
	"strategy" text NOT NULL,
	"broker_replied" boolean DEFAULT false NOT NULL,
	"broker_reply_at" timestamp,
	"broker_reply_content" text,
	"broker_sentiment" text,
	"email_delivered" boolean DEFAULT true NOT NULL,
	"email_opened" boolean DEFAULT false NOT NULL,
	"email_clicked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" varchar,
	"template_id" varchar,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"trigger" text NOT NULL,
	"recipients" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "extraction_verifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extraction_id" varchar NOT NULL,
	"field" text NOT NULL,
	"original_value" text,
	"corrected_value" text,
	"verified_by" text NOT NULL,
	"verified_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "geofence_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"geofence_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"dwell_time" integer,
	"load_id" varchar,
	"was_notified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "geofences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"center_latitude" real NOT NULL,
	"center_longitude" real NOT NULL,
	"radius" real NOT NULL,
	"load_id" varchar,
	"customer_id" varchar,
	"is_active" boolean DEFAULT true NOT NULL,
	"notification_settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gps_devices" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL,
	"device_id" text NOT NULL,
	"device_type" text DEFAULT 'mobile' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_heartbeat" timestamp,
	"firmware_version" text,
	"battery_level" integer,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "gps_devices_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "lane_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_states" jsonb NOT NULL,
	"to_states" jsonb NOT NULL,
	"min_rpm" real NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "load_bids" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" varchar,
	"scraped_load_id" varchar,
	"load_number" text NOT NULL,
	"broker_name" text NOT NULL,
	"broker_email" text,
	"broker_phone" text,
	"bid_amount" real NOT NULL,
	"recommended_amount" real,
	"margin" real,
	"rate_per_mile" real,
	"pickup_address" text NOT NULL,
	"delivery_address" text NOT NULL,
	"pickup_date" timestamp NOT NULL,
	"delivery_date" timestamp NOT NULL,
	"weight" integer,
	"commodity" text,
	"equipment_type" text DEFAULT 'dry_van' NOT NULL,
	"miles" integer,
	"status" text DEFAULT 'pending_driver' NOT NULL,
	"requires_email" boolean DEFAULT true NOT NULL,
	"bid_method" text DEFAULT 'email' NOT NULL,
	"assigned_driver_id" varchar,
	"driver_response" text,
	"driver_response_at" timestamp,
	"driver_notes" text,
	"bid_submitted_at" timestamp,
	"bid_expires_at" timestamp,
	"broker_response_at" timestamp,
	"broker_response" text,
	"email_campaign_id" varchar,
	"final_rate" real,
	"actual_margin" real,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "load_board_configurations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" varchar NOT NULL,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scraping_interval" integer DEFAULT 300 NOT NULL,
	"max_loads_per_run" integer DEFAULT 100,
	"last_scraped_at" timestamp,
	"last_error" text,
	"success_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "load_board_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_endpoint" text,
	"requires_auth" boolean DEFAULT false NOT NULL,
	"auth_type" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"rate_limit" integer DEFAULT 60,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "load_communication_threads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"thread_type" text DEFAULT 'unified' NOT NULL,
	"load_id" varchar,
	"driver_id" varchar NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_message_at" timestamp DEFAULT now(),
	"message_count" integer DEFAULT 0 NOT NULL,
	"unread_driver_messages" integer DEFAULT 0 NOT NULL,
	"unread_dispatch_messages" integer DEFAULT 0 NOT NULL,
	"load_offer_id" varchar,
	"load_offer_status" text,
	"load_offer_sent_at" timestamp,
	"load_offer_responded_at" timestamp,
	"assistant_enabled" boolean DEFAULT true NOT NULL,
	"assistant_mode" text DEFAULT 'suggest' NOT NULL,
	"context_summary" text,
	"last_summarized_message_id" varchar,
	"system_prompt" text,
	"ai_config" jsonb DEFAULT '{}'::jsonb,
	"auto_send_confidence" integer DEFAULT 80 NOT NULL,
	"load_origin" text,
	"load_destination" text,
	"driver_name" text,
	"driver_phone" text,
	"load_number" text,
	"last_message_text" text,
	"last_message_sender" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "load_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"document_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"signer_name" text,
	"notes" text,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"approved_by" varchar,
	"approved_at" timestamp,
	"rejected_by" varchar,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"dispatcher_notes" text,
	"image_width" integer,
	"image_height" integer,
	"quality_score" integer,
	"quality_warnings" text[],
	"version" integer DEFAULT 1 NOT NULL,
	"parent_document_id" varchar,
	"is_latest_version" boolean DEFAULT true NOT NULL,
	"upload_source" text DEFAULT 'web' NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"required_category" text,
	"uploaded_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "load_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"thread_id" varchar NOT NULL,
	"load_id" varchar,
	"sender_id" varchar,
	"sender_role" text NOT NULL,
	"sender_name" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"text_content" text,
	"media_url" text,
	"media_type" text,
	"sms_message_id" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"delivered_at" timestamp,
	"is_suggested" boolean DEFAULT false NOT NULL,
	"is_sent" boolean DEFAULT false NOT NULL,
	"approved_by" varchar,
	"approved_at" timestamp,
	"ai_data" jsonb DEFAULT '{}'::jsonb,
	"visibility" text DEFAULT 'external' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"reply_to_message_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "load_offers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"sms_message_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp NOT NULL,
	"responded_at" timestamp,
	"timeout_at" timestamp NOT NULL,
	"retry_count" integer DEFAULT 0,
	"last_sent_at" timestamp,
	"dispatcher_rate" real,
	"deadhead_distance" real,
	"awaiting_driver_confirmation" boolean DEFAULT false,
	"driver_confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "load_recommendations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" varchar NOT NULL,
	"load_id" varchar NOT NULL,
	"ai_score" real NOT NULL,
	"historical_performance_score" real NOT NULL,
	"market_condition_score" real NOT NULL,
	"profitability_score" real NOT NULL,
	"route_optimization_score" real NOT NULL,
	"predicted_profit" real NOT NULL,
	"predicted_margin" real NOT NULL,
	"risk_score" real NOT NULL,
	"confidence_level" real NOT NULL,
	"reasoning_factors" jsonb DEFAULT '{}'::jsonb,
	"similar_loads_performed" integer DEFAULT 0,
	"average_performance_on_route" real DEFAULT 0,
	"competitive_rate_position" text,
	"demand_level" text,
	"seasonal_adjustment" real DEFAULT 1,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"responded_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "loads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar,
	"load_number" text NOT NULL,
	"customer_id" varchar NOT NULL,
	"driver_id" varchar,
	"description" text NOT NULL,
	"priority" text DEFAULT 'standard' NOT NULL,
	"pickup_address" text NOT NULL,
	"pickup_date" timestamp NOT NULL,
	"pickup_time" text NOT NULL,
	"delivery_address" text NOT NULL,
	"delivery_date" timestamp NOT NULL,
	"delivery_time" text NOT NULL,
	"special_instructions" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"load_type" text DEFAULT 'full',
	"length" integer,
	"equipment_type" text DEFAULT 'dry_van' NOT NULL,
	"temperature_required" boolean DEFAULT false NOT NULL,
	"min_temperature" integer,
	"max_temperature" integer,
	"temperature_unit" text DEFAULT 'F',
	"expires_at" timestamp,
	"is_expired" boolean DEFAULT false NOT NULL,
	"rate" real,
	"miles" integer,
	"weight" integer,
	"company" text,
	"contact_phone" text,
	"source_board" text DEFAULT 'manual',
	"gps_tracking_sms_last_sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "loads_load_number_unique" UNIQUE("load_number")
);
--> statement-breakpoint
CREATE TABLE "maintenance_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" varchar NOT NULL,
	"alert_type" text NOT NULL,
	"maintenance_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"current_mileage" integer NOT NULL,
	"due_mileage" integer,
	"mileage_overdue" integer DEFAULT 0,
	"due_date" timestamp,
	"days_overdue" integer DEFAULT 0,
	"predictive_factors" jsonb DEFAULT '{}'::jsonb,
	"risk_score" real DEFAULT 0,
	"estimated_cost" real DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp,
	"resolved_by" text,
	"resolved_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" varchar NOT NULL,
	"alert_id" varchar,
	"maintenance_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"service_date" timestamp NOT NULL,
	"mileage_at_service" integer NOT NULL,
	"engine_hours_at_service" real,
	"service_provider" text,
	"service_location" text,
	"invoice_number" text,
	"labor_cost" real DEFAULT 0,
	"parts_cost" real DEFAULT 0,
	"total_cost" real NOT NULL,
	"parts_replaced" jsonb DEFAULT '[]'::jsonb,
	"work_performed" jsonb DEFAULT '[]'::jsonb,
	"service_rating" integer,
	"warranty_period" integer,
	"warranty_expiry" timestamp,
	"receipts" jsonb DEFAULT '[]'::jsonb,
	"photos" jsonb DEFAULT '[]'::jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "market_rate_trends" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"origin_state" text NOT NULL,
	"destination_state" text NOT NULL,
	"equipment_type" text NOT NULL,
	"average_rate" real NOT NULL,
	"median_rate" real NOT NULL,
	"high_rate" real NOT NULL,
	"low_rate" real NOT NULL,
	"rate_per_mile" real NOT NULL,
	"load_volume" integer DEFAULT 0,
	"truck_demand" real DEFAULT 0,
	"seasonal_factor" real DEFAULT 1,
	"week_of" timestamp NOT NULL,
	"period" text DEFAULT 'weekly' NOT NULL,
	"data_source" text DEFAULT 'scraped' NOT NULL,
	"sample_size" integer DEFAULT 0,
	"last_updated" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar,
	"load_id" varchar NOT NULL,
	"driver_id" varchar,
	"attachment_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"document_category" text,
	"document_status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" varchar,
	"reviewed_at" timestamp,
	"review_notes" text,
	"telegram_file_id" text,
	"telegram_file_unique_id" text,
	"width" integer,
	"height" integer,
	"caption" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "onboarding_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"email" text NOT NULL,
	"telegram_chat_id" text,
	"is_used" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "onboarding_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"type" "payment_method_type" NOT NULL,
	"brand" text,
	"last4" text,
	"exp_month" integer,
	"exp_year" integer,
	"bank_name" text,
	"account_holder_name" text,
	"account_type" text,
	"mandate_status" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"added_at" timestamp DEFAULT now(),
	"detached_at" timestamp,
	CONSTRAINT "payment_methods_stripe_payment_method_id_unique" UNIQUE("stripe_payment_method_id")
);
--> statement-breakpoint
CREATE TABLE "quick_reply_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"display_text" text NOT NULL,
	"message_template" text NOT NULL,
	"category" text DEFAULT 'status' NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_for_driver" boolean DEFAULT true NOT NULL,
	"is_for_dispatch" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "quick_reply_templates_template_key_unique" UNIQUE("template_key")
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"report_type" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb,
	"chart_types" jsonb DEFAULT '[]'::jsonb,
	"metrics" jsonb DEFAULT '[]'::jsonb,
	"schedule" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"load_id" varchar NOT NULL,
	"driver_id" varchar NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_latitude" real NOT NULL,
	"start_longitude" real NOT NULL,
	"end_latitude" real NOT NULL,
	"end_longitude" real NOT NULL,
	"planned_route" jsonb,
	"actual_route" jsonb,
	"planned_distance" real,
	"actual_distance" real,
	"planned_duration" integer,
	"actual_duration" integer,
	"estimated_arrival" timestamp,
	"actual_arrival" timestamp,
	"deviation_alerts" jsonb DEFAULT '[]'::jsonb,
	"traffic_data" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scraped_loads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" varchar NOT NULL,
	"config_id" varchar NOT NULL,
	"external_id" text NOT NULL,
	"load_number" text,
	"pickup_city" text NOT NULL,
	"pickup_state" text NOT NULL,
	"pickup_zip" text,
	"pickup_address" text,
	"pickup_date" timestamp NOT NULL,
	"pickup_time_window" text,
	"delivery_city" text NOT NULL,
	"delivery_state" text NOT NULL,
	"delivery_zip" text,
	"delivery_address" text,
	"delivery_date" timestamp NOT NULL,
	"delivery_time_window" text,
	"rate" real,
	"rate_type" text,
	"mileage" integer,
	"rate_per_mile" real,
	"fuel_surcharge" real,
	"total_pay" real,
	"weight" integer,
	"commodity" text,
	"equipment_type" text,
	"truck_length" integer,
	"special_requirements" text,
	"broker_name" text,
	"broker_phone" text,
	"broker_email" text,
	"broker_mc_number" text,
	"status" text DEFAULT 'available' NOT NULL,
	"priority" text DEFAULT 'standard',
	"is_expedited" boolean DEFAULT false NOT NULL,
	"posted_at" timestamp,
	"expires_at" timestamp,
	"is_matched" boolean DEFAULT false NOT NULL,
	"match_score" real,
	"matched_driver_id" varchar,
	"is_imported" boolean DEFAULT false NOT NULL,
	"imported_load_id" varchar,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scraped_at" timestamp DEFAULT now(),
	"last_updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scraper_configs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'dat' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"login_url" text NOT NULL,
	"search_url" text NOT NULL,
	"username" text,
	"password" text,
	"search_criteria" jsonb DEFAULT '{}'::jsonb,
	"schedule" text DEFAULT '*/10 * * * * *' NOT NULL,
	"auto_create_loads" boolean DEFAULT true NOT NULL,
	"default_customer_id" varchar,
	"last_run_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scraper_configurations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"schedule_type" text DEFAULT 'interval' NOT NULL,
	"interval_minutes" integer DEFAULT 15,
	"cron_expression" text,
	"search_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferred_lanes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avoid_lanes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_rate" real,
	"max_rate" real,
	"min_rate_per_mile" real,
	"min_mileage" integer,
	"max_mileage" integer,
	"equipment_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_weight" integer,
	"auto_import_matches" boolean DEFAULT false NOT NULL,
	"auto_assign_drivers" boolean DEFAULT false NOT NULL,
	"minimum_match_score" real DEFAULT 75,
	"notify_on_new_matches" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"average_run_time_ms" integer,
	"total_loads_scraped" integer DEFAULT 0 NOT NULL,
	"total_matches_found" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"error_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scraper_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" varchar NOT NULL,
	"status" text NOT NULL,
	"loads_scraped" integer DEFAULT 0 NOT NULL,
	"loads_created" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"execution_time" integer,
	"started_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_config" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"twilio_account_sid" text NOT NULL,
	"twilio_auth_token" text NOT NULL,
	"twilio_phone_number" text NOT NULL,
	"dispatcher_phone_number" text NOT NULL,
	"response_timeout_minutes" integer DEFAULT 3 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" varchar NOT NULL,
	"stripe_subscription_id" text,
	"plan_tier" "subscription_plan" DEFAULT 'starter' NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"collection_method" text DEFAULT 'charge_automatically',
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancel_at" timestamp,
	"canceled_at" timestamp,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"trial_start" timestamp,
	"trial_end" timestamp,
	"seats_purchased" integer DEFAULT 5,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" varchar NOT NULL,
	"record_date" timestamp NOT NULL,
	"mileage" integer NOT NULL,
	"engine_hours" real,
	"fuel_used" real DEFAULT 0,
	"fuel_efficiency" real DEFAULT 0,
	"idle_time" real DEFAULT 0,
	"average_speed" real DEFAULT 0,
	"max_speed" real DEFAULT 0,
	"engine_load" real DEFAULT 0,
	"coolant_temp" real DEFAULT 0,
	"oil_pressure" real DEFAULT 0,
	"battery_voltage" real DEFAULT 0,
	"harsh_braking" integer DEFAULT 0,
	"harsh_acceleration" integer DEFAULT 0,
	"sharp_turns" integer DEFAULT 0,
	"engine_health_score" real DEFAULT 100,
	"brake_health_score" real DEFAULT 100,
	"transmission_health_score" real DEFAULT 100,
	"overall_health_score" real DEFAULT 100,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_number" text NOT NULL,
	"driver_id" varchar,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"vin" text NOT NULL,
	"license_plate" text NOT NULL,
	"equipment_type" text NOT NULL,
	"engine_type" text DEFAULT 'diesel' NOT NULL,
	"engine_model" text,
	"fuel_capacity" real DEFAULT 0,
	"weight_capacity" integer DEFAULT 26000,
	"current_mileage" integer DEFAULT 0 NOT NULL,
	"current_engine_hours" real DEFAULT 0,
	"last_service_mileage" integer DEFAULT 0,
	"next_service_due" integer DEFAULT 0,
	"oil_change_interval" integer DEFAULT 15000,
	"last_oil_change" timestamp,
	"next_oil_change_due" integer DEFAULT 0,
	"tire_rotation_interval" integer DEFAULT 12000,
	"last_tire_rotation" timestamp,
	"next_tire_rotation_due" integer DEFAULT 0,
	"brake_inspection_interval" integer DEFAULT 30000,
	"last_brake_inspection" timestamp,
	"next_brake_inspection_due" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"health_score" real DEFAULT 100,
	"fuel_efficiency" real DEFAULT 0,
	"insurance_expiry" timestamp,
	"registration_expiry" timestamp,
	"inspection_expiry" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "vehicles_vehicle_number_unique" UNIQUE("vehicle_number"),
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
ALTER TABLE "ai_performance_metrics" ADD CONSTRAINT "ai_performance_metrics_thread_id_load_communication_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."load_communication_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_performance_metrics" ADD CONSTRAINT "ai_performance_metrics_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backhaul_opportunities" ADD CONSTRAINT "backhaul_opportunities_primary_load_id_loads_id_fk" FOREIGN KEY ("primary_load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backhaul_opportunities" ADD CONSTRAINT "backhaul_opportunities_backhaul_load_id_loads_id_fk" FOREIGN KEY ("backhaul_load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backhaul_opportunities" ADD CONSTRAINT "backhaul_opportunities_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_responses" ADD CONSTRAINT "bid_responses_bid_id_load_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."load_bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_responses" ADD CONSTRAINT "bid_responses_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_history" ADD CONSTRAINT "billing_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_thread_id_load_communication_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."load_communication_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_calculations" ADD CONSTRAINT "cost_calculations_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_calculations" ADD CONSTRAINT "cost_calculations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_analytics" ADD CONSTRAINT "customer_analytics_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_notifications" ADD CONSTRAINT "dispatcher_notifications_bid_id_load_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."load_bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatcher_notifications" ADD CONSTRAINT "dispatcher_notifications_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_document_id_load_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."load_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit_log" ADD CONSTRAINT "document_audit_log_document_id_load_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."load_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit_log" ADD CONSTRAINT "document_audit_log_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_load_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."load_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_engagement_metrics" ADD CONSTRAINT "driver_engagement_metrics_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_load_history" ADD CONSTRAINT "driver_load_history_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_load_history" ADD CONSTRAINT "driver_load_history_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_performance_metrics" ADD CONSTRAINT "driver_performance_metrics_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_bid_id_load_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."load_bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_follow_ups" ADD CONSTRAINT "email_follow_ups_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_follow_ups" ADD CONSTRAINT "email_follow_ups_bid_id_load_bids_id_fk" FOREIGN KEY ("bid_id") REFERENCES "public"."load_bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_verifications" ADD CONSTRAINT "extraction_verifications_extraction_id_document_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."document_extractions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_geofence_id_geofences_id_fk" FOREIGN KEY ("geofence_id") REFERENCES "public"."geofences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gps_devices" ADD CONSTRAINT "gps_devices_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_bids" ADD CONSTRAINT "load_bids_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_bids" ADD CONSTRAINT "load_bids_scraped_load_id_scraped_loads_id_fk" FOREIGN KEY ("scraped_load_id") REFERENCES "public"."scraped_loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_bids" ADD CONSTRAINT "load_bids_assigned_driver_id_drivers_id_fk" FOREIGN KEY ("assigned_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_board_configurations" ADD CONSTRAINT "load_board_configurations_source_id_load_board_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."load_board_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_communication_threads" ADD CONSTRAINT "load_communication_threads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_communication_threads" ADD CONSTRAINT "load_communication_threads_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_communication_threads" ADD CONSTRAINT "load_communication_threads_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_messages" ADD CONSTRAINT "load_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_messages" ADD CONSTRAINT "load_messages_thread_id_load_communication_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."load_communication_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_messages" ADD CONSTRAINT "load_messages_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_messages" ADD CONSTRAINT "load_messages_reply_to_message_id_load_messages_id_fk" FOREIGN KEY ("reply_to_message_id") REFERENCES "public"."load_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_offers" ADD CONSTRAINT "load_offers_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_offers" ADD CONSTRAINT "load_offers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_recommendations" ADD CONSTRAINT "load_recommendations_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_recommendations" ADD CONSTRAINT "load_recommendations_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_alerts" ADD CONSTRAINT "maintenance_alerts_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_alert_id_maintenance_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."maintenance_alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_load_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."load_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraped_loads" ADD CONSTRAINT "scraped_loads_source_id_load_board_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."load_board_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraped_loads" ADD CONSTRAINT "scraped_loads_config_id_load_board_configurations_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."load_board_configurations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraped_loads" ADD CONSTRAINT "scraped_loads_matched_driver_id_drivers_id_fk" FOREIGN KEY ("matched_driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraped_loads" ADD CONSTRAINT "scraped_loads_imported_load_id_loads_id_fk" FOREIGN KEY ("imported_load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraper_configs" ADD CONSTRAINT "scraper_configs_default_customer_id_customers_id_fk" FOREIGN KEY ("default_customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraper_logs" ADD CONSTRAINT "scraper_logs_config_id_scraper_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."scraper_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_metrics" ADD CONSTRAINT "vehicle_metrics_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_unique_driver_unified_thread" ON "load_communication_threads" USING btree ("driver_id") WHERE thread_type = 'unified';--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");