import { type Driver, type InsertDriver, type Customer, type InsertCustomer, type Load, type InsertLoad, type LoadWithRelations, type EmailTemplate, type InsertEmailTemplate, type EmailLog, type InsertEmailLog, type EmailLogWithRelations, type OnboardingToken, type InsertOnboardingToken, type DriverLocation, type InsertDriverLocation, type DriverOnboarding, type ReportTemplate, type InsertReportTemplate, type ScraperConfig, type InsertScraperConfig, type ScraperLog, type InsertScraperLog, type LanePreference, type InsertLanePreference, type AvoidLocation, type InsertAvoidLocation, type TelegramBotConfig, type InsertTelegramBotConfig, type LoadOffer, type InsertLoadOffer, type LoadDocument, type InsertLoadDocument, type Geofence, type InsertGeofence, type GeofenceEvent, type InsertGeofenceEvent, type Route, type InsertRoute, type GpsDevice, type InsertGpsDevice, type LoadBoardSource, type InsertLoadBoardSource, type LoadBoardConfiguration, type InsertLoadBoardConfiguration, type ScrapedLoad, type InsertScrapedLoad, type ScraperConfiguration, type InsertScraperConfiguration, type LoadBid, type InsertLoadBid, type BidResponse, type InsertBidResponse, type EmailCampaign, type InsertEmailCampaign, type EmailFollowUp, type InsertEmailFollowUp, type DispatcherNotification, type InsertDispatcherNotification, type LoadBidWithRelations, type EmailCampaignWithFollowUps, type LoadCommunicationThread, type InsertLoadCommunicationThread, type LoadMessage, type InsertLoadMessage, type MessageAttachment, type InsertMessageAttachment, type QuickReplyTemplate, type InsertQuickReplyTemplate, type CommunicationLog, type InsertCommunicationLog, type User, type UpsertUser, type ZelloChannelMessage, type InsertZelloChannelMessage, type ZelloChannelStatus, type InsertZelloChannelStatus, type CommunicationInsights, type AiPerformanceMetrics, type DriverEngagementMetrics, type DocumentExtraction, type InsertDocumentExtraction, type ExtractionVerification, type InsertExtractionVerification } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Driver operations
  getDriver(id: string): Promise<Driver | undefined>;
  getAllDrivers(): Promise<Driver[]>;
  createDriver(driver: InsertDriver): Promise<Driver>;
  updateDriver(id: string, driver: Partial<InsertDriver>): Promise<Driver | undefined>;
  deleteDriver(id: string): Promise<boolean>;
  findDuplicateDrivers(name: string, email: string, phone: string): Promise<Driver[]>;
  getDriverByNameOrPhone(nameOrPhone: string): Promise<Driver | undefined>;
  
  // Driver mood tracking
  updateDriverMood(driverId: string, mood: string, note?: string): Promise<Driver | undefined>;
  
  // GPS tracking token operations
  generateTrackingToken(driverId: string): Promise<{ token: string } | undefined>;
  validateTrackingToken(driverId: string, token: string): Promise<boolean>;

  // Customer operations
  getCustomer(id: string): Promise<Customer | undefined>;
  getAllCustomers(): Promise<Customer[]>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: string, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: string): Promise<boolean>;
  findDuplicateCustomers(name: string, email: string, phone: string): Promise<Customer[]>;

  // Load operations
  getLoad(id: string): Promise<LoadWithRelations | undefined>;
  getAllLoads(): Promise<LoadWithRelations[]>;
  createLoad(load: InsertLoad): Promise<LoadWithRelations>;
  updateLoad(id: string, load: Partial<InsertLoad>): Promise<LoadWithRelations | undefined>;
  deleteLoad(id: string): Promise<boolean>;
  getLoadsByStatus(status: string): Promise<LoadWithRelations[]>;
  getLoadsByDriver(driverId: string): Promise<LoadWithRelations[]>;
  getLoadByNumber(loadNumber: string): Promise<LoadWithRelations | undefined>;
  getMostRecentLoadForDriver(driverId: string): Promise<LoadWithRelations | undefined>;

  // Email template operations
  getEmailTemplate(id: string): Promise<EmailTemplate | undefined>;
  getAllEmailTemplates(): Promise<EmailTemplate[]>;
  createEmailTemplate(template: InsertEmailTemplate): Promise<EmailTemplate>;
  updateEmailTemplate(id: string, template: Partial<InsertEmailTemplate>): Promise<EmailTemplate | undefined>;
  deleteEmailTemplate(id: string): Promise<boolean>;
  getEmailTemplatesByTrigger(trigger: string): Promise<EmailTemplate[]>;

  // Email log operations
  getEmailLog(id: string): Promise<EmailLogWithRelations | undefined>;
  getAllEmailLogs(): Promise<EmailLogWithRelations[]>;
  createEmailLog(log: InsertEmailLog): Promise<EmailLog>;
  updateEmailLog(id: string, log: Partial<InsertEmailLog>): Promise<EmailLog | undefined>;
  getEmailLogsByLoad(loadId: string): Promise<EmailLogWithRelations[]>;

  // Onboarding token operations
  createOnboardingToken(token: InsertOnboardingToken): Promise<OnboardingToken>;
  getOnboardingToken(token: string): Promise<OnboardingToken | undefined>;
  getAllOnboardingTokens(): Promise<OnboardingToken[]>;
  markTokenAsUsed(token: string): Promise<boolean>;

  // Driver location operations
  createDriverLocation(location: InsertDriverLocation): Promise<DriverLocation>;
  updateDriverLocation(id: string, location: Partial<InsertDriverLocation>): Promise<DriverLocation | undefined>;
  getDriverCurrentLocation(driverId: string): Promise<DriverLocation | undefined>;
  getDriverLocationHistory(driverId: string): Promise<DriverLocation[]>;
  getDriverLocations(driverId: string, limit?: number): Promise<DriverLocation[]>;
  getAllCurrentDriverLocations(): Promise<DriverLocation[]>;
  cleanupOldDriverLocations(driverId: string, keepCount: number): Promise<void>;
  
  // Additional methods for real driver location service
  getDrivers(): Promise<Driver[]>;

  // GPS Device operations
  getGpsDevice(id: string): Promise<GpsDevice | undefined>;
  getAllGpsDevices(): Promise<GpsDevice[]>;
  createGpsDevice(device: InsertGpsDevice): Promise<GpsDevice>;
  updateGpsDevice(id: string, device: Partial<InsertGpsDevice>): Promise<GpsDevice | undefined>;
  getGpsDeviceByDriver(driverId: string): Promise<GpsDevice | undefined>;

  // Geofence operations
  getGeofence(id: string): Promise<Geofence | undefined>;
  getAllGeofences(): Promise<Geofence[]>;
  getActiveGeofences(): Promise<Geofence[]>;
  createGeofence(geofence: InsertGeofence): Promise<Geofence>;
  updateGeofence(id: string, geofence: Partial<InsertGeofence>): Promise<Geofence | undefined>;
  deleteGeofence(id: string): Promise<boolean>;

  // Geofence event operations
  getGeofenceEvent(id: string): Promise<GeofenceEvent | undefined>;
  createGeofenceEvent(event: InsertGeofenceEvent): Promise<GeofenceEvent>;
  getRecentGeofenceEvents(driverId: string, geofenceId: string, limit: number): Promise<GeofenceEvent[]>;
  getDriverGeofenceEvents(driverId: string, hoursBack: number): Promise<GeofenceEvent[]>;

  // Route operations
  getRoute(id: string): Promise<Route | undefined>;
  getAllRoutes(): Promise<Route[]>;
  getActiveRoutes(): Promise<Route[]>;
  createRoute(route: InsertRoute): Promise<Route>;
  updateRoute(id: string, route: Partial<InsertRoute>): Promise<Route | undefined>;
  getActiveRouteForDriver(driverId: string): Promise<Route | undefined>;
  deleteRoute(id: string): Promise<boolean>;

  // Driver onboarding
  completeDriverOnboarding(data: DriverOnboarding, token: string): Promise<Driver>;

  // Scraper configuration operations
  getScraperConfig(id: string): Promise<ScraperConfig | undefined>;
  getAllScraperConfigs(): Promise<ScraperConfig[]>;
  createScraperConfig(config: InsertScraperConfig): Promise<ScraperConfig>;
  updateScraperConfig(id: string, config: Partial<InsertScraperConfig>): Promise<ScraperConfig | undefined>;
  deleteScraperConfig(id: string): Promise<boolean>;

  // Scraper log operations
  getScraperLog(id: string): Promise<ScraperLog | undefined>;
  getAllScraperLogs(): Promise<ScraperLog[]>;
  createScraperLog(log: InsertScraperLog): Promise<ScraperLog>;
  updateScraperLog(id: string, log: Partial<InsertScraperLog>): Promise<ScraperLog | undefined>;
  getScraperLogsByConfig(configId: string): Promise<ScraperLog[]>;

  // Telegram bot operations
  getTelegramBotConfig(id: string): Promise<TelegramBotConfig | undefined>;
  getAllTelegramBotConfigs(): Promise<TelegramBotConfig[]>;
  createTelegramBotConfig(config: InsertTelegramBotConfig): Promise<TelegramBotConfig>;
  updateTelegramBotConfig(id: string, config: Partial<InsertTelegramBotConfig>): Promise<TelegramBotConfig | undefined>;
  
  // Lane preference operations
  getLanePreference(id: string): Promise<LanePreference | undefined>;
  getAllLanePreferences(): Promise<LanePreference[]>;
  createLanePreference(pref: InsertLanePreference): Promise<LanePreference>;
  updateLanePreference(id: string, pref: Partial<InsertLanePreference>): Promise<LanePreference | undefined>;
  deleteLanePreference(id: string): Promise<boolean>;
  
  // Avoid location operations
  getAvoidLocation(id: string): Promise<AvoidLocation | undefined>;
  getAllAvoidLocations(): Promise<AvoidLocation[]>;
  createAvoidLocation(location: InsertAvoidLocation): Promise<AvoidLocation>;
  updateAvoidLocation(id: string, location: Partial<InsertAvoidLocation>): Promise<AvoidLocation | undefined>;
  deleteAvoidLocation(id: string): Promise<boolean>;
  
  // Load offer operations
  getLoadOffer(id: string): Promise<LoadOffer | undefined>;
  getAllLoadOffers(): Promise<LoadOffer[]>;
  getLoadOffers(loadId: string): Promise<LoadOffer[]>;
  createLoadOffer(offer: InsertLoadOffer): Promise<LoadOffer>;
  updateLoadOffer(id: string, offer: Partial<InsertLoadOffer>): Promise<LoadOffer | undefined>;
  getLoadOfferByLoadAndDriver(loadId: string, driverId: string): Promise<LoadOffer | undefined>;
  updateLoadOfferByLoadAndDriver(loadId: string, driverId: string, offer: Partial<InsertLoadOffer>): Promise<LoadOffer | undefined>;
  
  // Driver telegram operations
  getDriverByTelegramId(telegramId: string): Promise<Driver | undefined>;
  getDriversWithTelegramEnabled(): Promise<Driver[]>;

  // Load offer statistics operations
  getLoadOffersByDriver(driverId: string): Promise<LoadOffer[]>;
  getLoadOffersWithDetails(): Promise<LoadOffer[]>;
  getDriverLoadOfferStats(driverId: string): Promise<{driverId: string; driverName: string; totalOffers: number; accepted: number; declined: number; timeout: number; pending: number}>;
  getAllDriverLoadOfferStats(): Promise<{driverId: string; driverName: string; totalOffers: number; accepted: number; declined: number; timeout: number; pending: number}[]>;
  
  // Load offer statistics
  getLoadOffersByDriver(driverId: string): Promise<LoadOffer[]>;
  getLoadOffersWithDetails(): Promise<(LoadOffer & { load: LoadWithRelations; driver: Driver })[]>;
  getDriverLoadOfferStats(driverId: string): Promise<{driverId: string; driverName: string; totalOffers: number; accepted: number; declined: number; timeout: number; pending: number}>;
  getAllDriverLoadOfferStats(): Promise<{driverId: string; driverName: string; totalOffers: number; accepted: number; declined: number; timeout: number; pending: number}[]>;

  // Load Board Source operations
  getLoadBoardSource(id: string): Promise<LoadBoardSource | undefined>;
  getAllLoadBoardSources(): Promise<LoadBoardSource[]>;
  createLoadBoardSource(source: InsertLoadBoardSource): Promise<LoadBoardSource>;
  updateLoadBoardSource(id: string, source: Partial<InsertLoadBoardSource>): Promise<LoadBoardSource | undefined>;
  deleteLoadBoardSource(id: string): Promise<boolean>;

  // Load Board Configuration operations
  getLoadBoardConfiguration(id: string): Promise<LoadBoardConfiguration | undefined>;
  getAllLoadBoardConfigurations(): Promise<LoadBoardConfiguration[]>;
  getEnabledLoadBoardConfigurations(): Promise<LoadBoardConfiguration[]>;
  createLoadBoardConfiguration(config: InsertLoadBoardConfiguration): Promise<LoadBoardConfiguration>;
  updateLoadBoardConfiguration(id: string, config: Partial<InsertLoadBoardConfiguration>): Promise<LoadBoardConfiguration | undefined>;
  deleteLoadBoardConfiguration(id: string): Promise<boolean>;

  // Scraped Load operations
  getScrapedLoad(id: string): Promise<ScrapedLoad | undefined>;
  getAllScrapedLoads(): Promise<ScrapedLoad[]>;
  getRecentScrapedLoads(hours: number): Promise<ScrapedLoad[]>;
  getScrapedLoadByExternalId(sourceId: string, externalId: string): Promise<ScrapedLoad | undefined>;
  createScrapedLoad(load: InsertScrapedLoad): Promise<ScrapedLoad>;
  updateScrapedLoad(externalId: string, sourceId: string, load: Partial<InsertScrapedLoad>): Promise<ScrapedLoad | undefined>;
  deleteScrapedLoad(id: string): Promise<boolean>;
  getMatchedScrapedLoads(): Promise<ScrapedLoad[]>;
  getScrapedLoadsBySource(sourceId: string): Promise<ScrapedLoad[]>;

  // Scraper Configuration operations
  getScraperConfiguration(id: string): Promise<ScraperConfiguration | undefined>;
  getAllScraperConfigurations(): Promise<ScraperConfiguration[]>;
  getEnabledScraperConfigurations(): Promise<ScraperConfiguration[]>;
  createScraperConfiguration(config: InsertScraperConfiguration): Promise<ScraperConfiguration>;
  updateScraperConfiguration(id: string, config: Partial<InsertScraperConfiguration>): Promise<ScraperConfiguration | undefined>;
  deleteScraperConfiguration(id: string): Promise<boolean>;

  // Driver availability operations
  getAvailableDrivers(): Promise<Driver[]>;

  // Load Bidding operations
  getLoadBid(id: string): Promise<LoadBid | undefined>;
  getAllLoadBids(): Promise<LoadBid[]>;
  createLoadBid(bid: InsertLoadBid): Promise<LoadBid>;
  updateLoadBid(id: string, bid: Partial<InsertLoadBid>): Promise<LoadBid | undefined>;
  deleteLoadBid(id: string): Promise<boolean>;
  getExpiredBids(): Promise<LoadBid[]>;
  getDriverTimeoutBids(timeoutMinutes: number): Promise<LoadBid[]>;

  // Bid Response operations
  getBidResponse(id: string): Promise<BidResponse | undefined>;
  getAllBidResponses(): Promise<BidResponse[]>;
  createBidResponse(response: InsertBidResponse): Promise<BidResponse>;
  updateBidResponse(id: string, response: Partial<InsertBidResponse>): Promise<BidResponse | undefined>;
  getBidResponsesByBid(bidId: string): Promise<BidResponse[]>;
  getBidResponsesByDriver(driverId: string): Promise<BidResponse[]>;

  // Email Campaign operations
  getEmailCampaign(id: string): Promise<EmailCampaign | undefined>;
  getAllEmailCampaigns(): Promise<EmailCampaign[]>;
  getActiveCampaigns(): Promise<EmailCampaign[]>;
  createEmailCampaign(campaign: InsertEmailCampaign): Promise<EmailCampaign>;
  updateEmailCampaign(id: string, campaign: Partial<InsertEmailCampaign>): Promise<EmailCampaign | undefined>;
  deleteEmailCampaign(id: string): Promise<boolean>;

  // Email Follow-Up operations
  getEmailFollowUp(id: string): Promise<EmailFollowUp | undefined>;
  getAllEmailFollowUps(): Promise<EmailFollowUp[]>;
  createEmailFollowUp(followUp: InsertEmailFollowUp): Promise<EmailFollowUp>;
  updateEmailFollowUp(id: string, followUp: Partial<InsertEmailFollowUp>): Promise<EmailFollowUp | undefined>;
  getEmailFollowUpsByCampaign(campaignId: string): Promise<EmailFollowUp[]>;

  // Dispatcher Notification operations
  getDispatcherNotification(id: string): Promise<DispatcherNotification | undefined>;
  getAllDispatcherNotifications(): Promise<DispatcherNotification[]>;
  createDispatcherNotification(notification: InsertDispatcherNotification): Promise<DispatcherNotification>;
  updateDispatcherNotification(id: string, notification: Partial<InsertDispatcherNotification>): Promise<DispatcherNotification | undefined>;
  getDispatcherNotificationsByBid(bidId: string): Promise<DispatcherNotification[]>;

  // Load Document operations
  createLoadDocument(data: InsertLoadDocument): Promise<LoadDocument>;
  getLoadDocument(id: string): Promise<LoadDocument | null>;
  getLoadDocumentsByLoad(loadId: string): Promise<LoadDocument[]>;
  getLoadDocumentsByDriver(driverId: string): Promise<LoadDocument[]>;
  getLoadDocumentsByType(loadId: string, documentType: string): Promise<LoadDocument[]>;
  updateLoadDocument(id: string, data: Partial<InsertLoadDocument>): Promise<LoadDocument | null>;
  deleteLoadDocument(id: string): Promise<boolean>;

  // Load Document operations
  getLoadDocument(id: string): Promise<LoadDocument | undefined>;
  getAllLoadDocuments(): Promise<LoadDocument[]>;
  getLoadDocumentsByLoad(loadId: string): Promise<LoadDocument[]>;
  getLoadDocumentsByDriver(driverId: string): Promise<LoadDocument[]>;
  getLoadDocumentsByType(loadId: string, documentType: string): Promise<LoadDocument[]>;
  createLoadDocument(document: InsertLoadDocument): Promise<LoadDocument>;
  updateLoadDocument(id: string, document: Partial<InsertLoadDocument>): Promise<LoadDocument | undefined>;
  deleteLoadDocument(id: string): Promise<boolean>;
  
  // Enhanced Load Document operations - Professional document approval workflow
  approveDocument(documentId: string, approverId: string, notes?: string): Promise<LoadDocument | undefined>;
  rejectDocument(documentId: string, rejectedBy: string, reason: string): Promise<LoadDocument | undefined>;
  getDocumentsByLoad(loadId: string, includeRejected?: boolean): Promise<LoadDocument[]>;
  getRequiredDocuments(loadId: string): Promise<LoadDocument[]>;
  getDocumentAuditLog(documentId: string): Promise<LoadDocument[]>;
  recategorizeDocument(documentId: string, newCategory: string): Promise<LoadDocument | undefined>;
  getAllDocuments(): Promise<any[]>; // Returns documents with load details
  createDocument(data: Partial<InsertLoadDocument>): Promise<LoadDocument>;

  // AI Document Extraction operations
  createDocumentExtraction(data: InsertDocumentExtraction): Promise<DocumentExtraction>;
  getDocumentExtraction(id: string): Promise<DocumentExtraction | undefined>;
  getExtractionByDocumentId(documentId: string): Promise<DocumentExtraction | undefined>;
  updateExtractionVerification(id: string, verifiedBy: string, verifiedAt: Date): Promise<DocumentExtraction | undefined>;
  createExtractionVerification(data: InsertExtractionVerification): Promise<ExtractionVerification>;
  getExtractionVerifications(extractionId: string): Promise<ExtractionVerification[]>;

  // Load Communication Thread operations
  getLoadCommunicationThread(id: string): Promise<LoadCommunicationThread | undefined>;
  getLoadCommunicationThreadByLoad(loadId: string): Promise<LoadCommunicationThread | undefined>;
  getLoadCommunicationThreadByLoadAndDriver(loadId: string, driverId: string): Promise<LoadCommunicationThread | undefined>;
  getGeneralCommunicationThreadByDriver(driverId: string): Promise<LoadCommunicationThread | undefined>;
  getUnifiedThreadByDriver(driverId: string): Promise<LoadCommunicationThread | undefined>;
  getAllLoadCommunicationThreads(): Promise<LoadCommunicationThread[]>;
  createLoadCommunicationThread(thread: InsertLoadCommunicationThread): Promise<LoadCommunicationThread>;
  updateLoadCommunicationThread(id: string, thread: Partial<InsertLoadCommunicationThread>): Promise<LoadCommunicationThread | undefined>;
  deleteLoadCommunicationThread(id: string): Promise<boolean>;
  acceptLoadOffer(threadId: string, loadId: string): Promise<boolean>;
  consolidateDuplicateThreadsForDriver(driverId: string): Promise<{ merged: number; canonical: LoadCommunicationThread | null }>;
  consolidateAllDuplicateThreads(): Promise<{ totalDrivers: number; totalMerged: number }>;

  // Load Message operations
  getLoadMessage(id: string): Promise<LoadMessage | undefined>;
  getLoadMessagesByThread(threadId: string): Promise<LoadMessage[]>;
  getLoadMessagesByLoad(loadId: string): Promise<LoadMessage[]>;
  createLoadMessage(message: InsertLoadMessage): Promise<LoadMessage>;
  updateLoadMessage(id: string, message: Partial<InsertLoadMessage>): Promise<LoadMessage | undefined>;
  markMessageAsRead(messageId: string): Promise<boolean>;
  getUnreadMessagesForDriver(driverId: string): Promise<LoadMessage[]>;
  getUnreadMessagesForDispatch(): Promise<LoadMessage[]>;

  // Message Attachment operations
  getMessageAttachment(id: string): Promise<MessageAttachment | undefined>;
  getMessageAttachmentsByMessage(messageId: string): Promise<MessageAttachment[]>;
  getMessageAttachmentsByLoad(loadId: string): Promise<MessageAttachment[]>;
  getMessageAttachmentsByDriver(driverId: string): Promise<MessageAttachment[]>;
  getMessageAttachmentsByCategory(loadId: string, category: string): Promise<MessageAttachment[]>;
  getPendingReviewAttachments(): Promise<MessageAttachment[]>;
  createMessageAttachment(attachment: InsertMessageAttachment): Promise<MessageAttachment>;
  updateMessageAttachment(id: string, attachment: Partial<InsertMessageAttachment>): Promise<MessageAttachment | undefined>;
  approveMessageAttachment(id: string, reviewerId: string, notes?: string): Promise<MessageAttachment | undefined>;
  rejectMessageAttachment(id: string, reviewerId: string, notes: string): Promise<MessageAttachment | undefined>;
  deleteMessageAttachment(id: string): Promise<boolean>;

  // Quick Reply Template operations
  getQuickReplyTemplate(id: string): Promise<QuickReplyTemplate | undefined>;
  getAllQuickReplyTemplates(): Promise<QuickReplyTemplate[]>;
  getActiveQuickReplyTemplates(): Promise<QuickReplyTemplate[]>;
  getQuickReplyTemplatesForDriver(): Promise<QuickReplyTemplate[]>;
  getQuickReplyTemplatesForDispatch(): Promise<QuickReplyTemplate[]>;
  createQuickReplyTemplate(template: InsertQuickReplyTemplate): Promise<QuickReplyTemplate>;
  updateQuickReplyTemplate(id: string, template: Partial<InsertQuickReplyTemplate>): Promise<QuickReplyTemplate | undefined>;
  deleteQuickReplyTemplate(id: string): Promise<boolean>;

  // Communication Log operations
  getCommunicationLog(id: string): Promise<CommunicationLog | undefined>;
  getCommunicationLogsByLoad(loadId: string): Promise<CommunicationLog[]>;
  getCommunicationLogsByThread(threadId: string): Promise<CommunicationLog[]>;
  createCommunicationLog(log: InsertCommunicationLog): Promise<CommunicationLog>;

  // AI Assistant Communication operations
  getSuggestedMessages(threadId: string): Promise<LoadMessage[]>;
  approveSuggestedMessage(messageId: string, approverId: string): Promise<LoadMessage | undefined>;
  rejectSuggestedMessage(messageId: string): Promise<boolean>;
  updateThreadAiConfig(threadId: string, config: {
    assistantEnabled?: boolean;
    assistantMode?: 'suggest' | 'autosend' | 'off';
    autoSendConfidence?: number;
    systemPrompt?: string;
  }): Promise<LoadCommunicationThread | undefined>;
  getMessagesForContext(threadId: string, limit?: number): Promise<LoadMessage[]>;

  // Communication Analytics operations
  getCommunicationInsights(startDate: Date, endDate: Date, insightType?: string): Promise<CommunicationInsights[]>;
  getAIPerformanceMetrics(startDate: Date, endDate: Date, driverId?: string, threadId?: string): Promise<AiPerformanceMetrics[]>;
  getDriverEngagementMetrics(startDate: Date, endDate: Date, driverId?: string): Promise<DriverEngagementMetrics[]>;

  // User operations - REQUIRED for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;

  // Zello Channel Operations
  createZelloChannelMessage(message: InsertZelloChannelMessage): Promise<ZelloChannelMessage>;
  getZelloChannelMessages(channel: string, limit?: number): Promise<ZelloChannelMessage[]>;
  getUnreadZelloMessages(channel: string): Promise<ZelloChannelMessage[]>;
  markZelloMessagesAsRead(channel: string, messageIds: string[]): Promise<number>;
  getZelloChannelStatus(channel: string): Promise<ZelloChannelStatus | null>;
  createOrUpdateZelloChannelStatus(status: InsertZelloChannelStatus): Promise<ZelloChannelStatus>;
  updateZelloChannelUnreadCount(channel: string, delta: number): Promise<ZelloChannelStatus | null>;
  getAllZelloChannelStatuses(): Promise<ZelloChannelStatus[]>;
  getZelloMessageById(id: string): Promise<ZelloChannelMessage | null>;
}

