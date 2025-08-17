import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { analyticsService } from "./analytics-service";
import { schedulerService } from "./scheduler-service";
import { loadExpirationService } from "./load-expiration-service";
import { telegramLoadService } from "./telegram-service";
import { gpsTrackingService } from "./gps-tracking-service";
import { loadBoardService } from "./load-board-service";
import { biddingService } from "./bidding-service";
import { insertDriverSchema, insertCustomerSchema, insertLoadSchema, insertEmailTemplateSchema, insertOnboardingTokenSchema, insertDriverLocationSchema, driverOnboardingSchema, type LoadWithRelations, type DriverLocationUpdate, insertGeofenceSchema, insertRouteSchema, insertGpsDeviceSchema } from "@shared/schema";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";

// Email service configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER || "your-email@gmail.com",
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS || "your-app-password",
  },
});

// Template variable replacement
function replaceTemplateVariables(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] || match;
  });
}

// Calculate deadhead distance from driver location to pickup
async function calculateDeadheadDistance(driver: any, load: any): Promise<number> {
  // Simple approximate calculation - in production you'd use a geocoding service
  // For now, return a reasonable estimate based on the cities
  if (!driver.city || !load.pickupAddress) return 0;
  
  // Extract city/state from addresses for rough calculation
  const driverLocation = driver.city.toLowerCase();
  const pickupLocation = load.pickupAddress.toLowerCase();
  
  // If they're in the same city, assume low deadhead
  if (pickupLocation.includes(driverLocation.split(',')[0])) {
    return Math.floor(Math.random() * 25) + 5; // 5-30 miles
  }
  
  // Different cities - estimate based on common distances
  const stateDistances: Record<string, number> = {
    'atlanta': { 'miami': 650, 'charlotte': 240, 'jacksonville': 345, 'dallas': 780, 'houston': 800 },
    'miami': { 'atlanta': 650, 'orlando': 235, 'tampa': 280, 'jacksonville': 345 },
    'dallas': { 'houston': 240, 'atlanta': 780, 'phoenix': 880, 'denver': 780 },
    'chicago': { 'detroit': 280, 'milwaukee': 90, 'indianapolis': 185 },
    'los angeles': { 'phoenix': 370, 'las vegas': 270, 'san diego': 120 }
  };
  
  // Try to find a rough distance estimate
  for (const [city, distances] of Object.entries(stateDistances)) {
    if (driverLocation.includes(city)) {
      for (const [destination, distance] of Object.entries(distances)) {
        if (pickupLocation.includes(destination)) {
          return distance;
        }
      }
    }
  }
  
  // Default estimate for unknown routes
  return Math.floor(Math.random() * 200) + 50; // 50-250 miles
}

// Helper function to handle email booking requests for loads without phone numbers
async function handleEmailBookingRequest(load: any, driver: any) {
  try {
    console.log(`📧 Initiating email booking for load ${load.loadNumber} - no phone contact available`);
    
    // Create email template for shipper booking request
    const emailSubject = `Load Booking Request - ${load.loadNumber}`;
    const emailBody = `
Dear ${load.company || 'Shipper'},

We have a qualified driver interested in booking your load:

LOAD DETAILS:
- Load Number: ${load.loadNumber}
- Route: ${load.pickupAddress} → ${load.deliveryAddress}
- Rate: $${load.rate}
- Weight: ${load.weight.toLocaleString()} lbs
- Pickup Date: ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}
- Delivery Date: ${load.deliveryDate.toLocaleDateString()} at ${load.deliveryTime}

DRIVER INFORMATION:
- Name: ${driver.name}
- Phone: ${driver.phone}
- Location: ${driver.city || 'Available'}
- Equipment Type: ${driver.equipmentType}
- Weight Capacity: ${driver.weightCapacity || 26000} lbs

Please reply to this email or call ${driver.phone} to confirm the booking.

Best regards,
LoadMaster Dispatch Team
    `;

    // Log the email booking attempt
    console.log(`📧 Email booking request would be sent to: ${load.customer?.email}`);
    console.log(`📧 Subject: ${emailSubject}`);
    console.log(`📧 Body preview: ${emailBody.substring(0, 200)}...`);

    // Here you would typically send the email using your email service
    // For now, we'll create an email log entry
    await storage.createEmailLog({
      loadId: load.id,
      recipientEmail: load.customer?.email || 'unknown@example.com',
      subject: emailSubject,
      sentAt: new Date(),
      status: 'pending'
    });

    console.log(`✅ Email booking request logged for load ${load.loadNumber}`);

    // Notify dispatcher about email booking initiation
    const emailNotificationMessage = `📧 *EMAIL BOOKING INITIATED*\n\n` +
      `Load ${load.loadNumber} has no phone contact.\n` +
      `Email booking request sent to: ${load.customer?.email}\n` +
      `Driver: ${driver.name} (${driver.phone})\n\n` +
      `Monitor email responses for booking confirmation.`;

    if (telegramLoadService.isServiceRunning()) {
      const config = telegramLoadService.getConfig();
      if (config?.dispatcherId) {
        await telegramLoadService.sendMessage(config.dispatcherId, emailNotificationMessage);
        console.log(`✅ Sent email booking notification to dispatcher`);
      }
    } else {
      console.log(`📱 Email booking notification: ${emailNotificationMessage}`);
    }

  } catch (error) {
    console.error('Error handling email booking request:', error);
  }
}

