// Fast Cab - Production Ready Webhook with Security & Compliance
// Optimized for Vercel deployment with best practices

const twilio = require('twilio');

// Configuration
const SANDBOX_CODE = "cap-pleasure";
const DEMO_TIMINGS = {
  DRIVER_ARRIVAL: 8000,
  TRIP_START: 5000, 
  TRIP_DURATION: 15000,
  AUTO_RESET: 8000
};

// Enhanced session storage with cleanup
const userSessions = new Map();
const rateLimitStore = new Map();
const messageHistory = new Map();

// Security & Rate limiting
const SECURITY_CONFIG = {
  MAX_REQUESTS_PER_MINUTE: 30,
  MAX_REQUESTS_PER_HOUR: 100,
  WINDOW_MS: 60000,
  SESSION_TIMEOUT: 7200000, // 2 hours
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

// Security: Input validation and sanitization
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .substring(0, SECURITY_CONFIG.MAX_MESSAGE_LENGTH)
    .replace(/[<>\"'&]/g, ''); // Basic XSS prevention
}

function isValidPhoneNumber(phone) {
  // Basic phone number validation
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,15}$/;
  return phoneRegex.test(phone);
}

// Enhanced rate limiting
function checkRateLimit(phone) {
  const now = Date.now();
  const userRequests = rateLimitStore.get(phone) || [];
  
  // Clean old requests
  const validRequests = userRequests.filter(time => now - time < SECURITY_CONFIG.WINDOW_MS);
  
  if (validRequests.length >= SECURITY_CONFIG.MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  validRequests.push(now);
  rateLimitStore.set(phone, validRequests);
  return true;
}

// Session management with cleanup
function getUserSession(userPhone) {
  if (!userSessions.has(userPhone)) {
    userSessions.set(userPhone, {
      conversation_state: 'new_user',
      sandbox_joined: false,
      booking_data: {},
      created_at: Date.now(),
      last_activity: Date.now()
    });
  }
  
  const session = userSessions.get(userPhone);
  session.last_activity = Date.now();
  return session;
}

function updateUserSession(userPhone, updates) {
  const session = getUserSession(userPhone);
  Object.assign(session, updates, { last_activity: Date.now() });
  userSessions.set(userPhone, session);
}

// Clean expired sessions
function cleanupSessions() {
  const now = Date.now();
  for (const [phone, session] of userSessions.entries()) {
    if (now - session.last_activity > SECURITY_CONFIG.SESSION_TIMEOUT) {
      userSessions.delete(phone);
    }
  }
}

// Enhanced sandbox detection
function detectSandboxJoin(message) {
  const cleanMessage = message.toLowerCase().trim();
  const patterns = [
    `join ${SANDBOX_CODE}`,
    `join${SANDBOX_CODE}`,
    SANDBOX_CODE,
    `join cap-pleasure`,
    'join cap-pleasure',
    'joincap-pleasure'
  ];
  
  return patterns.some(pattern => cleanMessage.includes(pattern));
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

// Initialize Twilio client with validation
let twilioClient;
try {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error('MISSING TWILIO CREDENTIALS');
  }
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
} catch (error) {
  console.error('TWILIO CLIENT INIT ERROR:', error);
}

async function sendScheduledMessage(to, message, delay) {
  if (!twilioClient) return;
  
  setTimeout(async () => {
    try {
      await twilioClient.messages.create({
        body: sanitizeInput(message),
        from: 'whatsapp:+14155238886',
        to: `whatsapp:${to}`
      });
      console.log(`[SCHEDULED] Message sent to ${to.substring(0, 8)}***`);
    } catch (error) {
      console.error('[SCHEDULED ERROR]:', error.message);
    }
  }, delay);
}

// Main webhook handler with comprehensive error handling
export default async function handler(req, res) {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');

  // Method validation
  if (req.method !== 'POST') {
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Method not allowed</Message>
</Response>`;
    return res.status(405).send(errorTwiml);
  }

  try {
    // Cleanup expired sessions periodically
    if (Math.random() < 0.1) {
      cleanupSessions();
    }

    // Input validation
    const { Body: rawBody, From: from } = req.body;
    
    if (!rawBody || !from) {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>🔒 Invalid request format</Message>
</Response>`;
      return res.status(400).send(errorTwiml);
    }

    const userPhone = sanitizeInput(from.replace('whatsapp:', ''));
    const message = sanitizeInput(rawBody);

    // Phone number validation
    if (!isValidPhoneNumber(userPhone)) {
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>🔒 Invalid phone number format</Message>
</Response>`;
      return res.status(400).send(errorTwiml);
    }

    console.log(`[WEBHOOK] ${userPhone.substring(0, 8)}***: "${message.substring(0, 50)}..."`);

    // Rate limiting
    if (!checkRateLimit(userPhone)) {
      const rateLimitTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>⚠️ Too many messages. Please wait 1 minute before trying again.</Message>
</Response>`;
      return res.status(429).send(rateLimitTwiml);
    }

    const session = getUserSession(userPhone);
    let responseMessage = '';

    console.log(`[SESSION] State: ${session.conversation_state}, Sandbox: ${session.sandbox_joined}`);

    // ENHANCED SANDBOX JOIN DETECTION
    if (detectSandboxJoin(message)) {
      console.log(`[SANDBOX] User joined: ${userPhone.substring(0, 8)}***`);
      
      responseMessage = `✅ *Perfect! You're now in the Fast Cab Demo!*

🎉 *Setup complete!* The bot is ready for testing.

🚖 *Let's start your first demo ride:*

💬 *Try any of these:*
• "ride from Ikoyi to VI"
• "ride from Lekki to Surulere"
• "book ride from Ikeja to Yaba"

⚡ *Features:* 3 ride types • Upfront pricing • Real-time simulation

*Ready to book your first ride?*`;
      
      // CRITICAL: Update session state
      updateUserSession(userPhone, { 
        sandbox_joined: true, 
        conversation_state: 'ready_to_book' 
      });
    }
    
    // Handle greetings and main interactions
    else if (['hi', 'hello', 'start', 'hey', 'good morning', 'good afternoon', 'good evening'].includes(message.toLowerCase())) {
      
      console.log(`[GREETING] User: ${userPhone.substring(0, 8)}***, Sandbox: ${session.sandbox_joined}`);
      
      if (!session.sandbox_joined) {
        responseMessage = `🚖 *Welcome to Fast Cab Demo!*

⚠️ *First-time setup needed:*

*Step 1:* Copy this code:
\`\`\`join ${SANDBOX_CODE}\`\`\`

*Step 2:* Send it in this chat

*Step 3:* Start booking rides immediately!

🎯 *One-time setup* • Works for 72 hours • No app needed

*Please send the join code above to continue...*`;
      } else {
        responseMessage = `🚖 *Welcome back to Fast Cab Demo!*

🎭 *This is a live simulation* - Experience our ride-hailing bot!

✨ *Quick commands:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Surulere" 
💬 "ride from Ikeja to Yaba"

🚗 *Available everywhere in Lagos*
⚡ *Instant booking • Upfront pricing*
👨‍✈️ *Professional drivers • Real-time updates*

*Where would you like to go?*`;
        updateUserSession(userPhone, { conversation_state: 'ready_to_book' });
      }
    }
    
    // Handle ride requests (only if sandbox joined)
    else if (session.sandbox_joined) {
      const rideRequest = parseRideRequest(message);
      
      if (rideRequest) {
        const { pickup, dropoff } = rideRequest;
        
        console.log(`[RIDE_REQUEST] ${pickup} → ${dropoff}`);
        
        if (!validateLocation(pickup) || !validateLocation(dropoff)) {
          responseMessage = `❌ *Location not found*

📍 *Available Lagos areas:*
• Ikoyi, Victoria Island (VI), Lekki
• Surulere, Ikeja, Yaba, Lagos Island
• Apapa, Ajah

💬 *Try:* "ride from Ikoyi to VI"
Or type *menu* for options`;
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
          
          responseMessage += `💬 *Reply 1, 2, or 3 to select your ride*
Or type *menu* for main menu`;
        }
      }
      
      // Handle ride selection
      else if (session.conversation_state === 'selecting_ride' && ['1', '2', '3'].includes(message)) {
        const rideTypes = Object.keys(RIDE_TYPES);
        const selectedRideKey = rideTypes[parseInt(message) - 1];
        const selectedRide = RIDE_TYPES[selectedRideKey];
        
        const { pickup, dropoff, distance } = session.booking_data;
        const fare = calculateFare(selectedRideKey, distance);
        const bookingId = generateBookingId();
        const driver = DEMO_DRIVERS[Math.floor(Math.random() * DEMO_DRIVERS.length)];
        
        console.log(`[BOOKING] ${bookingId}: ${pickup} → ${dropoff}, ${selectedRideKey}`);
        
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
🎭 *This is a complete simulation - enjoy!*`;

        // Schedule automated demo messages
        await sendScheduledMessage(userPhone, 
          `🚗 *Demo Driver Arrived!*

${driver.name} is waiting outside
📍 *Pickup location:* ${pickup}
🚗 *Vehicle:* ${driver.vehicle_make} ${driver.vehicle_model} (${driver.plate_number})
📱 *Contact:* ${driver.phone}

⏰ *Please come out in 2 minutes*
🎭 *Demo: Starting trip automatically...*`, 
          DEMO_TIMINGS.DRIVER_ARRIVAL);

        await sendScheduledMessage(userPhone,
          `🚀 *Demo Trip Started!*

📊 *Live tracking:* fast-cab-demo.vercel.app/track/${bookingId}
⏱️ *Estimated arrival:* 15 seconds *(demo speed)*
📍 *Destination:* ${dropoff}

🛡️ *Safety features active*
🎭 *Enjoy your simulated ride!*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START);

        await sendScheduledMessage(userPhone,
          `🎉 *Demo Trip Completed Successfully!*

💰 *Total fare:* ₦${fare.toLocaleString()}
⏱️ *Trip duration:* 15 seconds *(demo)*
📍 *Arrived safely at:* ${dropoff}

⭐ *Please rate ${driver.name}:* Excellent service!
🎭 *Thank you for trying Fast Cab Demo!*

🔄 *Ready for another ride?* 
💬 Type: "ride from [pickup] to [destination]"
💬 Or say "hi" for main menu`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION);

        await sendScheduledMessage(userPhone,
          `🚖 *Fast Cab Demo - Ready for More!*

✨ *Try these popular routes:*
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Ajah"  
💬 "ride from Yaba to Apapa"
💬 "ride from VI to Lekki"

🎯 *What did you think of the demo?*
Share your experience with others!

💬 *Type your next ride request now...*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION + DEMO_TIMINGS.AUTO_RESET);

        // Reset session for next booking
        setTimeout(() => {
          updateUserSession(userPhone, { conversation_state: 'ready_to_book' });
        }, DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION + DEMO_TIMINGS.AUTO_RESET);
      }
      
      // Handle menu and help commands
      else if (['menu', 'main menu', 'help', 'options'].includes(message.toLowerCase())) {
        responseMessage = `🚖 *Fast Cab Demo - Main Menu*

💬 *Ride booking commands:*
"ride from [pickup] to [destination]"

📍 *Popular demo routes:*
• "ride from Ikoyi to VI"
• "ride from Lekki to Surulere"
• "ride from Ikeja to Yaba"
• "ride from Surulere to Ajah"

⚡ *Features:* Instant booking • 3 ride types • Upfront pricing • Real-time updates

*Where would you like to go next?*`;
        updateUserSession(userPhone, { conversation_state: 'ready_to_book' });
      }
      
      // Handle unrecognized commands
      else {
        responseMessage = `❓ *Command not recognized*

💬 *Try these examples:*
• "ride from Ikoyi to VI"
• "ride from Lekki to Surulere"
• "menu" - for main menu
• "hi" - to restart

📍 *Available locations:* Ikoyi, VI, Lekki, Surulere, Ikeja, Yaba, Lagos Island, Apapa, Ajah

*What would you like to do?*`;
      }
    } 
    
    // Handle non-sandbox users
    else {
      responseMessage = `🔒 *Demo Access Required*

To try Fast Cab demo, please complete setup:

*Step 1:* Copy and send this exact code:
\`\`\`join ${SANDBOX_CODE}\`\`\`

*Step 2:* Wait for confirmation *(instant)*

*Step 3:* Start booking rides immediately!

🎯 *Quick setup • Works for 72 hours • No download needed*

*Ready to join the demo?*`;
    }

    // ALWAYS return proper TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>
</Response>`;

    console.log(`[RESPONSE] Sent to ${userPhone.substring(0, 8)}***: ${responseMessage.substring(0, 80)}...`);
    
    return res.status(200).send(twiml);

  } catch (error) {
    console.error('[WEBHOOK CRITICAL ERROR]:', error);
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>🔧 Service temporarily unavailable. Please try again in a moment.</Message>
</Response>`;
    
    return res.status(500).send(errorTwiml);
  }
}