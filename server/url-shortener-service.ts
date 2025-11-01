/**
 * URL Shortening Service
 * 
 * Uses Shrtco.de free API for converting long URLs to short, professional links
 * No API key required, unlimited usage
 */

interface ShortenResult {
  success: boolean;
  shortUrl?: string;
  error?: string;
  originalUrl?: string;
}

class URLShortenerService {
  private cache: Map<string, string> = new Map();
  private readonly API_URL = 'https://api.shrtco.de/v2/shorten';
  
  /**
   * Shorten a URL using Shrtco.de API
   */
  async shortenUrl(longUrl: string): Promise<ShortenResult> {
    // Check cache first
    if (this.cache.has(longUrl)) {
      return {
        success: true,
        shortUrl: this.cache.get(longUrl)!,
        originalUrl: longUrl
      };
    }

    try {
      // Call Shrtco.de API (no auth required!)
      const response = await fetch(`${this.API_URL}?url=${encodeURIComponent(longUrl)}`);
      
      if (!response.ok) {
        throw new Error(`Shortening failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'URL shortening failed');
      }

      const shortUrl = data.result.full_short_link;
      
      // Cache the result
      this.cache.set(longUrl, shortUrl);
      
      console.log(`✅ URL shortened: ${longUrl.substring(0, 50)}... → ${shortUrl}`);
      
      return {
        success: true,
        shortUrl,
        originalUrl: longUrl
      };
    } catch (error) {
      console.error('❌ URL shortening error:', error);
      
      // Fallback: return original URL if shortening fails
      return {
        success: false,
        shortUrl: longUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
        originalUrl: longUrl
      };
    }
  }

  /**
   * Shorten multiple URLs in parallel
   */
  async shortenUrls(urls: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    
    const promises = urls.map(async (url) => {
      const result = await this.shortenUrl(url);
      return { url, shortUrl: result.shortUrl || url };
    });

    const settled = await Promise.all(promises);
    settled.forEach(({ url, shortUrl }) => {
      results.set(url, shortUrl);
    });

    return results;
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; urls: string[] } {
    return {
      size: this.cache.size,
      urls: Array.from(this.cache.keys())
    };
  }
}

// Export singleton instance
export const urlShortener = new URLShortenerService();
