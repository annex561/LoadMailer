import { IStorage } from "./storage";
import { TelegramService } from "./telegram-service";
import { ObjectStorageService } from "./objectStorage";

interface DocumentUploadRequest {
  loadId: string;
  driverId: string;
  documentType: 'bol' | 'freight_photo' | 'delivery_photo' | 'signature';
  fileUrl: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  signerName?: string;
  notes?: string;
}

export class DocumentUploadService {
  constructor(
    private storage: IStorage,
    private telegramService: TelegramService,
    private objectStorageService: ObjectStorageService
  ) {}

  async processDocumentUpload(request: DocumentUploadRequest) {
    try {
      // Normalize the file URL to get the object path
      const objectPath = this.objectStorageService.normalizeObjectEntityPath(request.fileUrl);
      
      // Set ACL policy for the uploaded document
      await this.objectStorageService.trySetObjectEntityAclPolicy(request.fileUrl, {
        owner: request.driverId,
        visibility: "private", // Load documents are private
      });

      // Store document metadata in database
      const document = await this.storage.createLoadDocument({
        loadId: request.loadId,
        driverId: request.driverId,
        documentType: request.documentType,
        fileName: request.fileName,
        fileUrl: objectPath,
        fileSize: request.fileSize,
        mimeType: request.mimeType,
        signerName: request.signerName,
        notes: request.notes,
      });

      console.log(`Document uploaded: ${request.documentType} for load ${request.loadId} by driver ${request.driverId}`);
      
      // Send confirmation message to driver based on document type
      await this.sendDocumentConfirmation(request);
      
      return document;
    } catch (error) {
      console.error('Error processing document upload:', error);
      throw error;
    }
  }

  private async sendDocumentConfirmation(request: DocumentUploadRequest) {
    const driver = await this.storage.getDriver(request.driverId);
    const load = await this.storage.getLoad(request.loadId);
    
    if (!driver?.telegramId || !load) return;

    let message = '';
    switch (request.documentType) {
      case 'bol':
        message = `✅ BOL received for Load ${load.loadNumber}!\n\nThank you for uploading the signed Bill of Lading. Your pickup documentation is complete.`;
        break;
      case 'freight_photo':
        message = `📸 Freight photo received for Load ${load.loadNumber}!\n\nThank you for uploading the freight photo. Your pickup documentation is complete.`;
        break;
      case 'delivery_photo':
        message = `🚚 Delivery photo received for Load ${load.loadNumber}!\n\nThank you for uploading the delivery confirmation photo. Your delivery documentation is complete.`;
        break;
      case 'signature':
        message = `✍️ Signature received for Load ${load.loadNumber}!\n\nThank you for uploading the delivery signature. Your delivery documentation is complete.`;
        break;
    }

    await this.telegramService.sendMessage(driver.telegramId, message);
  }

  async requestPickupDocuments(loadId: string, driverId: string) {
    const driver = await this.storage.getDriver(driverId);
    const load = await this.storage.getLoad(loadId);
    
    if (!driver?.telegramId || !load) return;

    const message = `📋 **PICKUP DOCUMENTATION REQUIRED**\n\n` +
      `Load: ${load.loadNumber}\n` +
      `Location: ${load.pickupAddress}\n\n` +
      `Please upload the following documents:\n\n` +
      `1️⃣ **Signed BOL** (Bill of Lading)\n` +
      `2️⃣ **Freight Photos** (showing loaded cargo)\n\n` +
      `Use the buttons below to upload each document.`;

    const keyboard = {
      inline_keyboard: [
        [
          { 
            text: '📄 Upload BOL', 
            callback_data: `upload_bol_${loadId}` 
          },
          { 
            text: '📸 Upload Freight Photo', 
            callback_data: `upload_freight_${loadId}` 
          }
        ]
      ]
    };

    await this.telegramService.sendMessage(driver.telegramId, message, keyboard);
  }

  async requestDeliveryDocuments(loadId: string, driverId: string) {
    const driver = await this.storage.getDriver(driverId);
    const load = await this.storage.getLoad(loadId);
    
    if (!driver?.telegramId || !load) return;

    const message = `🚚 **DELIVERY DOCUMENTATION REQUIRED**\n\n` +
      `Load: ${load.loadNumber}\n` +
      `Location: ${load.deliveryAddress}\n\n` +
      `Please upload the following:\n\n` +
      `📸 **Delivery Photo** (showing freight at destination)\n\n` +
      `This confirms successful delivery to the customer.`;

    const keyboard = {
      inline_keyboard: [
        [
          { 
            text: '📸 Upload Delivery Photo', 
            callback_data: `upload_delivery_${loadId}` 
          }
        ]
      ]
    };

    await this.telegramService.sendMessage(driver.telegramId, message, keyboard);
  }

  async getLoadDocuments(loadId: string) {
    return await this.storage.getLoadDocumentsByLoad(loadId);
  }

  async getDriverDocuments(driverId: string) {
    return await this.storage.getLoadDocumentsByDriver(driverId);
  }

  async getDocumentsByType(loadId: string, documentType: string) {
    return await this.storage.getLoadDocumentsByType(loadId, documentType);
  }

  async generateUploadUrl() {
    return await this.objectStorageService.getObjectEntityUploadURL();
  }
}