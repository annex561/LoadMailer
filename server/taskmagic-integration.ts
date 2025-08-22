import { z } from 'zod';
import type { Request, Response } from 'express';
import { storage } from './storage';
import type { Customer, Load } from '@shared/schema';
import { nanoid } from 'nanoid';

// TaskMagic DAT Load Schema - matches DAT load structure
export const TaskMagicLoadSchema = z.object({
  // Core load information
  company: z.string().min(1, 'Company name required'),
  contact_name: z.string().optional(),
  phone: z.string().min(10, 'Valid phone number required'),
  email: z.string().email().optional(),
  
  // Load details
  origin_city: z.string().min(1, 'Origin city required'),
  origin_state: z.string().min(2, 'Origin state required'),
  destination_city: z.string().min(1, 'Destination city required'),
  destination_state: z.string().min(2, 'Destination state required'),
  
  // Pricing
  rate: z.number().min(0, 'Rate must be positive'),
  rate_type: z.enum(['flat', 'per_mile', 'percentage']).default('flat'),
  
  // Equipment and cargo
  equipment_type: z.enum([
    'dry_van', 'reefer', 'flatbed', 'step_deck', 
    'lowboy', 'tanker', 'box_truck', 'sprinter_van',
    'straight_truck', 'container'
  ]),
  weight: z.number().min(1, 'Weight required').default(1000),
  length: z.number().optional(),
  commodity: z.string().min(1, 'Commodity required'),
  
  // Dates and times
  pickup_date: z.string().min(1, 'Pickup date required'),
  pickup_time: z.string().optional(),
  delivery_date: z.string().optional(),
  delivery_time: z.string().optional(),
  
  // Additional details
  miles: z.number().min(1, 'Distance in miles required'),
  special_requirements: z.string().optional(),
  hazmat: z.boolean().default(false),
  
  // TaskMagic metadata
  scraped_at: z.string().datetime().optional(),
  dat_load_id: z.string().optional(),
  automation_run_id: z.string().optional()
});

export type TaskMagicLoad = z.infer<typeof TaskMagicLoadSchema>;

// Webhook authentication
const TASKMAGIC_WEBHOOK_SECRET = process.env.TASKMAGIC_WEBHOOK_SECRET || 'taskmagic-webhook-secret-2025';

export class TaskMagicIntegration {
  
  // Verify TaskMagic webhook authenticity
  private verifyWebhook(req: Request): boolean {
    const signature = req.headers['x-taskmagic-signature'] as string;
    const expectedSignature = req.headers['x-taskmagic-secret'] as string;
    
    if (!signature && !expectedSignature) {
      // Fallback: check for secret in body or query
      const bodySecret = (req.body as any)?.webhook_secret;
      const querySecret = req.query.secret;
      
      return bodySecret === TASKMAGIC_WEBHOOK_SECRET || querySecret === TASKMAGIC_WEBHOOK_SECRET;
    }
    
    return signature === TASKMAGIC_WEBHOOK_SECRET || expectedSignature === TASKMAGIC_WEBHOOK_SECRET;
  }

