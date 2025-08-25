import Papa from 'papaparse';

export class GoogleSheetsCsvService {
  private cache = new Set<string>();

  // Get CSV data from Google Sheets export URL
  async getCsvData(spreadsheetId: string): Promise<any[]> {
    try {
      // Use CSV export URL for more reliable data fetching
      const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
      console.log(`📊 Fetching CSV data from: ${csvUrl}`);
      
      const response = await fetch(csvUrl);
      
      if (!response.ok) {
        throw new Error(`CSV fetch failed: ${response.status} ${response.statusText}`);
      }
      
      const csvText = await response.text();
      return this.parseCsv(csvText);
    } catch (error) {
      console.error('❌ Error fetching CSV data:', error);
      throw error;
    }
  }

  // Parse CSV using PapaParse for better reliability
  private async parseCsv(csvText: string): Promise<any[]> {
    const result = Papa.parse(csvText, { 
      header: true, 
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim()
    });
    
    if (result.errors?.length) {
      console.warn('CSV parse warnings:', result.errors.slice(0, 3));
    }
    
    return this.normalizeRows(result.data);
  }

  // Normalize rows to consistent column names
  private normalizeRows(rows: any[]): any[] {
    return rows.map(r => ({
      Pay: this.getColumnValue(r, 'Pay'),
      'Total miles': this.getColumnValue(r, 'Total miles'),
      'Pick Up': this.getColumnValue(r, 'Pick Up') || this.getColumnValue(r, 'Pick up address'),
      Delivery: this.getColumnValue(r, 'Delivery') || this.getColumnValue(r, 'Delivery address'),
      'pick up date': this.getColumnValue(r, 'pick up date'),
      Deadhead: this.getColumnValue(r, 'Deadhead'),
      Weight: this.getColumnValue(r, 'Weight'),
      'Load Type': this.getColumnValue(r, 'Load Type'),
      'Contact Info': this.getColumnValue(r, 'Contact Info'),
      Company: this.getColumnValue(r, 'Company')
    }));
  }

  // Get column value with case-insensitive matching
  private getColumnValue(row: any, columnName: string): string {
    if (!row) return '';
    
    // Try exact match first
    if (row[columnName] !== undefined) {
      return String(row[columnName] || '').trim();
    }
    
    // Try case-insensitive match
    const lowerName = columnName.toLowerCase();
    for (const [key, value] of Object.entries(row)) {
      if (key.toLowerCase() === lowerName) {
        return String(value || '').trim();
      }
    }
    
    return '';
  }

  // Generate unique key for deduplication (like in your CSV approach)
  private keyOf(row: any): string {
    return `${(row['Pick Up'] || '').trim()}→${(row['Delivery'] || '').trim()}|${(row['pick up date'] || '').trim()}|${(row['Company'] || '').trim()}|${(row['Contact Info'] || '').trim()}`.toLowerCase();
  }

