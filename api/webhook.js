// Fast Cab WhatsApp Webhook - SESSION BUGS FIXED
// Handles ride booking, tracking, cancellation, optional rating, and payment

// Configuration
const SANDBOX_CODE = "cap-pleasure";
const DEMO_TIMINGS = {
  DRIVER_ARRIVAL: 8000,
  TRIP_START: 5000,
  TRIP_DURATION: 15000
};

// Global session storage (survives serverless calls using global)
if (!global.userSessions) {
  global.userSessions = new Map();
}
if (!global.requestCounts) {
  global.requestCounts = new Map();
}

// Lagos locations with aliases
const LAGOS_LOCATIONS = {
  'ikoyi': { name: 'Ikoyi', lat: 6.4511, lng: 3.4372 },
  'vi': { name: 'Victoria Island', lat: 6.4281, lng: 3.4219 },
  'victoria island': { name: 'Victoria Island', lat: 6.4281, lng: 3.4219 },
  'lekki': { name: 'Lekki', lat: 6.4698, lng: 3.5852 },
  'surulere': { name: 'Surulere', lat: 6.5027, lng: 3.3635 },
  'ikeja': { name: 'Ikeja', lat: 6.6018, lng: 3.3515 },
  'yaba': { name: 'Yaba', lat: 6.5158, lng: 3.3696 },
  'lagos island': { name: 'Lagos Island', lat: 6.4541, lng: 3.3947 },
  'island': { name: 'Lagos Island', lat: 6.4541, lng: 3.3947 },
  'apapa': { name: 'Apapa', lat: 6.4474, lng: 3.3594 },
  'ajah': { name: 'Ajah', lat: 6.4698, lng: 3.6043 }
};

// Ride types with realistic pricing
const RIDE_TYPES = {
  'economy': {
    name: '🚗 Economy',
    description: 'Budget-friendly • 2-4 mins',
    base_fare: 600,
    per_km: 120
  },
  'comfort': {
    name: '🚙 Comfort', 
    description: 'More space • AC guaranteed',
    base_fare: 900,
    per_km: 180
  },
  'premium': {
    name: '🚕 Premium',
    description: 'Luxury • Top drivers',
    base_fare: 1500,
    per_km: 250
  }
};

// Demo drivers
const DEMO_DRIVERS = [
  {
    name: 'Emeka Johnson',
    phone: '+234701****890', 
    vehicle: 'Toyota Corolla',
    plate: 'LAG-234-XY',
    rating: 4.9,
    trips: 1247
  },
  {
    name: 'Fatima Abubakar',
    phone: '+234802****567',
    vehicle: 'Honda Civic', 
    plate: 'LAG-567-BC',
    rating: 4.8,
    trips: 892
  },
  {
    name: 'Samuel Okafor',
    phone: '+234703****234',
    vehicle: 'Toyota Camry',
    plate: 'LAG-890-DE', 
    rating: 4.9,
    trips: 1534
  }
];

// HELPER FUNCTIONS

// Detect sandbox join messages - MORE FLEXIBLE MATCHING
function isSandboxJoinMessage(message) {
  const msg = message.toLowerCase().replace(/\s+/g, '');
  const patterns = [
    'joincap-pleasure',
    'joincappleasure', 
    'cap-pleasure',
    'cappleasure'
  ];
  return patterns.some(pattern => msg.includes(pattern));
}

// Parse ride requests with smart location matching - IMPROVED
function parseRideRequest(message) {
  const msg = message.toLowerCase().trim();
  
  // Enhanced patterns to catch more variations
  const patterns = [
    /(?:ride|book|trip|go)?\s*from\s+([^to]+?)\s+to\s+(.+)/i,
    /([a-zA-Z\s]+)\s+to\s+([a-zA-Z\s]+)/i,
    /^([a-zA-Z\s]+)-([a-zA-Z\s]+)$/i // handles "lekki-ikeja" format
  ];
  
  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match && match[1] && match[2]) {
      const pickup = findLocation(match[1].trim());
      const dropoff = findLocation(match[2].trim());
      
      if (pickup && dropoff && pickup !== dropoff) {
        return { pickup, dropoff };
      }
    }
  }
  return null;
}

