import puppeteer from 'puppeteer';
import { storage } from './storage';
import type { Load, LoadDocument, Customer, Driver } from '@shared/schema';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);

export class PDFService {
  private browser: any = null;

  constructor() {}

  async initialize(): Promise<void> {
    try {
      console.log('📄 Initializing PDF Service...');
      // Puppeteer browser will be launched on-demand
      console.log('✅ PDF Service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize PDF Service:', error);
    }
  }

  async generateLoadDocumentPackage(loadId: string): Promise<{ pdfPath: string; pdfUrl: string }> {
    try {
      console.log(`📄 Generating PDF package for load ${loadId}...`);
      
      // Fetch load details
      const load = await storage.getLoad(loadId);
      if (!load) {
        throw new Error(`Load ${loadId} not found`);
      }

      // Fetch all approved documents for this load
      const allDocuments = await storage.getLoadDocumentsByLoad(loadId);
      const approvedDocuments = allDocuments.filter(doc => doc.approvalStatus === 'approved');

      if (approvedDocuments.length === 0) {
        throw new Error(`No approved documents found for load ${load.loadNumber}`);
      }

      // Fetch customer and driver details
      const customer = await storage.getCustomer(load.customerId);
      const driver = load.driverId ? await storage.getDriver(load.driverId) : null;

      // Sort documents: BOL first, POD second, then others
      const sortedDocuments = this.sortDocuments(approvedDocuments);

      // Generate HTML for PDF
      const htmlContent = await this.generatePDFHTML(load, customer, driver, sortedDocuments);

      // Launch puppeteer and generate PDF
      const pdfBuffer = await this.htmlToPDF(htmlContent);

      // Save PDF to /tmp directory
      const pdfFileName = `load_${load.loadNumber}_documents_${Date.now()}.pdf`;
      const pdfPath = path.join('/tmp', pdfFileName);
      
      // Ensure /tmp directory exists
      try {
        await mkdir('/tmp', { recursive: true });
      } catch (e) {
        // Directory might already exist, ignore
      }
      
      await writeFile(pdfPath, pdfBuffer);

      // Generate download URL (served from /tmp via route)
      const pdfUrl = `/api/loads/${loadId}/download-pdf/${pdfFileName}`;

      console.log(`✅ PDF package generated: ${pdfFileName}`);
      
      return { pdfPath, pdfUrl };
    } catch (error) {
      console.error(`❌ Error generating PDF package:`, error);
      throw error;
    }
  }

  private sortDocuments(documents: LoadDocument[]): LoadDocument[] {
    const order = ['bol', 'pod', 'weight_ticket', 'scale_ticket', 'inspection', 'receipt', 'fuel_receipt', 'freight_photo', 'other'];
    
    return documents.sort((a, b) => {
      const aIndex = order.indexOf(a.documentType);
      const bIndex = order.indexOf(b.documentType);
      
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      
      return aIndex - bIndex;
    });
  }