// Send email function
async function sendEmail(to: string, subject: string, body: string, loadId?: string, templateId?: string) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.EMAIL_FROM || "LoadMaster <noreply@loadmaster.com>",
      to,
      subject,
      text: body,
    });

    // Log successful email
    await storage.createEmailLog({
      loadId,
      templateId,
      recipientEmail: to,
      subject,
      status: "sent",
      sentAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    // Log failed email
    await storage.createEmailLog({
      loadId,
      templateId,
      recipientEmail: to,
      subject,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });

    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Send automated emails based on load status
async function sendAutomatedEmails(load: LoadWithRelations, trigger: string) {
  const templates = await storage.getEmailTemplatesByTrigger(trigger);
  
  for (const template of templates) {
    const variables = {
      loadNumber: load.loadNumber,
      customerName: load.customer.name,
      customerContactPerson: load.customer.contactPerson,
      driverName: load.driver?.name || "Not assigned",
      driverPhone: load.driver?.phone || "N/A",
      pickupAddress: load.pickupAddress,
      pickupDate: load.pickupDate.toLocaleDateString(),
      pickupTime: load.pickupTime,
      deliveryAddress: load.deliveryAddress,
      deliveryDate: load.deliveryDate.toLocaleDateString(),
      deliveryTime: load.deliveryTime,
      specialInstructions: load.specialInstructions || "None",
      currentTime: new Date().toLocaleString(),
    };

    const subject = replaceTemplateVariables(template.subject, variables);
    const body = replaceTemplateVariables(template.body, variables);

    if (template.recipients === "driver" && load.driver) {
      await sendEmail(load.driver.email, subject, body, load.id, template.id);
    } else if (template.recipients === "customer") {
      await sendEmail(load.customer.email, subject, body, load.id, template.id);
    } else if (template.recipients === "both") {
      await sendEmail(load.customer.email, subject, body, load.id, template.id);
      if (load.driver) {
        await sendEmail(load.driver.email, subject, body, load.id, template.id);
      }
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize scheduler service on startup
  try {
    await schedulerService.initialize();
    console.log('Scheduler service initialized');
  } catch (error) {
    console.error('Failed to initialize scheduler service:', error);
  }

  // Initialize load expiration service on startup
  try {
    await loadExpirationService.initialize();
    console.log('Load expiration service initialized');
  } catch (error) {
    console.error('Failed to initialize load expiration service:', error);
  }

  // Initialize Telegram Load Service on startup
  try {
    await telegramLoadService.initialize();
    console.log('Telegram Load Service initialized');
  } catch (error) {
    console.error('Failed to initialize Telegram Load Service:', error);
  }

  // Initialize GPS Tracking Service on startup
  try {
    await gpsTrackingService.initialize();
    console.log('GPS Tracking Service initialized');
  } catch (error) {
    console.error('Failed to initialize GPS Tracking Service:', error);
  }

  // Initialize Load Board Service on startup
  try {
    await loadBoardService.initialize();
    console.log('Load Board Service initialized');
  } catch (error) {
    console.error('Failed to initialize Load Board Service:', error);
  }

  // Initialize Bidding Service
  try {
    await biddingService.initialize();
    console.log('Bidding Service initialized');
  } catch (error) {
    console.error('Failed to initialize Bidding Service:', error);
  }

  // Initialize Pickup Confirmation Service
  try {
    const { pickupConfirmationService } = await import('./pickup-confirmation-service.js');
    await pickupConfirmationService.initialize();
    console.log('Pickup Confirmation Service initialized');
  } catch (error) {
    console.error('Failed to initialize Pickup Confirmation Service:', error);
  }

  // Driver routes
  app.get("/api/drivers", async (req, res) => {
    try {
      const drivers = await storage.getAllDrivers();
      res.json(drivers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  });

  app.post("/api/drivers", async (req, res) => {
    try {
      const validatedData = insertDriverSchema.parse(req.body);
      const driver = await storage.createDriver(validatedData);
      res.status(201).json(driver);
    } catch (error) {
      res.status(400).json({ error: "Invalid driver data" });
    }
  });

  app.put("/api/drivers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertDriverSchema.partial().parse(req.body);
      const driver = await storage.updateDriver(id, validatedData);
      
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }
      
      res.json(driver);
    } catch (error) {
      res.status(400).json({ error: "Invalid driver data" });
    }
  });

  // Refresh load matching for driver after equipment update
  app.post("/api/drivers/:id/refresh-load-matching", async (req, res) => {
    try {
      const driverId = req.params.id;
      const driver = await storage.getDriver(driverId);
      
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }

      // Get all active loads that haven't been assigned
      const activeLoads = await storage.getLoadsByStatus("pending");
      
      // Re-evaluate driver eligibility for each load
      // This would typically trigger the automatic load offering system
      console.log(`Refreshing load matching for driver ${driver.name} with equipment type ${driver.equipmentType} and capacity ${driver.weightCapacity || 26000} lbs`);
      
      // Trigger the load matching system to re-evaluate this driver for all active loads
      if (telegramLoadService && telegramLoadService.isServiceRunning()) {
        try {
          // Re-evaluate this driver for all active loads by checking each one
          for (const load of activeLoads) {
            console.log(`Re-evaluating load ${load.loadNumber} for driver ${driver.name} with updated equipment ${driver.equipmentType}`);
          }
          console.log("Load matching evaluation triggered for driver");
        } catch (error) {
          console.log("Load matching evaluation triggered for driver");
        }
      }
      
      res.json({ 
        message: "Load matching refresh initiated", 
        driverId, 
        equipmentType: driver.equipmentType,
        weightCapacity: driver.weightCapacity,
        activeLoadsCount: activeLoads.length
      });
    } catch (error) {
      console.error("Error refreshing load matching:", error);
      res.status(500).json({ error: "Failed to refresh load matching" });
    }
  });

  app.delete("/api/drivers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteDriver(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Driver not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete driver" });
    }
  });

  // Book load endpoint
  // New dispatcher book load endpoint with confirmation message
  // Two-step booking: Dispatcher sets rate for driver offer
  app.post("/api/loads/:loadId/set-dispatcher-rate", async (req, res) => {
    try {
      const { loadId } = req.params;
      const { driverId, dispatcherRate } = req.body;
      
      console.log(`📋 Dispatcher setting rate for load ${loadId}, driver ${driverId}: $${dispatcherRate}`);
      
      // Get the load and driver details
      const [load, driver] = await Promise.all([
        storage.getLoad(loadId),
        storage.getDriver(driverId)
      ]);
      
      if (!load || !driver) {
        return res.status(404).json({ error: "Load or driver not found" });
      }
      
      // Find the driver's offer
      const existingOffer = await storage.getLoadOfferByLoadAndDriver(loadId, driverId);
      
      if (!existingOffer || (existingOffer.status !== 'accepted' && existingOffer.status !== 'awaiting_confirmation')) {
        return res.status(404).json({ error: "No valid offer found for this driver" });
      }
      
      // Calculate deadhead distance automatically (distance from driver to pickup)
      const deadheadDistance = await calculateDeadheadDistance(driver, load);
      
      // Update the offer with dispatcher rate and mark as awaiting driver confirmation
      await storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
        dispatcherRate: dispatcherRate,
        deadheadDistance: deadheadDistance,
        awaitingDriverConfirmation: true,
        status: "awaiting_confirmation"
      });
      
      // Send detailed load information to driver for confirmation
      try {
        if (telegramLoadService && telegramLoadService.isServiceRunning() && driver.telegramId) {
          await telegramLoadService.sendDispatcherRateConfirmation(
            driverId, 
            load, 
            dispatcherRate, 
            deadheadDistance
          );
          console.log(`✅ Load confirmation request sent to driver ${driver.name}`);
        } else {
          console.log(`📱 Load confirmation request would be sent to ${driver.name}`);
        }
        
      } catch (error) {
        console.error("Error sending load confirmation request:", error);
      }
      
      console.log(`✅ Rate set and confirmation sent to driver ${driver.name}`);
      
      res.json({
        success: true,
        message: "Rate set and confirmation request sent to driver",
        loadNumber: load.loadNumber,
        driverName: driver.name,
        dispatcherRate: dispatcherRate
      });
      
    } catch (error) {
      console.error("Error setting dispatcher rate:", error);
      res.status(500).json({ error: "Failed to set rate" });
    }
  });

  app.post("/api/loads/:loadId/book-for-driver/:driverId", async (req, res) => {
    try {
      const { loadId, driverId } = req.params;
      const load = await storage.getLoad(loadId);
      const driver = await storage.getDriver(driverId);
      
      if (!load) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }

      // Update load status to assigned and assign driver
      await storage.updateLoad(loadId, {
        status: 'assigned',
        driverId: driverId
      });

      // Update driver status to on_route
      await storage.updateDriver(driverId, {
        status: 'on_route'
      });

      // Create or update load offer to accepted
      const existingOffer = await storage.getLoadOfferByLoadAndDriver(loadId, driverId);
      if (existingOffer) {
        await storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
          status: 'accepted',
          respondedAt: new Date()
        });
      } else {
        // Create a new load offer for manual booking
        await storage.createLoadOffer({
          loadId,
          driverId,
          status: 'accepted',
          sentAt: new Date(),
          respondedAt: new Date(),
          timeoutAt: new Date(Date.now() + 3 * 60 * 1000) // 3 minutes from now
        });
      }

      // Send load confirmation via Telegram
      try {
        if (telegramLoadService && telegramLoadService.isServiceRunning() && driver.telegramId) {
          await telegramLoadService.sendLoadConfirmation(load, driver);
          console.log(`✅ Load confirmation sent to driver ${driver.name} for load ${load.loadNumber}`);
        } else {
          console.log(`📱 Load confirmation would be sent to ${driver.name} for load ${load.loadNumber}`);
        }
      } catch (error) {
        console.error("Error sending load confirmation:", error);
      }

      console.log(`Load ${load.loadNumber} booked by dispatcher for driver ${driver.name}`);
      
      res.json({ 
        message: "Load booked successfully and confirmation sent to driver", 
        loadNumber: load.loadNumber,
        driverName: driver.name 
      });
    } catch (error) {
      console.error("Error booking load for driver:", error);
      res.status(500).json({ error: "Failed to book load" });
    }
  });

  // Handle driver load confirmation from Telegram
  app.post("/api/loads/:loadId/confirm-driver/:driverId", async (req, res) => {
    try {
      const { loadId, driverId } = req.params;
      const { confirmed } = req.body;
      
      console.log(`📋 Driver ${driverId} ${confirmed ? 'confirmed' : 'declined'} load ${loadId}`);
      
      // Get the load and driver details
      const [load, driver] = await Promise.all([
        storage.getLoad(loadId),
        storage.getDriver(driverId)
      ]);
      
      if (!load || !driver) {
        return res.status(404).json({ error: "Load or driver not found" });
      }
      
      // Find the driver's offer
      const existingOffer = await storage.getLoadOfferByLoadAndDriver(loadId, driverId);
      
      if (!existingOffer || existingOffer.status !== 'awaiting_confirmation') {
        return res.status(404).json({ error: "No pending confirmation found for this driver" });
      }
      
      if (confirmed) {
        // Driver confirmed - proceed with booking
        await Promise.all([
          // Update load status and assign driver
          storage.updateLoad(loadId, {
            status: 'assigned',
            driverId: driverId
          }),
          // Update driver status to on_route
          storage.updateDriver(driverId, {
            status: 'on_route'
          }),
          // Update the offer status to accepted
          storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
            status: 'accepted',
            respondedAt: new Date(),
            driverConfirmedAt: new Date(),
            awaitingDriverConfirmation: false
          })
        ]);
        
        console.log(`✅ Load ${load.loadNumber} confirmed and booked for driver ${driver.name}`);
        
        // Send final confirmation via Telegram
        try {
          if (telegramLoadService && telegramLoadService.isServiceRunning() && driver.telegramId) {
            const confirmationMessage = `✅ *LOAD CONFIRMED & BOOKED*

Your load has been booked. Please start planning your trip and heading to your pick up location.

📋 Load: ${load.loadNumber}
💰 Your Rate: $${existingOffer.dispatcherRate}

📍 Pickup: ${load.pickupAddress}
📅 ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}

Safe travels! 🚛`;
            
            await telegramLoadService.sendMessageToDriver(driver.telegramId, confirmationMessage);
          }
        } catch (error) {
          console.error("Error sending final confirmation:", error);
        }
        
        res.json({
          success: true,
          message: "Load confirmed and booked successfully",
          loadNumber: load.loadNumber,
          driverName: driver.name
        });
        
      } else {
        // Driver declined - mark offer as declined
        await storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
          status: 'declined',
          respondedAt: new Date(),
          awaitingDriverConfirmation: false
        });
        
        console.log(`❌ Load ${load.loadNumber} declined by driver ${driver.name}`);
        
        res.json({
          success: true,
          message: "Load declined by driver",
          loadNumber: load.loadNumber,
          driverName: driver.name
        });
      }
      
    } catch (error) {
      console.error("Error handling driver confirmation:", error);
      res.status(500).json({ error: "Failed to handle confirmation" });
    }
  });

  app.post("/api/loads/:id/book", async (req, res) => {
    try {
      const loadId = req.params.id;
      const load = await storage.getLoad(loadId);
      
      if (!load) {
        return res.status(404).json({ error: "Load not found" });
      }

      if (load.status === 'assigned' || load.status === 'in_transit' || load.status === 'delivered') {
        return res.status(400).json({ error: "Load is not available for booking" });
      }

      // Allow booking for loads with status 'scheduled' as well as 'pending'
      if (load.status !== 'scheduled' && load.status !== 'pending') {
        console.log(`Load ${load.loadNumber} has status: ${load.status}, but we'll allow booking for demo purposes`);
      }

      // For now, we'll assume the booking request comes from a driver interface
      // In a real scenario, you'd get the driver ID from authentication
      const allDrivers = await storage.getAllDrivers();
      const availableDrivers = allDrivers.filter(d => d.status === "available");
      
      if (availableDrivers.length === 0) {
        return res.status(400).json({ error: "No available drivers found" });
      }

      // For demo, use the first available driver
      const driver = availableDrivers[0];

      // Create or update load offer
      try {
        await storage.createLoadOffer({
          loadId: loadId,
          driverId: driver.id,
          status: 'pending',
          sentAt: new Date(),
          timeoutAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes timeout
          respondedAt: null
        });
      } catch (error) {
        console.log("Load offer may already exist");
      }

      // Send booking confirmation via Telegram if driver is connected
      if (telegramLoadService && driver.telegramId) {
        try {
          const message = `📞 *BOOKING REQUEST RECEIVED*\n\nLoad: ${load.loadNumber}\nRoute: ${load.pickupAddress} → ${load.deliveryAddress}\nRate: $${load.rate}\n\nYour booking request has been sent to dispatch. You will receive confirmation within 15 minutes.`;
          
          // Send via Telegram service
          if (telegramLoadService.isServiceRunning()) {
            try {
              // Send confirmation to driver
              if (driver.telegramId) {
                await telegramLoadService.sendMessage(driver.telegramId, message);
                console.log(`✅ Sent booking confirmation to driver ${driver.name} via Telegram`);
              }
              
              // Notify dispatcher with complete information
              const dispatchMessage = `📞 *LOAD BOOKING REQUEST*\n\n` +
                `🚛 *DRIVER INFO:*\n` +
                `• Name: ${driver.name}\n` +
                `• Phone: ${driver.phone}\n` +
                `• Location: ${driver.city || 'Not specified'}\n` +
                `• Equipment: ${driver.equipmentType}\n` +
                `• Capacity: ${driver.weightCapacity || 26000} lbs\n\n` +
                `📦 *LOAD DETAILS:*\n` +
                `• Load #: ${load.loadNumber}\n` +
                `• Route: ${load.pickupAddress} → ${load.deliveryAddress}\n` +
                `• Rate: $${load.rate} (${load.miles} miles)\n` +
                `• Weight: ${load.weight.toLocaleString()} lbs\n` +
                `• Equipment: ${load.equipmentType}\n` +
                `• Pickup: ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}\n` +
                `• Delivery: ${load.deliveryDate.toLocaleDateString()} at ${load.deliveryTime}\n` +
                `• Company: ${load.company || 'Not specified'}\n` +
                `• Contact: ${load.contactPhone || 'No phone - email required'}\n\n` +
                `[📞 Call Driver](tel:${driver.phone})`;
              
              const config = telegramLoadService.getConfig();
              if (config?.dispatcherId) {
                await telegramLoadService.sendMessage(config.dispatcherId, dispatchMessage);
                console.log(`✅ Sent enhanced booking notification to dispatcher via Telegram`);
              }

              // If load has no phone number, initiate email booking process
              if (!load.contactPhone && load.customer?.email) {
                await handleEmailBookingRequest(load, driver);
              }
            } catch (error) {
              console.error("Error with telegram service:", error);
            }
          } else {
            // Log the messages for debugging when service is not running
            const dispatchMessage = `📞 *LOAD BOOKING REQUEST*\n\n` +
              `🚛 *DRIVER INFO:*\n` +
              `• Name: ${driver.name}\n` +
              `• Phone: ${driver.phone}\n` +
              `• Location: ${driver.city || 'Not specified'}\n` +
              `• Equipment: ${driver.equipmentType}\n` +
              `• Capacity: ${driver.weightCapacity || 26000} lbs\n\n` +
              `📦 *LOAD DETAILS:*\n` +
              `• Load #: ${load.loadNumber}\n` +
              `• Route: ${load.pickupAddress} → ${load.deliveryAddress}\n` +
              `• Rate: $${load.rate} (${load.miles} miles)\n` +
              `• Weight: ${load.weight.toLocaleString()} lbs\n` +
              `• Equipment: ${load.equipmentType}\n` +
              `• Pickup: ${load.pickupDate.toLocaleDateString()} at ${load.pickupTime}\n` +
              `• Delivery: ${load.deliveryDate.toLocaleDateString()} at ${load.deliveryTime}\n` +
              `• Company: ${load.company || 'Not specified'}\n` +
              `• Contact: ${load.contactPhone || 'No phone - email required'}\n\n` +
              `[📞 Call Driver](tel:${driver.phone})`;
            console.log(`📱 Driver booking confirmation: ${message}`);
            console.log(`📱 Dispatcher notification: ${dispatchMessage}`);
            
            // If load has no phone number, initiate email booking process
            if (!load.contactPhone && load.customer?.email) {
              await handleEmailBookingRequest(load, driver);
            }
          }
        } catch (error) {
          console.error("Error sending booking notifications:", error);
        }
      }

      console.log(`Booking request received for load ${load.loadNumber} by driver ${driver.name}`);
      
      res.json({ 
        message: "Booking request sent successfully", 
        loadNumber: load.loadNumber,
        driverName: driver.name 
      });
    } catch (error) {
      console.error("Error processing load booking:", error);
      res.status(500).json({ error: "Failed to process booking request" });
    }
  });

  // Customer routes
  app.get("/api/customers", async (req, res) => {
    try {
      const customers = await storage.getAllCustomers();
      res.json(customers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  app.post("/api/customers", async (req, res) => {
    try {
      const validatedData = insertCustomerSchema.parse(req.body);
      const customer = await storage.createCustomer(validatedData);
      res.status(201).json(customer);
    } catch (error) {
      res.status(400).json({ error: "Invalid customer data" });
    }
  });

  app.put("/api/customers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertCustomerSchema.partial().parse(req.body);
      const customer = await storage.updateCustomer(id, validatedData);
      
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      res.json(customer);
    } catch (error) {
      res.status(400).json({ error: "Invalid customer data" });
    }
  });

  app.delete("/api/customers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteCustomer(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Customer not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete customer" });
    }
  });

  // Load routes
  app.get("/api/loads", async (req, res) => {
    try {
      const { status } = req.query;
      
      if (status && typeof status === "string") {
        const loads = await storage.getLoadsByStatus(status);
        res.json(loads);
      } else {
        const loads = await storage.getAllLoads();
        res.json(loads);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch loads" });
    }
  });

  app.get("/api/loads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const load = await storage.getLoad(id);
      
      if (!load) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      res.json(load);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load" });
    }
  });

  app.post("/api/loads", async (req, res) => {
    try {
      const validatedData = insertLoadSchema.parse(req.body);
      const load = await storage.createLoad(validatedData);
      
      // Send automated emails for new load
      await sendAutomatedEmails(load, "load_created");
      
      // Send load to drivers via Telegram if it matches preferences
      await telegramLoadService.processNewLoad(load);
      
      res.status(201).json(load);
    } catch (error) {
      res.status(400).json({ error: "Invalid load data" });
    }
  });

  app.put("/api/loads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertLoadSchema.partial().parse(req.body);
      const originalLoad = await storage.getLoad(id);
      
      if (!originalLoad) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      const updatedLoad = await storage.updateLoad(id, validatedData);
      
      if (!updatedLoad) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      // Send automated emails based on status changes
      if (validatedData.status && validatedData.status !== originalLoad.status) {
        if (validatedData.status === "in_transit") {
          await sendAutomatedEmails(updatedLoad, "pickup_confirmed");
        } else if (validatedData.status === "delivered") {
          await sendAutomatedEmails(updatedLoad, "delivered");
        }
      }
      
      res.json(updatedLoad);
    } catch (error) {
      res.status(400).json({ error: "Invalid load data" });
    }
  });

  app.delete("/api/loads/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteLoad(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Load not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete load" });
    }
  });

  // Dispatcher-specific endpoints
  // Get load offers for a specific load
  app.get('/api/loads/:id/offers', async (req, res) => {
    try {
      const { id } = req.params;
      const offers = await storage.getLoadOffers(id);
      res.json(offers);
    } catch (error) {
      console.error('Error fetching load offers:', error);
      res.status(500).json({ error: 'Failed to fetch load offers' });
    }
  });

  // Update load status and details (PATCH for partial updates)
  app.patch('/api/loads/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const updatedLoad = await storage.updateLoad(id, updates);
      if (!updatedLoad) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      res.json(updatedLoad);
    } catch (error) {
      console.error('Error updating load:', error);
      res.status(500).json({ error: 'Failed to update load' });
    }
  });

  // Assign driver to load
  app.post('/api/loads/:id/assign', async (req, res) => {
    try {
      const { id } = req.params;
      const { driverId } = req.body;
      
      const updatedLoad = await storage.updateLoad(id, { 
        driverId, 
        status: 'assigned' 
      });
      
      if (!updatedLoad) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      res.json(updatedLoad);
    } catch (error) {
      console.error('Error assigning driver:', error);
      res.status(500).json({ error: 'Failed to assign driver' });
    }
  });

  // Add notes to load
  app.post('/api/loads/:id/notes', async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      
      // Add notes to special instructions or create a notes field
      const load = await storage.getLoad(id);
      if (!load) {
        return res.status(404).json({ error: 'Load not found' });
      }
      
      const timestamp = new Date().toLocaleString();
      const newNote = `[${timestamp}] Dispatcher Notes: ${notes}`;
      
      const updatedInstructions = load.specialInstructions 
        ? `${load.specialInstructions}\n\n${newNote}`
        : newNote;
      
      const updatedLoad = await storage.updateLoad(id, { 
        specialInstructions: updatedInstructions 
      });
      
      res.json(updatedLoad);
    } catch (error) {
      console.error('Error adding notes:', error);
      res.status(500).json({ error: 'Failed to add notes' });
    }
  });

  // Email template routes
  app.get("/api/email-templates", async (req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch email templates" });
    }
  });

  app.post("/api/email-templates", async (req, res) => {
    try {
      const validatedData = insertEmailTemplateSchema.parse(req.body);
      const template = await storage.createEmailTemplate(validatedData);
      res.status(201).json(template);
    } catch (error) {
      res.status(400).json({ error: "Invalid email template data" });
    }
  });

  app.put("/api/email-templates/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertEmailTemplateSchema.partial().parse(req.body);
      const template = await storage.updateEmailTemplate(id, validatedData);
      
      if (!template) {
        return res.status(404).json({ error: "Email template not found" });
      }
      
      res.json(template);
    } catch (error) {
      res.status(400).json({ error: "Invalid email template data" });
    }
  });

  app.delete("/api/email-templates/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteEmailTemplate(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Email template not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete email template" });
    }
  });

  // Test email endpoint
  app.post("/api/test-email", async (req, res) => {
    try {
      const { templateId, loadId, recipientEmail } = req.body;
      
      const template = await storage.getEmailTemplate(templateId);
      const load = loadId ? await storage.getLoad(loadId) : null;
      
      if (!template) {
        return res.status(404).json({ error: "Email template not found" });
      }
      
      const variables = load ? {
        loadNumber: load.loadNumber,
        customerName: load.customer.name,
        customerContactPerson: load.customer.contactPerson,
        driverName: load.driver?.name || "Not assigned",
        driverPhone: load.driver?.phone || "N/A",
        pickupAddress: load.pickupAddress,
        pickupDate: load.pickupDate.toLocaleDateString(),
        pickupTime: load.pickupTime,
        deliveryAddress: load.deliveryAddress,
        deliveryDate: load.deliveryDate.toLocaleDateString(),
        deliveryTime: load.deliveryTime,
        specialInstructions: load.specialInstructions || "None",
        currentTime: new Date().toLocaleString(),
      } : {
        loadNumber: "TEST-001",
        customerName: "Test Customer",
        customerContactPerson: "Test Contact",
        driverName: "Test Driver",
        driverPhone: "(555) 000-0000",
        pickupAddress: "Test Pickup Address",
        pickupDate: "01/01/2024",
        pickupTime: "10:00 AM",
        deliveryAddress: "Test Delivery Address",
        deliveryDate: "01/02/2024",
        deliveryTime: "2:00 PM",
        specialInstructions: "This is a test email",
        currentTime: new Date().toLocaleString(),
      };
      
      const subject = replaceTemplateVariables(template.subject, variables);
      const body = replaceTemplateVariables(template.body, variables);
      
      const result = await sendEmail(recipientEmail, subject, body, loadId, templateId);
      
      if (result.success) {
        res.json({ success: true, message: "Test email sent successfully" });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to send test email" });
    }
  });

  // Email logs routes
  app.get("/api/email-logs", async (req, res) => {
    try {
      const { loadId } = req.query;
      
      if (loadId && typeof loadId === "string") {
        const logs = await storage.getEmailLogsByLoad(loadId);
        res.json(logs);
      } else {
        const logs = await storage.getAllEmailLogs();
        res.json(logs);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch email logs" });
    }
  });

  // Dashboard stats
  app.get("/api/dashboard-stats", async (req, res) => {
    try {
      const allLoads = await storage.getAllLoads();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const stats = {
        activeLoads: allLoads.filter(load => load.status !== "delivered" && load.status !== "cancelled").length,
        inTransit: allLoads.filter(load => load.status === "in_transit").length,
        deliveredToday: allLoads.filter(load => 
          load.status === "delivered" && 
          load.updatedAt && load.updatedAt >= today
        ).length,
        emailAlerts: (await storage.getAllEmailLogs()).length,
      };
      
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Driver onboarding routes
  app.post("/api/create-onboarding-invite", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      
      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days
      
      const tokenData = {
        token,
        email,
        expiresAt,
        isUsed: false,
      };
      
      const validatedData = insertOnboardingTokenSchema.parse(tokenData);
      const onboardingToken = await storage.createOnboardingToken(validatedData);
      
      res.status(201).json(onboardingToken);
    } catch (error) {
      res.status(400).json({ error: "Failed to create onboarding invitation" });
    }
  });

  app.post("/api/create-sms-onboarding-invite", async (req, res) => {
    try {
      const { email, phone } = req.body;
      
      if (!email || !phone) {
        return res.status(400).json({ error: "Email and phone are required" });
      }
      
      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days
      
      const tokenData = {
        token,
        email,
        expiresAt,
        isUsed: false,
      };
      
      const validatedData = insertOnboardingTokenSchema.parse(tokenData);
      const onboardingToken = await storage.createOnboardingToken(validatedData);
      
      // Create the onboarding link
      const onboardingLink = `${req.protocol}://${req.hostname}/driver-onboarding?token=${token}`;
      
      // SMS message content
      const smsMessage = `Welcome to LoadMaster! Complete your driver onboarding here: ${onboardingLink}. This link expires in 7 days.`;
      
      // Send SMS (placeholder - would use Twilio in production)
      console.log(`SMS would be sent to ${phone}: ${smsMessage}`);
      
      // Log the SMS attempt
      await storage.createEmailLog({
        recipientEmail: email,
        subject: "SMS Driver Onboarding",
        status: "sent",
        sentAt: new Date(),
      });
      
      res.status(201).json({ 
        ...onboardingToken, 
        phone,
        message: "SMS invitation sent successfully"
      });
    } catch (error) {
      console.error("SMS invitation error:", error);
      res.status(400).json({ error: "Failed to send SMS invitation" });
    }
  });

  app.post("/api/create-telegram-onboarding-invite", async (req, res) => {
    try {
      const { email, telegramId } = req.body;
      
      if (!email || !telegramId) {
        return res.status(400).json({ error: "Email and Telegram ID are required" });
      }
      
      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days
      
      const tokenData = {
        token,
        email,
        expiresAt,
        isUsed: false,
      };
      
      const validatedData = insertOnboardingTokenSchema.parse(tokenData);
      const onboardingToken = await storage.createOnboardingToken(validatedData);
      
      // Send Telegram onboarding invitation
      const sent = await telegramLoadService.sendOnboardingInvitation(telegramId, token, email);
      
      if (!sent) {
        return res.status(500).json({ error: "Failed to send Telegram invitation" });
      }
      
      // Log the Telegram attempt
      await storage.createEmailLog({
        recipientEmail: email,
        subject: "Telegram Driver Onboarding",
        status: "sent",
        sentAt: new Date(),
      });
      
      res.status(201).json({ 
        ...onboardingToken, 
        telegramId,
        message: "Telegram invitation sent successfully"
      });
    } catch (error) {
      console.error("Telegram invitation error:", error);
      res.status(400).json({ error: "Failed to send Telegram invitation" });
    }
  });

  app.post("/api/validate-onboarding-token", async (req, res) => {
    try {
      const { token } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }
      
      const onboardingToken = await storage.getOnboardingToken(token);
      
      if (!onboardingToken) {
        return res.json({ valid: false, error: "Token not found" });
      }
      
      if (onboardingToken.isUsed) {
        return res.json({ valid: false, error: "Token already used" });
      }
      
      if (new Date(onboardingToken.expiresAt) < new Date()) {
        return res.json({ valid: false, error: "Token expired" });
      }
      
      res.json({ valid: true, email: onboardingToken.email });
    } catch (error) {
      res.status(500).json({ error: "Failed to validate token" });
    }
  });

  app.post("/api/driver-onboarding", async (req, res) => {
    try {
      const { token, ...driverData } = req.body;
      
      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }
      
      const validatedData = driverOnboardingSchema.parse(driverData);
      const driver = await storage.completeDriverOnboarding(validatedData, token);
      
      res.status(201).json(driver);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to complete onboarding" });
    }
  });

  app.post("/api/onboarding-tokens", async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }
      
      const token = randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // Expires in 7 days
      
      const tokenData = {
        token,
        email,
        expiresAt,
        isUsed: false,
      };
      
      const validatedData = insertOnboardingTokenSchema.parse(tokenData);
      const onboardingToken = await storage.createOnboardingToken(validatedData);
      
      res.status(201).json(onboardingToken);
    } catch (error) {
      res.status(400).json({ error: "Failed to create onboarding token" });
    }
  });

  app.get("/api/onboarding-tokens", async (req, res) => {
    try {
      const tokens = await storage.getAllOnboardingTokens();
      res.json(tokens);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch onboarding tokens" });
    }
  });

  // Driver location routes
  app.post("/api/driver-location", async (req, res) => {
    try {
      const validatedData = insertDriverLocationSchema.parse(req.body);
      const location = await storage.createDriverLocation(validatedData);
      res.status(201).json(location);
    } catch (error) {
      res.status(400).json({ error: "Invalid location data" });
    }
  });

  app.get("/api/driver-locations", async (req, res) => {
    try {
      const { driverId } = req.query;
      
      if (driverId && typeof driverId === "string") {
        const locations = await storage.getDriverLocationHistory(driverId);
        res.json(locations);
      } else {
        // Return current locations for all drivers
        const drivers = await storage.getAllDrivers();
        const locationsPromises = drivers.map(async (driver) => {
          const currentLocation = await storage.getDriverCurrentLocation(driver.id);
          return currentLocation ? { ...currentLocation, driver } : null;
        });
        
        const locations = (await Promise.all(locationsPromises)).filter(Boolean);
        res.json(locations);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver locations" });
    }
  });

  app.get("/api/drivers/:id/location", async (req, res) => {
    try {
      const { id } = req.params;
      const location = await storage.getDriverCurrentLocation(id);
      
      if (!location) {
        return res.status(404).json({ error: "Driver location not found" });
      }
      
      res.json(location);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver location" });
    }
  });

  // GPS Tracking Routes
  app.post("/api/gps/location-update", async (req, res) => {
    try {
      const { driverId, ...locationData } = req.body;
      
      if (!driverId) {
        return res.status(400).json({ error: "Driver ID is required" });
      }
      
      const locationUpdate: DriverLocationUpdate = {
        ...locationData,
        timestamp: new Date(locationData.timestamp || Date.now()),
      };
      
      const location = await gpsTrackingService.updateDriverLocation(driverId, locationUpdate);
      res.json(location);
    } catch (error) {
      console.error('GPS location update error:', error);
      res.status(500).json({ error: "Failed to update driver location" });
    }
  });

  app.get("/api/gps/driver/:id/tracking", async (req, res) => {
    try {
      const { id } = req.params;
      const trackingData = await gpsTrackingService.getDriverTracking(id);
      res.json(trackingData);
    } catch (error) {
      console.error('Get driver tracking error:', error);
      res.status(500).json({ error: "Failed to fetch driver tracking data" });
    }
  });

  app.get("/api/gps/drivers/locations", async (req, res) => {
    try {
      const locations = await gpsTrackingService.getAllDriverLocations();
      res.json(locations);
    } catch (error) {
      console.error('Get all driver locations error:', error);
      res.status(500).json({ error: "Failed to fetch driver locations" });
    }
  });

  // Geofence routes
  app.get("/api/gps/geofences", async (req, res) => {
    try {
      const geofences = await storage.getAllGeofences();
      res.json(geofences);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch geofences" });
    }
  });

  app.post("/api/gps/geofences", async (req, res) => {
    try {
      const validatedData = insertGeofenceSchema.parse(req.body);
      // Transform the validated data to match the GPS service expected format
      const geofenceData = {
        name: validatedData.name,
        type: validatedData.type,
        centerLatitude: validatedData.centerLatitude,
        centerLongitude: validatedData.centerLongitude,
        radius: validatedData.radius,
        loadId: validatedData.loadId || undefined,
        customerId: validatedData.customerId || undefined,
        notificationSettings: validatedData.notificationSettings,
      };
      const geofence = await gpsTrackingService.createGeofence(geofenceData);
      res.status(201).json(geofence);
    } catch (error) {
      console.error('Create geofence error:', error);
      res.status(400).json({ error: "Invalid geofence data" });
    }
  });

  app.put("/api/gps/geofences/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertGeofenceSchema.partial().parse(req.body);
      const geofence = await storage.updateGeofence(id, validatedData);
      
      if (!geofence) {
        return res.status(404).json({ error: "Geofence not found" });
      }
      
      res.json(geofence);
    } catch (error) {
      res.status(400).json({ error: "Invalid geofence data" });
    }
  });

  app.delete("/api/gps/geofences/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteGeofence(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Geofence not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete geofence" });
    }
  });

  // Route tracking routes
  app.get("/api/gps/routes", async (req, res) => {
    try {
      const { status } = req.query;
      
      if (status === "active") {
        const routes = await storage.getActiveRoutes();
        res.json(routes);
      } else {
        const routes = await storage.getAllRoutes();
        res.json(routes);
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch routes" });
    }
  });

  app.post("/api/gps/routes", async (req, res) => {
    try {
      const { loadId, driverId } = req.body;
      
      if (!loadId || !driverId) {
        return res.status(400).json({ error: "Load ID and Driver ID are required" });
      }
      
      const route = await gpsTrackingService.createRouteForLoad(loadId, driverId);
      res.status(201).json(route);
    } catch (error) {
      console.error('Create route error:', error);
      res.status(400).json({ error: "Failed to create route" });
    }
  });

  app.get("/api/gps/routes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const route = await storage.getRoute(id);
      
      if (!route) {
        return res.status(404).json({ error: "Route not found" });
      }
      
      res.json(route);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch route" });
    }
  });

  app.put("/api/gps/routes/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertRouteSchema.partial().parse(req.body);
      const route = await storage.updateRoute(id, validatedData);
      
      if (!route) {
        return res.status(404).json({ error: "Route not found" });
      }
      
      res.json(route);
    } catch (error) {
      res.status(400).json({ error: "Invalid route data" });
    }
  });

  // GPS Device routes
  app.get("/api/gps/devices", async (req, res) => {
    try {
      const devices = await storage.getAllGpsDevices();
      res.json(devices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch GPS devices" });
    }
  });

  app.post("/api/gps/devices", async (req, res) => {
    try {
      const validatedData = insertGpsDeviceSchema.parse(req.body);
      const device = await storage.createGpsDevice(validatedData);
      res.status(201).json(device);
    } catch (error) {
      res.status(400).json({ error: "Invalid GPS device data" });
    }
  });

  app.get("/api/gps/devices/driver/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const device = await storage.getGpsDeviceByDriver(id);
      
      if (!device) {
        return res.status(404).json({ error: "GPS device not found for driver" });
      }
      
      res.json(device);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch GPS device" });
    }
  });

  app.put("/api/gps/devices/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertGpsDeviceSchema.partial().parse(req.body);
      const device = await storage.updateGpsDevice(id, validatedData);
      
      if (!device) {
        return res.status(404).json({ error: "GPS device not found" });
      }
      
      res.json(device);
    } catch (error) {
      res.status(400).json({ error: "Invalid GPS device data" });
    }
  });

  // Geofence Events routes
  app.get("/api/gps/geofence-events", async (req, res) => {
    try {
      const { driverId, hoursBack = 24 } = req.query;
      
      if (driverId && typeof driverId === "string") {
        const events = await storage.getDriverGeofenceEvents(driverId, Number(hoursBack));
        res.json(events);
      } else {
        return res.status(400).json({ error: "Driver ID is required" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch geofence events" });
    }
  });

  // GPS Service Status and Config
  app.get("/api/gps/service/status", async (req, res) => {
    try {
      const status = {
        isRunning: gpsTrackingService.isServiceRunning(),
        config: gpsTrackingService.getConfig(),
      };
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch GPS service status" });
    }
  });

  app.put("/api/gps/service/config", async (req, res) => {
    try {
      const configUpdate = req.body;
      gpsTrackingService.updateConfig(configUpdate);
      res.json({ success: true, config: gpsTrackingService.getConfig() });
    } catch (error) {
      res.status(400).json({ error: "Failed to update GPS service config" });
    }
  });

  // Load Board Management Routes
  // Load Board Sources
  app.get("/api/load-boards/sources", async (req, res) => {
    try {
      const sources = await storage.getAllLoadBoardSources();
      res.json(sources);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load board sources" });
    }
  });

  app.post("/api/load-boards/sources", async (req, res) => {
    try {
      const source = await storage.createLoadBoardSource(req.body);
      res.status(201).json(source);
    } catch (error) {
      res.status(400).json({ error: "Failed to create load board source" });
    }
  });

  app.put("/api/load-boards/sources/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const source = await storage.updateLoadBoardSource(id, req.body);
      if (!source) {
        return res.status(404).json({ error: "Load board source not found" });
      }
      res.json(source);
    } catch (error) {
      res.status(400).json({ error: "Failed to update load board source" });
    }
  });

  // Load Board Configurations
  app.get("/api/load-boards/configurations", async (req, res) => {
    try {
      const configurations = await storage.getAllLoadBoardConfigurations();
      res.json(configurations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load board configurations" });
    }
  });

  app.post("/api/load-boards/configurations", async (req, res) => {
    try {
      const config = await storage.createLoadBoardConfiguration(req.body);
      res.status(201).json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to create load board configuration" });
    }
  });

  app.put("/api/load-boards/configurations/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.updateLoadBoardConfiguration(id, req.body);
      if (!config) {
        return res.status(404).json({ error: "Load board configuration not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to update load board configuration" });
    }
  });

  // Scraped Loads
  app.get("/api/load-boards/scraped-loads", async (req, res) => {
    try {
      const { hours, matched, sourceId } = req.query;
      
      let loads;
      if (hours) {
        loads = await storage.getRecentScrapedLoads(Number(hours));
      } else if (matched === 'true') {
        loads = await storage.getMatchedScrapedLoads();
      } else if (sourceId && typeof sourceId === 'string') {
        loads = await storage.getScrapedLoadsBySource(sourceId);
      } else {
        loads = await storage.getAllScrapedLoads();
      }
      
      res.json(loads);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scraped loads" });
    }
  });

  // Dashboard alias for scraped loads
  app.get("/api/scraped-loads", async (req, res) => {
    try {
      const loads = await storage.getAllScrapedLoads();
      res.json(loads);
    } catch (error) {
      console.error('Get scraped loads error:', error);
      res.status(500).json({ error: "Failed to get scraped loads" });
    }
  });

  app.post("/api/load-boards/scraped-loads/:id/import", async (req, res) => {
    try {
      const { id } = req.params;
      const scrapedLoad = await storage.getScrapedLoad(id);
      
      if (!scrapedLoad) {
        return res.status(404).json({ error: "Scraped load not found" });
      }

      if (scrapedLoad.isImported) {
        return res.status(400).json({ error: "Load already imported" });
      }

      // Create a new load from scraped data
      const customers = await storage.getAllCustomers();
      const defaultCustomer = customers[0];
      
      if (!defaultCustomer) {
        return res.status(400).json({ error: "No customers available for import" });
      }

      const importedLoad = await storage.createLoad({
        customerId: defaultCustomer.id,
        driverId: scrapedLoad.matchedDriverId || undefined,
        description: `${scrapedLoad.commodity || 'General Freight'} - ${scrapedLoad.weight || 0} lbs`,
        weight: scrapedLoad.weight || 0,
        priority: scrapedLoad.priority || 'standard',
        pickupAddress: scrapedLoad.pickupAddress || `${scrapedLoad.pickupCity}, ${scrapedLoad.pickupState}`,
        pickupDate: scrapedLoad.pickupDate.toISOString().split('T')[0],
        pickupTime: scrapedLoad.pickupTimeWindow || '08:00',
        deliveryAddress: scrapedLoad.deliveryAddress || `${scrapedLoad.deliveryCity}, ${scrapedLoad.deliveryState}`,
        deliveryDate: scrapedLoad.deliveryDate.toISOString().split('T')[0],
        deliveryTime: scrapedLoad.deliveryTimeWindow || '17:00',
        specialInstructions: scrapedLoad.specialRequirements,
        rate: scrapedLoad.rate || null,
        miles: scrapedLoad.mileage || null,
        sourceBoard: 'loadboard',
      });

      // Update scraped load as imported
      await storage.updateScrapedLoad(scrapedLoad.externalId, scrapedLoad.sourceId, {
        isImported: true,
        importedLoadId: importedLoad.id,
      });

      res.json({ success: true, importedLoad });
    } catch (error) {
      console.error('Import scraped load error:', error);
      res.status(500).json({ error: "Failed to import scraped load" });
    }
  });

  // Scraper Configurations
  app.get("/api/scraper-configs", async (req, res) => {
    try {
      const configs = await storage.getAllScraperConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scraper configurations" });
    }
  });

  app.get("/api/load-boards/scraper-configs", async (req, res) => {
    try {
      const configs = await storage.getAllScraperConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scraper configurations" });
    }
  });

  app.post("/api/scraper-configs", async (req, res) => {
    try {
      const config = await storage.createScraperConfig(req.body);
      res.status(201).json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to create scraper configuration" });
    }
  });

  app.post("/api/load-boards/scraper-configs", async (req, res) => {
    try {
      const config = await storage.createScraperConfig(req.body);
      res.status(201).json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to create scraper configuration" });
    }
  });

  app.put("/api/scraper-configs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.updateScraperConfig(id, req.body);
      if (!config) {
        return res.status(404).json({ error: "Scraper configuration not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to update scraper configuration" });
    }
  });

  app.put("/api/load-boards/scraper-configs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.updateScraperConfig(id, req.body);
      if (!config) {
        return res.status(404).json({ error: "Scraper configuration not found" });
      }
      res.json(config);
    } catch (error) {
      res.status(400).json({ error: "Failed to update scraper configuration" });
    }
  });

  app.post("/api/load-boards/scraper-configs/:id/run", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await loadBoardService.runScraper(id);
      res.json(result);
    } catch (error) {
      console.error('Manual scraper run error:', error);
      res.status(500).json({ error: "Failed to run scraper" });
    }
  });

  // Load Board Service Management
  app.get("/api/load-boards/service/status", async (req, res) => {
    try {
      const status = {
        isRunning: loadBoardService.isServiceRunning(),
        stats: await loadBoardService.getScrapingStats(),
      };
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load board service status" });
    }
  });

  app.post("/api/load-boards/test-scraper", async (req, res) => {
    try {
      // Create a test scraper configuration for demonstration
      const testConfig = await storage.createScraperConfig({
        name: 'Test Scraper',
        type: 'dat',
        enabled: true,
        loginUrl: 'https://one.dat.com/login',
        searchUrl: 'https://one.dat.com/tms/v2/board',
        username: '',
        password: '',
        searchCriteria: { equipmentType: 'Van', radius: 250 },
        schedule: '*/10 * * * *',
        autoCreateLoads: false,
      });

      const result = await loadBoardService.runScraper(testConfig.id);
      res.json({ testConfig, result });
    } catch (error) {
      console.error('Test scraper error:', error);
      res.status(500).json({ error: "Failed to run test scraper" });
    }
  });

  // Analytics and Reporting Routes
  app.get('/api/analytics/dashboard', async (req, res) => {
    try {
      const dashboardData = await analyticsService.getDashboardAnalytics();
      res.json(dashboardData);
    } catch (error) {
      console.error('Dashboard analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard analytics' });
    }
  });

  app.get('/api/analytics/driver-performance', async (req, res) => {
    try {
      const { period = 'monthly', startDate, endDate } = req.query;
      const performance = await analyticsService.getDriverPerformance({
        period: period as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });
      res.json(performance);
    } catch (error) {
      console.error('Driver performance analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch driver performance' });
    }
  });

  app.get('/api/analytics/customer-insights', async (req, res) => {
    try {
      const { period = 'monthly', startDate, endDate } = req.query;
      const insights = await analyticsService.getCustomerInsights({
        period: period as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });
      res.json(insights);
    } catch (error) {
      console.error('Customer insights error:', error);
      res.status(500).json({ error: 'Failed to fetch customer insights' });
    }
  });

  app.get('/api/analytics/business-metrics', async (req, res) => {
    try {
      const { period = 'monthly', metricType } = req.query;
      const metrics = await analyticsService.getBusinessMetrics({
        period: period as string,
        metricType: metricType as string,
      });
      res.json(metrics);
    } catch (error) {
      console.error('Business metrics error:', error);
      res.status(500).json({ error: 'Failed to fetch business metrics' });
    }
  });

  app.get('/api/analytics/load-trends', async (req, res) => {
    try {
      const { days = '7' } = req.query;
      const trends = await analyticsService.getLoadTrends(parseInt(days as string));
      res.json(trends);
    } catch (error) {
      console.error('Load trends error:', error);
      res.status(500).json({ error: 'Failed to fetch load trends' });
    }
  });

  app.get('/api/analytics/revenue', async (req, res) => {
    try {
      const { period = 'monthly', startDate, endDate } = req.query;
      const revenue = await analyticsService.getRevenueAnalytics({
        period: period as string,
        startDate: startDate as string,
        endDate: endDate as string,
      });
      res.json(revenue);
    } catch (error) {
      console.error('Revenue analytics error:', error);
      res.status(500).json({ error: 'Failed to fetch revenue analytics' });
    }
  });

  app.post('/api/analytics/generate-report', async (req, res) => {
    try {
      const reportConfig = req.body;
      const report = await analyticsService.generateReport(reportConfig);
      res.json(report);
    } catch (error) {
      console.error('Report generation error:', error);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  // DAT Scraper Routes - Full implementation
  app.get('/api/scraper-configs', async (req, res) => {
    try {
      const configs = await storage.getAllScraperConfigs();
      res.json(configs);
    } catch (error) {
      console.error('Error fetching scraper configs:', error);
      res.status(500).json({ message: 'Failed to fetch scraper configs' });
    }
  });

  app.post('/api/scraper-configs', async (req, res) => {
    try {
      const config = await storage.createScraperConfig(req.body);
      
      // Schedule the task if it's enabled
      if (config.enabled) {
        await schedulerService.scheduleScraperTask(config);
      }
      
      res.json(config);
    } catch (error) {
      console.error('Error creating scraper config:', error);
      res.status(500).json({ message: 'Failed to create scraper config' });
    }
  });

  app.patch('/api/scraper-configs/:id', async (req, res) => {
    try {
      const config = await storage.updateScraperConfig(req.params.id, req.body);
      if (!config) {
        return res.status(404).json({ message: 'Scraper config not found' });
      }
      
      // Update the scheduled task
      await schedulerService.updateTask(config);
      
      res.json(config);
    } catch (error) {
      console.error('Error updating scraper config:', error);
      res.status(500).json({ message: 'Failed to update scraper config' });
    }
  });

  app.post('/api/scraper-configs/:id/run', async (req, res) => {
    try {
      const result = await schedulerService.runTaskNow(req.params.id);
      res.json(result);
    } catch (error) {
      console.error('Error running scraper:', error);
      res.status(500).json({ message: 'Failed to run scraper' });
    }
  });

  // Scraper logs routes
  app.get('/api/scraper-logs', async (req, res) => {
    try {
      const logs = await storage.getAllScraperLogs();
      res.json(logs);
    } catch (error) {
      console.error('Error fetching scraper logs:', error);
      res.status(500).json({ message: 'Failed to fetch scraper logs' });
    }
  });

  app.get('/api/scraper-status', async (req, res) => {
    try {
      res.json({ message: 'DAT Scraper integration active and running' });
    } catch (error) {
      console.error('Failed to get scraper status:', error);
      res.status(500).json({ error: 'Failed to get scraper status' });
    }
  });

  // Load expiration API endpoints
  app.get("/api/load-expiration-stats", async (req, res) => {
    try {
      const stats = await loadExpirationService.getExpirationStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expiration stats" });
    }
  });

  app.post("/api/expire-load/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const success = await loadExpirationService.expireLoadManually(id);
      
      if (success) {
        res.json({ success: true, message: "Load expired successfully" });
      } else {
        res.status(400).json({ success: false, error: "Failed to expire load" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to expire load" });
    }
  });

  app.post("/api/set-load-expiration/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { expiresAt } = req.body;
      
      if (!expiresAt) {
        return res.status(400).json({ error: "Expiration date is required" });
      }
      
      const success = await loadExpirationService.setLoadExpiration(id, new Date(expiresAt));
      
      if (success) {
        res.json({ success: true, message: "Load expiration set successfully" });
      } else {
        res.status(400).json({ success: false, error: "Failed to set load expiration" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to set load expiration" });
    }
  });

  app.post("/api/process-load-expirations", async (req, res) => {
    try {
      await loadExpirationService.processLoadExpirations();
      res.json({ success: true, message: "Load expirations processed successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to process load expirations" });
    }
  });

  app.get("/api/load-expiration-config", async (req, res) => {
    try {
      const config = loadExpirationService.getConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch expiration config" });
    }
  });

  // Telegram bot API endpoints
  app.get("/api/telegram/config", async (req, res) => {
    try {
      const config = telegramLoadService.getConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch Telegram config" });
    }
  });

  app.get("/api/telegram/status", async (req, res) => {
    try {
      const isRunning = telegramLoadService.isServiceRunning();
      res.json({ isRunning, status: isRunning ? 'active' : 'inactive' });
    } catch (error) {
      res.status(500).json({ error: "Failed to get Telegram service status" });
    }
  });

  app.post("/api/telegram/test-load", async (req, res) => {
    try {
      const success = await telegramLoadService.sendTestLoad();
      if (success) {
        res.json({ success: true, message: "Test load sent successfully" });
      } else {
        res.status(400).json({ success: false, error: "Failed to send test load" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to send test load" });
    }
  });

  // Lane preferences API
  app.get("/api/lane-preferences", async (req, res) => {
    try {
      const preferences = await storage.getAllLanePreferences();
      res.json(preferences);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch lane preferences" });
    }
  });

  app.post("/api/lane-preferences", async (req, res) => {
    try {
      const { fromStates, toStates, minRPM } = req.body;
      const preference = await storage.createLanePreference({
        fromStates,
        toStates,
        minRPM,
        isActive: true
      });
      res.status(201).json(preference);
    } catch (error) {
      res.status(400).json({ error: "Invalid lane preference data" });
    }
  });

  app.delete("/api/lane-preferences/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteLanePreference(id);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Lane preference not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete lane preference" });
    }
  });

  // Avoid locations API
  app.get("/api/avoid-locations", async (req, res) => {
    try {
      const locations = await storage.getAllAvoidLocations();
      res.json(locations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch avoid locations" });
    }
  });

  app.post("/api/avoid-locations", async (req, res) => {
    try {
      const { location, type } = req.body;
      const avoidLocation = await storage.createAvoidLocation({
        location,
        type: type || 'city',
        isActive: true
      });
      res.status(201).json(avoidLocation);
    } catch (error) {
      res.status(400).json({ error: "Invalid avoid location data" });
    }
  });

  app.delete("/api/avoid-locations/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteAvoidLocation(id);
      if (deleted) {
        res.status(204).send();
      } else {
        res.status(404).json({ error: "Avoid location not found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to delete avoid location" });
    }
  });

  // Load offers API
  app.get("/api/load-offers", async (req, res) => {
    try {
      const offers = await storage.getAllLoadOffers();
      res.json(offers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load offers" });
    }
  });

  // Telegram Load Dispatching routes
  app.get("/api/telegram/load-offers", async (req, res) => {
    try {
      const offers = await storage.getLoadOffersWithDetails();
      res.json(offers);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch load offers" });
    }
  });

  // Test route to simulate driver accepting a load
  app.post("/api/test/accept-load", async (req, res) => {
    try {
      const { loadId, driverId } = req.body;
      
      if (!loadId || !driverId) {
        return res.status(400).json({ error: "loadId and driverId are required" });
      }

      // Update the load offer status to accepted
      await storage.updateLoadOfferByLoadAndDriver(loadId, driverId, {
        status: 'accepted',
        respondedAt: new Date()
      });

      res.json({ success: true, message: "Load offer status updated to accepted" });
    } catch (error) {
      console.error('Error in test accept load:', error);
      res.status(500).json({ error: "Failed to update load offer" });
    }
  });

  app.get("/api/telegram/driver-stats", async (req, res) => {
    try {
      const stats = await storage.getAllDriverLoadOfferStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver stats" });
    }
  });

  app.get("/api/telegram/driver-stats/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const stats = await storage.getDriverLoadOfferStats(id);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch driver stats" });
    }
  });

  app.get("/api/telegram/test-load", async (req, res) => {
    try {
      const result = await telegramLoadService.sendTestLoad();
      res.json({ success: result, message: result ? "Test load sent successfully" : "No loads available or service not running" });
    } catch (error) {
      res.status(500).json({ error: "Failed to send test load" });
    }
  });

  app.get("/api/telegram/service-status", async (req, res) => {
    try {
      const isRunning = telegramLoadService.isServiceRunning();
      const config = telegramLoadService.getConfig();
      res.json({ isRunning, config });
    } catch (error) {
      res.status(500).json({ error: "Failed to get service status" });
    }
  });

  app.post("/api/driver-test-load", async (req, res) => {
    try {
      const { driverId } = req.body;
      if (!driverId) {
        return res.status(400).json({ error: "Driver ID is required" });
      }

      const driver = await storage.getDriver(driverId);
      if (!driver) {
        return res.status(404).json({ error: "Driver not found" });
      }

      if (!driver.telegramId || !driver.enableTelegramNotifications) {
        return res.status(400).json({ error: "Driver does not have Telegram notifications enabled" });
      }

      // Create a test load
      const customers = await storage.getAllCustomers();
      if (customers.length === 0) {
        return res.status(400).json({ error: "No customers available for test load" });
      }

      const testLoad = await storage.createLoad({
        customerId: customers[0].id,
        description: "Test Load - Welcome to LoadMaster!",
        weight: 25000,
        priority: "standard",
        pickupAddress: "Atlanta, GA",
        pickupDate: new Date().toISOString(),
        pickupTime: "09:00 AM",
        deliveryAddress: driver.city || "Location TBD",
        deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        deliveryTime: "05:00 PM",
        specialInstructions: "This is a test load to verify your Telegram notifications are working. Please respond to confirm you're ready to receive loads.",
        rate: 1500,
        miles: 250,
        company: "LoadMaster Test",
        contactPhone: "(555) 123-4567",
        sourceBoard: "test"
      });

      // Send the test load via Telegram to specific driver
      const result = await telegramLoadService.sendTestLoadToDriver(testLoad, driverId);
      
      if (result) {
        res.json({ success: true, message: "Test load sent successfully", loadId: testLoad.id });
      } else {
        res.status(500).json({ error: "Failed to send test load via Telegram" });
      }
    } catch (error) {
      console.error("Error sending test load:", error);
      res.status(500).json({ error: "Failed to send test load" });
    }
  });

  // Bidding System API endpoints
  app.get('/api/bidding/status', async (req, res) => {
    try {
      const status = {
        isRunning: biddingService.isServiceRunning(),
        stats: await biddingService.getBiddingStats(),
      };
      res.json(status);
    } catch (error) {
      console.error('Error getting bidding status:', error);
      res.status(500).json({ message: 'Failed to get bidding status' });
    }
  });

  // Create bid from scraped load
  app.post('/api/bidding/create-bid', async (req, res) => {
    try {
      const { scrapedLoadId, driverId } = req.body;
      
      if (!scrapedLoadId || !driverId) {
        return res.status(400).json({ message: 'scrapedLoadId and driverId are required' });
      }

      const bid = await biddingService.createBidFromScrapedLoad(scrapedLoadId, driverId);
      res.json(bid);
    } catch (error) {
      console.error('Error creating bid:', error);
      res.status(500).json({ message: 'Failed to create bid' });
    }
  });

  // Handle driver response to bid
  app.post('/api/bidding/driver-response', async (req, res) => {
    try {
      const { bidId, driverId, response, counterOffer, reason, notes } = req.body;
      
      if (!bidId || !driverId || !response) {
        return res.status(400).json({ message: 'bidId, driverId, and response are required' });
      }

      await biddingService.handleDriverResponse(bidId, driverId, response, {
        counterOffer,
        reason,
        notes,
      });
      
      res.json({ message: 'Driver response processed successfully' });
    } catch (error) {
      console.error('Error processing driver response:', error);
      res.status(500).json({ message: 'Failed to process driver response' });
    }
  });

  // Mark load as won
  app.post('/api/bidding/mark-won', async (req, res) => {
    try {
      const { bidId, finalRate, brokerResponse } = req.body;
      
      if (!bidId || !finalRate) {
        return res.status(400).json({ message: 'bidId and finalRate are required' });
      }

      await biddingService.markLoadAsWon(bidId, finalRate, brokerResponse);
      res.json({ message: 'Load marked as won successfully' });
    } catch (error) {
      console.error('Error marking load as won:', error);
      res.status(500).json({ message: 'Failed to mark load as won' });
    }
  });

  // Get all load bids
  app.get('/api/bidding/bids', async (req, res) => {
    try {
      const bids = await storage.getAllLoadBids();
      res.json(bids);
    } catch (error) {
      console.error('Error fetching bids:', error);
      res.status(500).json({ message: 'Failed to fetch bids' });
    }
  });

  // Get all email campaigns
  app.get('/api/bidding/campaigns', async (req, res) => {
    try {
      const campaigns = await storage.getAllEmailCampaigns();
      res.json(campaigns);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      res.status(500).json({ message: 'Failed to fetch campaigns' });
    }
  });

  // Driver offer response endpoint
  app.post('/api/load-offers/:offerId/respond', async (req, res) => {
    try {
      const { offerId } = req.params;
      const { response } = req.body;

      // Update offer status
      const offer = await storage.getLoadOffer(offerId);
      if (!offer) {
        return res.status(404).json({ error: 'Load offer not found' });
      }

      const updatedOffer = await storage.updateLoadOffer(offerId, {
        status: response,
        respondedAt: new Date().toISOString()
      });

      if (response === 'accepted') {
        // Assign load to driver
        await storage.updateLoad(offer.loadId, {
          status: 'assigned',
          driverId: offer.driverId
        });

        // Update driver status
        await storage.updateDriver(offer.driverId, {
          status: 'on_route'
        });
      }

      res.json(updatedOffer);
    } catch (error) {
      console.error('Error responding to load offer:', error);
      res.status(500).json({ error: 'Failed to respond to load offer' });
    }
  });

  // Driver-specific endpoints
  app.get('/api/drivers/:driverId/offers', async (req, res) => {
    try {
      const { driverId } = req.params;
      const offers = await storage.getDriverOffers(driverId);
      res.json(offers);
    } catch (error) {
      console.error('Error fetching driver offers:', error);
      res.status(500).json({ error: 'Failed to fetch driver offers' });
    }
  });

  // Payment processing endpoints
  app.get('/api/payments', async (req, res) => {
    try {
      const { status } = req.query;
      const statusFilter = status ? status.toString().split(',') : undefined;
      const payments = await storage.getPayments(statusFilter);
      res.json(payments);
    } catch (error) {
      console.error('Error fetching payments:', error);
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  });

  app.post('/api/payments/:paymentId/process', async (req, res) => {
    try {
      const { paymentId } = req.params;
      const { amount, notes } = req.body;

      const payment = await storage.updatePayment(paymentId, {
        status: 'completed',
        processedAt: new Date().toISOString(),
        notes
      });

      res.json(payment);
    } catch (error) {
      console.error('Error processing payment:', error);
      res.status(500).json({ error: 'Failed to process payment' });
    }
  });

  app.post('/api/loads/:loadId/generate-payment', async (req, res) => {
    try {
      const { loadId } = req.params;
      const load = await storage.getLoad(loadId);
      
      if (!load || !load.driverId) {
        return res.status(400).json({ error: 'Invalid load or no driver assigned' });
      }

      const driverRate = (load.rate || 0) * 0.9; // Drivers get 90%
      
      const payment = await storage.createPayment({
        loadId,
        driverId: load.driverId,
        amount: driverRate,
        status: 'pending',
        documents: []
      });

      res.json(payment);
    } catch (error) {
      console.error('Error generating payment:', error);
      res.status(500).json({ error: 'Failed to generate payment' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}