export class MemStorage implements IStorage {
  private drivers: Map<string, Driver> = new Map();
  private customers: Map<string, Customer> = new Map();
  private loads: Map<string, Load> = new Map();
  private emailTemplates: Map<string, EmailTemplate> = new Map();
  private emailLogs: Map<string, EmailLog> = new Map();
  private onboardingTokens: Map<string, OnboardingToken> = new Map();
  private driverLocations: Map<string, DriverLocation> = new Map();
  private scraperConfigs: Map<string, ScraperConfig> = new Map();
  private scraperLogs: Map<string, ScraperLog> = new Map();
  private telegramBotConfigs: Map<string, TelegramBotConfig> = new Map();
  private lanePreferences: Map<string, LanePreference> = new Map();
  private avoidLocations: Map<string, AvoidLocation> = new Map();
  private loadOffers: Map<string, LoadOffer> = new Map();
  private geofences: Map<string, Geofence> = new Map();
  private geofenceEvents: Map<string, GeofenceEvent> = new Map();
  private routes: Map<string, Route> = new Map();
  private gpsDevices: Map<string, GpsDevice> = new Map();
  private loadBoardSources: Map<string, LoadBoardSource> = new Map();
  private loadBoardConfigurations: Map<string, LoadBoardConfiguration> = new Map();
  private scrapedLoads: Map<string, ScrapedLoad> = new Map();
  private scraperConfigurations: Map<string, ScraperConfiguration> = new Map();
  private loadBids: Map<string, LoadBid> = new Map();
  private bidResponses: Map<string, BidResponse> = new Map();
  private emailCampaigns: Map<string, EmailCampaign> = new Map();
  private emailFollowUps: Map<string, EmailFollowUp> = new Map();
  private dispatcherNotifications: Map<string, DispatcherNotification> = new Map();
  private loadDocuments: Map<string, LoadDocument> = new Map();
  private zelloChannelMessages: Map<string, ZelloChannelMessage> = new Map();
  private zelloChannelStatuses: Map<string, ZelloChannelStatus> = new Map();
  private loadCounter = 1;

