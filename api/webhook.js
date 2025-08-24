// Fast Cab - FIXED Webhook with Working Session Management
// Deployed on Vercel with proper sandbox detection

const twilio = require('twilio');

// Configuration
const SANDBOX_CODE = "cap-pleasure";
const DEMO_TIMINGS = {
  DRIVER_ARRIVAL: 8000,
  TRIP_START: 5000, 
  TRIP_DURATION: 15000,
  AUTO_RESET: 8000
};

// CRITICAL FIX: Use global memory for session persistence
global.userSessions = global.userSessions || new Map();
global.rateLimitStore = global.rateLimitStore || new Map();

// Security config
const SECURITY_CONFIG = {
  MAX_REQUESTS_PER_MINUTE: 50,
  WINDOW_MS: 60000,
  MAX_MESSAGE_LENGTH: 500
};

// Lagos locations
const LAGOS_LOCATIONS = {
  'ikoyi': { name: 'Ikoyi', lat: 6.4511, lng: 3.4372 },
  'vi': { name: 'Victoria Island', lat: 6.4281, lng: 3.4219 },
  'victoria island': { name: 'Victoria Island', lat: 6.4281, lng: 3.4219 },
  'lekki': { name: 'Lekki', lat: 6.4698, lng: 3.5852 },
  'surulere': { name: 'Surulere', lat: 6.5027, lng: 3.3635 },
  'ikeja': { name: 'Ikeja', lat: 6.6018, lng: 3.3515 },
  'yaba': { name: 'Yaba', lat: 6.5158, lng: 3.3696 },
  'lagos island': { name: 'Lagos Island', lat: 6.4541, lng: 3.3947 },
  'apapa': { name: 'Apapa', lat: 6.4474, lng: 3.3594 },
  'ajah': { name: 'Ajah', lat: 6.4698, lng: 3.6043 }
};

// Ride types with pricing
const RIDE_TYPES = {
  'economy': {
    name: '🚗 Economy',
    description: 'Affordable rides for everyday trips',
    base_fare: 600,
    per_km: 120
  },
  'comfort': {
    name: '🚙 Comfort',
    description: 'More space and newer vehicles', 
    base_fare: 900,
    per_km: 180
  },
  'premium': {
    name: '🚕 Premium',
    description: 'Luxury vehicles with top-rated drivers',
    base_fare: 1500,
    per_km: 250
  }
};

// Demo drivers
const DEMO_DRIVERS = [
  {
    id: 1,
    name: 'John Doe',
    phone: '+234701234****',
    vehicle_make: 'Toyota',
    vehicle_model: 'Corolla',
    plate_number: 'LAG-123-AB',
    rating: 4.8,
    total_trips: 245
  },
  {
    id: 2,
    name: 'Mary Johnson', 
    phone: '+234701234****',
    vehicle_make: 'Honda',
    vehicle_model: 'Civic',
    plate_number: 'LAG-456-CD',
    rating: 4.9,
    total_trips: 189
  },
  {
    id: 3,
    name: 'David Wilson',
    phone: '+234701234****', 
    vehicle_make: 'Toyota',
    vehicle_model: 'Camry',
    plate_number: 'LAG-789-EF',
    rating: 4.7,
    total_trips: 312
  }
];

// FIXED: Session management with global persistence
function getUserSession(userPhone) {
  if (!global.userSessions.has(userPhone)) {
    global.userSessions.set(userPhone, {
      conversation_state: 'new_user',
      sandbox_joined: false,
      booking_data: {},
      created_at: Date.now()
    });
  }
  return global.userSessions.get(userPhone);
}

function updateUserSession(userPhone, updates) {
  const session = getUserSession(userPhone);
  Object.assign(session, updates);
  global.userSessions.set(userPhone, session);
  console.log(`[SESSION UPDATED] ${userPhone.substring(0, 8)}***: sandbox=${session.sandbox_joined}, state=${session.conversation_state}`);
}

