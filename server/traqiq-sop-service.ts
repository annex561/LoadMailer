import { storage } from './storage';
import { randomUUID } from 'crypto';
import type { LoadWithRelations, Driver } from '@shared/schema';

// TraqIQ SOP Step Definitions
export enum SOPStep {
  DRIVER_CONFIRMATION = 1,
  SEND_DISPATCH_INSTRUCTIONS = 2,
  IN_TRANSIT_TO_PICKUP = 3,
  ARRIVED_AT_PICKUP = 4,
  ANNEX_NOTIFIED = 5,
  PICKUP_DOCS_UPLOADED = 6,
  BROKER_CONFIRMED = 7,
  IN_TRANSIT_MONITORING = 8,
  REQUEST_DELIVERY_DOCS = 9,
  DRIVER_RELEASED = 10,
  DOCS_TO_EINSTEIN_AI = 11,
}

export const SOP_STEPS = [
  { step: 1, name: 'Driver Confirmation', description: 'Driver accepts load assignment' },
  { step: 2, name: 'Send Dispatch Instructions', description: 'System sends pickup details and compliance requirements' },
  { step: 3, name: 'In Transit to Pickup', description: 'GPS tracking active, monitoring driver en route to shipper' },
  { step: 4, name: 'Arrived at Pickup', description: 'Driver arrives at pickup location' },
  { step: 5, name: 'Annex Notified', description: 'System auto-alerts Annex team' },
  { step: 6, name: 'Pickup Docs Uploaded', description: 'Driver submits BOL + freight photos' },
  { step: 7, name: 'Broker Confirmed', description: 'Broker acknowledges pickup complete' },
  { step: 8, name: 'In Transit Monitoring', description: 'GPS tracking during haul, ETA updates' },
  { step: 9, name: 'Request Delivery Docs', description: 'System prompts for POD as driver approaches consignee' },
  { step: 10, name: 'Driver Released', description: 'Delivery confirmed, driver cleared' },
  { step: 11, name: 'Docs to Einstein AI', description: 'Documents processed for invoicing/records' },
];

export const TOTAL_STEPS = 11;

// Auto-messages for each step
export const AUTO_MESSAGES = {
  [SOPStep.SEND_DISPATCH_INSTRUCTIONS]: (load: LoadWithRelations, driver: Driver) => `
🚛 DISPATCH CONFIRMATION - LAMP Logistics

Load #${load.loadNumber}
📍 Pickup: ${load.pickupAddress}
📍 Delivery: ${load.deliveryAddress}
📅 Pickup: ${load.pickupDate} ${load.pickupTime || ''}
📅 Delivery: ${load.deliveryDate} ${load.deliveryTime || ''}

⚠️ COMPLIANCE REQUIREMENTS:
• Late delivery fee policy applies
• GPS tracking REQUIRED at all times
• Load locks/securement required
• Photo proof at pickup AND delivery (BOL/POD)
• Seal verification required
• Contact dispatch immediately for any issues

Reply CONFIRM to acknowledge these instructions.
  `.trim(),

  [SOPStep.ARRIVED_AT_PICKUP]: () => `
This is VJ from LAMP Logistics Support! Please send the pictures of the freight properly secured and the BOL (with printed name, sender signature, and check-in/check-out time) and WAIT for good to go.
  `.trim(),

  [SOPStep.REQUEST_DELIVERY_DOCS]: (load: LoadWithRelations) => `
📦 DELIVERY APPROACHING - Load #${load.loadNumber}

You're approaching the delivery location!

Please prepare:
• POD (Proof of Delivery) with signature
• Photos of offloaded freight
• Note any exceptions or damages

Send all docs when delivery is complete. DO NOT leave until confirmed!
  `.trim(),
};

const PICKUP_GEOFENCE_RADIUS = 200;
const DELIVERY_GEOFENCE_RADIUS = 200;

interface TraqIQSOPState {
  loadId: string;
  currentStep: SOPStep;
  stepHistory: Array<{
    step: SOPStep;
    timestamp: Date;
    triggeredBy: 'auto' | 'manual' | 'gps';
    notes?: string;
  }>;
  gpsTracking: {
    isActive: boolean;
    lastLocation?: { lat: number; lng: number; timestamp: Date };
    distanceToPickup?: number;
    distanceToDelivery?: number;
  };
  monitoring: {
    annexNotified: boolean;
    annexNotifiedAt?: Date;
    manualOverrideUsed: boolean;
  };
  documents: {
    bolUploaded: boolean;
    freightPhotosUploaded: boolean;
    podUploaded: boolean;
  };
}

