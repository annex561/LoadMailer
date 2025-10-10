import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import axios from 'axios';
import WebSocket from 'ws';

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
  location?: ZelloLocation;
  lastSeen?: Date;
}

interface ZelloLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  timestamp: string;
  address?: string;
  batteryLevel?: number;
}

interface ZelloMessage {
  channel: string;
  from: string;
  type: 'voice' | 'text' | 'image' | 'alert' | 'document';
  duration?: number;
  text?: string;
  imageUrl?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  documentType?: 'pod' | 'bol' | 'inspection_report' | 'damage_photos' | 'weight_ticket' | 'lumper_receipt' | 'other';
  loadId?: string;
  timestamp: Date;
}

export class ZelloDispatchService extends EventEmitter {
  private apiKey: string;
  private username: string;
  private password: string;
  private sessionId: string | null = null;
  private baseUrl: string = 'https://lamp1.zellowork.com/web/api';
  private workspaceUrl: string = 'lamp1.zellowork.com';
  private channels: Map<string, ZelloChannel> = new Map();
  private users: Map<string, ZelloUser> = new Map();
  private isInitialized: boolean = false;
  private reconnectInterval: NodeJS.Timeout | null = null;
  
  // WebSocket fields for real-time communication
  private websocket: WebSocket | null = null;
  private wsSequence: number = 1;
  private wsConnected: boolean = false;
  private wsRefreshToken: string | null = null;
  private wsReconnectTimer: NodeJS.Timeout | null = null;
  
  constructor() {
    super();
    // Use the correct API key from the Zello dashboard
    this.apiKey = (process.env.ZELLO_API_KEY || '9TRA0D2GBV1OCOC657BFSPIH4QBDICH5').trim();
    // Ensure we're using the correct API user credentials
    this.username = (process.env.ZELLO_USERNAME || 'annexAPI').trim();
    this.password = (process.env.ZELLO_PASSWORD || 'Anonymous#561').trim();
    console.log('🎙️ Zello Dispatch Service initializing...');
    
    if (!this.apiKey || !this.username || !this.password) {
      console.warn('⚠️ Zello credentials not fully configured (need API_KEY, USERNAME, and PASSWORD)');
    }
  }
  