  constructor() {
    this.initializeDefaultData();
  }

  private initializeDefaultData() {
    // Create default drivers
    const driver1: Driver = {
      id: randomUUID(),
      name: "Mike Johnson",
      email: "mike.johnson@company.com",
      phone: "(555) 123-4567",
      status: "available",
      licenseNumber: "DL12345678",
      emergencyContact: "Jane Johnson",
      emergencyPhone: "(555) 987-6543",
      isOnboarded: true,
      telegramId: null,
      telegramUsername: null,
      city: null,
      enableTelegramNotifications: false,
      createdAt: new Date(),
    };
    
    const driver2: Driver = {
      id: randomUUID(),
      name: "Sarah Williams",
      email: "sarah.williams@company.com",
      phone: "(555) 987-6543",
      status: "on_route",
      licenseNumber: "DL87654321",
      emergencyContact: "John Williams",
      emergencyPhone: "(555) 321-0987",
      isOnboarded: true,
      telegramId: null,
      telegramUsername: null,
      city: null,
      enableTelegramNotifications: false,
      createdAt: new Date(),
    };

    this.drivers.set(driver1.id, driver1);
    this.drivers.set(driver2.id, driver2);

    // Create default customers
    const customer1: Customer = {
      id: randomUUID(),
      name: "ABC Manufacturing",
      contactPerson: "John Smith",
      email: "contact@abcmfg.com",
      phone: "(555) 234-5678",
      address: "1234 Industrial Blvd, Chicago, IL 60601",
      status: "active",
      createdAt: new Date(),
    };

    const customer2: Customer = {
      id: randomUUID(),
      name: "XYZ Logistics",
      contactPerson: "Maria Garcia",
      email: "orders@xyzlog.com",
      phone: "(555) 876-5432",
      address: "9876 Commerce Ave, Dallas, TX 75201",
      status: "active",
      createdAt: new Date(),
    };

    this.customers.set(customer1.id, customer1);
    this.customers.set(customer2.id, customer2);

    // Create default email templates
    const template1: EmailTemplate = {
      id: randomUUID(),
      name: "Load Assignment",
      description: "Notification sent to drivers when a new load is assigned",
      trigger: "load_created",
      recipients: "driver",
      subject: "New Load Assignment - {{loadNumber}}",
      body: "Hello {{driverName}},\n\nYou have been assigned a new load:\n\nLoad Number: {{loadNumber}}\nCustomer: {{customerName}}\nPickup: {{pickupAddress}} on {{pickupDate}} at {{pickupTime}}\nDelivery: {{deliveryAddress}} on {{deliveryDate}} at {{deliveryTime}}\n\nSpecial Instructions: {{specialInstructions}}\n\nPlease confirm receipt of this assignment.\n\nBest regards,\nTRAQ IQ Team",
      isActive: true,
      createdAt: new Date(),
    };

    const template2: EmailTemplate = {
      id: randomUUID(),
      name: "Pickup Confirmation",
      description: "Sent to customer when driver confirms pickup",
      trigger: "pickup_confirmed",
      recipients: "customer",
      subject: "Pickup Confirmed - {{loadNumber}}",
      body: "Dear {{customerContactPerson}},\n\nWe're pleased to confirm that your shipment has been picked up:\n\nLoad Number: {{loadNumber}}\nPickup Time: {{currentTime}}\nDriver: {{driverName}} - {{driverPhone}}\nExpected Delivery: {{deliveryDate}} at {{deliveryTime}}\n\nYou can track your shipment status through our system.\n\nThank you for choosing our services.\n\nBest regards,\nTRAQ IQ Team",
      isActive: true,
      createdAt: new Date(),
    };

    const template3: EmailTemplate = {
      id: randomUUID(),
      name: "Delivery Complete",
      description: "Confirmation sent when delivery is completed",
      trigger: "delivered",
      recipients: "both",
      subject: "Delivery Complete - {{loadNumber}}",
      body: "Hello,\n\nWe're happy to confirm that the delivery has been completed successfully:\n\nLoad Number: {{loadNumber}}\nDelivery Time: {{currentTime}}\nDelivery Address: {{deliveryAddress}}\n\nThank you for your business.\n\nBest regards,\nTRAQ IQ Team",
      isActive: true,
      createdAt: new Date(),
    };

    this.emailTemplates.set(template1.id, template1);
    this.emailTemplates.set(template2.id, template2);
    this.emailTemplates.set(template3.id, template3);
  }