// FIXED: More comprehensive sandbox detection
function isSandboxJoinMessage(message) {
  const cleanMsg = message.toLowerCase().trim().replace(/\s+/g, '');
  const patterns = [
    'joincap-pleasure',
    'joincappleasure', 
    'join cap-pleasure',
    'join cap pleasure',
    'cap-pleasure',
    'cappleasure'
  ];
  
  return patterns.some(pattern => cleanMsg.includes(pattern.replace(/\s+/g, '')));
}

// Rate limiting
function checkRateLimit(phone) {
  const now = Date.now();
  const userRequests = global.rateLimitStore.get(phone) || [];
  const validRequests = userRequests.filter(time => now - time < SECURITY_CONFIG.WINDOW_MS);
  
  if (validRequests.length >= SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  validRequests.push(now);
  global.rateLimitStore.set(phone, validRequests);
  return true;
}

// Utility functions
function calculateDistance(pickup, dropoff) {
  const pickup_coords = LAGOS_LOCATIONS[pickup.toLowerCase()];
  const dropoff_coords = LAGOS_LOCATIONS[dropoff.toLowerCase()];
  
  if (!pickup_coords || !dropoff_coords) return 10;
  
  const lat1 = pickup_coords.lat * Math.PI / 180;
  const lon1 = pickup_coords.lng * Math.PI / 180;
  const lat2 = dropoff_coords.lat * Math.PI / 180;
  const lon2 = dropoff_coords.lng * Math.PI / 180;
  
  const R = 6371;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(R * c * 10) / 10;
}

function calculateFare(rideType, distance) {
  const rate = RIDE_TYPES[rideType];
  return rate.base_fare + (rate.per_km * distance);
}

function generateBookingId() {
  return 'FC' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

function parseRideRequest(message) {
  const lowerMessage = message.toLowerCase();
  const patterns = [
    /(?:ride|book|trip)\s+from\s+([^to]+)\s+to\s+(.+)/i,
    /from\s+([^to]+)\s+to\s+(.+)/i,
    /([^to]+)\s+to\s+(.+)/i
  ];
  
  for (const pattern of patterns) {
    const match = lowerMessage.match(pattern);
    if (match) {
      return {
        pickup: match[1].trim(),
        dropoff: match[2].trim()
      };
    }
  }
  return null;
}

function validateLocation(location) {
  return LAGOS_LOCATIONS[location.toLowerCase()] !== undefined;
}

// Initialize Twilio client
let twilioClient;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
} catch (error) {
  console.error('TWILIO CLIENT ERROR:', error);
}

async function sendScheduledMessage(to, message, delay) {
  if (!twilioClient) return;
  
  setTimeout(async () => {
    try {
      await twilioClient.messages.create({
        body: message,
        from: 'whatsapp:+14155238886',
        to: `whatsapp:${to}`
      });
      console.log(`[SCHEDULED] Message sent to ${to.substring(0, 8)}***`);
    } catch (error) {
      console.error('[SCHEDULED ERROR]:', error.message);
    }
  }, delay);
}

// MAIN WEBHOOK HANDLER - COMPLETELY REWRITTEN
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');

  if (req.method !== 'POST') {
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Method not allowed</Message></Response>`;
    return res.status(405).send(errorTwiml);
  }

  try {
    const { Body: rawBody, From: from } = req.body;
    
    if (!rawBody || !from) {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Invalid request</Message></Response>`;
      return res.status(400).send(errorTwiml);
    }

    const userPhone = from.replace('whatsapp:', '');
    const message = rawBody.trim();

    console.log(`\n=== WEBHOOK REQUEST ===`);
    console.log(`Phone: ${userPhone.substring(0, 8)}***`);
    console.log(`Message: "${message}"`);

    // Rate limiting
    if (!checkRateLimit(userPhone)) {
      const rateLimitTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>⚠️ Too many requests. Please wait a moment.</Message></Response>`;
      return res.status(429).send(rateLimitTwiml);
    }

    // Get current session
    const session = getUserSession(userPhone);
    console.log(`Current session: sandbox=${session.sandbox_joined}, state=${session.conversation_state}`);

    let responseMessage = '';

    // PRIORITY 1: Handle sandbox join messages FIRST
    if (isSandboxJoinMessage(message)) {
      console.log(`🎯 SANDBOX JOIN DETECTED!`);
      
      responseMessage = `✅ *Perfect! You're now in the Fast Cab Demo!*

🎉 *Setup complete!* Ready to book your first ride.

🚖 *Try these commands now:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Surulere"
💬 "ride from Ikeja to Yaba"

⚡ *Features:* 3 ride types • Upfront pricing • Real-time simulation

*Where would you like to go?*`;
      
      // CRITICAL: Update session immediately
      updateUserSession(userPhone, { 
        sandbox_joined: true, 
        conversation_state: 'ready_to_book' 
      });
    }
    
    // PRIORITY 2: Handle ride booking (only for sandbox users)
    else {
      const rideRequest = parseRideRequest(message);
      
      if (rideRequest && session.sandbox_joined) {
        const { pickup, dropoff } = rideRequest;
        console.log(`🚗 RIDE REQUEST: ${pickup} → ${dropoff}`);
        
        if (!validateLocation(pickup) || !validateLocation(dropoff)) {
          responseMessage = `❌ *Location not found*

📍 *Available Lagos areas:*
• Ikoyi, Victoria Island (VI), Lekki
• Surulere, Ikeja, Yaba, Lagos Island
• Apapa, Ajah

💬 *Try:* "ride from Ikoyi to VI"`;
        } else {
          const distance = calculateDistance(pickup, dropoff);
          const pickupName = LAGOS_LOCATIONS[pickup.toLowerCase()].name;
          const dropoffName = LAGOS_LOCATIONS[dropoff.toLowerCase()].name;
          
          updateUserSession(userPhone, {
            conversation_state: 'selecting_ride',
            booking_data: { pickup: pickupName, dropoff: dropoffName, distance }
          });
          
          responseMessage = `🚗 *Available Demo Rides*
📍 *From:* ${pickupName}
📍 *To:* ${dropoffName}
📏 *Distance:* ~${distance}km

`;
          
          let optionNumber = 1;
          Object.entries(RIDE_TYPES).forEach(([key, ride]) => {
            const fare = calculateFare(key, distance);
            responseMessage += `*${optionNumber}. ${ride.name}*
💰 ₦${fare.toLocaleString()}
📝 ${ride.description}

`;
            optionNumber++;
          });
          
          responseMessage += `💬 *Reply 1, 2, or 3 to select your ride*`;
        }
      }
      
      // PRIORITY 3: Handle ride selection
      else if (session.conversation_state === 'selecting_ride' && ['1', '2', '3'].includes(message) && session.sandbox_joined) {
        console.log(`🎯 RIDE SELECTION: ${message}`);
        
        const rideTypes = Object.keys(RIDE_TYPES);
        const selectedRideKey = rideTypes[parseInt(message) - 1];
        const selectedRide = RIDE_TYPES[selectedRideKey];
        
        const { pickup, dropoff, distance } = session.booking_data;
        const fare = calculateFare(selectedRideKey, distance);
        const bookingId = generateBookingId();
        const driver = DEMO_DRIVERS[Math.floor(Math.random() * DEMO_DRIVERS.length)];
        
        updateUserSession(userPhone, {
          conversation_state: 'ride_confirmed',
          booking_data: {
            ...session.booking_data,
            ride_type: selectedRideKey,
            fare,
            booking_id: bookingId,
            driver
          }
        });
        
        responseMessage = `✅ *Demo Ride Confirmed!*

${selectedRide.name} - ₦${fare.toLocaleString()}
📍 *From:* ${pickup}
📍 *To:* ${dropoff}

👨‍✈️ *Your Demo Driver*
📛 *${driver.name}*
🚗 *${driver.vehicle_make} ${driver.vehicle_model}* (${driver.plate_number})
⭐ ${driver.rating}/5.0 • ${driver.total_trips} trips
📱 ${driver.phone}

⏰ *Arriving in 8 seconds* *(demo speed)*

🔔 *You'll receive automatic updates!*
🎭 *Enjoy the full simulation!*`;

        // Schedule automated demo messages
        await sendScheduledMessage(userPhone, 
          `🚗 *Demo Driver Arrived!*

${driver.name} is waiting outside
📍 *Location:* ${pickup}
🚗 *Vehicle:* ${driver.vehicle_make} ${driver.vehicle_model} (${driver.plate_number})

⏰ *Starting trip now...*`, 
          DEMO_TIMINGS.DRIVER_ARRIVAL);

        await sendScheduledMessage(userPhone,
          `🚀 *Demo Trip Started!*

📊 *Live tracking active*
⏱️ *ETA:* 15 seconds *(demo speed)*
📍 *Destination:* ${dropoff}

🛡️ *Safe journey in progress!*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START);

        await sendScheduledMessage(userPhone,
          `🎉 *Demo Trip Completed!*

💰 *Fare:* ₦${fare.toLocaleString()}
📍 *Arrived at:* ${dropoff}
⭐ *Rate your driver:* Excellent!

🔄 *Try another ride:*
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Ajah"

*Ready for your next demo ride?*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION);

        // Reset session
        setTimeout(() => {
          updateUserSession(userPhone, { conversation_state: 'ready_to_book' });
        }, DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION + DEMO_TIMINGS.AUTO_RESET);
      }
      
      // PRIORITY 4: Handle greetings
      else if (['hi', 'hello', 'start', 'hey'].includes(message.toLowerCase())) {
        console.log(`👋 GREETING: sandbox=${session.sandbox_joined}`);
        
        if (session.sandbox_joined) {
          responseMessage = `🚖 *Welcome back to Fast Cab Demo!*

🎭 *Ready for another ride?*

✨ *Try these commands:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Surulere"
💬 "ride from Ikeja to Yaba"

⚡ *Instant booking • Upfront pricing*

*Where would you like to go?*`;
          updateUserSession(userPhone, { conversation_state: 'ready_to_book' });
        } else {
          responseMessage = `🚖 *Welcome to Fast Cab Demo!*

⚠️ *First-time setup needed:*

*Step 1:* Copy this code:
\`\`\`join ${SANDBOX_CODE}\`\`\`

*Step 2:* Send it in this chat

*Step 3:* Start booking rides immediately!

🎯 *One-time setup • Works 72 hours*

*Send the join code to continue...*`;
        }
      }
      
      // PRIORITY 5: Handle everything else
      else {
        if (session.sandbox_joined) {
          responseMessage = `❓ *Try these ride commands:*

💬 *Examples:*
• "ride from Ikoyi to VI"
• "ride from Lekki to Surulere"
• "ride from Ikeja to Yaba"

📍 *Available locations:* Ikoyi, VI, Lekki, Surulere, Ikeja, Yaba, Lagos Island, Apapa, Ajah

*Where would you like to go?*`;
        } else {
          responseMessage = `🔒 *Demo Setup Required*

Please send this code first:
\`\`\`join ${SANDBOX_CODE}\`\`\`

Then you can start booking rides!

*Copy and send the code above...*`;
        }
      }
    }

    console.log(`Response: ${responseMessage.substring(0, 100)}...`);
    console.log(`=== END ===\n`);

    // ALWAYS return TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>
</Response>`;

    return res.status(200).send(twiml);

  } catch (error) {
    console.error('[CRITICAL ERROR]:', error);
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>🔧 Service temporarily unavailable. Please try again.</Message>
</Response>`;
    
    return res.status(500).send(errorTwiml);
  }
}