# SMS Setup Guide - Willow SMS Load Notifications

## Overview
LoadMaster has migrated from Telegram to SMS (Willow SMS) for all driver communications. The system now uses Twilio to send load offers and notifications directly to drivers' phones via text messages.

## Current Status
- ✅ **SMS Service Active**: Twilio SMS service is configured and running
- ✅ **Driver Database Updated**: All drivers now use phone numbers instead of Telegram IDs  
- ✅ **Load Offers via SMS**: Load notifications are sent via text message
- ✅ **Driver Registration**: New drivers register using phone numbers
- ✅ **Communication System**: Full SMS-based communication workflow operational

## SMS Configuration

### Environment Variables Required
The system requires these Twilio environment variables:
- `TWILIO_ACCOUNT_SID`: Your Twilio account identifier
- `TWILIO_AUTH_TOKEN`: Your Twilio authentication token  
- `TWILIO_PHONE_NUMBER`: Primary Twilio phone number for sending messages
- `TWILIO_PHONE_NUMBER_2`: Secondary phone number (optional)

### Features

#### 1. Automated Load Offers
- Real-time load matching based on driver location and equipment type
- SMS notifications sent within 150-mile radius of pickup location
- Professional LAMP Logistics branded messaging
- Rate and route information included in each offer

#### 2. Driver Registration
- Phone-based driver onboarding
- Simple registration form accessible via web link
- Automatic SMS notification setup

#### 3. Communication Management
- Two-way SMS communication between drivers and dispatch
- Load status updates via text message
- Driver availability management through SMS commands

## Driver Database Schema

### Updated Fields
Drivers now use these SMS-specific fields:
- `phone_number`: Driver's phone number (replaced telegram_id)
- `enable_sms_notifications`: Boolean flag for SMS preferences (replaced enable_telegram_notifications)
- `status`: Available, on_route, unavailable

### Load Matching Algorithm
The system matches loads to drivers based on:
- **Location proximity** (150-mile radius)
- **Equipment type compatibility** (dry_van, refrigerated, flatbed, etc.)
- **Driver availability status**
- **Rate attractiveness**

## SMS Message Format

### Load Offer Example
```
🚛 LAMP Logistics New Load Offer

LOAD-123456
📍 Nashville, TN → Atlanta, GA
💰 $1,850 | 🛣️ 248 miles
📅 Pickup: Today 2:00 PM
🚚 Equipment: Dry Van

Reply:
✅ BOOK to accept
❌ PASS to decline

Contact dispatch: (555) 123-4567
```

### Status Update Commands
Drivers can respond with:
- `BOOK` or `ACCEPT` - Accept the load offer
- `PASS` or `DECLINE` - Decline the load offer
- `AVAILABLE` - Set status to available
- `UNAVAILABLE` - Set status to unavailable
- `HELP` - Get assistance information

## System Integration

### Frontend Changes
- **SMS Dispatching Page**: `/sms-dispatching` - Manage SMS communications
- **Driver Management**: Updated to show phone numbers instead of Telegram usernames
- **Load Tracking**: SMS-based communication threads
- **Navigation**: Sidebar updated to show "SMS Dispatching" instead of "Telegram Dispatching"

### Backend Services
- **SMS Service**: Handles Twilio integration and message sending
- **Communication Service**: Manages driver-dispatch conversations via SMS
- **Load Service**: Automated load matching and SMS notifications
- **Driver Service**: Phone-based driver management

## Rate Limiting & Best Practices

### Message Throttling
- 2-second delay between messages to prevent rate limiting
- Batch processing for multiple load offers
- Queue management for high-volume periods

### Phone Number Validation
- Format validation for US phone numbers
- Duplicate number detection
- Opt-out handling for unsubscribe requests

## Troubleshooting

### Common Issues
1. **SMS not sending**: Check Twilio credentials and phone number formatting
2. **Driver not responding**: Verify phone number is correct and SMS-enabled
3. **Rate limiting**: System automatically handles Twilio rate limits with delays

### Monitoring
- SMS delivery status tracked in communication logs
- Failed message retry logic
- Real-time SMS status dashboard at `/sms-status`

## Migration Notes

### Completed Migration Tasks
- ✅ Database schema updated (telegram_id → phone_number)
- ✅ All services converted from Telegram to SMS
- ✅ Frontend pages updated for SMS workflow
- ✅ API endpoints converted to SMS-based communication
- ✅ Load processing updated to use SMS notifications
- ✅ Driver registration updated for phone numbers

### Benefits of SMS Migration
- **Universal Access**: No app installation required
- **Higher Delivery Rates**: SMS has higher open rates than Telegram
- **Professional Communication**: Direct phone-based contact
- **Simplified Onboarding**: Easier driver registration process
- **Better Integration**: Native phone system integration

## Support
For SMS system issues or configuration help, contact the development team with:
- Driver phone number
- SMS delivery logs
- Twilio account status
- Error messages or symptoms