// Fast Cab - OPTIMIZED User Experience
// Intuitive flow with smart detection and guided experience

const twilio = require('twilio');

// Configuration
const SANDBOX_CODE = "cap-pleasure";
const DEMO_TIMINGS = {
  DRIVER_ARRIVAL: 8000,    // More realistic timing
  TRIP_START: 5000,
  TRIP_DURATION: 15000,
  AUTO_RESET: 8000
};

// Enhanced rate limiting with user-friendly responses
const requestCounts = new Map();
const userSessions = new Map(); // Temporary session storage for user context

// Lagos locations with common aliases
const LAGOS_LOCATIONS = {
  'ikoyi': { name: 'Ikoyi', lat: 6.4511, lng: 3.4372 },
  'vi': { name: 'Victoria Island', lat: 6.4281, lng: 3.4219 },
  'victoria island': { name: 'Victoria Island', lat: 6.4281, lng: 3.4219 },
  'lekki': { name: 'Lekki', lat: 6.4698, lng: 3.5852 },
  'surulere': { name: 'Surulere', lat: 6.5027, lng: 3.3635 },
  'ikeja': { name: 'Ikeja', lat: 6.6018, lng: 3.3515 },
  'yaba': { name: 'Yaba', lat: 6.5158, lng: 3.3696 },
  'lagos island': { name: 'Lagos Island', lat: 6.4541, lng: 3.3947 },
  'island': { name: 'Lagos Island', lat: 6.4541, lng: 3.3947 }, // Alias
  'apapa': { name: 'Apapa', lat: 6.4474, lng: 3.3594 },
  'ajah': { name: 'Ajah', lat: 6.4698, lng: 3.6043 }
};

// Popular route suggestions for better UX
const POPULAR_ROUTES = [
  { from: 'Ikoyi', to: 'Victoria Island', emoji: '🏢' },
  { from: 'Lekki', to: 'Ikeja', emoji: '✈️' },
  { from: 'Surulere', to: 'Yaba', emoji: '🎓' },
  { from: 'Victoria Island', to: 'Lekki', emoji: '🏠' }
];

// Simplified ride types with clear value propositions
const RIDE_TYPES = {
  'economy': {
    name: '🚗 Economy',
    description: 'Budget-friendly • 2-4 mins ETA',
    base_fare: 600,
    per_km: 120,
    emoji: '🚗'
  },
  'comfort': {
    name: '🚙 Comfort',
    description: 'More space • AC guaranteed',
    base_fare: 900,
    per_km: 180,
    emoji: '🚙'
  },
  'premium': {
    name: '🚕 Premium',
    description: 'Luxury ride • Top drivers',
    base_fare: 1500,
    per_km: 250,
    emoji: '🚕'
  }
};

// Demo drivers with more personality
const DEMO_DRIVERS = [
  {
    id: 1,
    name: 'Emeka Johnson',
    phone: '+234701****890',
    vehicle_make: 'Toyota',
    vehicle_model: 'Corolla',
    plate_number: 'LAG-234-XY',
    rating: 4.9,
    total_trips: 1247,
    greeting: "Welcome! I'm on my way 😊"
  },
  {
    id: 2,
    name: 'Fatima Abubakar',
    phone: '+234802****567',
    vehicle_make: 'Honda',
    vehicle_model: 'Civic',
    plate_number: 'LAG-567-BC',
    rating: 4.8,
    total_trips: 892,
    greeting: "Hello! See you in a few minutes 👋"
  },
  {
    id: 3,
    name: 'Samuel Okafor',
    phone: '+234703****234',
    vehicle_make: 'Toyota',
    vehicle_model: 'Camry',
    plate_number: 'LAG-890-DE',
    rating: 4.9,
    total_trips: 1534,
    greeting: "Good day! Almost there 🚗"
  }
];

// Smart message parsing with fuzzy matching
function smartParseMessage(message) {
  const msg = message.toLowerCase().trim();
  
  // Intent classification
  const intents = {
    greeting: ['hi', 'hello', 'start', 'hey', 'menu', 'begin'],
    help: ['help', 'support', 'assist', 'guide'],
    booking: ['ride', 'book', 'trip', 'go', 'from', 'to'],
    selection: /^[1-3]$/,
    sandbox: ['join', 'cap-pleasure', 'setup'],
    cancel: ['cancel', 'stop', 'end', 'quit'],
    status: ['status', 'where', 'eta', 'driver']
  };
  
  // Check each intent
  for (const [intent, patterns] of Object.entries(intents)) {
    if (intent === 'selection' && patterns.test(msg)) {
      return { intent: 'selection', value: msg };
    }
    if (Array.isArray(patterns) && patterns.some(p => msg.includes(p))) {
      return { intent, message: msg };
    }
  }
  
  return { intent: 'unknown', message: msg };
}