// Smart location finder with fuzzy matching - ENHANCED
function findLocation(input) {
  const term = input.toLowerCase().trim();
  
  // Direct match
  if (LAGOS_LOCATIONS[term]) return term;
  
  // Abbreviations and aliases
  const aliases = {
    'vi': 'victoria island',
    'v.i': 'victoria island', 
    'v.i.': 'victoria island',
    'island': 'lagos island'
  };
  if (aliases[term]) return aliases[term];
  
  // Partial match (more flexible)
  const matches = Object.keys(LAGOS_LOCATIONS).filter(loc => 
    loc.includes(term) || term.includes(loc) || 
    LAGOS_LOCATIONS[loc].name.toLowerCase().includes(term)
  );
  
  return matches.length === 1 ? matches[0] : null;
}

// Calculate distance between locations
function calculateDistance(pickup, dropoff) {
  const p1 = LAGOS_LOCATIONS[pickup];
  const p2 = LAGOS_LOCATIONS[dropoff];
  
  if (!p1 || !p2) return 8;
  
  const R = 6371;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLon = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c * 10) / 10;
}

// Calculate fare based on ride type and distance
function calculateFare(rideType, distance) {
  const rate = RIDE_TYPES[rideType];
  return rate.base_fare + (rate.per_km * distance);
}

// Rate limiting (25 messages per minute)
function checkRateLimit(phone) {
  const now = Date.now();
  const requests = global.requestCounts.get(phone) || [];
  const recent = requests.filter(time => now - time < 60000);
  
  if (recent.length >= 25) {
    return false;
  }
  
  recent.push(now);
  global.requestCounts.set(phone, recent);
  return true;
}

// Generate booking ID
function generateBookingId() {
  return 'FC' + Date.now().toString(36).substr(-6).toUpperCase();
}

// Fast TwiML response
function createTwiMLResponse(message) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>
</Response>`;
}

// Send scheduled messages using Twilio API (non-blocking)
async function sendScheduledMessage(userPhone, message, delay) {
  setTimeout(async () => {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log(`[SCHEDULED - Dev Mode]: ${message.substring(0, 50)}...`);
      return;
    }
    
    try {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          From: 'whatsapp:+14155238886',
          To: `whatsapp:${userPhone}`,
          Body: message
        })
      });
      
      if (!response.ok) {
        console.error(`[SCHEDULED ERROR]: ${response.status}`);
      }
    } catch (error) {
      console.error('[SCHEDULED ERROR]:', error);
    }
  }, delay);
}

// MAIN WEBHOOK HANDLER
export default async function handler(req, res) {
  // Performance: Set headers immediately
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  
  if (req.method !== 'POST') {
    return res.status(405).send(createTwiMLResponse('Method not allowed'));
  }

  try {
    const { Body: rawBody, From: from } = req.body;
    
    if (!rawBody || !from) {
      return res.status(400).send(createTwiMLResponse('Invalid request'));
    }

    const userPhone = from.replace('whatsapp:', '');
    const message = rawBody.trim();
    
    console.log(`📱 [${userPhone.slice(-4)}]: "${message}"`);

    // Rate limiting
    if (!checkRateLimit(userPhone)) {
      return res.status(429).send(createTwiMLResponse('⏳ Too many requests. Please wait a moment.'));
    }

    // Get or create user session - FIXED INITIALIZATION
    let session = global.userSessions.get(userPhone);
    if (!session) {
      session = { 
        connected: false,
        currentState: 'new_user',
        joinedAt: null
      };
      global.userSessions.set(userPhone, session);
      console.log(`🆕 NEW SESSION created for ${userPhone.slice(-4)}`);
    }

    let responseMessage = '';
    
    // PRIORITY 1: Handle sandbox join (new user setup)
    if (isSandboxJoinMessage(message)) {
      console.log(`✅ SANDBOX JOIN detected for ${userPhone.slice(-4)}`);
      
      // Mark user as connected
      session.connected = true;
      session.joinedAt = Date.now();
      session.currentState = 'welcome';
      global.userSessions.set(userPhone, session);
      
      responseMessage = `✅ *Connected successfully!*

🚖 *Welcome to Fast Cab!*

🔥 *Popular routes (copy & send):*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"  
💬 "ride from Surulere to Yaba"