  // Driver operations
  async getDriver(id: string): Promise<Driver | undefined> {
    return this.drivers.get(id);
  }

  async getAllDrivers(): Promise<Driver[]> {
    const drivers = Array.from(this.drivers.values());
    console.log(`📋 Storage returned ${drivers.length} drivers:`, drivers.map(d => `${d.name} (${d.id})`));
    return drivers;
  }

  async createDriver(insertDriver: InsertDriver): Promise<Driver> {
    const id = randomUUID();
    const driver: Driver = {
      ...insertDriver,
      id,
      status: insertDriver.status || "available",
      licenseNumber: insertDriver.licenseNumber || null,
      emergencyContact: insertDriver.emergencyContact || null,
      emergencyPhone: insertDriver.emergencyPhone || null,
      isOnboarded: insertDriver.isOnboarded || false,
      telegramId: insertDriver.telegramId || null,
      telegramUsername: insertDriver.telegramUsername || null,
      city: insertDriver.city || null,
      enableTelegramNotifications: insertDriver.enableTelegramNotifications || false,
      createdAt: new Date(),
    };
    this.drivers.set(id, driver);
    return driver;
  }

  async updateDriver(id: string, updates: Partial<InsertDriver>): Promise<Driver | undefined> {
    try {
      // First try to update in database
      const { db } = await import('./db');
      const { drivers } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      const result = await db.update(drivers)
        .set(updates)
        .where(eq(drivers.id, id))
        .returning();
      
      if (result.length > 0) {
        const updated = result[0];
        // Update memory cache
        this.drivers.set(id, updated);
        console.log(`Driver ${updated.name} status updated to: ${updated.status}`);
        return updated;
      }
    } catch (error) {
      console.error('Error updating driver in database:', error);
    }
    
    // Fallback to memory-only update
    const driver = this.drivers.get(id);
    if (!driver) return undefined;

    const updatedDriver = { ...driver, ...updates };
    this.drivers.set(id, updatedDriver);
    console.log(`Driver ${updatedDriver.name} status updated in memory to: ${updatedDriver.status}`);
    return updatedDriver;
  }

  async updateDriverMood(driverId: string, mood: string, note?: string): Promise<Driver | undefined> {
    try {
      // First try to update in database
      const { db } = await import('./db');
      const { drivers } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      
      const result = await db.update(drivers)
        .set({
          currentMood: mood,
          moodUpdatedAt: new Date(),
          moodNote: note || null,
        })
        .where(eq(drivers.id, driverId))
        .returning();
      
      if (result.length > 0) {
        const updated = result[0];
        // Update memory cache
        this.drivers.set(driverId, updated);
        console.log(`Driver ${updated.name} mood updated to: ${mood}`);
        return updated;
      }
    } catch (error) {
      console.error('Error updating driver mood in database:', error);
    }
    
    // Fallback to memory-only update
    const driver = this.drivers.get(driverId);
    if (!driver) return undefined;

    const updatedDriver = { 
      ...driver, 
      currentMood: mood,
      moodUpdatedAt: new Date(),
      moodNote: note || null,
    };
    this.drivers.set(driverId, updatedDriver);
    console.log(`Driver ${updatedDriver.name} mood updated in memory to: ${mood}`);
    return updatedDriver;
  }

  async deleteDriver(id: string): Promise<boolean> {
    return this.drivers.delete(id);
  }

  async findDuplicateDrivers(name: string, email: string, phone: string): Promise<Driver[]> {
    try {
      // First check database
      const { db } = await import('./db');
      const { drivers } = await import('@shared/schema');
      const { or, ilike, eq } = await import('drizzle-orm');
      
      const dbDrivers = await db.select().from(drivers).where(
        or(
          ilike(drivers.name, name),
          eq(drivers.email, email),
          eq(drivers.phone, phone)
        )
      );
      
      if (dbDrivers.length > 0) {
        return dbDrivers;
      }
    } catch (error) {
      console.log('Database not available, checking in-memory storage');
    }
    
    // Fallback to in-memory check
    const duplicates: Driver[] = [];
    for (const driver of this.drivers.values()) {
      if (driver.name.toLowerCase() === name.toLowerCase() || 
          driver.email.toLowerCase() === email.toLowerCase() || 
          driver.phone === phone) {
        duplicates.push(driver);
      }
    }
    return duplicates;
  }

  // Customer operations
  async getCustomer(id: string): Promise<Customer | undefined> {
    return this.customers.get(id);
  }

  async getAllCustomers(): Promise<Customer[]> {
    return Array.from(this.customers.values());
  }

  async createCustomer(insertCustomer: InsertCustomer): Promise<Customer> {
    const id = randomUUID();
    const customer: Customer = {
      ...insertCustomer,
      id,
      status: insertCustomer.status || "active",
      createdAt: new Date(),
    };
    this.customers.set(id, customer);
    return customer;
  }

  async updateCustomer(id: string, updates: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const customer = this.customers.get(id);
    if (!customer) return undefined;

    const updatedCustomer = { ...customer, ...updates };
    this.customers.set(id, updatedCustomer);
    return updatedCustomer;
  }

  async deleteCustomer(id: string): Promise<boolean> {
    return this.customers.delete(id);
  }

  async findDuplicateCustomers(name: string, email: string, phone: string): Promise<Customer[]> {
    try {
      // First check database
      const { db } = await import('./db');
      const { customers } = await import('@shared/schema');
      const { or, ilike, eq } = await import('drizzle-orm');
      
      const dbCustomers = await db.select().from(customers).where(
        or(
          ilike(customers.name, name),
          eq(customers.email, email),
          eq(customers.phone, phone)
        )
      );
      
      if (dbCustomers.length > 0) {
        return dbCustomers;
      }
    } catch (error) {
      console.log('Database not available, checking in-memory storage');
    }
    
    // Fallback to in-memory check
    const duplicates: Customer[] = [];
    for (const customer of this.customers.values()) {
      if (customer.name.toLowerCase() === name.toLowerCase() || 
          customer.email.toLowerCase() === email.toLowerCase() || 
          customer.phone === phone) {
        duplicates.push(customer);
      }
    }
    return duplicates;
  }

  // Load operations
  async getLoad(id: string): Promise<LoadWithRelations | undefined> {
    const load = this.loads.get(id);
    if (!load) return undefined;

    const customer = this.customers.get(load.customerId);
    const driver = load.driverId ? this.drivers.get(load.driverId) || null : null;

    if (!customer) return undefined;

    return {
      ...load,
      customer,
      driver,
    };
  }

