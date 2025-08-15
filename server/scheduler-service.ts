import cron from "node-cron";
import { DATScraper, type ScraperConfig } from "./dat-scraper";
import { storage } from "./storage";
import type { ScraperConfig as DBScraperConfig } from "@shared/schema";

export interface ScheduledTask {
  id: string;
  configId: string;
  schedule: string;
  task: any;
  scraper: DATScraper;
}

export class SchedulerService {
  private tasks: Map<string, ScheduledTask> = new Map();
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Load all enabled scraper configurations
      const configs = await storage.getAllScraperConfigs();
      const enabledConfigs = configs.filter(config => config.enabled);

      console.log(`Found ${enabledConfigs.length} enabled scraper configurations`);

      // Schedule each enabled configuration
      for (const config of enabledConfigs) {
        await this.scheduleScraperTask(config);
      }

      this.isInitialized = true;
      console.log('Scheduler service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize scheduler service:', error);
      throw error;
    }
  }

  async scheduleScraperTask(config: DBScraperConfig): Promise<void> {
    try {
      // Remove existing task if it exists
      await this.removeTask(config.id);

      // Convert DB config to scraper config
      const scraperConfig: ScraperConfig = {
        enabled: config.enabled,
        loginUrl: config.loginUrl,
        searchUrl: config.searchUrl,
        username: config.username || undefined,
        password: config.password || undefined,
        searchCriteria: (config.searchCriteria as any) || {},
        schedule: config.schedule,
        autoCreateLoads: config.autoCreateLoads,
        defaultCustomerId: config.defaultCustomerId || undefined
      };

      // Create scraper instance
      const scraper = new DATScraper(scraperConfig);

      // Validate cron schedule
      if (!cron.validate(config.schedule)) {
        console.error(`Invalid cron schedule for config ${config.id}: ${config.schedule}`);
        return;
      }

      // Schedule the task with seconds support
      const task = cron.schedule(config.schedule, async () => {
        await this.executeScraperTask(config.id, scraper);
      }, {
        scheduled: false
      });

      // Store the scheduled task
      const scheduledTask: ScheduledTask = {
        id: `scraper_${config.id}`,
        configId: config.id,
        schedule: config.schedule,
        task,
        scraper
      };

      this.tasks.set(config.id, scheduledTask);

      // Start the task
      task.start();

      console.log(`Scheduled scraper task for config ${config.id} with schedule: ${config.schedule}`);
    } catch (error) {
      console.error(`Failed to schedule scraper task for config ${config.id}:`, error);
    }
  }

  private async executeScraperTask(configId: string, scraper: DATScraper): Promise<void> {
    const startTime = Date.now();
    console.log(`Starting scraper task for config ${configId}`);

    try {
      // Create log entry
      const logEntry = await storage.createScraperLog({
        configId,
        status: 'running',
        loadsScraped: 0,
        loadsCreated: 0,
        startedAt: new Date(),
        metadata: { scheduledRun: true }
      });

      // Execute scraper
      const result = await scraper.run();
      const executionTime = Date.now() - startTime;

      // Update log entry with results
      await storage.updateScraperLog(logEntry.id, {
        status: result.success ? 'success' : 'error',
        loadsScraped: result.loadsScraped,
        loadsCreated: result.loadsCreated,
        errorMessage: result.error,
        executionTime,
        completedAt: new Date()
      });

      // Update config with last run time
      await storage.updateScraperConfig(configId, {
        lastRunAt: new Date()
      });

      console.log(`Scraper task completed for config ${configId}. Scraped: ${result.loadsScraped}, Created: ${result.loadsCreated}`);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      console.error(`Scraper task failed for config ${configId}:`, errorMessage);

      // Log the error
      try {
        const logEntry = await storage.createScraperLog({
          configId,
          status: 'error',
          loadsScraped: 0,
          loadsCreated: 0,
          errorMessage,
          executionTime,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          metadata: { scheduledRun: true, error: true }
        });
      } catch (logError) {
        console.error('Failed to create error log:', logError);
      }
    }
  }

  async removeTask(configId: string): Promise<void> {
    const existingTask = this.tasks.get(configId);
    if (existingTask) {
      existingTask.task.stop();
      existingTask.task.destroy();
      await existingTask.scraper.cleanup();
      this.tasks.delete(configId);
      console.log(`Removed scheduled task for config ${configId}`);
    }
  }

  async updateTask(config: DBScraperConfig): Promise<void> {
    if (config.enabled) {
      await this.scheduleScraperTask(config);
    } else {
      await this.removeTask(config.id);
    }
  }

  async runTaskNow(configId: string): Promise<{ success: boolean; loadsScraped: number; loadsCreated: number; error?: string }> {
    try {
      const config = await storage.getScraperConfig(configId);
      if (!config) {
        throw new Error(`Scraper configuration not found: ${configId}`);
      }

      const scraperConfig: ScraperConfig = {
        enabled: config.enabled,
        loginUrl: config.loginUrl,
        searchUrl: config.searchUrl,
        username: config.username || undefined,
        password: config.password || undefined,
        searchCriteria: (config.searchCriteria as any) || {},
        schedule: config.schedule,
        autoCreateLoads: config.autoCreateLoads,
        defaultCustomerId: config.defaultCustomerId || undefined
      };

      const scraper = new DATScraper(scraperConfig);
      const result = await scraper.run();

      // Log the manual run
      await storage.createScraperLog({
        configId,
        status: result.success ? 'success' : 'error',
        loadsScraped: result.loadsScraped,
        loadsCreated: result.loadsCreated,
        errorMessage: result.error,
        startedAt: new Date(),
        completedAt: new Date(),
        metadata: { manualRun: true }
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Manual scraper run failed for config ${configId}:`, errorMessage);
      return {
        success: false,
        loadsScraped: 0,
        loadsCreated: 0,
        error: errorMessage
      };
    }
  }

  getScheduledTasks(): Array<{ configId: string; schedule: string; isRunning: boolean }> {
    return Array.from(this.tasks.values()).map(task => ({
      configId: task.configId,
      schedule: task.schedule,
      isRunning: task.task.getStatus() === 'scheduled'
    }));
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down scheduler service...');
    
    for (const task of this.tasks.values()) {
      try {
        task.task.stop();
        task.task.destroy();
        await task.scraper.cleanup();
        console.log(`Stopped task for config ${task.configId}`);
      } catch (error) {
        console.error(`Error stopping task for config ${task.configId}:`, error);
      }
    }
    
    this.tasks.clear();
    this.isInitialized = false;
    console.log('Scheduler service shutdown complete');
  }
}

// Singleton instance
export const schedulerService = new SchedulerService();

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down gracefully...');
  await schedulerService.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...');
  await schedulerService.shutdown();
  process.exit(0);
});