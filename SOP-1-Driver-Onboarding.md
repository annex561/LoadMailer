# SOP #1: Driver Onboarding Process

**Test Driver:** Luke Skywalker  
**Phone:** 660-229-0858  
**Equipment:** 26 foot Box Truck  
**Location:** West Palm Beach, FL  

---

## DISPATCHER STEPS

### Step 1: Access Driver Management
1. Navigate to LoadOps Dashboard
2. Click "Driver Management" in the sidebar
3. Click "Add New Driver" or "Manually Add Driver" button

### Step 2: Enter Driver Information
Fill in the following fields:
- **Name:** Luke Skywalker
- **Phone:** 660-229-0858 (will be normalized to +16602290858)
- **Email:** (optional, can leave blank)
- **City:** West Palm Beach
- **Equipment Type:** 26 foot Box Truck
- **Weight Capacity:** 26000 lbs (default)
- **Max Length:** 26 ft
- **Status:** Available (default)

### Step 3: Submit and Verify Creation
1. Click "Create Driver" button
2. Wait for success confirmation message
3. Verify driver appears in the driver list
4. Check driver status shows as "Available"

---

## AUTOMATED SYSTEM ACTIONS

### SMS Notification
System automatically sends SMS to 660-229-0858 with:
- Welcome message: "Welcome to TRAQ IQ, Luke Skywalker!"
- Dashboard link for mobile access
- Instructions for logging in

---

## DRIVER STEPS

### Step 1: Receive SMS
1. Check phone 660-229-0858 for SMS from TRAQ IQ
2. Verify message contains:
   - Welcome greeting with name
   - Dashboard link (shortened URL)
   - Instructions

### Step 2: Access Mobile Dashboard
1. Click the link in the SMS
2. Dashboard should automatically authenticate using driverId from URL
3. Verify dashboard loads successfully

### Step 3: Verify Profile Information
On the driver dashboard, verify:
- Name displays as "Luke Skywalker"
- Status shows as "Available"
- Equipment type shows "26 foot Box Truck"
- Location shows "West Palm Beach"
- No active loads yet (0 loads)

---

## VERIFICATION CHECKLIST

### ✅ Dispatcher Side Verification
- [ ] Driver "Luke Skywalker" appears in Driver Management list
- [ ] Phone number shows as 660-229-0858 or +16602290858
- [ ] Equipment type shows "26 foot Box Truck"
- [ ] Location shows "West Palm Beach"
- [ ] Status shows "Available"
- [ ] Driver has a valid driverId (UUID format)

### ✅ SMS Verification
- [ ] SMS was sent to 660-229-0858
- [ ] SMS contains driver name "Luke Skywalker"
- [ ] SMS contains clickable dashboard link
- [ ] SMS was received within 30 seconds of creation

### ✅ Driver Dashboard Verification
- [ ] Dashboard link from SMS works
- [ ] Dashboard loads without errors
- [ ] Driver name "Luke Skywalker" displays correctly
- [ ] Status shows "Available"
- [ ] Equipment information is correct
- [ ] Location shows "West Palm Beach"
- [ ] Load count shows 0 (no active loads yet)
- [ ] Navigation menu is accessible

---

## SUCCESS CRITERIA

All checkboxes in the Verification Checklist must be checked ✅ before proceeding to SOP #2.

---

## TROUBLESHOOTING

**If SMS is not received:**
- Check Twilio configuration in system settings
- Verify phone number format is correct (+1 for US numbers)
- Check server logs for SMS send confirmation

**If dashboard link doesn't work:**
- Verify driver was created successfully
- Check that driverId is included in the URL
- Try accessing dashboard directly via /driver-dashboard?driverId=[ID]

**If driver doesn't appear in list:**
- Refresh the Driver Management page
- Check for error messages during creation
- Verify database connection is working