// Enhanced ride request parsing with better location matching
function parseRideRequest(message) {
  const cleanMsg = message.toLowerCase().trim();
  
  // Multiple patterns to catch different ways users express rides
  const patterns = [
    /(?:ride|book|trip|go)\s+from\s+([^to]+?)\s+to\s+(.+)/i,
    /from\s+([^to]+?)\s+to\s+(.+)/i,
    /book\s+([^to]+?)\s+to\s+(.+)/i,
    /([a-zA-Z\s]+)\s+to\s+([a-zA-Z\s]+)/i,
    /take me (?:from\s+)?([^to]+?)\s+to\s+(.+)/i
  ];
  
  for (const pattern of patterns) {
    const match = cleanMsg.match(pattern);
    if (match && match[1] && match[2]) {
      let pickup = match[1].trim();
      let dropoff = match[2].trim();
      
      // Fuzzy location matching
      pickup = findBestLocationMatch(pickup);
      dropoff = findBestLocationMatch(dropoff);
      
      if (pickup && dropoff) {
        return { pickup, dropoff };
      }
    }
  }
  return null;
}

// Fuzzy location matching for better UX
function findBestLocationMatch(input) {
  const searchTerm = input.toLowerCase().trim();
  
  // Exact match first
  if (LAGOS_LOCATIONS[searchTerm]) {
    return searchTerm;
  }
  
  // Partial matches
  const matches = Object.keys(LAGOS_LOCATIONS).filter(loc => 
    loc.includes(searchTerm) || searchTerm.includes(loc)
  );
  
  if (matches.length === 1) {
    return matches[0];
  }
  
  // Common abbreviations
  const abbreviations = {
    'vi': 'victoria island',
    'v.i': 'victoria island',
    'v.i.': 'victoria island',
    'island': 'lagos island'
  };
  
  if (abbreviations[searchTerm]) {
    return abbreviations[searchTerm];
  }
  
  return null;
}

// Calculate distance with caching
const distanceCache = new Map();
function calculateDistance(pickup, dropoff) {
  const cacheKey = `${pickup}-${dropoff}`;
  if (distanceCache.has(cacheKey)) {
    return distanceCache.get(cacheKey);
  }
  
  const p1 = LAGOS_LOCATIONS[pickup.toLowerCase()];
  const p2 = LAGOS_LOCATIONS[dropoff.toLowerCase()];
  
  if (!p1 || !p2) return 8;
  
  const R = 6371;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLon = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = Math.round(R * c * 10) / 10;
  
  distanceCache.set(cacheKey, distance);
  return distance;
}

function calculateFare(rideType, distance) {
  const rate = RIDE_TYPES[rideType];
  if (!rate) return 1000;
  return rate.base_fare + (rate.per_km * distance);
}

function generateBookingId() {
  return 'FC' + Date.now().toString(36).substr(-6).toUpperCase();
}

// Enhanced rate limiting with context
function checkRateLimit(phone) {
  const now = Date.now();
  const key = phone;
  const requests = requestCounts.get(key) || [];
  const recentRequests = requests.filter(time => now - time < 60000);
  
  if (recentRequests.length > 20) { // More reasonable limit
    return { allowed: false, count: recentRequests.length };
  }
  
  recentRequests.push(now);
  requestCounts.set(key, recentRequests);
  return { allowed: true, count: recentRequests.length };
}

// Initialize Twilio client with better error handling
let twilioClient;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  } else {
    console.log('[INFO] Twilio credentials not found - running in development mode');
  }
} catch (error) {
  console.error('[TWILIO INIT ERROR]:', error);
}

// Enhanced scheduled messaging with better error handling
async function sendScheduledMessage(to, message, delay) {
  if (!twilioClient) {
    console.log(`[DEV MODE] Would send: ${message}`);
    return;
  }
  
  setTimeout(async () => {
    try {
      await twilioClient.messages.create({
        body: message,
        from: 'whatsapp:+14155238886',
        to: `whatsapp:${to}`
      });
      console.log(`[SCHEDULED] Message sent to ${to.slice(-4)}`);
    } catch (error) {
      console.error('[SCHEDULED ERROR]:', error.message);
    }
  }, delay);
}

