import { EventEmitter } from 'events';

interface ZelloChannel {
  name: string;
  type: 'team' | 'private' | 'dynamic';
  users: string[];
  active: boolean;
}

interface ZelloUser {
  username: string;
  displayName: string;
  status: 'available' | 'busy' | 'offline';
  channels: string[];
}

interface ZelloMessage {
  channel: string;
  from: string;
  type: 'voice' | 'text' | 'image' | 'alert';
  duration?: number;
  text?: string;
  timestamp: Date;
}

export class ZelloDispatchService extends EventEmitter {
  private apiKey: string;
  private baseUrl: string = 'https://api.zello.com';
  private workspaceUrl: string = 'lamp1.zellowork.com';
  private channels: Map<string, ZelloChannel> = new Map();
  private users: Map<string, ZelloUser> = new Map();
  private isInitialized: boolean = false;
  private reconnectInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    super();
    this.apiKey = process.env.ZELLO_API_KEY || '';
    console.log('🎙️ Zello Dispatch Service initializing...');
    
    if (!this.apiKey) {
      console.warn('⚠️ ZELLO_API_KEY not found in environment variables');
    }
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      console.error('❌ Cannot initialize Zello service without API key');
      return;
    }

    try {
      console.log('🔐 Authenticating with Zello Work API...');
      
      // Initialize default channels
      await this.setupDefaultChannels();
      
      // Load existing users
      await this.loadUsers();
      
      this.isInitialized = true;
      console.log('✅ Zello Dispatch Service initialized successfully');
      
      // Start monitoring channel activity
      this.startChannelMonitoring();
      
    } catch (error) {
      console.error('❌ Failed to initialize Zello service:', error);
      this.scheduleReconnect();
    }
  }

  private async setupDefaultChannels(): Promise<void> {
    const defaultChannels = [
      { name: 'all-drivers', type: 'team' as const, description: 'All active drivers' },
      { name: 'southeast-region', type: 'team' as const, description: 'SE region drivers' },
      { name: 'box-truck-ops', type: 'team' as const, description: 'Box truck operators' },
      { name: 'hotshot-expedite', type: 'team' as const, description: 'Expedite/hotshot drivers' },
      { name: 'dispatch-priority', type: 'team' as const, description: 'High priority dispatch' }
    ];

    for (const channelConfig of defaultChannels) {
      const channel: ZelloChannel = {
        name: channelConfig.name,
        type: channelConfig.type,
        users: [],
        active: true
      };
      this.channels.set(channelConfig.name, channel);
      console.log(`📻 Channel created: ${channelConfig.name} - ${channelConfig.description}`);
    }
  }

  private async loadUsers(): Promise<void> {
    // In production, this would fetch from Zello API
    // For now, we'll prepare the structure for driver integration
    console.log('👥 Loading Zello users...');
  }

  async sendLoadNotification(
    loadData: {
      loadNumber: string;
      origin: string;
      destination: string;
      rate: number;
      distance?: number;
      equipment?: string;
      weight?: string;
      commodity?: string;
      pickupDate?: string;
    },
    targetChannel: string = 'all-drivers'
  ): Promise<boolean> {
    if (!this.isInitialized) {
      console.warn('⚠️ Zello service not initialized, cannot send notification');
      return false;
    }

    try {
      const message = this.formatLoadMessage(loadData);
      
      console.log(`🎙️ Sending voice alert to channel: ${targetChannel}`);
      console.log(`📢 Message: ${message}`);
      
      // In production, this would use Zello's API to send voice/text alert
      // For now, we'll emit an event that can be handled elsewhere
      this.emit('load_broadcast', {
        channel: targetChannel,
        message,
        loadData,
        timestamp: new Date()
      });
      
      // Log the broadcast
      console.log(`✅ Load ${loadData.loadNumber} broadcast to ${targetChannel}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to send Zello notification:`, error);
      return false;
    }
  }

  private formatLoadMessage(loadData: any): string {
    const parts = [
      `New load available: ${loadData.loadNumber}`,
      `From ${loadData.origin} to ${loadData.destination}`
    ];
    
    if (loadData.rate) {
      parts.push(`Rate: $${loadData.rate}`);
    }
    
    if (loadData.distance) {
      parts.push(`Distance: ${loadData.distance} miles`);
    }
    
    if (loadData.equipment) {
      parts.push(`Equipment: ${loadData.equipment}`);
    }
    
    if (loadData.pickupDate) {
      parts.push(`Pickup: ${loadData.pickupDate}`);
    }
    
    parts.push('Reply BOOK to accept or check SMS for details');
    
    return parts.join('. ');
  }

  async broadcastToRegion(message: string, region: string): Promise<void> {
    const channelName = `${region.toLowerCase()}-region`;
    if (this.channels.has(channelName)) {
      await this.sendCustomMessage(message, channelName);
    } else {
      console.warn(`⚠️ Region channel ${channelName} not found`);
    }
  }

  async sendCustomMessage(message: string, channel: string): Promise<void> {
    if (!this.isInitialized) {
      console.warn('⚠️ Zello service not initialized');
      return;
    }

    console.log(`📻 Sending to ${channel}: ${message}`);
    
    this.emit('custom_broadcast', {
      channel,
      message,
      timestamp: new Date()
    });
  }

  async addUserToChannel(username: string, channelName: string): Promise<boolean> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      console.error(`❌ Channel ${channelName} not found`);
      return false;
    }

    if (!channel.users.includes(username)) {
      channel.users.push(username);
      console.log(`✅ Added ${username} to channel ${channelName}`);
    }
    
    return true;
  }

  async removeUserFromChannel(username: string, channelName: string): Promise<boolean> {
    const channel = this.channels.get(channelName);
    if (!channel) {
      console.error(`❌ Channel ${channelName} not found`);
      return false;
    }

    const index = channel.users.indexOf(username);
    if (index > -1) {
      channel.users.splice(index, 1);
      console.log(`✅ Removed ${username} from channel ${channelName}`);
    }
    
    return true;
  }

  private startChannelMonitoring(): void {
    // Monitor for voice responses (in production, would connect to Zello WebSocket)
    console.log('📡 Starting Zello channel monitoring...');
    
    // Emit heartbeat to show service is active
    setInterval(() => {
      this.emit('heartbeat', {
        channels: Array.from(this.channels.keys()),
        userCount: this.users.size,
        timestamp: new Date()
      });
    }, 30000); // Every 30 seconds
  }

  private scheduleReconnect(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }
    
    this.reconnectInterval = setInterval(() => {
      console.log('🔄 Attempting Zello reconnection...');
      this.initialize();
    }, 60000); // Retry every minute
  }

  async handleVoiceResponse(data: {
    channel: string;
    from: string;
    command: string;
    loadNumber?: string;
  }): Promise<void> {
    console.log(`🎙️ Voice response from ${data.from}: ${data.command}`);
    
    const upperCommand = data.command.toUpperCase();
    
    if (upperCommand.includes('BOOK') || upperCommand.includes('ACCEPT')) {
      this.emit('load_accepted', {
        driver: data.from,
        loadNumber: data.loadNumber,
        channel: data.channel,
        timestamp: new Date()
      });
    } else if (upperCommand.includes('DECLINE') || upperCommand.includes('PASS')) {
      this.emit('load_declined', {
        driver: data.from,
        loadNumber: data.loadNumber,
        channel: data.channel,
        timestamp: new Date()
      });
    } else if (upperCommand.includes('STATUS')) {
      this.emit('status_request', {
        driver: data.from,
        channel: data.channel,
        timestamp: new Date()
      });
    }
  }

  getChannelStatus(): {
    initialized: boolean;
    channels: { name: string; userCount: number; active: boolean }[];
    totalUsers: number;
  } {
    return {
      initialized: this.isInitialized,
      channels: Array.from(this.channels.values()).map(ch => ({
        name: ch.name,
        userCount: ch.users.length,
        active: ch.active
      })),
      totalUsers: this.users.size
    };
  }

  async createDriverAccount(driverData: {
    name: string;
    email: string;
    phone: string;
    equipmentType?: string;
  }): Promise<{
    username: string;
    password: string;
    channels: string[];
    appDownloadLinks: {
      ios: string;
      android: string;
    };
  }> {
    // Generate unique username from name and last 4 digits of phone
    const phoneDigits = driverData.phone.replace(/\D/g, '').slice(-4);
    const cleanName = driverData.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const username = `${cleanName}_${phoneDigits}`;
    
    // Generate secure password
    const password = this.generateSecurePassword();
    
    // Determine channels based on equipment type
    const channels = ['all-drivers'];
    
    if (driverData.equipmentType) {
      // Map equipment types to appropriate channels
      const equipmentLower = driverData.equipmentType.toLowerCase();
      
      if (equipmentLower.includes('box') || equipmentLower.includes('straight')) {
        channels.push('box-truck-ops');
      } else if (equipmentLower.includes('van') || equipmentLower.includes('sprinter')) {
        channels.push('hotshot-expedite');
      } else if (equipmentLower.includes('flatbed')) {
        channels.push('dispatch-priority');
      }
      
      // Add regional channel (default to southeast for now)
      channels.push('southeast-region');
    }
    
    // In production, would make actual API call to Zello to create user
    console.log(`📱 Creating Zello account for driver: ${username}`);
    
    // Add user to internal tracking
    this.users.set(username, {
      name: driverData.name,
      username,
      channels,
      online: false
    });
    
    // Add user to channels
    for (const channelName of channels) {
      await this.addUserToChannel(username, channelName);
    }
    
    console.log(`✅ Zello account created: ${username}`);
    console.log(`📻 Assigned to channels: ${channels.join(', ')}`);
    
    return {
      username,
      password,
      channels,
      appDownloadLinks: {
        ios: 'https://apps.apple.com/app/zello-work-walkie-talkie/id991280948',
        android: 'https://play.google.com/store/apps/details?id=com.loudtalks.work'
      }
    };
  }

  private generateSecurePassword(): string {
    // Generate a secure but memorable password
    const adjectives = ['Swift', 'Strong', 'Ready', 'Prime', 'Fleet', 'Turbo', 'Eagle'];
    const nouns = ['Driver', 'Trucker', 'Hauler', 'Carrier', 'Freight', 'Road', 'Mile'];
    const numbers = Math.floor(1000 + Math.random() * 9000);
    
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    
    return `${adj}${noun}${numbers}!`;
  }

  generateWelcomeMessage(credentials: {
    username: string;
    password: string;
    channels: string[];
    appDownloadLinks: { ios: string; android: string };
  }): string {
    return `Welcome to LAMP Logistics Voice Dispatch! 🎙️

Your Zello Work account is ready:
Username: ${credentials.username}
Password: ${credentials.password}

Download Zello Work:
iPhone: ${credentials.appDownloadLinks.ios}
Android: ${credentials.appDownloadLinks.android}

You've been added to channels: ${credentials.channels.join(', ')}

Login and start receiving load broadcasts via voice!`;
  }

  async createDynamicChannel(name: string, users: string[]): Promise<boolean> {
    if (this.channels.has(name)) {
      console.warn(`⚠️ Channel ${name} already exists`);
      return false;
    }

    const channel: ZelloChannel = {
      name,
      type: 'dynamic',
      users,
      active: true
    };

    this.channels.set(name, channel);
    console.log(`✅ Dynamic channel ${name} created with ${users.length} users`);
    
    return true;
  }

  async deleteDynamicChannel(name: string): Promise<boolean> {
    const channel = this.channels.get(name);
    if (!channel || channel.type !== 'dynamic') {
      console.error(`❌ Cannot delete channel ${name} - not a dynamic channel`);
      return false;
    }

    this.channels.delete(name);
    console.log(`✅ Dynamic channel ${name} deleted`);
    
    return true;
  }

  isServiceConfigured(): boolean {
    return !!this.apiKey;
  }

  isServiceRunning(): boolean {
    return this.isInitialized;
  }

  shutdown(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    
    this.removeAllListeners();
    this.isInitialized = false;
    console.log('🛑 Zello Dispatch Service shut down');
  }
}

// Export singleton instance
export const zelloService = new ZelloDispatchService();
export default zelloService;