*Ready to book your ride?*`;
    }

    // PRIORITY 2: Handle greetings from connected users
    else if (
      session.connected && (
        ['hi', 'hello', 'start', 'hey', 'menu'].includes(message.toLowerCase().trim()) ||
        message.toLowerCase().includes('hi! i want to try the fast cab demo')
      )
    ) {
      console.log(`👋 WELCOME MESSAGE for connected user ${userPhone.slice(-4)}`);
      
      session.currentState = 'welcome';
      global.userSessions.set(userPhone, session);
      
      responseMessage = `🚖 *Welcome back to Fast Cab!*

🔥 *Popular routes (copy & send):*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Yaba"

*Ready to book your ride?*`;
    }

    // PRIORITY 3: Handle ride requests from connected users - MAIN FIX
    else if (session.connected) {
      const msg = message.toLowerCase().trim();
      
      // Handle ride booking requests
      const rideRequest = parseRideRequest(message);
      if (rideRequest) {
        console.log(`🚗 RIDE REQUEST from ${userPhone.slice(-4)}: ${rideRequest.pickup} → ${rideRequest.dropoff}`);
        
        const { pickup, dropoff } = rideRequest;
        const distance = calculateDistance(pickup, dropoff);
        const pickupName = LAGOS_LOCATIONS[pickup].name;
        const dropoffName = LAGOS_LOCATIONS[dropoff].name;
        
        // Update session with pending ride
        session.pendingRide = { pickup, dropoff, distance, pickupName, dropoffName };
        session.currentState = 'selecting_ride';
        global.userSessions.set(userPhone, session);
        
        responseMessage = `🚗 *Available rides from ${pickupName} to ${dropoffName}:*

*1️⃣ 🚗 Economy - ₦${calculateFare('economy', distance).toLocaleString()}*
   ⏱️ 2-4 mins • Budget-friendly

*2️⃣ 🚙 Comfort - ₦${calculateFare('comfort', distance).toLocaleString()}*  
   ⏱️ 2-3 mins • More space + AC

*3️⃣ 🚕 Premium - ₦${calculateFare('premium', distance).toLocaleString()}*
   ⏱️ 1-2 mins • Luxury experience

💬 *Type 1, 2, or 3 to book*`;
      }
      
      // Handle ride selection (1, 2, 3)
      else if (['1', '2', '3'].includes(msg) && session.currentState === 'selecting_ride' && session.pendingRide) {
        console.log(`🎯 RIDE SELECTION: Option ${msg} chosen by ${userPhone.slice(-4)}`);
        
        const selectedOption = parseInt(msg);
        const rideTypes = Object.keys(RIDE_TYPES);
        const selectedRideKey = rideTypes[selectedOption - 1];
        const selectedRide = RIDE_TYPES[selectedRideKey];
        const { pendingRide } = session;
        
        const fare = calculateFare(selectedRideKey, pendingRide.distance);
        const bookingId = generateBookingId(); 
        const driver = DEMO_DRIVERS[Math.floor(Math.random() * DEMO_DRIVERS.length)];
        
        // Update session with active trip
        session.activeTrip = {
          bookingId,
          driver,
          pickup: pendingRide.pickupName,
          dropoff: pendingRide.dropoffName, 
          fare,
          startTime: Date.now(),
          rideType: selectedRideKey
        };
        session.currentState = 'trip_confirmed';
        session.pendingRide = null;
        global.userSessions.set(userPhone, session);
        
        responseMessage = `✅ *Ride Confirmed!*
🚕 *${selectedRide.name} - ₦${fare.toLocaleString()}*
📍 *${pendingRide.pickupName} → ${pendingRide.dropoffName}*

👨‍✈️ *Your Driver*
📱 *${driver.name}*
🚗 *${driver.vehicle}*
🏷️ *${driver.plate}*  
⭐ *${driver.rating}/5 (${driver.trips.toLocaleString()} trips)*

📍 *Booking: ${bookingId}*
⏰ *Arriving in 8 seconds...*

💬 *Type "track" to track driver*
💬 *Type "cancel" if needed*`;

        // Automated ride sequence (non-blocking)
        sendScheduledMessage(userPhone, 
          `🚗 *Driver Arrived!*