const protocolStates = new Map<string, TraqIQSOPState>();

export class TraqIQSOPService {
  private smsService: any;

  constructor(smsService?: any) {
    this.smsService = smsService;
    console.log('🚛 TraqIQ SOP Service initialized');
  }

  async initializeProtocol(loadId: string): Promise<TraqIQSOPState> {
    const state: TraqIQSOPState = {
      loadId,
      currentStep: SOPStep.DRIVER_CONFIRMATION,
      stepHistory: [],
      gpsTracking: { isActive: false },
      monitoring: { annexNotified: false, manualOverrideUsed: false },
      documents: { bolUploaded: false, freightPhotosUploaded: false, podUploaded: false },
    };
    protocolStates.set(loadId, state);
    console.log(`🚛 TraqIQ SOP initialized for load ${loadId}`);
    return state;
  }

  getProtocolState(loadId: string): TraqIQSOPState | undefined {
    return protocolStates.get(loadId);
  }

  getStepInfo(step: SOPStep) {
    return SOP_STEPS.find(s => s.step === step);
  }

  async advanceStep(loadId: string, triggeredBy: 'auto' | 'manual' | 'gps' = 'auto', notes?: string): Promise<TraqIQSOPState | null> {
    const state = protocolStates.get(loadId);
    if (!state) return null;

    const load = await storage.getLoad(loadId);
    if (!load) return null;

    state.stepHistory.push({ step: state.currentStep, timestamp: new Date(), triggeredBy, notes });

    const nextStep = state.currentStep + 1;
    if (nextStep > TOTAL_STEPS) {
      console.log(`✅ TraqIQ SOP COMPLETE for load ${loadId}`);
      return state;
    }

    state.currentStep = nextStep as SOPStep;
    console.log(`🚛 Load ${loadId} → Step ${nextStep}: ${this.getStepInfo(nextStep)?.name}`);

    await this.executeStepActions(loadId, nextStep as SOPStep, load);
    protocolStates.set(loadId, state);
    return state;
  }

  private async executeStepActions(loadId: string, step: SOPStep, load: LoadWithRelations): Promise<void> {
    const state = protocolStates.get(loadId);
    if (!state) return;

    switch (step) {
      case SOPStep.SEND_DISPATCH_INSTRUCTIONS:
        if (load.driver && this.smsService) {
          const message = AUTO_MESSAGES[SOPStep.SEND_DISPATCH_INSTRUCTIONS](load, load.driver);
          await this.sendDriverMessage(load.driver, message);
        }
        break;

      case SOPStep.IN_TRANSIT_TO_PICKUP:
        state.gpsTracking.isActive = true;
        console.log(`📍 GPS tracking ON for load ${loadId}`);
        break;

      case SOPStep.ARRIVED_AT_PICKUP:
        if (load.driver && this.smsService) {
          const message = AUTO_MESSAGES[SOPStep.ARRIVED_AT_PICKUP]();
          await this.sendDriverMessage(load.driver, message);
        }
        break;

      case SOPStep.ANNEX_NOTIFIED:
        state.monitoring.annexNotified = true;
        state.monitoring.annexNotifiedAt = new Date();
        await this.notifyAnnexTeam(loadId, load);
        break;

      case SOPStep.REQUEST_DELIVERY_DOCS:
        if (load.driver && this.smsService) {
          const message = AUTO_MESSAGES[SOPStep.REQUEST_DELIVERY_DOCS](load);
          await this.sendDriverMessage(load.driver, message);
        }
        break;

      case SOPStep.DRIVER_RELEASED:
        state.gpsTracking.isActive = false;
        break;
    }
  }

  async confirmDriver(loadId: string, driverId: string): Promise<TraqIQSOPState | null> {
    const state = protocolStates.get(loadId);
    if (!state || state.currentStep !== SOPStep.DRIVER_CONFIRMATION) return null;
    return this.advanceStep(loadId, 'auto', `Driver ${driverId} confirmed`);
  }