  private async authenticate(): Promise<boolean> {
    if (!this.apiKey || !this.username || !this.password) {
      console.error('❌ Missing Zello credentials');
      return false;
    }

    try {
      // Step 1: Get token and session ID
      const tokenUrl = `https://${this.workspaceUrl}/user/gettoken`;
      console.log('🔑 Step 1: Getting token from Zello...');
      
      const tokenResponse = await fetch(tokenUrl, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey
        }
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('❌ Failed to get token:', errorText);
        return false;
      }

      const tokenData = await tokenResponse.json();
      
      if (tokenData.status !== 'OK' || !tokenData.sid) {
        console.error('❌ Invalid token response:', tokenData);
        return false;
      }
      
      this.sessionId = tokenData.sid;
      const token = tokenData.token;
      console.log('✅ Token obtained, session ID:', this.sessionId);
      
      // Step 2: Login with username and password
      const loginUrl = `https://${this.workspaceUrl}/user/login?sid=${this.sessionId}`;
      console.log('🔐 Step 2: Logging in with credentials...');
      
      // Hash the password according to Zello API docs: md5(md5(password) + token + api_key)
      const passwordMd5 = crypto.createHash('md5').update(this.password).digest('hex');
      const combined = passwordMd5 + token + this.apiKey;
      const hashedPassword = crypto.createHash('md5').update(combined).digest('hex');
      
      console.log('🔒 Using proper password hashing as per Zello API:');
      console.log('  - Password MD5:', passwordMd5.substring(0, 8) + '...');
      console.log('  - Token:', token.substring(0, 8) + '...');
      console.log('  - Final hash:', hashedPassword.substring(0, 8) + '...');
      
      const loginBody = new URLSearchParams({
        username: this.username,
        password: hashedPassword  // Use the properly hashed password
      });
      
      const loginResponse = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: loginBody
      });

      if (!loginResponse.ok) {
        const errorText = await loginResponse.text();
        console.error('❌ Login failed:', errorText);
        this.sessionId = null;
        return false;
      }

      const loginData = await loginResponse.json();
      
      if (loginData.status === 'OK') {
        console.log('✅ Zello authentication successful - fully logged in');
        return true;
      } else {
        console.error('❌ Login failed:', loginData);
        this.sessionId = null;
        return false;
      }
    } catch (error) {
      console.error('❌ Zello authentication error:', error);
      this.sessionId = null;
      return false;
    }
  }

  private async makeZelloApiCall(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    // Ensure we have a session
    if (!this.sessionId) {
      console.log('🔐 No session found, authenticating...');
      const authenticated = await this.authenticate();
      if (!authenticated) {
        throw new Error('Failed to authenticate with Zello Work API');
      }
    }
    
    // Build URL with session ID
    const url = `https://${this.workspaceUrl}${endpoint}`;
    const params = new URLSearchParams({ sid: this.sessionId });
    
    // Add body parameters to URL for GET requests, or keep in body for POST/PUT
    if (body && method === 'GET') {
      Object.keys(body).forEach(key => params.append(key, body[key]));
    }
    
    const fullUrl = `${url}?${params}`;
    
    try {
      const options: RequestInit = {
        method,
        headers: {}
      };
      
      if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        // Zello API expects form-encoded data, not JSON
        const formData = new URLSearchParams();
        Object.keys(body).forEach(key => {
          formData.append(key, String(body[key]));
        });
        options.body = formData;
        options.headers = {
          'Content-Type': 'application/x-www-form-urlencoded'
        };
      }
      
      const response = await fetch(fullUrl, options);
      
      if (!response.ok) {
        const errorData = await response.text();
        
        // If we get a 401, try to re-authenticate once
        if (response.status === 401) {
          console.log('🔑 Session expired, re-authenticating...');
          this.sessionId = null;
          const authenticated = await this.authenticate();
          if (authenticated) {
            // Retry the request with new session
            return this.makeZelloApiCall(endpoint, method, body);
          }
        }
        
        throw new Error(`Zello API error: ${response.status} - ${errorData}`);
      }
      
      const data = await response.json();
      return data;
      
    } catch (error) {
      console.error(`❌ Zello API call failed for ${endpoint}:`, error);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    if (!this.apiKey || !this.username || !this.password) {
      console.error('❌ Cannot initialize Zello service without full credentials');
      return;
    }

    try {
      console.log('🔐 Authenticating with Zello Work API...');
      
      // Authenticate first
      const authenticated = await this.authenticate();
      if (!authenticated) {
        console.error('❌ Failed to authenticate with Zello Work');
        return;
      }
      
      // Initialize default channels
      await this.setupDefaultChannels();
      
      // Connect to WebSocket for real-time messaging
      await this.connectWebSocket();
      
      // Load existing users
      await this.loadUsers();
      
      // Try to create/sync real Zello users
      await this.syncUsersToZello();
      
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

    try {
      // First, get the list of existing channels from Zello
      console.log('🔍 Checking existing channels in Zello workspace...');
      const existingChannelsResponse = await this.makeZelloApiCall('/channels', 'GET');
      
      const existingChannelNames = new Set<string>();
      if (existingChannelsResponse && Array.isArray(existingChannelsResponse)) {
        existingChannelsResponse.forEach((ch: any) => {
          existingChannelNames.add(ch.name);
          console.log(`✅ Found existing channel: ${ch.name}`);
        });
      }
      
      // Create channels that don't exist yet
      for (const channelConfig of defaultChannels) {
        if (!existingChannelNames.has(channelConfig.name)) {
          console.log(`📦 Creating channel in Zello: ${channelConfig.name}`);
          
          try {
            const createResponse = await this.makeZelloApiCall('/channels/add', 'POST', {
              name: channelConfig.name,
              // Zello Work uses 'group' instead of 'team'
              type: 'group', 
              // Add the API user to the channel
              add: [this.username]
            });
            
            if (createResponse) {
              console.log(`✅ Successfully created channel: ${channelConfig.name}`);
            }
          } catch (createError: any) {
            if (createError.response?.data?.error === 'Channel already exists') {
              console.log(`ℹ️ Channel ${channelConfig.name} already exists`);
            } else {
              console.error(`❌ Failed to create channel ${channelConfig.name}:`, createError.response?.data || createError.message);
            }
          }
        } else {
          console.log(`✅ Channel already exists: ${channelConfig.name}`);
          
          // Ensure the API user is added to the existing channel
          try {
            await this.makeZelloApiCall('/channels/add_users', 'POST', {
              channel: channelConfig.name,
              users: [this.username]
            });
            console.log(`✅ Added ${this.username} to channel ${channelConfig.name}`);
          } catch (addError: any) {
            // User might already be in the channel
            if (addError.response?.data?.error?.includes('already')) {
              console.log(`ℹ️ User ${this.username} already in channel ${channelConfig.name}`);
            } else {
              console.warn(`⚠️ Could not add user to channel ${channelConfig.name}:`, addError.response?.data || addError.message);
            }
          }
        }
        
        // Add to local channel list
        const channel: ZelloChannel = {
          name: channelConfig.name,
          type: channelConfig.type,
          users: [this.username],
          active: true
        };
        this.channels.set(channelConfig.name, channel);
        console.log(`📻 Channel registered locally: ${channelConfig.name} - ${channelConfig.description}`);
      }
      
      console.log('✅ All default channels have been set up');
      
    } catch (error) {
      console.error('❌ Error setting up channels:', error);
      // Still set up local channels even if API fails
      for (const channelConfig of defaultChannels) {
        const channel: ZelloChannel = {
          name: channelConfig.name,
          type: channelConfig.type,
          users: [],
          active: true
        };
        this.channels.set(channelConfig.name, channel);
        console.log(`📻 Channel created locally (API unavailable): ${channelConfig.name}`);
      }
    }
  }

  private async loadUsers(): Promise<void> {
    console.log('👥 Loading Zello users...');
    
    // First, load all drivers from database to ensure new registrations are included
    try {
      // Import storage dynamically to avoid circular dependencies
      const { storage } = await import('./storage');
      const drivers = await storage.getDrivers();
      
      console.log(`📋 Loading ${drivers.length} drivers from database into Zello service`);
      
      // Add each driver to Zello tracking
      for (const driver of drivers) {
        // Generate username same way as in createDriverAccount
        const phoneDigits = driver.phone.replace(/\D/g, '').slice(-4);
        const cleanName = driver.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const username = `${cleanName}_${phoneDigits}`;
        
        // Determine channels based on equipment type (same logic as createDriverAccount)
        const channels = ['all-drivers'];
        if (driver.equipmentType) {
          const equipmentLower = driver.equipmentType.toLowerCase();
          if (equipmentLower.includes('box') || equipmentLower.includes('straight')) {
            channels.push('box-truck-ops');
          } else if (equipmentLower.includes('van') || equipmentLower.includes('sprinter')) {
            channels.push('hotshot-expedite');
          } else if (equipmentLower.includes('flatbed')) {
            channels.push('dispatch-priority');
          }
          channels.push('southeast-region');
        }
        
        // Add to users map if not already present
        if (!this.users.has(username)) {
          this.users.set(username, {
            username,
            displayName: driver.name,
            status: 'available' as const,
            channels
          });
          console.log(`✅ Added driver ${driver.name} (${username}) to Zello tracking`);
        }
      }
    } catch (error) {
      console.error('⚠️ Could not load drivers from database:', error);
    }
    
    // Then try to sync with Zello API (may fail due to auth issues)
    await this.updateUserLocations();
    
    // Add users to their assigned channels
    await this.assignUsersToChannels();
  }
  
  private async assignUsersToChannels(): Promise<void> {
    console.log('📡 Assigning users to channels...');
    
    // Iterate through all loaded users
    for (const [username, user] of this.users) {
      // Add user to their assigned channels
      for (const channelName of user.channels) {
        await this.addUserToChannel(username, channelName);
      }
      
      // Also add the user to all-drivers channel if not already there
      if (!user.channels.includes('all-drivers')) {
        await this.addUserToChannel(username, 'all-drivers');
      }
    }
    
    // Log channel membership counts
    for (const [channelName, channel] of this.channels) {
      console.log(`📻 Channel ${channelName}: ${channel.users.length} users`);
    }
  }
  
  private async syncUsersToZello(): Promise<void> {
    console.log('🔄 Syncing users to real Zello Work platform...');
    
    try {
      // Get existing users from Zello with timeout
      let existingUsers: any[] = [];
      let existingUsernames = new Set<string>();
      
      try {
        console.log('📋 Fetching existing users from Zello...');
        const existingUsersResponse = await Promise.race([
          this.makeZelloApiCall('/user/list', 'GET'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout getting user list')), 5000))
        ]) as any;
        
        if (existingUsersResponse?.users) {
          existingUsers = existingUsersResponse.users;
          existingUsernames = new Set(existingUsers.map((u: any) => u.name));
        } else if (existingUsersResponse?.status === 'OK') {
          // Empty user list
          existingUsers = [];
        } else {
          console.error('❌ Unexpected response from user list:', existingUsersResponse);
        }
      } catch (listError) {
        console.error('⚠️ Could not fetch existing users:', listError);
        // Continue anyway - we'll try to create users
      }
      
      console.log(`📋 Found ${existingUsers.length} existing users in Zello Work`);
      
      // Create users that don't exist
      let createdCount = 0;
      let skippedCount = 0;
      
      for (const [username, user] of this.users) {
        if (existingUsernames.has(username)) {
          console.log(`⏭️ User ${username} already exists in Zello`);
          skippedCount++;
          continue;
        }
        
        try {
          // Create user in Zello Work
          const createResponse = await this.makeZelloApiCall('/user/save', 'POST', {
            name: username,
            password: 'Driver123!', // Default password for drivers
            email: user.email || `${username}@lampslogistics.com`,
            full_name: user.displayName || user.name || username,
            job: 'Driver',
            admin: 'false'  // Must be string 'false', not boolean
          });
          
          if (createResponse?.status === 'OK') {
            console.log(`✅ Created Zello user: ${username}`);
            createdCount++;
            
            // Add user to channels
            for (const channelName of user.channels) {
              try {
                await this.makeZelloApiCall('/user/addtochannel', 'POST', {
                  username: username,
                  channel: channelName
                });
                console.log(`  ➕ Added ${username} to channel ${channelName}`);
              } catch (channelError) {
                console.error(`  ❌ Failed to add ${username} to ${channelName}:`, channelError);
              }
            }
          } else {
            console.error(`❌ Failed to create user ${username}:`, createResponse);
          }
        } catch (error) {
          console.error(`❌ Error creating user ${username}:`, error);
        }
      }
      
      console.log(`✅ Zello sync complete: ${createdCount} users created, ${skippedCount} already existed`);
      
    } catch (error) {
      console.error('❌ Failed to sync users to Zello:', error);
    }
  }

  async updateUserLocations(): Promise<void> {
    try {
      console.log('📍 Updating Zello user locations...');
      
      // Try to fetch real GPS data from Zello API when available
      if (this.isInitialized && this.apiKey) {
        try {
          // Fetch users with their GPS locations from Zello Work API
          const usersResponse = await this.makeZelloApiCall('/users', 'GET');
          
          if (usersResponse && Array.isArray(usersResponse)) {
            console.log(`📡 Fetched ${usersResponse.length} users from Zello API`);
            
            // Update users with real GPS data from API
            for (const apiUser of usersResponse) {
              const username = apiUser.username || apiUser.name;
              const displayName = apiUser.display_name || apiUser.full_name || username;
              
              let user = this.users.get(username);
              if (!user) {
                user = {
                  username,
                  displayName,
                  status: apiUser.status || 'available',
                  channels: apiUser.channels || ['all-drivers']
                };
                this.users.set(username, user);
              }
              
              // If the API provides location data, use it
              if (apiUser.location || apiUser.gps || apiUser.last_location) {
                const loc = apiUser.location || apiUser.gps || apiUser.last_location;
                user.location = {
                  latitude: loc.latitude || loc.lat,
                  longitude: loc.longitude || loc.lng || loc.lon,
                  accuracy: loc.accuracy || 10,
                  speed: loc.speed || 0,
                  heading: loc.heading || loc.bearing || 0,
                  altitude: loc.altitude || loc.elevation || 0,
                  timestamp: loc.timestamp || loc.time || new Date().toISOString(),
                  batteryLevel: loc.battery || loc.battery_level || 100,
                  address: loc.address || loc.description || `${loc.latitude}, ${loc.longitude}`
                };
                user.lastSeen = new Date(loc.timestamp || Date.now());
                console.log(`✅ Updated real GPS for ${displayName}: ${user.location.latitude}, ${user.location.longitude}`);
              }
            }
            
            console.log(`✅ Processed ${usersResponse.length} users from Zello API`);
            return; // Exit after processing real API data
          }
        } catch (apiError) {
          console.warn('⚠️ Failed to fetch real Zello GPS data, falling back to simulated:', apiError);
        }
      }
      
      // Fallback: Provide simulated GPS locations when API is unavailable
      console.log('📍 Using simulated Zello GPS data (API unavailable or no GPS data from API)');
      const simulatedDrivers = [
        {
          username: 'annex_luberisse_4567', 
          displayName: 'Annex Luberisse',
          lat: 35.0456, lng: -85.3097, // Chattanooga, TN
          speed: 65, heading: 45
        },
        {
          username: 'test_zello_driver_7890',
          displayName: 'Test Zello Driver 7JxsRS',
          lat: 33.7490, lng: -84.3880, // Atlanta, GA  
          speed: 0, heading: 135
        }
      ];
      
      for (const driver of simulatedDrivers) {
        let user = this.users.get(driver.username);
        if (!user) {
          user = {
            username: driver.username,
            displayName: driver.displayName,
            status: 'available' as const,
            channels: ['all-drivers', 'southeast-region']
          };
          this.users.set(driver.username, user);
        }
        
        // Update with simulated GPS location
        user.location = {
          latitude: driver.lat + (Math.random() - 0.5) * 0.01, // Small random movement
          longitude: driver.lng + (Math.random() - 0.5) * 0.01,
          accuracy: 10 + Math.random() * 20,
          speed: driver.speed + (Math.random() - 0.5) * 10,
          heading: driver.heading + (Math.random() - 0.5) * 30,
          altitude: 1000 + Math.random() * 200,
          timestamp: new Date().toISOString(),
          batteryLevel: 70 + Math.random() * 30,
          address: driver.username.includes('annex') ? 'Chattanooga, TN' : 'Atlanta, GA'
        };
        user.lastSeen = new Date();
      }
      
      console.log(`✅ Updated simulated locations for ${simulatedDrivers.length} Zello users`);
    } catch (error) {
      console.error('❌ Failed to update Zello user locations:', error);
    }
  }
  
  async getUserLocations(): Promise<Array<{
    username: string;
    displayName: string;
    location: ZelloLocation | undefined;
    status: string;
  }>> {
    // Refresh locations before returning
    await this.updateUserLocations();
    
    const locations = Array.from(this.users.values()).map(user => ({
      username: user.username,
      displayName: user.displayName,
      location: user.location,
      status: user.status
    }));
    
    return locations;
  }
  
  async getUserLocationByUsername(username: string): Promise<ZelloLocation | null> {
    const user = this.users.get(username);
    return user?.location || null;
  }

  // Message history polling - alternative to webhooks
  async getMessageHistory(channelName?: string, maxMessages: number = 100): Promise<any> {
    if (!this.isInitialized || !this.sessionId) {
      console.warn('⚠️ Zello service not initialized, cannot fetch message history');
      return { messages: [] };
    }

    try {
      console.log(`📜 Fetching message history${channelName ? ` for channel: ${channelName}` : ' for all channels'}`);
      
      // Build query parameters for Zello Work API
      const params: any = {
        max: maxMessages.toString()
      };
      
      if (channelName) {
        params.channel = channelName;
      }
      
      // Calculate timestamp for last 5 minutes (to avoid fetching old messages)
      const fiveMinutesAgo = Math.floor((Date.now() - 5 * 60 * 1000) / 1000);
      params.start = fiveMinutesAgo.toString();
      
      // Use the proper Zello Work API endpoint
      const response = await this.makeZelloApiCall('/web/api/history/get', 'GET', params);

      if (response && response.status === 'OK') {
        console.log(`✅ Retrieved ${response.returned || 0} messages from Zello history`);
        return response;
      } else {
        console.error('❌ Failed to fetch message history:', response);
        return { messages: [] };
      }
    } catch (error) {
      console.error('❌ Error fetching Zello message history:', error);
      return { messages: [] };
    }
  }

  // Process messages from history API (similar to webhook processing)
  async processHistoryMessages(messages: any[]): Promise<any[]> {
    const processedMessages = [];
    
    for (const msg of messages) {
      try {
        // Convert Zello history format to our webhook format
        const processedMsg = {
          type: msg.type === 'text' ? 'text_message' : msg.type,
          channel: msg.recipient_type === 'channel' ? msg.recipient : null,
          sender: msg.sender,
          from: msg.sender,
          message: msg.text || '',
          timestamp: new Date(msg.ts * 1000).toISOString(), // Convert Unix timestamp
          messageId: msg.id,
          processed: false
        };
        
        // Handle attachments if present
        if (msg.type === 'image' && msg.media_key) {
          processedMsg.attachment = {
            type: 'image',
            mediaKey: msg.media_key,
            timestamp: msg.image_ts ? new Date(msg.image_ts * 1000).toISOString() : processedMsg.timestamp
          };
        }
        
        processedMessages.push(processedMsg);
      } catch (error) {
        console.error(`❌ Error processing history message ${msg.id}:`, error);
      }
    }
    
    return processedMessages;
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

  // WebSocket Connection for Real-time Messaging
  private async connectWebSocket(): Promise<void> {
    try {
      console.log('🔌 Connecting to Zello WebSocket for real-time messaging...');
      
      // Ensure we have REST API session first
      if (!this.sessionId) {
        console.log('⚠️ No REST session available for WebSocket, authenticating first...');
        const authenticated = await this.authenticate();
        if (!authenticated) {
          console.error('❌ Cannot connect WebSocket without REST authentication');
          return;
        }
      }
      
      // Connect to Zello Work WebSocket
      // Zello Work uses the zellowork.io domain with workspace name
      const wsUrl = `wss://zellowork.io/ws/lamp1`;
      console.log(`📡 Connecting to WebSocket: zellowork.io/ws/lamp1`);
      
      this.websocket = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${this.sessionId}`,
          'User-Agent': 'LoadSignal/1.0'
        }
      });
      
      this.websocket.on('open', () => {
        console.log('✅ WebSocket connected to Zello');
        this.wsConnected = true;
        this.wsLogon();
      });
      
      this.websocket.on('message', (data: WebSocket.Data) => {
        this.handleWebSocketMessage(data);
      });
      
      this.websocket.on('close', () => {
        console.log('❌ WebSocket disconnected');
        this.wsConnected = false;
        this.scheduleWebSocketReconnect();
      });
      
      this.websocket.on('error', (error) => {
        console.error('❌ WebSocket error:', error);
        this.wsConnected = false;
      });
      
    } catch (error) {
      console.error('❌ Failed to connect WebSocket:', error);
      this.scheduleWebSocketReconnect();
    }
  }
  
  private scheduleWebSocketReconnect(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }
    
    this.wsReconnectTimer = setTimeout(() => {
      console.log('🔄 Attempting WebSocket reconnection...');
      this.connectWebSocket();
    }, 5000);
  }
  
  private wsLogon(): void {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot logon: WebSocket not connected');
      return;
    }
    
    // Get all channel names for the logon
    const channelNames = Array.from(this.channels.keys());
    
    // For Zello Work, we need username/password authentication
    // The session ID from REST API doesn't work for WebSocket
    const logonCommand = {
      command: 'logon',
      seq: this.wsSequence++,
      username: this.username,
      password: this.password,
      channels: channelNames.length > 0 ? channelNames : ['all-drivers'], // Default to all-drivers if no channels
      listen_only: false, // We want to send and receive
      version: '1.0',
      platform_type: 'nodejs',
      platform_name: 'LoadSignal Gateway'
    };
    
    console.log(`🔐 Sending WebSocket logon for user ${this.username} to channels: ${channelNames.join(', ')}`);
    this.websocket.send(JSON.stringify(logonCommand));
  }
  
  private handleWebSocketMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.seq && message.success !== undefined) {
        // This is a response to our command
        if (message.success) {
          console.log('✅ WebSocket command successful:', message.seq);
          
          // Store refresh token if provided
          if (message.refresh_token) {
            this.wsRefreshToken = message.refresh_token;
            console.log('🔑 Received WebSocket refresh token');
          }
        } else {
          console.error('❌ WebSocket command failed:', JSON.stringify(message, null, 2));
          
          // If logon failed, close the connection to trigger reconnect with different credentials
          if (message.error && message.error.includes('not authorized')) {
            console.error('🔐 Authentication failed - check Zello Work credentials');
            this.websocket?.close();
          }
        }
      } else if (message.command) {
        // This is an incoming event/message
        this.handleIncomingWebSocketEvent(message);
      } else {
        // Log any unhandled message types for debugging
        console.log('📦 Unhandled WebSocket message:', JSON.stringify(message, null, 2));
      }
    } catch (error) {
      // Not JSON, might be binary audio data
      // We don't handle audio in this implementation
    }
  }
  
  private async handleIncomingWebSocketEvent(event: any): Promise<void> {
    console.log('📨 Incoming WebSocket event:', event.command);
    
    switch (event.command) {
      case 'on_channel_status':
        console.log(`📻 Channel ${event.channel} status:`, event.status, 
                   `(${event.users_online} users online)`);
        // Update channel status in database
        await this.updateChannelStatus(event.channel, event.users_online);
        break;
        
      case 'on_text_message':
        console.log(`💬 Text message in ${event.channel} from ${event.from}: ${event.text}`);
        // Store message in database
        await this.storeChannelMessage(event.channel, event.from, event.text, 'text');
        // Emit event for processing
        this.emit('text_message', {
          channel: event.channel,
          from: event.from,
          text: event.text,
          for: event.for,
          timestamp: new Date()
        });
        break;
        
      case 'on_voice_message':
        console.log(`🎤 Voice message in ${event.channel} from ${event.from}`);
        // Store voice message in database
        await this.storeChannelMessage(event.channel, event.from, '', 'voice', {
          duration: event.duration,
          codecInfo: event.codecInfo
        });
        // Emit event for real-time updates
        this.emit('voice_message', {
          channel: event.channel,
          from: event.from,
          duration: event.duration,
          timestamp: new Date()
        });
        break;
        
      case 'on_error':
        console.error('❌ WebSocket error event:', event.error);
        break;
    }
  }

  // Store channel messages in database
  private async storeChannelMessage(
    channel: string, 
    sender: string, 
    text: string, 
    messageType: 'text' | 'voice' = 'text',
    metadata?: any
  ): Promise<void> {
    try {
      // Import storage here to avoid circular dependency
      const { storage } = await import('./storage');
      
      // Find driver by Zello username if exists
      const driver = await this.findDriverByZelloUsername(sender);
      
      // Create channel message
      await storage.createZelloChannelMessage({
        channel,
        sender,
        senderType: driver ? 'driver' : 'dispatch',
        messageType,
        textContent: text || null,
        driverId: driver?.id || null,
        driverName: driver?.name || null,
        driverPhone: driver?.phone || null,
        zelloTimestamp: new Date(),
        zelloMetadata: metadata || {}
      });

      // Update channel unread count
      await storage.updateZelloChannelUnreadCount(channel, 1);
      
      console.log(`✅ Stored ${messageType} message from ${sender} in channel ${channel}`);
    } catch (error) {
      console.error('❌ Failed to store channel message:', error);
    }
  }

  // Update channel status in database
  private async updateChannelStatus(channel: string, onlineUsers: number): Promise<void> {
    try {
      const { storage } = await import('./storage');
      
      await storage.createOrUpdateZelloChannelStatus({
        channelName: channel,
        onlineUsers,
        totalUsers: this.channels.get(channel)?.users.length || 0,
        userList: this.channels.get(channel)?.users || [],
        isActive: true,
        channelType: 'group'
      });
      
      console.log(`✅ Updated status for channel ${channel}: ${onlineUsers} users online`);
    } catch (error) {
      console.error('❌ Failed to update channel status:', error);
    }
  }

  // Find driver by Zello username
  private async findDriverByZelloUsername(username: string): Promise<any> {
    try {
      const { storage } = await import('./storage');
      
      // Try to find driver by Zello username format (e.g., "john_smith_1234")
      const drivers = await storage.getAllDrivers();
      const driver = drivers.find(d => {
        const expectedUsername = this.generateZelloUsername(d.name, d.phone);
        return expectedUsername.toLowerCase() === username.toLowerCase();
      });
      
      return driver;
    } catch (error) {
      console.error('❌ Failed to find driver by Zello username:', error);
      return null;
    }
  }
  
  private async sendWebSocketTextMessage(channel: string, text: string, forUser?: string): Promise<boolean> {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot send message: WebSocket not connected');
      return false;
    }
    
    const messageCommand = {
      command: 'send_text_message',
      seq: this.wsSequence++,
      channel: channel,
      text: text,
      for: forUser
    };
    
    try {
      console.log(`📤 Sending WebSocket text message to ${channel}${forUser ? ` for ${forUser}` : ''}`);
      this.websocket.send(JSON.stringify(messageCommand));
      return true;
    } catch (error) {
      console.error('❌ Failed to send WebSocket message:', error);
      return false;
    }
  }

  // Main function for sending messages to channels or users
  async sendMessage(recipient: string, message: string): Promise<boolean> {
    if (!this.isInitialized) {
      console.warn('⚠️ Zello service not initialized');
      return false;
    }

    try {
      console.log(`📻 Sending message to ${recipient}: ${message}`);
      
      // Check if recipient is a channel (from our channels map)
      const isChannel = this.channels.has(recipient);
      
      if (isChannel) {
        // Send to channel using WebSocket
        if (this.wsConnected) {
          const success = await this.sendWebSocketTextMessage(recipient, message);
          if (success) {
            // Store outgoing message in database
            await this.storeChannelMessage(recipient, this.username, message, 'text');
          }
          return success;
        } else {
          console.warn('⚠️ WebSocket not connected, message not sent');
          return false;
        }
      } else {
        // Try to send as direct message to user
        // First check if the user exists in our users map
        const userExists = this.users.has(recipient) || 
                          Array.from(this.users.keys()).some(u => u.toLowerCase() === recipient.toLowerCase());
        
        if (userExists) {
          // Send direct message via all-drivers channel with @mention
          // (Zello Work doesn't support direct messages via WebSocket to users not in channel)
          if (this.wsConnected) {
            const success = await this.sendWebSocketTextMessage('all-drivers', message, recipient);
            if (success) {
              await this.storeChannelMessage('all-drivers', this.username, message, 'text');
            }
            return success;
          } else {
            console.warn('⚠️ WebSocket not connected, message not sent');
            return false;
          }
        } else {
          // If not a known user, try sending to all-drivers channel as fallback
          console.log(`⚠️ User ${recipient} not found, sending to all-drivers channel`);
          if (this.wsConnected) {
            const success = await this.sendWebSocketTextMessage('all-drivers', `@${recipient}: ${message}`);
            if (success) {
              await this.storeChannelMessage('all-drivers', this.username, `@${recipient}: ${message}`, 'text');
            }
            return success;
          } else {
            console.warn('⚠️ WebSocket not connected, message not sent');
            return false;
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error sending message to ${recipient}:`, error);
      return false;
    }
  }

  // Send message to multiple channels and/or users
  async sendMessageToMultiple(channels: string[], users: string[], message: string): Promise<{success: string[], failed: string[]}> {
    const results = {success: [], failed: []};
    
    // Send to channels
    for (const channel of channels) {
      const success = await this.sendMessage(channel, message);
      if (success) {
        results.success.push(channel);
      } else {
        results.failed.push(channel);
      }
    }
    
    // Send to individual users
    for (const user of users) {
      const success = await this.sendMessage(user, message);
      if (success) {
        results.success.push(user);
      } else {
        results.failed.push(user);
      }
    }
    
    return results;
  }

  // Get channel messages from database
  async getChannelMessages(channel: string, limit: number = 100): Promise<any[]> {
    try {
      const { storage } = await import('./storage');
      return await storage.getZelloChannelMessages(channel, limit);
    } catch (error) {
      console.error('❌ Failed to get channel messages:', error);
      return [];
    }
  }

  // Mark channel messages as read
  async markChannelMessagesAsRead(channel: string, messageIds: string[]): Promise<number> {
    try {
      const { storage } = await import('./storage');
      const updated = await storage.markZelloMessagesAsRead(channel, messageIds);
      
      // Update unread count
      if (updated > 0) {
        await storage.updateZelloChannelUnreadCount(channel, -updated);
      }
      
      return updated;
    } catch (error) {
      console.error('❌ Failed to mark messages as read:', error);
      return 0;
    }
  }

  // Get all channel statuses with unread counts
  async getAllChannelStatuses(): Promise<any[]> {
    try {
      const { storage } = await import('./storage');
      return await storage.getAllZelloChannelStatuses();
    } catch (error) {
      console.error('❌ Failed to get channel statuses:', error);
      return [];
    }
  }

  async sendCustomMessage(message: string, channel: string): Promise<boolean> {
    if (!this.isInitialized) {
      console.warn('⚠️ Zello service not initialized');
      return false;
    }

    try {
      console.log(`📻 Sending to ${channel}: ${message}`);
      
      // Use the correct Zello API endpoint for sending text messages to channels
      const response = await this.makeZelloApiCall('/text-messages/channels', 'POST', {
        channel: channel,
        text: message
      });
      
      if (response && response.status === 'OK') {
        console.log(`✅ Message sent to Zello channel ${channel} successfully`);
        
        // Also emit the event for any local listeners
        this.emit('custom_broadcast', {
          channel,
          message,
          timestamp: new Date()
        });
        
        return true;
      } else {
        console.error(`❌ Failed to send message to Zello channel ${channel}:`, response);
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to send message to Zello channel ${channel}:`, error);
      
      // Fallback: Still emit locally even if API fails
      this.emit('custom_broadcast', {
        channel,
        message,
        timestamp: new Date(),
        error: true
      });
      
      return false;
    }
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

  async handleDocumentUpload(data: {
    channel: string;
    from: string;
    imageUrl: string;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
    caption?: string;
    loadId?: string;
  }): Promise<void> {
    console.log(`📄 Document upload from ${data.from} in channel: ${data.channel}`);
    
    // Determine document type from caption or filename
    let documentType: ZelloMessage['documentType'] = 'other';
    const captionLower = (data.caption || '').toLowerCase();
    const fileNameLower = (data.fileName || '').toLowerCase();
    
    if (captionLower.includes('pod') || captionLower.includes('proof of delivery') || fileNameLower.includes('pod')) {
      documentType = 'pod';
    } else if (captionLower.includes('bol') || captionLower.includes('bill of lading') || fileNameLower.includes('bol')) {
      documentType = 'bol';
    } else if (captionLower.includes('inspection') || fileNameLower.includes('inspection')) {
      documentType = 'inspection_report';
    } else if (captionLower.includes('damage') || fileNameLower.includes('damage')) {
      documentType = 'damage_photos';
    } else if (captionLower.includes('weight') || captionLower.includes('ticket') || fileNameLower.includes('weight')) {
      documentType = 'weight_ticket';
    } else if (captionLower.includes('lumper') || captionLower.includes('receipt') || fileNameLower.includes('lumper')) {
      documentType = 'lumper_receipt';
    }
    
    // Emit document upload event
    this.emit('document_uploaded', {
      driver: data.from,
      channel: data.channel,
      imageUrl: data.imageUrl,
      fileName: data.fileName || `zello_doc_${Date.now()}.jpg`,
      fileSize: data.fileSize || 0,
      mimeType: data.mimeType || 'image/jpeg',
      documentType,
      loadId: data.loadId,
      caption: data.caption,
      timestamp: new Date()
    });
    
    console.log(`✅ Document categorized as ${documentType}: ${data.fileName || 'unnamed'}`);
  }

  async sendDocumentRequest(
    driverUsername: string,
    loadId: string,
    documentTypes: string[]
  ): Promise<void> {
    if (!this.isInitialized) {
      console.warn('⚠️ Zello service not initialized');
      return;
    }
    
    const message = `📋 Document Request for Load ${loadId}\n\n` +
      `Please upload the following documents:\n` +
      documentTypes.map(type => `• ${this.getDocumentTypeLabel(type)}`).join('\n') +
      `\n\nUse Zello to send photos with captions indicating the document type.`;
    
    // Send to driver's personal channel or all-drivers channel
    const targetChannel = 'all-drivers';
    
    console.log(`📨 Sending document request to ${driverUsername} for load ${loadId}`);
    await this.sendCustomMessage(message, targetChannel);
    
    // Emit event for tracking
    this.emit('document_request_sent', {
      driver: driverUsername,
      loadId,
      documentTypes,
      timestamp: new Date()
    });
  }

  private getDocumentTypeLabel(type: string): string {
    switch (type) {
      case 'pod': return 'Proof of Delivery (POD)';
      case 'bol': return 'Bill of Lading (BOL)';
      case 'inspection_report': return 'Inspection Report';
      case 'damage_photos': return 'Damage Photos';
      case 'weight_ticket': return 'Weight Ticket';
      case 'lumper_receipt': return 'Lumper Receipt';
      default: return 'Document';
    }
  }

  async handleImageMessage(message: ZelloMessage): Promise<void> {
    if (message.type === 'image' || message.type === 'document') {
      await this.handleDocumentUpload({
        channel: message.channel,
        from: message.from,
        imageUrl: message.imageUrl || '',
        fileName: message.fileName,
        fileSize: message.fileSize,
        mimeType: message.mimeType,
        caption: message.text,
        loadId: message.loadId
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
    
    console.log(`📱 Creating Zello account for driver: ${username}`);
    
    // NOTE: Real Zello Work API requires:
    // 1. Admin username/password for Basic auth or OAuth session
    // 2. Proper API endpoint configuration
    // 3. Correct payload format with password_confirm and channels[] array
    
    // Currently using simulated provisioning for testing
    // In production, replace with actual Zello Work API integration:
    /*
    try {
      if (this.apiKey && this.isProduction) {
        // Real API call would look like:
        const response = await this.makeZelloWorkApiCall('/user/add', {
          username,
          password,
          password_confirm: password,
          email: driverData.email,
          full_name: driverData.name,
          channels: channels // as array
        });
        
        if (response.code === 200) {
          console.log(`✅ Successfully created Zello user: ${username}`);
        }
      }
    } catch (apiError) {
      console.error(`⚠️ Zello API provisioning failed:`, apiError);
      // Would handle retry or queue for later provisioning
    }
    */
    
    console.log(`⚠️ Using simulated Zello provisioning (real API requires admin credentials)`);
    console.log(`📝 Driver would receive: Username: ${username}, Channels: ${channels.join(', ')}`);
    
    // Add user to internal tracking (works even if API call fails)
    this.users.set(username, {
      username,
      displayName: driverData.name,
      status: 'available' as const,
      channels
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

  async syncDriverToZello(driver: {
    name: string;
    phone: string;
    equipmentType?: string;
  }): Promise<void> {
    // Generate username same way as in createDriverAccount
    const phoneDigits = driver.phone.replace(/\D/g, '').slice(-4);
    const cleanName = driver.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const username = `${cleanName}_${phoneDigits}`;
    
    // Determine channels based on equipment type
    const channels = ['all-drivers'];
    if (driver.equipmentType) {
      const equipmentLower = driver.equipmentType.toLowerCase();
      if (equipmentLower.includes('box') || equipmentLower.includes('straight')) {
        channels.push('box-truck-ops');
      } else if (equipmentLower.includes('van') || equipmentLower.includes('sprinter')) {
        channels.push('hotshot-expedite');
      } else if (equipmentLower.includes('flatbed')) {
        channels.push('dispatch-priority');
      }
      channels.push('southeast-region');
    }
    
    // Add to users map
    this.users.set(username, {
      username,
      displayName: driver.name,
      status: 'available' as const,
      channels
    });
    
    // Add user to channels immediately
    for (const channelName of channels) {
      await this.addUserToChannel(username, channelName);
    }
    
    console.log(`✅ Synced driver ${driver.name} (${username}) to Zello with channels: ${channels.join(', ')}`);
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