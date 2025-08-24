/**
 * DAT LoadLink Auto Scraper
 * Automatically clicks through loads and extracts data for LoadMaster
 * 
 * Usage: 
 * 1. Navigate to DAT LoadLink search results
 * 2. Open browser console (F12)
 * 3. Copy/paste this script and run it
 * 4. Script will automatically process all visible loads
 */

class DATAutoScraper {
  constructor(webhookUrl = 'https://66c29e54-1226-40b2-99a7-6591af2210d8-00-rjlpbou3l6wt.spock.replit.dev/api/taskmagic/webhook/single-load') {
    this.webhookUrl = webhookUrl;
    this.processedLoads = new Set();
    this.currentIndex = 0;
    this.isRunning = false;
    
    // Configuration
    this.config = {
      delayBetweenLoads: 2000,     // 2 seconds between each load
      maxRetries: 3,               // Max retries for failed requests
      scrollDelay: 1000,           // Delay after scrolling to load more
      detailViewDelay: 1500        // Wait time for load details to appear
    };
    
    console.log('🚚 DAT Auto Scraper initialized');
    console.log('📡 Webhook URL:', this.webhookUrl);
  }

  // Get all load rows from the current page
  getLoadRows() {
    // Multiple selectors to find load rows in different DAT layouts
    const selectors = [
      'tbody tr[data-testid*="load"]',  // New DAT interface
      'tbody tr:has(.rate-column)',     // Rows with rate info
      'table tbody tr:not(:first-child)', // All table rows except header
      '[data-cy="load-row"]',          // Cypress test selector
      '.load-result-row',              // Class-based selector
      'tbody tr'                       // Fallback - all tbody rows
    ];
    
    for (const selector of selectors) {
      const rows = document.querySelectorAll(selector);
      if (rows.length > 0) {
        console.log(`✅ Found ${rows.length} load rows using selector: ${selector}`);
        return Array.from(rows).filter(row => this.isValidLoadRow(row));
      }
    }
    
    console.warn('⚠️ No load rows found');
    return [];
  }

  // Validate if a row contains load data
  isValidLoadRow(row) {
    // Check if row has typical load data indicators
    const hasRate = row.textContent.includes('$') || row.querySelector('[class*="rate"]');
    const hasLocation = row.textContent.match(/[A-Z]{2}/) || row.querySelector('[class*="location"]');
    const hasEquipment = row.textContent.includes('SB') || row.textContent.includes('Box') || row.textContent.includes('Van');
    
    return hasRate && (hasLocation || hasEquipment) && row.textContent.trim().length > 10;
  }

  // Extract load data from a row
  extractLoadData(row, index) {
    const cells = row.querySelectorAll('td');
    const loadData = {
      id: `dat_load_${Date.now()}_${index}`,
      source: 'DAT LoadLink',
      scrapedAt: new Date().toISOString(),
      rowIndex: index
    };

    try {
      // Parse based on typical DAT column structure
      if (cells.length >= 6) {
        // Age column (index 0)
        loadData.age = this.cleanText(cells[0]?.textContent);
        
        // Rate column (index 1)
        const rateText = cells[1]?.textContent || '';
        loadData.rate = this.extractRate(rateText);
        loadData.ratePer = this.extractRatePer(rateText);
        
        // Trip/Route column (index 2)
        const tripText = cells[2]?.textContent || '';
        loadData.miles = this.extractMiles(tripText);
        loadData.tripId = this.extractTripId(tripText);
        
        // Origin column (index 3-4)
        const originText = cells[3]?.textContent || '';
        const [originCity, originState] = this.parseLocation(originText);
        loadData.originCity = originCity;
        loadData.originState = originState;
        
        // Deadhead/Pickup column
        loadData.deadhead = this.cleanText(cells[4]?.textContent);
        
        // Equipment column (index 5)
        loadData.equipmentType = this.normalizeEquipment(cells[5]?.textContent);
        
        // Company column (index 6)
        loadData.company = this.cleanText(cells[6]?.textContent);
        
        // Additional columns if available
        if (cells.length > 7) {
          loadData.laneRate = this.cleanText(cells[7]?.textContent);
        }
        if (cells.length > 8) {
          loadData.triHaul = this.cleanText(cells[8]?.textContent);
        }
      }

      // Extract destination from route info
      const routeInfo = row.textContent.match(/([A-Z]{2})\s*→\s*([A-Z]{2})/);
      if (routeInfo) {
        loadData.destinationState = routeInfo[2];
      }

      // Look for additional data in data attributes
      const dataAttributes = row.attributes;
      for (let attr of dataAttributes) {
        if (attr.name.startsWith('data-')) {
          loadData[attr.name.replace('data-', '')] = attr.value;
        }
      }

      console.log(`📦 Extracted load data:`, loadData);
      return loadData;

    } catch (error) {
      console.error('❌ Error extracting load data:', error);
      return { ...loadData, error: error.message };
    }
  }

  // Helper methods for data extraction
  extractRate(text) {
    const match = text.match(/\$?([\d,]+)/);
    return match ? parseInt(match[1].replace(/,/g, '')) : null;
  }

  extractRatePer(text) {
    if (text.includes('/mi')) return 'mile';
    if (text.includes('/lb')) return 'pound';
    return 'total';
  }

  extractMiles(text) {
    const match = text.match(/(\d+)\s*mi/i);
    return match ? parseInt(match[1]) : null;
  }

  extractTripId(text) {
    const match = text.match(/(\d{3,})/);
    return match ? match[1] : null;
  }