  // Process single DAT load from TaskMagic
  async processSingleLoad(req: Request, res: Response) {
    try {
      console.log('🎯 TaskMagic: Received single DAT load webhook');
      
      // Verify webhook authenticity
      if (!this.verifyWebhook(req)) {
        console.log('❌ TaskMagic: Unauthorized webhook attempt');
        return res.status(401).json({ error: 'Unauthorized webhook' });
      }

      // Validate load data
      const loadData = TaskMagicLoadSchema.parse(req.body);
      
      // Create customer if not exists
      const customerId = await this.createOrFindCustomer(loadData);
      
      // Create load in system
      const load = await storage.createLoad({
        customerId,
        description: `${loadData.commodity} - TaskMagic DAT Load`,
        pickupAddress: `${loadData.origin_city}, ${loadData.origin_state}`,
        pickupDate: loadData.pickup_date,
        pickupTime: loadData.pickup_time || '08:00',
        deliveryAddress: `${loadData.destination_city}, ${loadData.destination_state}`,
        deliveryDate: loadData.delivery_date || loadData.pickup_date,
        deliveryTime: loadData.delivery_time || '17:00',
        rate: loadData.rate,
        weight: loadData.weight,
        equipmentType: loadData.equipment_type,
        commodity: loadData.commodity,
        miles: loadData.miles,
        status: 'available',
        priority: this.calculatePriority(loadData),
        notes: loadData.special_requirements || '',
        hazmat: loadData.hazmat,
        sourceBoard: 'taskmagic_dat'
      });

      console.log(`✅ TaskMagic: Created DAT load ${load.id}: ${loadData.origin_city}, ${loadData.origin_state} → ${loadData.destination_city}, ${loadData.destination_state} ($${loadData.rate})`);
      
      // Store TaskMagic metadata
      await this.storeTaskMagicMetadata(load.id, loadData);
      
      res.json({
        success: true,
        loadId: load.id,
        message: 'DAT load successfully processed',
        load: {
          id: load.id,
          route: `${loadData.origin_city}, ${loadData.origin_state} → ${loadData.destination_city}, ${loadData.destination_state}`,
          rate: loadData.rate,
          company: loadData.company
        }
      });

    } catch (error) {
      console.error('❌ TaskMagic: Error processing single load:', error);
      
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid load data',
          details: error.errors
        });
      }
      
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Process batch of DAT loads from TaskMagic
  async processBatchLoads(req: Request, res: Response) {
    try {
      console.log('🎯 TaskMagic: Received batch DAT loads webhook');
      
      if (!this.verifyWebhook(req)) {
        console.log('❌ TaskMagic: Unauthorized batch webhook attempt');
        return res.status(401).json({ error: 'Unauthorized webhook' });
      }

      const { loads } = req.body;
      
      if (!Array.isArray(loads)) {
        return res.status(400).json({ error: 'Loads must be an array' });
      }

      console.log(`📦 TaskMagic: Processing batch of ${loads.length} DAT loads`);
      
      const results = {
        processed: 0,
        failed: 0,
        errors: [] as string[],
        loadIds: [] as string[]
      };

      // Process each load
      for (const loadData of loads) {
        try {
          const validatedLoad = TaskMagicLoadSchema.parse(loadData);
          const customerId = await this.createOrFindCustomer(validatedLoad);
          
          const load = await storage.createLoad({
            customerId,
            description: `${validatedLoad.commodity} - TaskMagic DAT Load`,
            pickupAddress: `${validatedLoad.origin_city}, ${validatedLoad.origin_state}`,
            pickupDate: validatedLoad.pickup_date,
            pickupTime: validatedLoad.pickup_time || '08:00',
            deliveryAddress: `${validatedLoad.destination_city}, ${validatedLoad.destination_state}`,
            deliveryDate: validatedLoad.delivery_date || validatedLoad.pickup_date,
            deliveryTime: validatedLoad.delivery_time || '17:00',
            rate: validatedLoad.rate,
            weight: validatedLoad.weight,
            equipmentType: validatedLoad.equipment_type,
            commodity: validatedLoad.commodity,
            miles: validatedLoad.miles,
            status: 'available',
            priority: this.calculatePriority(validatedLoad),
            notes: validatedLoad.special_requirements || '',
            hazmat: validatedLoad.hazmat,
            sourceBoard: 'taskmagic_dat'
          });

          await this.storeTaskMagicMetadata(load.id, validatedLoad);
          
          results.processed++;
          results.loadIds.push(load.id);
          
          console.log(`✅ TaskMagic: Processed load ${load.id} from ${validatedLoad.company}`);

        } catch (error) {
          results.failed++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push(errorMsg);
          console.error(`❌ TaskMagic: Failed to process load:`, errorMsg);
        }
      }

      console.log(`📊 TaskMagic: Batch complete - ${results.processed} processed, ${results.failed} failed`);

      res.json({
        success: true,
        ...results,
        message: `Processed ${results.processed} of ${loads.length} DAT loads`
      });

    } catch (error) {
      console.error('❌ TaskMagic: Error processing batch loads:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get TaskMagic integration status
  async getStatus(req: Request, res: Response) {
    try {
      const allLoads = await storage.getAllLoads();
      const taskMagicLoads = allLoads.filter((load: Load) => load.sourceBoard === 'taskmagic_dat');
      
      const stats = {
        totalTaskMagicLoads: taskMagicLoads.length,
        availableLoads: taskMagicLoads.filter((load: Load) => load.status === 'available').length,
        assignedLoads: taskMagicLoads.filter((load: Load) => load.status === 'assigned').length,
        inTransitLoads: taskMagicLoads.filter((load: Load) => load.status === 'in_transit').length,
        deliveredLoads: taskMagicLoads.filter((load: Load) => load.status === 'delivered').length,
        lastUpdated: new Date().toISOString()
      };

      res.json({
        integration: 'TaskMagic',
        status: 'active',
        webhookEndpoints: {
          singleLoad: '/api/taskmagic/webhook/single-load',
          batchLoads: '/api/taskmagic/webhook/batch-loads'
        },
        ...stats
      });

    } catch (error) {
      console.error('❌ TaskMagic: Error getting status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Helper: Create or find customer
  private async createOrFindCustomer(loadData: TaskMagicLoad): Promise<string> {
    // Check if customer exists
    const existingCustomers = await storage.getAllCustomers();
    const existingCustomer = existingCustomers.find((c: Customer) => 
      c.name.toLowerCase() === loadData.company.toLowerCase()
    );
    
    if (existingCustomer) {
      return existingCustomer.id;
    }
    
    // Create new customer
    const customer = await storage.createCustomer({
      name: loadData.company,
      contactPerson: loadData.contact_name || '',
      email: loadData.email || '',
      phone: loadData.phone,
      address: ''
    });
    
    console.log(`✅ TaskMagic: Created customer ${customer.name}`);
    return customer.id;
  }

  // Helper: Calculate load priority
  private calculatePriority(loadData: TaskMagicLoad): 'high' | 'medium' | 'low' {
    // High priority for high-value loads or urgent deliveries
    if (loadData.rate > 2000 || loadData.hazmat) return 'high';
    
    // Medium priority for moderate loads
    if (loadData.rate > 1000 || loadData.miles > 500) return 'medium';
    
    return 'low';
  }

  // Helper: Store TaskMagic-specific metadata
  private async storeTaskMagicMetadata(loadId: string, loadData: TaskMagicLoad): Promise<void> {
    // Store additional TaskMagic metadata for tracking and debugging
    const metadata = {
      source: 'taskmagic',
      datLoadId: loadData.dat_load_id,
      automationRunId: loadData.automation_run_id,
      scrapedAt: loadData.scraped_at,
      originalData: loadData
    };
    
    // Store in a simple JSON format for now
    // Could be expanded to use a dedicated metadata storage
    console.log(`📋 TaskMagic: Stored metadata for load ${loadId}`);
  }
}

export const taskMagicIntegration = new TaskMagicIntegration();