${driver.name} is waiting outside
📍 *Pickup: ${pendingRide.pickupName}*  
🚗 *Vehicle: ${driver.vehicle} (${driver.plate})*`, 
          DEMO_TIMINGS.DRIVER_ARRIVAL);

        sendScheduledMessage(userPhone,
          `🚀 *Trip Started!*
📱 *Live tracking: fast-cab.vercel.app/track/${bookingId}*
⏱️ *ETA: 15 seconds*
📍 *Destination: ${pendingRide.dropoffName}*
🛡️ *Enjoy your safe ride!*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START);

        // Update state for trip completion
        setTimeout(() => {
          const currentSession = global.userSessions.get(userPhone);
          if (currentSession?.activeTrip?.bookingId === bookingId) {
            currentSession.currentState = 'payment_rating';
            global.userSessions.set(userPhone, currentSession);
          }
        }, DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START);

        sendScheduledMessage(userPhone,
          `🎉 *Trip Completed!*
💰 *Total: ₦${fare.toLocaleString()}*
📍 *Arrived: ${pendingRide.dropoffName}*  
⏱️ *Duration: 15 seconds*

⭐ *Rate ${driver.name}? (Optional)*
💬 *Type "1" to "5" for rating OR skip to payment*

💳 *Payment method:*
💬 *Type "cash" or "transfer"*

*Choose rating + payment OR just payment above*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION);
      }
      
      // Handle tracking
      else if (msg === 'track') {
        if (session.activeTrip) {
          const { driver, pickup, dropoff, bookingId } = session.activeTrip;
          responseMessage = `🔍 *Live Trip Tracking*

📍 *Booking: ${bookingId}*
👨‍✈️ *Driver: ${driver.name}*
📱 *Phone: ${driver.phone}*
🚗 *Vehicle: ${driver.vehicle} (${driver.plate})*
🌐 *Live map: fast-cab.vercel.app/track/${bookingId}*

📍 *Current: En route to ${dropoff}*
⏱️ *ETA: Few minutes*

🛡️ *Your safety is our priority!*`;
        } else {
          responseMessage = `❌ *No active trip to track*

*Start a new ride:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"

*Copy any route above!*`;
        }
      }
      
      // Handle cancellation
      else if (msg === 'cancel') {
        if (session.activeTrip) {
          session.currentState = 'cancellation_confirm';
          global.userSessions.set(userPhone, session);
          
          responseMessage = `⚠️ *Cancel Trip Confirmation*

📍 *Booking: ${session.activeTrip.bookingId}*
👨‍✈️ *Driver: ${session.activeTrip.driver.name}*

*Are you sure you want to cancel?*

💬 *Type "yes" to cancel*  
💬 *Type "no" to continue trip*`;
        } else {
          responseMessage = `❌ *No active trip to cancel*

*Start a new ride:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"

*Copy any route above!*`;
        }
      }
      
      // Handle cancellation confirmation  
      else if (session.currentState === 'cancellation_confirm') {
        if (msg === 'yes') {
          const { bookingId, driver } = session.activeTrip;
          session.activeTrip = null;
          session.currentState = 'welcome';
          global.userSessions.set(userPhone, session);
          
          responseMessage = `✅ *Trip Cancelled*

📍 *Booking: ${bookingId}* has been cancelled
💰 *No charges applied*  
🚗 *${driver.name} has been notified*

🔥 *Book another ride?*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Yaba"

*Ready for your next ride?*`;
        } else if (msg === 'no') {
          session.currentState = 'trip_confirmed';
          global.userSessions.set(userPhone, session);
          
          responseMessage = `✅ *Trip Continues*

🚗 *Your ride is still active*
📍 *${session.activeTrip.driver.name} has been notified*
🔍 *Type "track" for live updates*`;
        } else {
          responseMessage = `*Please respond with:*
💬 *"yes" to cancel trip*
💬 *"no" to continue trip*`;
        }
      }
      
      // Handle payment and optional rating  
      else if (session.currentState === 'payment_rating') {
        const isRating = /^[1-5]$/.test(msg);
        const isPayment = ['cash', 'transfer'].includes(msg);
        
        if (isRating) {
          const rating = parseInt(msg);
          const stars = '⭐'.repeat(rating);
          const ratingText = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating - 1];
          const feedback = rating >= 4 ? '🎉 Thank you for the positive feedback!' : 'Your feedback helps us improve!';
          
          session.rating = rating;
          session.currentState = 'payment_only';
          global.userSessions.set(userPhone, session);
          
          responseMessage = `✅ *Rating submitted!*
${stars} *${rating}/5 - ${ratingText}*
👨‍✈️ *${session.activeTrip.driver.name} has been rated*

${feedback}

💳 *Payment method:*
💬 *Type "cash" or "transfer"*

*Choose your payment option above*`;
        } else if (isPayment) {
          return handlePayment(userPhone, msg, session, res);
        } else {
          responseMessage = `*Please choose:*
⭐ *Rate 1-5 (optional)*  
💳 *Payment: "cash" or "transfer"*

*Example: "4" or "cash"*`;
        }
      }
      
      // Handle payment after rating
      else if (session.currentState === 'payment_only' && ['cash', 'transfer'].includes(msg)) {
        return handlePayment(userPhone, msg, session, res);
      }
      
      // Default help for connected users
      else {
        console.log(`❓ UNKNOWN COMMAND from connected user ${userPhone.slice(-4)}: "${message}"`);
        
        responseMessage = `🚖 *Fast Cab Commands:*

🔥 *Book a ride:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"  

📱 *During trip:*
💬 "track" - Live tracking
💬 "cancel" - Cancel ride

💬 "hi" - Main menu

*Ready to book your ride?*`;
      }
    }
    
    // PRIORITY 4: Handle new/unconnected users  
    else {
      console.log(`🆕 NEW/UNCONNECTED user ${userPhone.slice(-4)}`);
      
      if (['hi', 'hello', 'start', 'hey', 'menu'].includes(message.toLowerCase().trim()) || 
          message.toLowerCase().includes('hi! i want to try the fast cab demo')) {
        responseMessage = `🚖 *Welcome to Fast Cab!*
👋 *Thanks for trying our service!*

⚠️ *Quick setup needed:*

📋 *Step 1:* Copy this code:
join cap-pleasure

📋 *Step 2:* Send it here

📋 *Step 3:* Book rides like:
💬 "ride from Ikoyi to VI"  
💬 "ride from Lekki to Ikeja"

⚡ *Takes 10 seconds • No app needed*

*Copy & send the join code above to start!*`;
      } else {
        responseMessage = `*Please join first by sending:*
join cap-pleasure`;
      }
    }

    console.log(`✅ [${userPhone.slice(-4)}] Response: ${responseMessage.substring(0, 50)}...`);
    return res.status(200).send(createTwiMLResponse(responseMessage));

  } catch (error) {
    console.error('❌ WEBHOOK ERROR:', error);
    return res.status(500).send(createTwiMLResponse('🔧 Temporary issue. Try: "ride from Ikoyi to VI"'));
  }
}

// Helper function to handle payment processing
function handlePayment(userPhone, paymentMethod, session, res) {
  const { activeTrip } = session;
  
  let responseMessage = '';
  
  if (paymentMethod === 'cash') {
    responseMessage = `💰 *Cash Payment Selected*

✅ *Payment confirmed!*
💵 *Pay ₦${activeTrip.fare.toLocaleString()} directly to your driver*
📱 *${activeTrip.driver.name} will collect payment*

🎉 *Trip completed successfully!*

🔥 *Book another ride?*
💬 "ride from Ikoyi to VI"  
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Yaba"
💬 "ride from VI to Lekki"

*Ready for your next ride?*`;
  } else if (paymentMethod === 'transfer') {
    responseMessage = `💳 *Bank Transfer Selected*

✅ *Payment confirmed!*
🏦 *Transfer ₦${activeTrip.fare.toLocaleString()} to:*
📱 *Fast Cab Wallet*
🏷️ *Account: 1234567890*
🏛️ *Bank: GTBank*

🎉 *Trip completed successfully!*

🔥 *Book another ride?*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"  
💬 "ride from Surulere to Yaba"
💬 "ride from VI to Lekki"

*Ready for your next ride?*`;
  }
  
  // Reset session for new booking
  session.activeTrip = null;
  session.currentState = 'welcome';
  session.rating = null;
  global.userSessions.set(userPhone, session);
  
  return res.status(200).send(createTwiMLResponse(responseMessage));
}