  parseLocation(text) {
    const cleaned = text.replace(/[^\w\s,]/g, '').trim();
    const parts = cleaned.split(/[,\s]+/);
    
    if (parts.length >= 2) {
      return [parts[0], parts[parts.length - 1]]; // First part = city, last = state
    }
    return [cleaned, null];
  }

  normalizeEquipment(text) {
    const cleaned = text.toLowerCase().trim();
    if (cleaned.includes('box') || cleaned.includes('sb')) return 'straight_box_truck';
    if (cleaned.includes('van') || cleaned.includes('dv')) return 'dry_van';
    if (cleaned.includes('reefer') || cleaned.includes('ref')) return 'refrigerated_truck';
    if (cleaned.includes('flat') || cleaned.includes('fb')) return 'flatbed_truck';
    return cleaned;
  }

  cleanText(text) {
    return text ? text.trim().replace(/\s+/g, ' ') : '';
  }

  // Send load data to LoadMaster webhook
  async sendToWebhook(loadData) {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-taskmagic-secret': 'taskmagic-webhook-secret-2025'
        },
        body: JSON.stringify(loadData)
      });

      if (response.ok) {
        console.log(`✅ Load ${loadData.id} sent successfully`);
        return true;
      } else {
        console.error(`❌ Failed to send load ${loadData.id}:`, response.status);
        return false;
      }
    } catch (error) {
      console.error(`❌ Webhook error for load ${loadData.id}:`, error);
      return false;
    }
  }

  // Click on a load row and wait for details
  async clickLoad(row) {
    try {
      // Scroll into view
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.delay(500);

      // Highlight the row being processed
      row.style.backgroundColor = '#e3f2fd';
      row.style.border = '2px solid #2196f3';

      // Click the row
      row.click();
      
      // Wait for any detail views to load
      await this.delay(this.config.detailViewDelay);

      console.log('🖱️ Clicked load row');
      return true;
    } catch (error) {
      console.error('❌ Error clicking load:', error);
      return false;
    }
  }

  // Utility function for delays
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Check if there are more loads to load (pagination/infinite scroll)
  async loadMoreLoads() {
    // Look for "Load More" button
    const loadMoreBtn = document.querySelector('[class*="load-more"], [class*="show-more"], button:contains("Load More")');
    if (loadMoreBtn && loadMoreBtn.offsetParent !== null) {
      console.log('📄 Loading more results...');
      loadMoreBtn.click();
      await this.delay(this.config.scrollDelay);
      return true;
    }

    // Try infinite scroll
    const lastRow = document.querySelector('tbody tr:last-child');
    if (lastRow) {
      lastRow.scrollIntoView();
      await this.delay(this.config.scrollDelay);
      
      // Check if new rows appeared
      const newRows = this.getLoadRows();
      return newRows.length > this.processedLoads.size;
    }

    return false;
  }

  // Main processing function
  async processAllLoads() {
    if (this.isRunning) {
      console.log('⚠️ Scraper already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Starting DAT Auto Scraper...');

    try {
      let hasMoreLoads = true;
      let totalProcessed = 0;
      let successCount = 0;

      while (hasMoreLoads) {
        const loadRows = this.getLoadRows();
        
        if (loadRows.length === 0) {
          console.log('❌ No loads found to process');
          break;
        }

        // Process each load that hasn't been processed yet
        for (let i = 0; i < loadRows.length; i++) {
          const row = loadRows[i];
          const rowId = this.getRowId(row);

          if (this.processedLoads.has(rowId)) {
            continue; // Skip already processed loads
          }

          console.log(`\n🔄 Processing load ${i + 1}/${loadRows.length}`);

          // Click and extract data
          await this.clickLoad(row);
          const loadData = this.extractLoadData(row, i);
          
          // Send to webhook
          const success = await this.sendToWebhook(loadData);
          
          if (success) {
            successCount++;
            this.processedLoads.add(rowId);
          }

          totalProcessed++;

          // Reset row styling
          row.style.backgroundColor = '';
          row.style.border = '';

          // Delay between loads
          await this.delay(this.config.delayBetweenLoads);
        }

        // Try to load more loads
        hasMoreLoads = await this.loadMoreLoads();
        
        if (!hasMoreLoads) {
          console.log('✅ No more loads to process');
        }
      }

      console.log(`\n🎉 Scraping completed!`);
      console.log(`📊 Total processed: ${totalProcessed}`);
      console.log(`✅ Successfully sent: ${successCount}`);
      console.log(`❌ Failed: ${totalProcessed - successCount}`);

    } catch (error) {
      console.error('❌ Fatal error during scraping:', error);
    } finally {
      this.isRunning = false;
    }
  }

  // Generate unique ID for a row
  getRowId(row) {
    return row.textContent.slice(0, 50) + '_' + Array.from(row.children).length;
  }

  // Stop the scraper
  stop() {
    this.isRunning = false;
    console.log('🛑 Scraper stopped');
  }

  // Get status
  getStatus() {
    return {
      isRunning: this.isRunning,
      processedCount: this.processedLoads.size,
      currentIndex: this.currentIndex
    };
  }
}

// Initialize and expose globally
window.datScraper = new DATAutoScraper();

// Console commands for easy use
console.log(`
🚚 DAT Auto Scraper Ready!

Commands:
  datScraper.processAllLoads()  - Start scraping all loads
  datScraper.stop()            - Stop the scraper
  datScraper.getStatus()       - Check current status

Example usage:
  datScraper.processAllLoads();
`);