  async getAllLoads(): Promise<LoadWithRelations[]> {
    const loads: LoadWithRelations[] = [];
    
    for (const load of Array.from(this.loads.values())) {
      const customer = this.customers.get(load.customerId);
      const driver = load.driverId ? this.drivers.get(load.driverId) || null : null;
      
      if (customer) {
        loads.push({
          ...load,
          customer,
          driver,
        });
      }
    }
    
    return loads.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createLoad(insertLoad: InsertLoad): Promise<LoadWithRelations> {
    const id = randomUUID();
    const loadNumber = `LM-${new Date().getFullYear()}-${this.loadCounter.toString().padStart(3, '0')}`;
    this.loadCounter++;

    const load: Load = {
      ...insertLoad,
      id,
      loadNumber,
      status: insertLoad.status || "scheduled",
      priority: insertLoad.priority || "standard",
      pickupDate: new Date(insertLoad.pickupDate),
      deliveryDate: new Date(insertLoad.deliveryDate),
      driverId: insertLoad.driverId || null,
      equipmentType: insertLoad.equipmentType || "dry_van",
      temperatureRequired: insertLoad.temperatureRequired || false,
      isExpired: insertLoad.isExpired || false,
      temperatureUnit: insertLoad.temperatureUnit || "F",
      sourceBoard: insertLoad.sourceBoard || "manual",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.loads.set(id, load);

    const customer = this.customers.get(load.customerId);
    const driver = load.driverId ? this.drivers.get(load.driverId) || null : null;

    return {
      ...load,
      customer: customer!,
      driver,
    };
  }

  async updateLoad(id: string, updates: Partial<InsertLoad>): Promise<LoadWithRelations | undefined> {
    const load = this.loads.get(id);
    if (!load) return undefined;

    const updatedLoad: Load = {
      ...load,
      ...updates,
      pickupDate: updates.pickupDate ? new Date(updates.pickupDate) : load.pickupDate,
      deliveryDate: updates.deliveryDate ? new Date(updates.deliveryDate) : load.deliveryDate,
      updatedAt: new Date(),
    };

    this.loads.set(id, updatedLoad);

    const customer = this.customers.get(updatedLoad.customerId);
    if (!customer) return undefined;
    const driver = updatedLoad.driverId ? this.drivers.get(updatedLoad.driverId) || null : null;

    return {
      ...updatedLoad,
      customer: customer!,
      driver,
    };
  }

  async deleteLoad(id: string): Promise<boolean> {
    return this.loads.delete(id);
  }

  async getLoadsByStatus(status: string): Promise<LoadWithRelations[]> {
    const allLoads = await this.getAllLoads();
    return allLoads.filter(load => load.status === status);
  }

  async getLoadsByDriver(driverId: string): Promise<LoadWithRelations[]> {
    const allLoads = await this.getAllLoads();
    return allLoads.filter(load => load.assignedDriverId === driverId);
  }

  // Email template operations
  async getEmailTemplate(id: string): Promise<EmailTemplate | undefined> {
    return this.emailTemplates.get(id);
  }

  async getAllEmailTemplates(): Promise<EmailTemplate[]> {
    return Array.from(this.emailTemplates.values());
  }

  async createEmailTemplate(insertTemplate: InsertEmailTemplate): Promise<EmailTemplate> {
    const id = randomUUID();
    const template: EmailTemplate = {
      ...insertTemplate,
      id,
      isActive: insertTemplate.isActive !== undefined ? insertTemplate.isActive : true,
      createdAt: new Date(),
    };
    this.emailTemplates.set(id, template);
    return template;
  }

  async updateEmailTemplate(id: string, updates: Partial<InsertEmailTemplate>): Promise<EmailTemplate | undefined> {
    const template = this.emailTemplates.get(id);
    if (!template) return undefined;

    const updatedTemplate = { ...template, ...updates };
    this.emailTemplates.set(id, updatedTemplate);
    return updatedTemplate;
  }

  async deleteEmailTemplate(id: string): Promise<boolean> {
    return this.emailTemplates.delete(id);
  }

  async getEmailTemplatesByTrigger(trigger: string): Promise<EmailTemplate[]> {
    return Array.from(this.emailTemplates.values()).filter(template => 
      template.trigger === trigger && template.isActive
    );
  }

  // Email log operations
  async getEmailLog(id: string): Promise<EmailLogWithRelations | undefined> {
    const log = this.emailLogs.get(id);
    if (!log) return undefined;

    const load = log.loadId ? await this.getLoad(log.loadId) : undefined;
    const template = log.templateId ? this.emailTemplates.get(log.templateId) : undefined;

    return {
      ...log,
      load,
      template,
    };
  }

  async getAllEmailLogs(): Promise<EmailLogWithRelations[]> {
    const logs: EmailLogWithRelations[] = [];
    
    for (const log of Array.from(this.emailLogs.values())) {
      const load = log.loadId ? await this.getLoad(log.loadId) : undefined;
      const template = log.templateId ? this.emailTemplates.get(log.templateId) : undefined;
      
      logs.push({
        ...log,
        load,
        template,
      });
    }
    
    return logs.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createEmailLog(insertLog: InsertEmailLog): Promise<EmailLog> {
    const id = randomUUID();
    const log: EmailLog = {
      ...insertLog,
      id,
      loadId: insertLog.loadId || null,
      templateId: insertLog.templateId || null,
      errorMessage: insertLog.errorMessage || null,
      sentAt: insertLog.sentAt || null,
      createdAt: new Date(),
    };
    this.emailLogs.set(id, log);
    return log;
  }

  async updateEmailLog(id: string, updates: Partial<InsertEmailLog>): Promise<EmailLog | undefined> {
    const log = this.emailLogs.get(id);
    if (!log) return undefined;

    const updatedLog = { ...log, ...updates };
    this.emailLogs.set(id, updatedLog);
    return updatedLog;
  }

  async getEmailLogsByLoad(loadId: string): Promise<EmailLogWithRelations[]> {
    const allLogs = await this.getAllEmailLogs();
    return allLogs.filter(log => log.loadId === loadId);
  }

  // Onboarding token operations
  async createOnboardingToken(insertToken: InsertOnboardingToken): Promise<OnboardingToken> {
    const id = randomUUID();
    const token: OnboardingToken = {
      ...insertToken,
      id,
      isUsed: insertToken.isUsed || false,
      createdAt: new Date(),
    };
    this.onboardingTokens.set(insertToken.token, token);
    return token;
  }

  async getOnboardingToken(tokenString: string): Promise<OnboardingToken | undefined> {
    return this.onboardingTokens.get(tokenString);
  }

  async getAllOnboardingTokens(): Promise<OnboardingToken[]> {
    return Array.from(this.onboardingTokens.values()).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async markTokenAsUsed(tokenString: string): Promise<boolean> {
    const token = this.onboardingTokens.get(tokenString);
    if (!token) return false;
    
    const updatedToken = { ...token, isUsed: true };
    this.onboardingTokens.set(tokenString, updatedToken);
    return true;
  }

  // Driver location operations
  async createDriverLocation(insertLocation: InsertDriverLocation): Promise<DriverLocation> {
    const id = randomUUID();
    const location: DriverLocation = {
      ...insertLocation,
      id,
      accuracy: insertLocation.accuracy || null,
      speed: insertLocation.speed || null,
      heading: insertLocation.heading || null,
      createdAt: new Date(),
    };
    this.driverLocations.set(id, location);
    return location;
  }

  async getDriverCurrentLocation(driverId: string): Promise<DriverLocation | undefined> {
    const locations = Array.from(this.driverLocations.values())
      .filter(location => location.driverId === driverId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return locations[0];
  }

  async getDriverLocationHistory(driverId: string): Promise<DriverLocation[]> {
    return Array.from(this.driverLocations.values())
      .filter(location => location.driverId === driverId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // Driver onboarding
  async completeDriverOnboarding(data: DriverOnboarding, tokenString: string): Promise<Driver> {
    const token = await this.getOnboardingToken(tokenString);
    if (!token || token.isUsed || new Date(token.expiresAt) < new Date()) {
      throw new Error('Invalid or expired token');
    }

    // Create the driver
    const driverData: InsertDriver = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      status: 'available',
      licenseNumber: data.licenseNumber,
      emergencyContact: data.emergencyContact,
      emergencyPhone: data.emergencyPhone,
    };

    const driver = await this.createDriver(driverData);
    
    // Mark driver as onboarded
    const updatedDriver = { ...driver, isOnboarded: true };
    this.drivers.set(driver.id, updatedDriver);
    
    // Mark token as used
    await this.markTokenAsUsed(tokenString);
    
    return updatedDriver;
  }

  // Scraper configuration operations
  async getScraperConfig(id: string): Promise<ScraperConfig | undefined> {
    // First check memory
    const memoryResult = this.scraperConfigs.get(id);
    if (memoryResult) return memoryResult;

    // If not in memory, query database
    try {
      const { db } = await import('./db');
      const { scraperConfigs } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const result = await db.select().from(scraperConfigs).where(eq(scraperConfigs.id, id)).limit(1);
      if (result.length > 0) {
        // Cache in memory for future requests
        this.scraperConfigs.set(id, result[0]);
        return result[0];
      }
    } catch (error) {
      console.error('Error querying scraper config from database:', error);
    }
    return undefined;
  }

  async getAllScraperConfigs(): Promise<ScraperConfig[]> {
    // Query database for all configs
    try {
      const { db } = await import('./db');
      const { scraperConfigs } = await import('@shared/schema');
      const result = await db.select().from(scraperConfigs);
      
      // Update memory cache
      result.forEach(config => {
        this.scraperConfigs.set(config.id, config);
      });
      
      return result;
    } catch (error) {
      console.error('Error querying scraper configs from database:', error);
      // Fallback to memory
      return Array.from(this.scraperConfigs.values());
    }
  }

  async createScraperConfig(config: InsertScraperConfig): Promise<ScraperConfig> {
    try {
      const { db } = await import('./db');
      const { scraperConfigs } = await import('@shared/schema');
      
      const result = await db.insert(scraperConfigs).values(config).returning();
      const newConfig = result[0];
      
      // Cache in memory
      this.scraperConfigs.set(newConfig.id, newConfig);
      return newConfig;
    } catch (error) {
      console.error('Error creating scraper config in database:', error);
      // Fallback to memory implementation
      const id = randomUUID();
      const newConfig: ScraperConfig = {
        ...config,
        id,
        type: config.type || "dat",
        schedule: config.schedule || "*/1 * * * * *",
        enabled: config.enabled || false,
        autoCreateLoads: config.autoCreateLoads || true,
        username: config.username || null,
        password: config.password || null,
        searchCriteria: config.searchCriteria || {},
        defaultCustomerId: config.defaultCustomerId || null,
        lastRunAt: config.lastRunAt || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.scraperConfigs.set(id, newConfig);
      return newConfig;
    }
  }

  async updateScraperConfig(id: string, config: Partial<InsertScraperConfig>): Promise<ScraperConfig | undefined> {
    try {
      const { db } = await import('./db');
      const { scraperConfigs } = await import('@shared/schema');
      
      const { eq } = await import('drizzle-orm');
      const result = await db.update(scraperConfigs)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(scraperConfigs.id, id))
        .returning();
        
      if (result.length > 0) {
        const updated = result[0];
        // Update memory cache
        this.scraperConfigs.set(id, updated);
        return updated;
      }
    } catch (error) {
      console.error('Error updating scraper config in database:', error);
    }
    
    // Fallback to memory implementation
    const existing = this.scraperConfigs.get(id);
    if (!existing) return undefined;

    const updated: ScraperConfig = {
      ...existing,
      ...config,
      updatedAt: new Date(),
    };
    this.scraperConfigs.set(id, updated);
    return updated;
  }

  async deleteScraperConfig(id: string): Promise<boolean> {
    try {
      const { db } = await import('./db');
      const { scraperConfigs } = await import('@shared/schema');
      
      const { eq } = await import('drizzle-orm');
      await db.delete(scraperConfigs).where(eq(scraperConfigs.id, id));
      
      // Remove from memory cache
      this.scraperConfigs.delete(id);
      return true;
    } catch (error) {
      console.error('Error deleting scraper config from database:', error);
      return this.scraperConfigs.delete(id);
    }
  }

  // Scraper log operations
  async getScraperLog(id: string): Promise<ScraperLog | undefined> {
    return this.scraperLogs.get(id);
  }

  async getAllScraperLogs(): Promise<ScraperLog[]> {
    return Array.from(this.scraperLogs.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createScraperLog(log: InsertScraperLog): Promise<ScraperLog> {
    const id = randomUUID();
    const newLog: ScraperLog = {
      ...log,
      id,
      loadsScraped: log.loadsScraped || 0,
      loadsCreated: log.loadsCreated || 0,
      errorMessage: log.errorMessage || null,
      executionTime: log.executionTime || null,
      completedAt: log.completedAt || null,
      metadata: log.metadata || {},
      createdAt: new Date(),
    };
    this.scraperLogs.set(id, newLog);
    return newLog;
  }

  async updateScraperLog(id: string, log: Partial<InsertScraperLog>): Promise<ScraperLog | undefined> {
    const existing = this.scraperLogs.get(id);
    if (!existing) return undefined;

    const updated: ScraperLog = {
      ...existing,
      ...log,
    };
    this.scraperLogs.set(id, updated);
    return updated;
  }

  async getScraperLogsByConfig(configId: string): Promise<ScraperLog[]> {
    return Array.from(this.scraperLogs.values())
      .filter(log => log.configId === configId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  // Telegram bot config operations
  async getTelegramBotConfig(id: string): Promise<TelegramBotConfig | undefined> {
    return this.telegramBotConfigs.get(id);
  }

  async getAllTelegramBotConfigs(): Promise<TelegramBotConfig[]> {
    return Array.from(this.telegramBotConfigs.values());
  }

  async createTelegramBotConfig(config: InsertTelegramBotConfig): Promise<TelegramBotConfig> {
    const id = randomUUID();
    const newConfig: TelegramBotConfig = {
      ...config,
      id,
      botUsername: config.botUsername || null,
      responseTimeoutMinutes: config.responseTimeoutMinutes || 3,
      isActive: config.isActive !== undefined ? config.isActive : true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.telegramBotConfigs.set(id, newConfig);
    return newConfig;
  }

  async updateTelegramBotConfig(id: string, config: Partial<InsertTelegramBotConfig>): Promise<TelegramBotConfig | undefined> {
    const existing = this.telegramBotConfigs.get(id);
    if (!existing) return undefined;

    const updated: TelegramBotConfig = {
      ...existing,
      ...config,
      updatedAt: new Date(),
    };
    this.telegramBotConfigs.set(id, updated);
    return updated;
  }

  // Lane preference operations
  async getLanePreference(id: string): Promise<LanePreference | undefined> {
    return this.lanePreferences.get(id);
  }

  async getAllLanePreferences(): Promise<LanePreference[]> {
    return Array.from(this.lanePreferences.values())
      .filter(pref => pref.isActive)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createLanePreference(pref: InsertLanePreference): Promise<LanePreference> {
    const id = randomUUID();
    const newPref: LanePreference = {
      ...pref,
      id,
      isActive: pref.isActive !== undefined ? pref.isActive : true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.lanePreferences.set(id, newPref);
    return newPref;
  }

  async updateLanePreference(id: string, pref: Partial<InsertLanePreference>): Promise<LanePreference | undefined> {
    const existing = this.lanePreferences.get(id);
    if (!existing) return undefined;

    const updated: LanePreference = {
      ...existing,
      ...pref,
      updatedAt: new Date(),
    };
    this.lanePreferences.set(id, updated);
    return updated;
  }

  async deleteLanePreference(id: string): Promise<boolean> {
    return this.lanePreferences.delete(id);
  }

  // Avoid location operations
  async getAvoidLocation(id: string): Promise<AvoidLocation | undefined> {
    return this.avoidLocations.get(id);
  }

  async getAllAvoidLocations(): Promise<AvoidLocation[]> {
    return Array.from(this.avoidLocations.values())
      .filter(loc => loc.isActive)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createAvoidLocation(location: InsertAvoidLocation): Promise<AvoidLocation> {
    const id = randomUUID();
    const newLocation: AvoidLocation = {
      ...location,
      id,
      type: location.type || "city",
      isActive: location.isActive !== undefined ? location.isActive : true,
      createdAt: new Date(),
    };
    this.avoidLocations.set(id, newLocation);
    return newLocation;
  }

  async updateAvoidLocation(id: string, location: Partial<InsertAvoidLocation>): Promise<AvoidLocation | undefined> {
    const existing = this.avoidLocations.get(id);
    if (!existing) return undefined;

    const updated: AvoidLocation = {
      ...existing,
      ...location,
    };
    this.avoidLocations.set(id, updated);
    return updated;
  }

  async deleteAvoidLocation(id: string): Promise<boolean> {
    return this.avoidLocations.delete(id);
  }

  // Load offer operations
  async getLoadOffer(id: string): Promise<LoadOffer | undefined> {
    return this.loadOffers.get(id);
  }

  async getAllLoadOffers(): Promise<LoadOffer[]> {
    return Array.from(this.loadOffers.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getLoadOffers(loadId: string): Promise<LoadOffer[]> {
    return Array.from(this.loadOffers.values())
      .filter(offer => offer.loadId === loadId)
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  }

  async createLoadOffer(offer: InsertLoadOffer): Promise<LoadOffer> {
    const id = randomUUID();
    const newOffer: LoadOffer = {
      ...offer,
      id,
      status: offer.status || "pending",
      telegramMessageId: offer.telegramMessageId || null,
      respondedAt: offer.respondedAt || null,
      createdAt: new Date(),
    };
    this.loadOffers.set(id, newOffer);
    return newOffer;
  }

  async updateLoadOffer(id: string, offer: Partial<InsertLoadOffer>): Promise<LoadOffer | undefined> {
    const existing = this.loadOffers.get(id);
    if (!existing) return undefined;

    const updated: LoadOffer = {
      ...existing,
      ...offer,
    };
    this.loadOffers.set(id, updated);
    return updated;
  }

  async getLoadOfferByLoadAndDriver(loadId: string, driverId: string): Promise<LoadOffer | undefined> {
    return Array.from(this.loadOffers.values())
      .find(offer => offer.loadId === loadId && offer.driverId === driverId);
  }

  async updateLoadOfferByLoadAndDriver(loadId: string, driverId: string, offer: Partial<InsertLoadOffer>): Promise<LoadOffer | undefined> {
    const existing = await this.getLoadOfferByLoadAndDriver(loadId, driverId);
    if (!existing) return undefined;

    const updated: LoadOffer = {
      ...existing,
      ...offer,
    };
    this.loadOffers.set(existing.id, updated);
    return updated;
  }

  // Driver telegram operations
  async getDriverByTelegramId(telegramId: string): Promise<Driver | undefined> {
    return Array.from(this.drivers.values())
      .find(driver => driver.telegramId === telegramId);
  }

  async getDriversWithTelegramEnabled(): Promise<Driver[]> {
    try {
      // Try to get fresh data from database first
      const { db } = await import('./db');
      const { drivers } = await import('@shared/schema');
      
      const { isNotNull } = await import('drizzle-orm');
      const dbDrivers = await db.select().from(drivers)
        .where(isNotNull(drivers.telegramId));
      
      // Update memory cache with fresh data
      for (const driver of dbDrivers) {
        this.drivers.set(driver.id, driver);
      }
      
      // Filter for drivers with telegram enabled (now allowing test IDs for development)
      return dbDrivers.filter(driver => 
        driver.telegramId && 
        driver.enableTelegramNotifications
      );
    } catch (error) {
      console.error('Error getting drivers from database, using memory cache:', error);
      // Fallback to memory cache with same filtering
      return Array.from(this.drivers.values())
        .filter(driver => 
          driver.telegramId && 
          driver.enableTelegramNotifications
        );
    }
  }
  
  // Load offer statistics
  async getLoadOffersByDriver(driverId: string): Promise<LoadOffer[]> {
    return Array.from(this.loadOffers.values())
      .filter(offer => offer.driverId === driverId)
      .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  }

  // Enhanced driver location operations
  async updateDriverLocation(id: string, location: Partial<InsertDriverLocation>): Promise<DriverLocation | undefined> {
    const existing = this.driverLocations.get(id);
    if (!existing) return undefined;

    const updated: DriverLocation = {
      ...existing,
      ...location,
    };
    this.driverLocations.set(id, updated);
    return updated;
  }

  async getAllCurrentDriverLocations(): Promise<DriverLocation[]> {
    return Array.from(this.driverLocations.values())
      .filter(location => location.isActive)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async cleanupOldDriverLocations(driverId: string, keepCount: number): Promise<void> {
    const driverLocationList = Array.from(this.driverLocations.values())
      .filter(location => location.driverId === driverId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Keep only the most recent locations
    const toDelete = driverLocationList.slice(keepCount);
    for (const location of toDelete) {
      this.driverLocations.delete(location.id);
    }
  }

  // GPS Device operations
  async getGpsDevice(id: string): Promise<GpsDevice | undefined> {
    return this.gpsDevices.get(id);
  }

  async getAllGpsDevices(): Promise<GpsDevice[]> {
    return Array.from(this.gpsDevices.values())
      .filter(device => device.isActive)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createGpsDevice(device: InsertGpsDevice): Promise<GpsDevice> {
    const id = randomUUID();
    const newDevice: GpsDevice = {
      ...device,
      id,
      status: device.status || "active",
      deviceType: device.deviceType || "mobile",
      isActive: device.isActive !== undefined ? device.isActive : true,
      settings: device.settings || {},
      lastHeartbeat: device.lastHeartbeat || null,
      firmwareVersion: device.firmwareVersion || null,
      batteryLevel: device.batteryLevel || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.gpsDevices.set(id, newDevice);
    return newDevice;
  }

  async updateGpsDevice(id: string, device: Partial<InsertGpsDevice>): Promise<GpsDevice | undefined> {
    const existing = this.gpsDevices.get(id);
    if (!existing) return undefined;

    const updated: GpsDevice = {
      ...existing,
      ...device,
      updatedAt: new Date(),
    };
    this.gpsDevices.set(id, updated);
    return updated;
  }

  async getGpsDeviceByDriver(driverId: string): Promise<GpsDevice | undefined> {
    return Array.from(this.gpsDevices.values())
      .find(device => device.driverId === driverId && device.isActive);
  }

  // Geofence operations
  async getGeofence(id: string): Promise<Geofence | undefined> {
    return this.geofences.get(id);
  }

  async getAllGeofences(): Promise<Geofence[]> {
    return Array.from(this.geofences.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getActiveGeofences(): Promise<Geofence[]> {
    return Array.from(this.geofences.values())
      .filter(geofence => geofence.isActive)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createGeofence(geofence: InsertGeofence): Promise<Geofence> {
    const id = randomUUID();
    const newGeofence: Geofence = {
      ...geofence,
      id,
      isActive: geofence.isActive !== undefined ? geofence.isActive : true,
      notificationSettings: geofence.notificationSettings || {},
      loadId: geofence.loadId || null,
      customerId: geofence.customerId || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.geofences.set(id, newGeofence);
    return newGeofence;
  }

  async updateGeofence(id: string, geofence: Partial<InsertGeofence>): Promise<Geofence | undefined> {
    const existing = this.geofences.get(id);
    if (!existing) return undefined;

    const updated: Geofence = {
      ...existing,
      ...geofence,
      updatedAt: new Date(),
    };
    this.geofences.set(id, updated);
    return updated;
  }

  async deleteGeofence(id: string): Promise<boolean> {
    return this.geofences.delete(id);
  }

  // Geofence event operations
  async getGeofenceEvent(id: string): Promise<GeofenceEvent | undefined> {
    return this.geofenceEvents.get(id);
  }

  async createGeofenceEvent(event: InsertGeofenceEvent): Promise<GeofenceEvent> {
    const id = randomUUID();
    const newEvent: GeofenceEvent = {
      ...event,
      id,
      dwellTime: event.dwellTime || null,
      loadId: event.loadId || null,
      wasNotified: event.wasNotified !== undefined ? event.wasNotified : false,
      createdAt: new Date(),
    };
    this.geofenceEvents.set(id, newEvent);
    return newEvent;
  }

  async getRecentGeofenceEvents(driverId: string, geofenceId: string, limit: number): Promise<GeofenceEvent[]> {
    return Array.from(this.geofenceEvents.values())
      .filter(event => event.driverId === driverId && event.geofenceId === geofenceId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async getDriverGeofenceEvents(driverId: string, hoursBack: number): Promise<GeofenceEvent[]> {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    return Array.from(this.geofenceEvents.values())
      .filter(event => event.driverId === driverId && new Date(event.timestamp) >= cutoffTime)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  // Route operations
  async getRoute(id: string): Promise<Route | undefined> {
    return this.routes.get(id);
  }

  async getAllRoutes(): Promise<Route[]> {
    return Array.from(this.routes.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getActiveRoutes(): Promise<Route[]> {
    return Array.from(this.routes.values())
      .filter(route => route.status === 'active' || route.status === 'planned')
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createRoute(route: InsertRoute): Promise<Route> {
    const id = randomUUID();
    const newRoute: Route = {
      ...route,
      id,
      status: route.status || "planned",
      plannedRoute: route.plannedRoute || null,
      actualRoute: route.actualRoute || null,
      plannedDistance: route.plannedDistance || null,
      actualDistance: route.actualDistance || null,
      plannedDuration: route.plannedDuration || null,
      actualDuration: route.actualDuration || null,
      estimatedArrival: route.estimatedArrival || null,
      actualArrival: route.actualArrival || null,
      deviationAlerts: route.deviationAlerts || [],
      trafficData: route.trafficData || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.routes.set(id, newRoute);
    return newRoute;
  }

  async updateRoute(id: string, route: Partial<InsertRoute>): Promise<Route | undefined> {
    const existing = this.routes.get(id);
    if (!existing) return undefined;

    const updated: Route = {
      ...existing,
      ...route,
      updatedAt: new Date(),
    };
    this.routes.set(id, updated);
    return updated;
  }

  async getActiveRouteForDriver(driverId: string): Promise<Route | undefined> {
    return Array.from(this.routes.values())
      .find(route => route.driverId === driverId && (route.status === 'active' || route.status === 'planned'));
  }

  async deleteRoute(id: string): Promise<boolean> {
    return this.routes.delete(id);
  }
  
  async getLoadOffersWithDetails(): Promise<(LoadOffer & { load: LoadWithRelations; driver: Driver })[]> {
    const offers: (LoadOffer & { load: LoadWithRelations; driver: Driver })[] = [];
    
    for (const offer of Array.from(this.loadOffers.values())) {
      const load = await this.getLoad(offer.loadId);
      const driver = await this.getDriver(offer.driverId);
      
      if (load && driver) {
        offers.push({ ...offer, load, driver });
      }
    }
    
    return offers.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  }
  
  async getDriverLoadOfferStats(driverId: string): Promise<{driverId: string; driverName: string; totalOffers: number; accepted: number; declined: number; timeout: number; pending: number}> {
    const driver = await this.getDriver(driverId);
    if (!driver) {
      throw new Error('Driver not found');
    }
    
    const offers = await this.getLoadOffersByDriver(driverId);
    
    return {
      driverId,
      driverName: driver.name,
      totalOffers: offers.length,
      accepted: offers.filter(o => o.status === 'accepted').length,
      declined: offers.filter(o => o.status === 'declined').length,
      timeout: offers.filter(o => o.status === 'timeout').length,
      pending: offers.filter(o => o.status === 'pending').length
    };
  }
  
  async getAllDriverLoadOfferStats(): Promise<{driverId: string; driverName: string; totalOffers: number; accepted: number; declined: number; timeout: number; pending: number}[]> {
    const drivers = await this.getDriversWithTelegramEnabled();
    const stats = [];
    
    for (const driver of drivers) {
      const driverStats = await this.getDriverLoadOfferStats(driver.id);
      stats.push(driverStats);
    }
    
    return stats;
  }

  // Load Board Source operations
  async getLoadBoardSource(id: string): Promise<LoadBoardSource | undefined> {
    return this.loadBoardSources.get(id);
  }

  async getAllLoadBoardSources(): Promise<LoadBoardSource[]> {
    return Array.from(this.loadBoardSources.values());
  }

  async createLoadBoardSource(source: InsertLoadBoardSource): Promise<LoadBoardSource> {
    const id = randomUUID();
    const newSource: LoadBoardSource = {
      ...source,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.loadBoardSources.set(id, newSource);
    return newSource;
  }

  async updateLoadBoardSource(id: string, source: Partial<InsertLoadBoardSource>): Promise<LoadBoardSource | undefined> {
    const existing = this.loadBoardSources.get(id);
    if (!existing) return undefined;

    const updated: LoadBoardSource = {
      ...existing,
      ...source,
      updatedAt: new Date(),
    };
    this.loadBoardSources.set(id, updated);
    return updated;
  }

  async deleteLoadBoardSource(id: string): Promise<boolean> {
    return this.loadBoardSources.delete(id);
  }

  // Load Board Configuration operations
  async getLoadBoardConfiguration(id: string): Promise<LoadBoardConfiguration | undefined> {
    return this.loadBoardConfigurations.get(id);
  }

  async getAllLoadBoardConfigurations(): Promise<LoadBoardConfiguration[]> {
    return Array.from(this.loadBoardConfigurations.values());
  }

  async getEnabledLoadBoardConfigurations(): Promise<LoadBoardConfiguration[]> {
    return Array.from(this.loadBoardConfigurations.values()).filter(config => config.isEnabled);
  }

  async createLoadBoardConfiguration(config: InsertLoadBoardConfiguration): Promise<LoadBoardConfiguration> {
    const id = randomUUID();
    const newConfig: LoadBoardConfiguration = {
      ...config,
      id,
      lastScrapedAt: null,
      lastError: null,
      successCount: 0,
      errorCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.loadBoardConfigurations.set(id, newConfig);
    return newConfig;
  }

  async updateLoadBoardConfiguration(id: string, config: Partial<InsertLoadBoardConfiguration>): Promise<LoadBoardConfiguration | undefined> {
    const existing = this.loadBoardConfigurations.get(id);
    if (!existing) return undefined;

    const updated: LoadBoardConfiguration = {
      ...existing,
      ...config,
      updatedAt: new Date(),
    };
    this.loadBoardConfigurations.set(id, updated);
    return updated;
  }

  async deleteLoadBoardConfiguration(id: string): Promise<boolean> {
    return this.loadBoardConfigurations.delete(id);
  }

  // Scraped Load operations
  async getScrapedLoad(id: string): Promise<ScrapedLoad | undefined> {
    return this.scrapedLoads.get(id);
  }

  async getAllScrapedLoads(): Promise<ScrapedLoad[]> {
    return Array.from(this.scrapedLoads.values());
  }

  async getRecentScrapedLoads(hours: number): Promise<ScrapedLoad[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return Array.from(this.scrapedLoads.values())
      .filter(load => new Date(load.scrapedAt || 0) > cutoff)
      .sort((a, b) => new Date(b.scrapedAt || 0).getTime() - new Date(a.scrapedAt || 0).getTime());
  }

  async getScrapedLoadByExternalId(sourceId: string, externalId: string): Promise<ScrapedLoad | undefined> {
    return Array.from(this.scrapedLoads.values())
      .find(load => load.sourceId === sourceId && load.externalId === externalId);
  }

  async createScrapedLoad(load: InsertScrapedLoad): Promise<ScrapedLoad> {
    const id = randomUUID();
    const newLoad: ScrapedLoad = {
      ...load,
      id,
      scrapedAt: new Date(),
      lastUpdatedAt: new Date(),
    };
    this.scrapedLoads.set(id, newLoad);
    return newLoad;
  }

  async updateScrapedLoad(externalId: string, sourceId: string, load: Partial<InsertScrapedLoad>): Promise<ScrapedLoad | undefined> {
    const existing = Array.from(this.scrapedLoads.values())
      .find(l => l.externalId === externalId && l.sourceId === sourceId);
    
    if (!existing) return undefined;

    const updated: ScrapedLoad = {
      ...existing,
      ...load,
      lastUpdatedAt: new Date(),
    };
    this.scrapedLoads.set(existing.id, updated);
    return updated;
  }

  async deleteScrapedLoad(id: string): Promise<boolean> {
    return this.scrapedLoads.delete(id);
  }

  async getMatchedScrapedLoads(): Promise<ScrapedLoad[]> {
    return Array.from(this.scrapedLoads.values())
      .filter(load => load.isMatched)
      .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  }

  async getScrapedLoadsBySource(sourceId: string): Promise<ScrapedLoad[]> {
    return Array.from(this.scrapedLoads.values())
      .filter(load => load.sourceId === sourceId)
      .sort((a, b) => new Date(b.scrapedAt || 0).getTime() - new Date(a.scrapedAt || 0).getTime());
  }

  // Scraper Configuration operations
  async getScraperConfiguration(id: string): Promise<ScraperConfiguration | undefined> {
    return this.scraperConfigurations.get(id);
  }

  async getAllScraperConfigurations(): Promise<ScraperConfiguration[]> {
    return Array.from(this.scraperConfigurations.values());
  }

  async getEnabledScraperConfigurations(): Promise<ScraperConfiguration[]> {
    return Array.from(this.scraperConfigurations.values()).filter(config => config.isEnabled);
  }

  async createScraperConfiguration(config: InsertScraperConfiguration): Promise<ScraperConfiguration> {
    const id = randomUUID();
    const newConfig: ScraperConfiguration = {
      ...config,
      id,
      lastRunAt: null,
      nextRunAt: null,
      averageRunTimeMs: null,
      totalLoadsScraped: 0,
      totalMatchesFound: 0,
      lastError: null,
      errorCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.scraperConfigurations.set(id, newConfig);
    return newConfig;
  }

  async updateScraperConfiguration(id: string, config: Partial<InsertScraperConfiguration>): Promise<ScraperConfiguration | undefined> {
    const existing = this.scraperConfigurations.get(id);
    if (!existing) return undefined;

    const updated: ScraperConfiguration = {
      ...existing,
      ...config,
      updatedAt: new Date(),
    };
    this.scraperConfigurations.set(id, updated);
    return updated;
  }

  async deleteScraperConfiguration(id: string): Promise<boolean> {
    return this.scraperConfigurations.delete(id);
  }

  // Driver availability operations
  async getAvailableDrivers(): Promise<Driver[]> {
    return Array.from(this.drivers.values())
      .filter(driver => driver.status === 'available' && driver.isOnboarded);
  }

  // Load Bidding operations
  async getLoadBid(id: string): Promise<LoadBid | undefined> {
    return this.loadBids.get(id);
  }

  async getAllLoadBids(): Promise<LoadBid[]> {
    return Array.from(this.loadBids.values());
  }

  async createLoadBid(bid: InsertLoadBid): Promise<LoadBid> {
    const id = randomUUID();
    const newBid: LoadBid = {
      ...bid,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.loadBids.set(id, newBid);
    return newBid;
  }

  async updateLoadBid(id: string, bid: Partial<InsertLoadBid>): Promise<LoadBid | undefined> {
    const existing = this.loadBids.get(id);
    if (!existing) return undefined;

    const updated: LoadBid = {
      ...existing,
      ...bid,
      updatedAt: new Date(),
    };
    this.loadBids.set(id, updated);
    return updated;
  }

  async deleteLoadBid(id: string): Promise<boolean> {
    return this.loadBids.delete(id);
  }

  async getExpiredBids(): Promise<LoadBid[]> {
    const now = new Date();
    return Array.from(this.loadBids.values())
      .filter(bid => bid.bidExpiresAt && bid.bidExpiresAt < now && bid.status === 'bid_submitted');
  }

  async getDriverTimeoutBids(timeoutMinutes: number): Promise<LoadBid[]> {
    const timeoutThreshold = new Date(Date.now() - timeoutMinutes * 60 * 1000);
    return Array.from(this.loadBids.values())
      .filter(bid => 
        bid.status === 'pending_driver' && 
        bid.createdAt && 
        bid.createdAt < timeoutThreshold
      );
  }

  // Bid Response operations
  async getBidResponse(id: string): Promise<BidResponse | undefined> {
    return this.bidResponses.get(id);
  }

  async getAllBidResponses(): Promise<BidResponse[]> {
    return Array.from(this.bidResponses.values());
  }

  async createBidResponse(response: InsertBidResponse): Promise<BidResponse> {
    const id = randomUUID();
    const newResponse: BidResponse = {
      ...response,
      id,
      createdAt: new Date(),
    };
    this.bidResponses.set(id, newResponse);
    return newResponse;
  }

  async updateBidResponse(id: string, response: Partial<InsertBidResponse>): Promise<BidResponse | undefined> {
    const existing = this.bidResponses.get(id);
    if (!existing) return undefined;

    const updated: BidResponse = {
      ...existing,
      ...response,
    };
    this.bidResponses.set(id, updated);
    return updated;
  }

  async getBidResponsesByBid(bidId: string): Promise<BidResponse[]> {
    return Array.from(this.bidResponses.values())
      .filter(response => response.bidId === bidId);
  }

  async getBidResponsesByDriver(driverId: string): Promise<BidResponse[]> {
    return Array.from(this.bidResponses.values())
      .filter(response => response.driverId === driverId);
  }

  // Email Campaign operations
  async getEmailCampaign(id: string): Promise<EmailCampaign | undefined> {
    return this.emailCampaigns.get(id);
  }

  async getAllEmailCampaigns(): Promise<EmailCampaign[]> {
    return Array.from(this.emailCampaigns.values());
  }

  async getActiveCampaigns(): Promise<EmailCampaign[]> {
    return Array.from(this.emailCampaigns.values())
      .filter(campaign => campaign.status === 'active');
  }

  async createEmailCampaign(campaign: InsertEmailCampaign): Promise<EmailCampaign> {
    const id = randomUUID();
    const newCampaign: EmailCampaign = {
      ...campaign,
      id,
      totalEmails: 0,
      followUpCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.emailCampaigns.set(id, newCampaign);
    return newCampaign;
  }

  async updateEmailCampaign(id: string, campaign: Partial<InsertEmailCampaign>): Promise<EmailCampaign | undefined> {
    const existing = this.emailCampaigns.get(id);
    if (!existing) return undefined;

    const updated: EmailCampaign = {
      ...existing,
      ...campaign,
      updatedAt: new Date(),
    };
    this.emailCampaigns.set(id, updated);
    return updated;
  }

  async deleteEmailCampaign(id: string): Promise<boolean> {
    return this.emailCampaigns.delete(id);
  }

  // Email Follow-up operations
  async getEmailFollowUp(id: string): Promise<EmailFollowUp | undefined> {
    return this.emailFollowUps.get(id);
  }

  async getAllEmailFollowUps(): Promise<EmailFollowUp[]> {
    return Array.from(this.emailFollowUps.values());
  }

  async createEmailFollowUp(followUp: InsertEmailFollowUp): Promise<EmailFollowUp> {
    const id = randomUUID();
    const newFollowUp: EmailFollowUp = {
      ...followUp,
      id,
      createdAt: new Date(),
    };
    this.emailFollowUps.set(id, newFollowUp);
    return newFollowUp;
  }

  async updateEmailFollowUp(id: string, followUp: Partial<InsertEmailFollowUp>): Promise<EmailFollowUp | undefined> {
    const existing = this.emailFollowUps.get(id);
    if (!existing) return undefined;

    const updated: EmailFollowUp = {
      ...existing,
      ...followUp,
    };
    this.emailFollowUps.set(id, updated);
    return updated;
  }

  async getEmailFollowUpsByCampaign(campaignId: string): Promise<EmailFollowUp[]> {
    return Array.from(this.emailFollowUps.values())
      .filter(followUp => followUp.campaignId === campaignId);
  }

  // Dispatcher Notification operations
  async getDispatcherNotification(id: string): Promise<DispatcherNotification | undefined> {
    return this.dispatcherNotifications.get(id);
  }

  async getAllDispatcherNotifications(): Promise<DispatcherNotification[]> {
    return Array.from(this.dispatcherNotifications.values());
  }

  async createDispatcherNotification(notification: InsertDispatcherNotification): Promise<DispatcherNotification> {
    const id = randomUUID();
    const newNotification: DispatcherNotification = {
      ...notification,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.dispatcherNotifications.set(id, newNotification);
    return newNotification;
  }

  async updateDispatcherNotification(id: string, notification: Partial<InsertDispatcherNotification>): Promise<DispatcherNotification | undefined> {
    const existing = this.dispatcherNotifications.get(id);
    if (!existing) return undefined;

    const updated: DispatcherNotification = {
      ...existing,
      ...notification,
      updatedAt: new Date(),
    };
    this.dispatcherNotifications.set(id, updated);
    return updated;
  }

  async getDispatcherNotificationsByBid(bidId: string): Promise<DispatcherNotification[]> {
    return Array.from(this.dispatcherNotifications.values())
      .filter(notification => notification.bidId === bidId);
  }

  // Load Document operations
  async createLoadDocument(data: InsertLoadDocument): Promise<LoadDocument> {
    const id = randomUUID();
    const newDocument: LoadDocument = {
      ...data,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.loadDocuments.set(id, newDocument);
    return newDocument;
  }

  async getLoadDocument(id: string): Promise<LoadDocument | null> {
    return this.loadDocuments.get(id) || null;
  }

  async getLoadDocumentsByLoad(loadId: string): Promise<LoadDocument[]> {
    return Array.from(this.loadDocuments.values())
      .filter(doc => doc.loadId === loadId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getLoadDocumentsByDriver(driverId: string): Promise<LoadDocument[]> {
    return Array.from(this.loadDocuments.values())
      .filter(doc => doc.driverId === driverId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getLoadDocumentsByType(loadId: string, documentType: string): Promise<LoadDocument[]> {
    return Array.from(this.loadDocuments.values())
      .filter(doc => doc.loadId === loadId && doc.documentType === documentType)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async updateLoadDocument(id: string, data: Partial<InsertLoadDocument>): Promise<LoadDocument | null> {
    const existing = this.loadDocuments.get(id);
    if (!existing) return null;

    const updated: LoadDocument = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.loadDocuments.set(id, updated);
    return updated;
  }

  async deleteLoadDocument(id: string): Promise<boolean> {
    return this.loadDocuments.delete(id);
  }

  // Duplicate methods for compatibility
  async getAllLoadDocuments(): Promise<LoadDocument[]> {
    return Array.from(this.loadDocuments.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // Get all documents with load details for document management page
  async getAllDocuments(): Promise<any[]> {
    const documents = Array.from(this.loadDocuments.values());
    return documents.map(doc => {
      const load = doc.loadId ? this.loads.get(doc.loadId) : null;
      return {
        ...doc,
        uploadedAt: doc.createdAt,
        approvalNotes: doc.dispatcherNotes,
        load: load ? {
          id: load.id,
          loadNumber: load.loadNumber,
          pickupLocation: load.pickupLocation,
          deliveryLocation: load.deliveryLocation,
          status: load.status,
        } : null
      };
    }).sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }

  // Create document - wrapper around createLoadDocument
  async createDocument(data: Partial<InsertLoadDocument>): Promise<LoadDocument> {
    return this.createLoadDocument(data as InsertLoadDocument);
  }

  // Zello Channel Operations
  async createZelloChannelMessage(message: InsertZelloChannelMessage): Promise<ZelloChannelMessage> {
    const id = randomUUID();
    const newMessage: ZelloChannelMessage = {
      ...message,
      id,
      isRead: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.zelloChannelMessages.set(id, newMessage);
    
    // Update channel unread count
    const status = await this.getZelloChannelStatus(message.channel);
    if (status) {
      await this.updateZelloChannelUnreadCount(message.channel, 1);
    } else {
      await this.createOrUpdateZelloChannelStatus({
        channelName: message.channel,
        unreadCount: 1,
        lastMessageAt: new Date(),
        lastMessageSender: message.sender,
        lastMessagePreview: message.textContent || '[Voice Message]',
        isActive: true,
        onlineUsers: 0,
        totalUsers: 0,
      });
    }
    
    return newMessage;
  }

  async getZelloChannelMessages(channel: string, limit: number = 100): Promise<ZelloChannelMessage[]> {
    return Array.from(this.zelloChannelMessages.values())
      .filter(msg => msg.channel === channel)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  async getUnreadZelloMessages(channel: string): Promise<ZelloChannelMessage[]> {
    return Array.from(this.zelloChannelMessages.values())
      .filter(msg => msg.channel === channel && !msg.isRead)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async markZelloMessagesAsRead(channel: string, messageIds: string[]): Promise<number> {
    let count = 0;
    for (const id of messageIds) {
      const msg = this.zelloChannelMessages.get(id);
      if (msg && msg.channel === channel && !msg.isRead) {
        msg.isRead = true;
        msg.updatedAt = new Date();
        this.zelloChannelMessages.set(id, msg);
        count++;
      }
    }
    
    // Update channel unread count
    if (count > 0) {
      await this.updateZelloChannelUnreadCount(channel, -count);
    }
    
    return count;
  }

  async getZelloChannelStatus(channel: string): Promise<ZelloChannelStatus | null> {
    return this.zelloChannelStatuses.get(channel) || null;
  }

  async createOrUpdateZelloChannelStatus(status: InsertZelloChannelStatus): Promise<ZelloChannelStatus> {
    const existing = this.zelloChannelStatuses.get(status.channelName);
    const id = existing?.id || randomUUID();
    
    const updatedStatus: ZelloChannelStatus = {
      ...existing,
      ...status,
      id,
      updatedAt: new Date(),
      createdAt: existing?.createdAt || new Date(),
    };
    
    this.zelloChannelStatuses.set(status.channelName, updatedStatus);
    return updatedStatus;
  }

  async updateZelloChannelUnreadCount(channel: string, delta: number): Promise<ZelloChannelStatus | null> {
    const status = this.zelloChannelStatuses.get(channel);
    if (!status) return null;
    
    status.unreadCount = Math.max(0, status.unreadCount + delta);
    status.updatedAt = new Date();
    
    this.zelloChannelStatuses.set(channel, status);
    return status;
  }

  async getAllZelloChannelStatuses(): Promise<ZelloChannelStatus[]> {
    return Array.from(this.zelloChannelStatuses.values())
      .sort((a, b) => a.channelName.localeCompare(b.channelName));
  }

  async getZelloMessageById(id: string): Promise<ZelloChannelMessage | null> {
    return this.zelloChannelMessages.get(id) || null;
  }
}

import { DatabaseStorage } from './db-storage';

export const storage = new DatabaseStorage();