  async processLocationUpdate(loadId: string, driverId: string, lat: number, lng: number): Promise<void> {
    const state = protocolStates.get(loadId);
    if (!state || !state.gpsTracking.isActive) return;

    const load = await storage.getLoad(loadId);
    if (!load) return;

    state.gpsTracking.lastLocation = { lat, lng, timestamp: new Date() };

    if (state.currentStep === SOPStep.IN_TRANSIT_TO_PICKUP) {
      const pickupCoords = await this.geocodeAddress(load.pickupAddress);
      if (pickupCoords) {
        const distance = this.calculateDistance(lat, lng, pickupCoords.lat, pickupCoords.lng);
        state.gpsTracking.distanceToPickup = distance;
        if (distance <= PICKUP_GEOFENCE_RADIUS) {
          await this.advanceStep(loadId, 'gps', `GPS: arrived at pickup (${distance}m)`);
        }
      }
    } else if (state.currentStep === SOPStep.IN_TRANSIT_MONITORING) {
      const deliveryCoords = await this.geocodeAddress(load.deliveryAddress);
      if (deliveryCoords) {
        const distance = this.calculateDistance(lat, lng, deliveryCoords.lat, deliveryCoords.lng);
        state.gpsTracking.distanceToDelivery = distance;
        if (distance <= 1609) {
          await this.advanceStep(loadId, 'gps', `GPS: approaching delivery (${distance}m)`);
        }
      }
    }
    protocolStates.set(loadId, state);
  }

  async manualOverride(loadId: string, action: 'confirm' | 'skip'): Promise<TraqIQSOPState | null> {
    const state = protocolStates.get(loadId);
    if (!state) return null;
    state.monitoring.manualOverrideUsed = true;
    if (action === 'confirm') return this.advanceStep(loadId, 'manual', 'Manual override by Annex');
    return state;
  }

  async handleDocumentUpload(loadId: string, docType: 'bol' | 'freight_photos' | 'pod'): Promise<void> {
    const state = protocolStates.get(loadId);
    if (!state) return;

    if (docType === 'bol') state.documents.bolUploaded = true;
    if (docType === 'freight_photos') state.documents.freightPhotosUploaded = true;
    if (docType === 'pod') state.documents.podUploaded = true;

    if (state.currentStep === SOPStep.PICKUP_DOCS_UPLOADED && state.documents.bolUploaded && state.documents.freightPhotosUploaded) {
      await this.advanceStep(loadId, 'auto', 'All pickup docs uploaded');
    }
    if (state.currentStep === SOPStep.REQUEST_DELIVERY_DOCS && state.documents.podUploaded) {
      await this.advanceStep(loadId, 'auto', 'POD uploaded');
    }
    protocolStates.set(loadId, state);
  }

  private async sendDriverMessage(driver: Driver, message: string): Promise<void> {
    if (!this.smsService || !driver.phone) {
      console.log(`[SMS] Would send to ${driver.name}: ${message.substring(0, 50)}...`);
      return;
    }
    try {
      await this.smsService.sendSMS(driver.phone, message);
      console.log(`📱 SMS sent to ${driver.name}`);
    } catch (error) {
      console.error(`❌ SMS failed:`, error);
    }
  }

  private async notifyAnnexTeam(loadId: string, load: LoadWithRelations): Promise<void> {
    const webhookUrl = process.env.ANNEX_WEBHOOK_URL || 'https://nextstephq.app/api/webhook';
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Load ${load.loadNumber}: Driver at pickup. Awaiting docs.`,
          title: `Load ${load.loadNumber} Update`,
          priority: 8,
        }),
      });
      console.log(`📢 Annex notified for load ${loadId}`);
    } catch (error) {
      console.error(`❌ Webhook failed:`, error);
    }
  }

  private async geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
        { headers: { 'User-Agent': 'TraqIQ/1.0' } }
      );
      const data = await response.json();
      if (data?.[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    } catch (error) {
      console.error(`Geocode error:`, error);
    }
    return null;
  }

  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  getProtocolStatus(loadId: string): object | null {
    const state = protocolStates.get(loadId);
    if (!state) return null;
    return {
      loadId,
      currentStep: state.currentStep,
      totalSteps: TOTAL_STEPS,
      currentStepName: this.getStepInfo(state.currentStep)?.name,
      steps: SOP_STEPS.map(step => ({
        ...step,
        status: step.step < state.currentStep ? 'complete' : step.step === state.currentStep ? 'current' : 'pending',
      })),
      gpsTracking: state.gpsTracking,
      monitoring: state.monitoring,
      documents: state.documents,
    };
  }

  getAllActiveProtocols(): object[] {
    const result: object[] = [];
    protocolStates.forEach((_, loadId) => {
      const status = this.getProtocolStatus(loadId);
      if (status) result.push(status);
    });
    return result;
  }
}

export const traqiqSopService = new TraqIQSOPService();