// Generate welcome message with popular routes
function generateWelcomeMessage() {
  const routes = POPULAR_ROUTES.map(route => 
    `${route.emoji} "${route.from} to ${route.to}"`
  ).join('\n');
  
  return `🚖 *Welcome to Fast Cab Demo!*

✨ *Ready to book a ride?*

🔥 *Popular routes - just copy & paste:*
${routes}

📍 *Or create your own:*
💬 "ride from [pickup] to [destination]"

⚡ *Available areas:* Ikoyi, VI, Lekki, Ikeja, Surulere, Yaba, Ajah, Apapa

*Where would you like to go?*`;
}

// Generate setup instructions
function generateSetupMessage() {
  return `🚖 *Fast Cab Demo Setup*

⚠️ *Quick one-time setup:*

*Step 1:* Copy this exact message:
\`join cap-pleasure\`

*Step 2:* Send it in this chat

*Step 3:* Say "hi" again to start booking!

🎯 *Takes 10 seconds • Works for 72 hours*
⚡ *No app installation needed*

*Send the join code to continue...*`;
}

// MAIN OPTIMIZED WEBHOOK HANDLER
export default async function handler(req, res) {
  // Security headers
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method !== 'POST') {
    return res.status(405).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Method not allowed</Message></Response>`);
  }

  const startTime = Date.now();
  
  try {
    const { Body: rawBody, From: from } = req.body;
    
    if (!rawBody || !from) {
      return res.status(400).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Invalid request format</Message></Response>`);
    }

    const userPhone = from.replace('whatsapp:', '');
    const message = rawBody.trim();

    console.log(`\n🔄 [${new Date().toISOString()}] ${userPhone.slice(-4)}: "${message}"`);

    // Enhanced rate limiting
    const rateLimitResult = checkRateLimit(userPhone);
    if (!rateLimitResult.allowed) {
      const waitMessage = `⏳ *Please slow down*\n\nYou've sent ${rateLimitResult.count} messages in the last minute.\n\n*Please wait 30 seconds and try again.*`;
      return res.status(429).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>${waitMessage}</Message></Response>`);
    }

    // Parse user intent
    const parsed = smartParseMessage(message);
    let responseMessage = '';

    console.log(`🧠 Intent detected: ${parsed.intent}`);

    switch (parsed.intent) {
      case 'sandbox':
        // Handle sandbox join
        console.log('✅ SANDBOX JOIN DETECTED');
        userSessions.set(userPhone, { sandboxJoined: true, lastActivity: Date.now() });
        
        responseMessage = `✅ *Perfect! You're all set!*

${generateWelcomeMessage()}`;
        break;

      case 'greeting':
        // Smart greeting based on context
        const session = userSessions.get(userPhone);
        if (session && session.sandboxJoined) {
          responseMessage = generateWelcomeMessage();
        } else {
          responseMessage = generateSetupMessage();
        }
        break;

      case 'booking':
        // Handle ride booking
        const rideRequest = parseRideRequest(message);
        
        if (rideRequest) {
          console.log(`🚗 RIDE REQUEST: ${rideRequest.pickup} → ${rideRequest.dropoff}`);
          
          const { pickup, dropoff } = rideRequest;
          const distance = calculateDistance(pickup, dropoff);
          const pickupName = LAGOS_LOCATIONS[pickup.toLowerCase()].name;
          const dropoffName = LAGOS_LOCATIONS[dropoff.toLowerCase()].name;
          
          // Store ride context for selection
          userSessions.set(userPhone, { 
            pendingRide: { pickup, dropoff, distance, pickupName, dropoffName },
            lastActivity: Date.now()
          });
          
          responseMessage = `🚗 *Choose Your Ride*

📍 *${pickupName}* → *${dropoffName}*
📏 *Distance:* ~${distance}km

`;
          
          let optionNumber = 1;
          Object.entries(RIDE_TYPES).forEach(([key, ride]) => {
            const fare = calculateFare(key, distance);
            responseMessage += `*${optionNumber}. ${ride.name}*
💰 ₦${fare.toLocaleString()} • ${ride.description}

`;
            optionNumber++;
          });
          
          responseMessage += `*Simply reply 1, 2, or 3 to book instantly! 🚀*`;
        } else {
          // Invalid location
          responseMessage = `❌ *Location not recognized*

📍 *Available areas:*
Ikoyi, Victoria Island (VI), Lekki, Ikeja, Surulere, Yaba, Lagos Island, Apapa, Ajah

🔥 *Try these examples:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"
💬 "Surulere to Yaba"

*What's your pickup and destination?*`;
        }
        break;

      case 'selection':
        // Handle ride selection
        const userSession = userSessions.get(userPhone);
        if (!userSession || !userSession.pendingRide) {
          responseMessage = `⚠️ *No pending booking found*\n\n${generateWelcomeMessage()}`;
          break;
        }

        const { pendingRide } = userSession;
        const selectedOption = parseInt(parsed.value);
        const rideTypes = Object.keys(RIDE_TYPES);
        const selectedRideKey = rideTypes[selectedOption - 1];
        const selectedRide = RIDE_TYPES[selectedRideKey];
        
        const fare = calculateFare(selectedRideKey, pendingRide.distance);
        const bookingId = generateBookingId();
        const driver = DEMO_DRIVERS[Math.floor(Math.random() * DEMO_DRIVERS.length)];
        
        // Clear pending ride
        userSessions.delete(userPhone);
        
        console.log(`🎯 RIDE CONFIRMED: ${selectedRide.name} - ₦${fare}`);
        
        responseMessage = `✅ *Ride Confirmed!*

${selectedRide.emoji} *${selectedRide.name}* - ₦${fare.toLocaleString()}
📍 ${pendingRide.pickupName} → ${pendingRide.dropoffName}

👨‍✈️ *Your Driver*
📱 *${driver.name}*
🚗 *${driver.vehicle_make} ${driver.vehicle_model}*
🏷️ *${driver.plate_number}*
⭐ *${driver.rating}/5* (${driver.total_trips} trips)

📍 *Booking ID:* ${bookingId}
⏰ *Arriving in 8 seconds...*

🎭 *Demo experience starting!*`;

        // Enhanced demo sequence with personality
        await sendScheduledMessage(userPhone, 
          `🚗 *${driver.name} has arrived!*

💬 *Driver says:* "${driver.greeting}"
📍 *Location:* ${pendingRide.pickupName}
🚗 *Look for:* ${driver.vehicle_make} ${driver.vehicle_model}
🏷️ *Plate:* ${driver.plate_number}

⏰ *Starting trip in 5 seconds...*`, 
          DEMO_TIMINGS.DRIVER_ARRIVAL);

        await sendScheduledMessage(userPhone,
          `🚀 *Trip Started!*

📱 *Live tracking:* fast-cab.vercel.app/track/${bookingId}
⏱️ *ETA:* 15 seconds (demo mode)
📍 *Heading to:* ${pendingRide.dropoffName}
🛡️ *Safety features active*

🎵 *Enjoy your demo ride!*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START);

        await sendScheduledMessage(userPhone,
          `🎉 *Trip Completed!*

💰 *Total:* ₦${fare.toLocaleString()}
📍 *Arrived at:* ${pendingRide.dropoffName}
⏱️ *Trip time:* 15 seconds
⭐ *Rate ${driver.name}:* Excellent! ⭐⭐⭐⭐⭐

🎭 *Demo complete! Thanks for trying Fast Cab*

🔥 *Book another ride?*
${POPULAR_ROUTES.map(r => `💬 "${r.from} to ${r.to}"`).join('\n')}

*Ready for your next demo ride?*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION);
        break;

      case 'help':
        responseMessage = `🆘 *Fast Cab Demo Help*

🚗 *How to book:*
1️⃣ Say "ride from [pickup] to [destination]"
2️⃣ Choose 1, 2, or 3 for ride type
3️⃣ Watch the demo experience!

📍 *Available areas:*
Ikoyi, VI, Lekki, Ikeja, Surulere, Yaba, Lagos Island, Apapa, Ajah

🔥 *Quick examples:*
💬 "Ikoyi to VI"
💬 "Lekki to Ikeja"
💬 "ride from Surulere to Yaba"

*What would you like to try?*`;
        break;

      case 'cancel':
        userSessions.delete(userPhone);
        responseMessage = `✅ *Cancelled*\n\n${generateWelcomeMessage()}`;
        break;

      default:
        responseMessage = `🤔 *Not quite sure what you mean*

🚗 *To book a ride:*
💬 "ride from Ikoyi to VI"
💬 "Lekki to Ikeja"
💬 "Surulere to Yaba"

🆘 *Need help?* Just say "help"

*What would you like to do?*`;
    }

    const processingTime = Date.now() - startTime;
    console.log(`⚡ Response (${processingTime}ms): Success`);

    // Return optimized TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>
</Response>`;

    return res.status(200).send(twiml);

  } catch (error) {
    console.error(`❌ [ERROR]:`, error);
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>🔧 *Temporary issue* - Please try: "ride from Ikoyi to VI"</Message>
</Response>`;
    
    return res.status(500).send(errorTwiml);
  }
}