  private async generatePDFHTML(
    load: Load,
    customer: Customer | null,
    driver: Driver | null,
    documents: LoadDocument[]
  ): Promise<string> {
    const formatDate = (date: Date | string | null) => {
      if (!date) return 'N/A';
      const d = new Date(date);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    const formatTime = (time: string | null) => {
      if (!time) return 'N/A';
      return time;
    };

    const getDocumentTypeLabel = (type: string): string => {
      const labels: Record<string, string> = {
        'bol': 'Bill of Lading (BOL)',
        'pod': 'Proof of Delivery (POD)',
        'weight_ticket': 'Weight Ticket',
        'scale_ticket': 'Scale Ticket',
        'inspection': 'Inspection Report',
        'receipt': 'Receipt',
        'fuel_receipt': 'Fuel Receipt',
        'freight_photo': 'Freight Photo',
        'other': 'Other Document'
      };
      return labels[type] || type.toUpperCase();
    };

    // Generate document summary table rows
    const documentRows = documents.map((doc, index) => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${index + 1}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${getDocumentTypeLabel(doc.documentType)}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${formatDate(doc.uploadedAt)}</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
          <span style="background: #10b981; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">
            ✓ APPROVED
          </span>
        </td>
      </tr>
    `).join('');

    // Generate document pages (each document on separate page)
    const documentPages = await Promise.all(documents.map(async (doc, index) => {
      let imageBase64 = '';
      
      // Convert image to base64 if it's an image
      if (doc.mimeType?.startsWith('image/')) {
        try {
          // Try to fetch and convert image to base64
          // For now, we'll use the URL directly in img tag
          imageBase64 = doc.fileUrl;
        } catch (error) {
          console.error(`Error loading image for document ${doc.id}:`, error);
        }
      }

      return `
        <div style="page-break-before: always; padding: 40px;">
          <div style="margin-bottom: 30px;">
            <h2 style="color: #1f2937; font-size: 24px; font-weight: 700; margin-bottom: 8px;">
              Document ${index + 1}: ${getDocumentTypeLabel(doc.documentType)}
            </h2>
            <div style="display: flex; gap: 20px; font-size: 14px; color: #6b7280;">
              <span><strong>Uploaded:</strong> ${formatDate(doc.uploadedAt)}</span>
              <span><strong>Approved:</strong> ${formatDate(doc.approvedAt)}</span>
              <span><strong>File:</strong> ${doc.fileName}</span>
            </div>
          </div>
          
          ${imageBase64 ? `
            <div style="text-align: center;">
              <img src="${imageBase64}" style="max-width: 100%; max-height: 800px; border: 1px solid #e5e7eb; border-radius: 8px;" />
            </div>
          ` : `
            <div style="padding: 40px; background: #f9fafb; border: 2px dashed #d1d5db; border-radius: 8px; text-align: center;">
              <p style="color: #6b7280; font-size: 16px;">Document preview not available</p>
              <p style="color: #9ca3af; font-size: 14px; margin-top: 8px;">File: ${doc.fileName}</p>
            </div>
          `}
          
          ${doc.notes ? `
            <div style="margin-top: 20px; padding: 16px; background: #f3f4f6; border-left: 4px solid #3b82f6; border-radius: 4px;">
              <strong style="color: #1f2937;">Notes:</strong>
              <p style="color: #4b5563; margin-top: 8px;">${doc.notes}</p>
            </div>
          ` : ''}
        </div>
      `;
    }));

    // Combine all HTML
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; }
          @page { margin: 0; }
        </style>
      </head>
      <body>
        <!-- Cover Page -->
        <div style="padding: 60px; height: 100vh; display: flex; flex-direction: column; justify-content: space-between;">
          <!-- Header -->
          <div>
            <div style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); padding: 40px; border-radius: 12px; margin-bottom: 40px;">
              <h1 style="color: white; font-size: 36px; font-weight: 800; margin-bottom: 8px;">
                Load Documentation Package
              </h1>
              <p style="color: #dbeafe; font-size: 18px;">
                Load Number: ${load.loadNumber}
              </p>
            </div>
            
            <!-- Load Details -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 40px;">
              <!-- Pickup Information -->
              <div style="background: #f9fafb; padding: 24px; border-radius: 8px; border-left: 4px solid #10b981;">
                <h3 style="color: #059669; font-size: 16px; font-weight: 700; margin-bottom: 16px;">📍 PICKUP</h3>
                <p style="color: #1f2937; font-size: 14px; line-height: 1.6; margin-bottom: 8px;">
                  <strong>Location:</strong><br/>${load.pickupAddress}
                </p>
                <p style="color: #1f2937; font-size: 14px;">
                  <strong>Date:</strong> ${formatDate(load.pickupDate)}<br/>
                  <strong>Time:</strong> ${formatTime(load.pickupTime)}
                </p>
              </div>
              
              <!-- Delivery Information -->
              <div style="background: #f9fafb; padding: 24px; border-radius: 8px; border-left: 4px solid #ef4444;">
                <h3 style="color: #dc2626; font-size: 16px; font-weight: 700; margin-bottom: 16px;">📦 DELIVERY</h3>
                <p style="color: #1f2937; font-size: 14px; line-height: 1.6; margin-bottom: 8px;">
                  <strong>Location:</strong><br/>${load.deliveryAddress}
                </p>
                <p style="color: #1f2937; font-size: 14px;">
                  <strong>Date:</strong> ${formatDate(load.deliveryDate)}<br/>
                  <strong>Time:</strong> ${formatTime(load.deliveryTime)}
                </p>
              </div>
            </div>
            
            <!-- Customer & Driver Info -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 40px;">
              ${customer ? `
                <div style="background: #eff6ff; padding: 24px; border-radius: 8px;">
                  <h3 style="color: #2563eb; font-size: 16px; font-weight: 700; margin-bottom: 12px;">🏢 Customer</h3>
                  <p style="color: #1f2937; font-size: 14px; line-height: 1.6;">
                    <strong>${customer.name}</strong><br/>
                    ${customer.contactPerson}<br/>
                    ${customer.email}<br/>
                    ${customer.phone}
                  </p>
                </div>
              ` : ''}
              
              ${driver ? `
                <div style="background: #fef3c7; padding: 24px; border-radius: 8px;">
                  <h3 style="color: #d97706; font-size: 16px; font-weight: 700; margin-bottom: 12px;">🚛 Driver</h3>
                  <p style="color: #1f2937; font-size: 14px; line-height: 1.6;">
                    <strong>${driver.name}</strong><br/>
                    ${driver.email}<br/>
                    ${driver.phone}
                  </p>
                </div>
              ` : ''}
            </div>
            
            <!-- Document Summary Table -->
            <div style="margin-bottom: 40px;">
              <h3 style="color: #1f2937; font-size: 20px; font-weight: 700; margin-bottom: 16px;">
                📋 Document Summary
              </h3>
              <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background: #f3f4f6;">
                    <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; border-bottom: 2px solid #d1d5db;">#</th>
                    <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; border-bottom: 2px solid #d1d5db;">Document Type</th>
                    <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; border-bottom: 2px solid #d1d5db;">Upload Date</th>
                    <th style="padding: 12px; text-align: left; font-weight: 700; color: #374151; border-bottom: 2px solid #d1d5db;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${documentRows}
                </tbody>
              </table>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="text-align: center; padding-top: 40px; border-top: 2px solid #e5e7eb;">
            <p style="color: #6b7280; font-size: 14px;">
              Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 8px;">
              Total Documents: ${documents.length} | All documents approved and verified
            </p>
          </div>
        </div>
        
        <!-- Individual Document Pages -->
        ${documentPages.join('')}
      </body>
      </html>
    `;

    return html;
  }

  private async htmlToPDF(html: string): Promise<Buffer> {
    let browser = null;
    try {
      // Launch browser
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: {
          top: '0mm',
          right: '0mm',
          bottom: '0mm',
          left: '0mm'
        }
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      console.error('Error generating PDF with Puppeteer:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    console.log('✅ PDF Service stopped');
  }
}

export const pdfService = new PDFService();
