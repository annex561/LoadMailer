ALTER TABLE "load_communication_threads" DROP CONSTRAINT "load_communication_threads_load_id_loads_id_fk";
--> statement-breakpoint
ALTER TABLE "load_communication_threads" DROP CONSTRAINT "load_communication_threads_driver_id_drivers_id_fk";
--> statement-breakpoint
ALTER TABLE "load_messages" DROP CONSTRAINT "load_messages_load_id_loads_id_fk";
--> statement-breakpoint
ALTER TABLE "loads" DROP CONSTRAINT "loads_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "loads" DROP CONSTRAINT "loads_driver_id_drivers_id_fk";
--> statement-breakpoint
ALTER TABLE "load_communication_threads" ADD CONSTRAINT "threads_load_company_fk" FOREIGN KEY ("load_id","company_id") REFERENCES "public"."loads"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_communication_threads" ADD CONSTRAINT "threads_driver_company_fk" FOREIGN KEY ("driver_id","company_id") REFERENCES "public"."drivers"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "load_messages" ADD CONSTRAINT "messages_load_company_fk" FOREIGN KEY ("load_id","company_id") REFERENCES "public"."loads"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_customer_company_fk" FOREIGN KEY ("customer_id","company_id") REFERENCES "public"."customers"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_driver_company_fk" FOREIGN KEY ("driver_id","company_id") REFERENCES "public"."drivers"("id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customers_company_id" ON "customers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_drivers_company_id" ON "drivers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_threads_company_id" ON "load_communication_threads" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_messages_company_id" ON "load_messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_loads_company_id" ON "loads" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_id_company_id_unique" UNIQUE("id","company_id");--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_id_company_id_unique" UNIQUE("id","company_id");--> statement-breakpoint
ALTER TABLE "loads" ADD CONSTRAINT "loads_id_company_id_unique" UNIQUE("id","company_id");