  // Parse delivery date from various formats
  private parseDeliveryDate(row: any): Date | null {
    const now = new Date();
    const thisYear = now.getFullYear();

    const explicit = this.getColumnValue(row, 'Delivery Date') || this.getColumnValue(row, 'drop off date') || this.getColumnValue(row, 'Drop Date');
    const rangeOrPick = explicit || this.getColumnValue(row, 'pick up date');

    if (!rangeOrPick) return null;

    const text = rangeOrPick.replace(/\s+/g, ' ').trim();

    // If a single M/D[/YYYY]
    const single = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (single) {
      const [, m, d, y] = single;
      return this.safeDate(+m, +d, y ? this.normalizeYear(y) : thisYear, now);
    }

    // If a range like "8/24 - 8/27" or "8/24–8/27"
    const range = text.match(/(\d{1,2})\/(\d{1,2})\s*[–\-]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
    if (range) {
      const [, m1, d1, m2, d2, y] = range;
      const year = y ? this.normalizeYear(y) : thisYear;
      return this.safeDate(+m2, +d2, year, now, { startM: +m1, startD: +d1 });
    }

    return null;
  }

  private normalizeYear(y: string | number): number {
    const yy = +y;
    if (yy < 100) return 2000 + yy; // "25" -> 2025
    return yy;
  }

  // Builds a Date safely and handles cross-year spans like "12/30 - 1/3"
  private safeDate(m: number, d: number, y: number, now: Date, start?: { startM: number, startD: number }): Date {
    let dt = new Date(y, m - 1, d);
    if (start) {
      const startDate = new Date(y, start.startM - 1, start.startD);
      // If end appears earlier in the calendar than start, assume it crossed New Year
      if (dt < startDate) dt = new Date(y + 1, m - 1, d);
    }
    // If it's absurdly old (> 370 days behind), bump to next year (helps around New Year)
    if ((now.getTime() - dt.getTime()) > 370 * 864e5) dt = new Date(y + 1, m - 1, d);
    return dt;
  }

  // Check if load is expired
  private isExpired(row: any): boolean {
    const last = this.parseDeliveryDate(row);
    if (!last) return false; // keep if unknown
    const midnightToday = new Date(); 
    midnightToday.setHours(0, 0, 0, 0);
    return last < midnightToday;
  }

  // Transform normalized CSV rows to loads (replaces the old transformToLoads)
  transformCsvToLoads(csvRows: any[]): any[] {
    if (!csvRows || csvRows.length === 0) return [];

    const activeLoads = [];
    let added = 0;

    for (const row of csvRows) {
      // Skip expired loads
      if (this.isExpired(row)) continue;

      const key = this.keyOf(row);
      if (!this.cache.has(key)) {
        this.cache.add(key);
        
        const load = {
          id: `csv_${Date.now()}_${added}`,
          source: 'Google Sheets CSV',
          status: 'available',
          scrapedAt: new Date().toISOString(),
          
          // Map normalized columns to load fields
          origin: row['Pick Up'] || '',
          destination: row['Delivery'] || '',
          rate: this.parseRate(row['Pay']),
          miles: this.parseNumber(row['Total miles']),
          equipmentType: this.normalizeEquipment(row['Load Type']),
          company: row['Company'] || '',
          phone: row['Contact Info'] || '',
          pickupDate: this.parseDate(row['pick up date']),
          deliveryDate: null,
          weight: this.parseWeight(row['Weight']),
          commodity: 'General Freight',
          deadhead: row['Deadhead'] || '',

          // Parse origin/destination into city/state
          originCity: this.parseCity(row['Pick Up']),
          originState: this.parseState(row['Pick Up']),
          destinationCity: this.parseCity(row['Delivery']),
          destinationState: this.parseState(row['Delivery']),

          // Additional fields
          description: `${row['Company'] || 'Freight'} - ${row['Pick Up']} to ${row['Delivery']}`,
          loadNumber: `CSV-${Date.now()}${String(added).padStart(3, '0')}`,
          priority: 'normal',
          ratePer: 'total'
        };

        activeLoads.push(load);
        added++;
      }
    }

    console.log(`📊 Processed ${csvRows.length} CSV rows, added ${added} new loads, cache size: ${this.cache.size}`);
    return activeLoads;
  }

  // Helper methods from original service
  private parseRate(value: string): number {
    if (!value) return 0;
    const cleanValue = value.replace(/[^0-9.]/g, '');
    return parseFloat(cleanValue) || 0;
  }

  private parseNumber(value: string): number {
    if (!value) return 0;
    const cleanValue = value.replace(/[^0-9.]/g, '');
    return parseFloat(cleanValue) || 0;
  }

  private parseWeight(value: string): number | null {
    if (!value) return null;
    const cleanValue = value.replace(/[^0-9.]/g, '');
    const weight = parseFloat(cleanValue);
    return isNaN(weight) ? null : weight;
  }

  private parseDate(value: string): string | null {
    if (!value) return null;
    try {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date.toISOString();
    } catch {
      return null;
    }
  }

  private normalizeEquipment(value: string): string {
    if (!value) return 'dry_van';
    const lower = value.toLowerCase();
    if (lower.includes('dry') || lower.includes('van')) return 'dry_van';
    if (lower.includes('refrigerated') || lower.includes('reefer')) return 'refrigerated';
    if (lower.includes('flatbed') || lower.includes('flat')) return 'flatbed';
    return 'dry_van';
  }

  private parseCity(address: string): string {
    if (!address) return '';
    const parts = address.split(',');
    return parts[0]?.trim() || '';
  }

  private parseState(address: string): string {
    if (!address) return '';
    const parts = address.split(',');
    if (parts.length >= 2) {
      const stateZip = parts[1].trim();
      return stateZip.split(' ')[0] || '';
    }
    return '';
  }
}