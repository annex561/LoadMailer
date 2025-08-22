import { DATScraperControl } from '@/components/DATScraperControl';

export default function DATScraperPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">DAT Puppeteer Scraper</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Direct DAT LoadLink integration using Puppeteer automation
        </p>
      </div>
      
      <DATScraperControl />
    </div>
  );
}