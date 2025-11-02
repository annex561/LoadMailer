/**
 * URL Shortening Service
 * 
 * Uses TinyURL API for converting long URLs to short, professional links
 * No API key required, reliable and works in all environments
 */

interface ShortenResult {
  success: boolean;
  shortUrl?: string;
  error?: string;
  originalUrl?: string;
}

class URLShortenerService {
  private cache: Map<string, string> = new Map();
  private readonly API_URL = 'https://tinyurl.com/api-create.php';
  
  /**
   * Shorten a URL using TinyURL API
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
      // Call TinyURL API (simple and reliable!)
      const response = await fetch(`${this.API_URL}?url=${encodeURIComponent(longUrl)}`);
      
      if (!response.ok) {
        throw new Error(`Shortening failed: ${response.statusText}`);
      }

      const shortUrl = await response.text();
      
      // Validate the shortened URL
      if (!shortUrl || !shortUrl.startsWith('http')) {
        throw new Error('Invalid shortened URL response');
      }
      
      // Cache the result
      this.cache.set(longUrl, shortUrl.trim());
      
      console.log(`✅ URL shortened: ${longUrl.substring(0, 50)}... → ${shortUrl.trim()}`);
      
      return {
        success: true,
        shortUrl: shortUrl.trim(),
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
