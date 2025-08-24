// Fast Cab - Optimized Flow: New vs Returning Users
// Clean separation of first-time setup vs returning user experience

const twilio = require('twilio');

// Configuration
const SANDBOX_CODE = "cap-pleasure";
const DEMO_TIMINGS = {
  DRIVER_ARRIVAL: 8000,
  TRIP_START: 5000,
  TRIP_DURATION: 15000
};

// In-memory session tracking (survives across serverless calls using global)
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

// Popular routes for suggestions
const POPULAR_ROUTES = [
  'ride from Ikoyi to VI',
  'ride from Lekki to Ikeja', 
  'ride from Surulere to Yaba',
  'ride from VI to Lekki'
];

// Ride types
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

// CORE FUNCTIONS

// Detect sandbox join messages
function isSandboxJoinMessage(message) {
  const msg = message.toLowerCase().replace(/\s/g, '');
  const patterns = [
    'joincap-pleasure',
    'joincappleasure',
    'cap-pleasure',
    'cappleasure'
  ];
  return patterns.some(pattern => msg.includes(pattern));
}

// Parse ride requests with smart location matching
function parseRideRequest(message) {
  const msg = message.toLowerCase().trim();
  
  const patterns = [
    /(?:ride|book|trip|go)?\s*from\s+([^to]+?)\s+to\s+(.+)/i,
    /([a-zA-Z\s]+)\s+to\s+([a-zA-Z\s]+)/i
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

// Smart location finder with fuzzy matching
function findLocation(input) {
  const term = input.toLowerCase().trim();
  
  // Direct match
  if (LAGOS_LOCATIONS[term]) return term;
  
  // Abbreviations
  const abbrev = {
    'vi': 'victoria island',
    'v.i': 'victoria island',
    'v.i.': 'victoria island'
  };
  if (abbrev[term]) return abbrev[term];
  
  // Partial match
  const matches = Object.keys(LAGOS_LOCATIONS).filter(loc => 
    loc.includes(term) || term.includes(loc)
  );
  
  return matches.length === 1 ? matches[0] : null;
}

// Calculate distance
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

function calculateFare(rideType, distance) {
  const rate = RIDE_TYPES[rideType];
  return rate.base_fare + (rate.per_km * distance);
}

// Rate limiting
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

// Initialize Twilio
let twilioClient;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
} catch (error) {
  console.error('[TWILIO INIT]:', error);
}

// Send scheduled messages
async function sendScheduledMessage(to, message, delay) {
  if (!twilioClient) return;
  
  setTimeout(async () => {
    try {
      await twilioClient.messages.create({
        body: message,
        from: 'whatsapp:+14155238886',
        to: `whatsapp:${to}`
      });
    } catch (error) {
      console.error('[SCHEDULED ERROR]:', error);
    }
  }, delay);
}

// Check if user is connected to sandbox via Twilio API
async function checkSandboxStatus(userPhone) {
  if (!twilioClient) return true; // Dev mode - allow all
  
  try {
    const messages = await twilioClient.messages.list({
      to: `whatsapp:${userPhone}`,
      limit: 10
    });
    
    // Look for Twilio confirmation messages
    const hasConfirmation = messages.some(msg => 
      msg.body && (
        msg.body.includes('sandbox can now send') ||
        msg.body.includes('You are all set') ||
        msg.body.includes('joined the sandbox')
      )
    );
    
    return hasConfirmation;
  } catch (error) {
    console.error('[SANDBOX CHECK]:', error);
    return false;
  }
}

// Generate booking ID
function generateBookingId() {
  return 'FC' + Date.now().toString(36).substr(-6).toUpperCase();
}

// MAIN WEBHOOK HANDLER
export default async function handler(req, res) {
  // Security headers
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Method not allowed</Message></Response>');
  }

  try {
    const { Body: rawBody, From: from } = req.body;
    
    if (!rawBody || !from) {
      return res.status(400).send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Invalid request</Message></Response>');
    }

    const userPhone = from.replace('whatsapp:', '');
    const message = rawBody.trim();

    console.log(`\n📱 [${userPhone.slice(-4)}]: "${message}"`);

    // Rate limiting
    if (!checkRateLimit(userPhone)) {
      return res.status(429).send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>⏳ Too many requests. Please wait a moment.</Message></Response>');
    }

    let responseMessage = '';

    // PRIORITY 1: Handle sandbox join (new user connecting)
    if (isSandboxJoinMessage(message)) {
      console.log('✅ SANDBOX JOIN - New user connecting');
      
      // Mark user as connected
      global.userSessions.set(userPhone, { 
        connected: true, 
        joinedAt: Date.now() 
      });
      
      responseMessage = `✅ *You're all set! Welcome to Fast Cab*

🚖 *Book your first ride in 3 easy steps:*

*Step 1:* Pick a route below (just copy & send)
*Step 2:* Choose Economy, Comfort, or Premium  
*Step 3:* Watch your live ride demo!

🔥 *Popular routes:*
💬 ride from Ikoyi to VI
💬 ride from Lekki to Ikeja
💬 ride from VI to Lekki

*Just copy any route above and send it!* ⬆️`;
    }

    // PRIORITY 2: Handle greetings and website demo clicks
    else if (
      ['hi', 'hello', 'start', 'hey', 'menu'].includes(message.toLowerCase().trim()) ||
      message.toLowerCase().includes('hi! i want to try the fast cab demo')
    ) {
      const session = global.userSessions.get(userPhone);
      const isConnected = session?.connected || await checkSandboxStatus(userPhone);
      
      if (isConnected) {
        console.log('👋 RETURNING USER - Direct to welcome menu');
        
        // Update session if not already marked
        if (!session?.connected) {
          global.userSessions.set(userPhone, { 
            connected: true, 
            joinedAt: Date.now() 
          });
        }
        
        responseMessage = `🚖 *Welcome to Fast Cab!*

*Book a ride in 30 seconds:*

*Step 1:* Copy any route below  
*Step 2:* Choose your ride type (1, 2, or 3)
*Step 3:* Experience the full demo!

💬 ride from Ikoyi to VI
💬 ride from Lekki to Ikeja  
💬 ride from VI to Lekki

*Copy & send any route above* ⬆️`;
      } else {
        console.log('🆕 NEW USER - From website, show setup');
        
        responseMessage = `🚖 *Welcome to Fast Cab Demo!*

👋 *Thanks for clicking "Try Live Demo"!*

⚠️ *Quick one-time setup needed:*

**Step 1:** Copy this exact code:
\`join cap-pleasure\`

**Step 2:** Send it in this chat

**Step 3:** Start booking rides immediately!

🎯 *Takes 10 seconds • Works for 3 days*
⚡ *No app download required*

*Copy & send the join code above to continue...*`;
      }
    }

    // PRIORITY 3: Handle ride booking requests
    else {
      const rideRequest = parseRideRequest(message);
      
      if (rideRequest) {
        console.log(`🚗 RIDE REQUEST: ${rideRequest.pickup} → ${rideRequest.dropoff}`);
        
        const { pickup, dropoff } = rideRequest;
        const distance = calculateDistance(pickup, dropoff);
        const pickupName = LAGOS_LOCATIONS[pickup].name;
        const dropoffName = LAGOS_LOCATIONS[dropoff].name;
        
        // Store ride details for selection
        global.userSessions.set(userPhone, {
          connected: true,
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
        
        responseMessage += `*Reply 1, 2, or 3 to book instantly! 🚀*`;
      }
      
      // PRIORITY 4: Handle ride selection (1, 2, 3)
      else if (['1', '2', '3'].includes(message.trim())) {
        const session = global.userSessions.get(userPhone);
        
        if (!session?.pendingRide) {
          responseMessage = `⚠️ *No pending booking*

🚖 *Start a new booking:*
${POPULAR_ROUTES.map(route => `💬 "${route}"`).join('\n')}

*What's your pickup and destination?*`;
        } else {
          console.log(`🎯 RIDE SELECTION: Option ${message}`);
          
          const { pendingRide } = session;
          const selectedOption = parseInt(message);
          const rideTypes = Object.keys(RIDE_TYPES);
          const selectedRideKey = rideTypes[selectedOption - 1];
          const selectedRide = RIDE_TYPES[selectedRideKey];
          
          const fare = calculateFare(selectedRideKey, pendingRide.distance);
          const bookingId = generateBookingId();
          const driver = DEMO_DRIVERS[Math.floor(Math.random() * DEMO_DRIVERS.length)];
          
          // Clear pending ride
          global.userSessions.set(userPhone, { connected: true });
          
          responseMessage = `✅ *Ride Confirmed!*

${selectedRide.name} - ₦${fare.toLocaleString()}
📍 ${pendingRide.pickupName} → ${pendingRide.dropoffName}

👨‍✈️ *Your Driver*
📱 *${driver.name}*
🚗 *${driver.vehicle}*
🏷️ *${driver.plate}*
⭐ *${driver.rating}/5* (${driver.trips} trips)

📍 *Booking:* ${bookingId}
⏰ *Arriving in 8 seconds...*

🎭 *Demo starting now!*`;

          // Automated demo sequence
          await sendScheduledMessage(userPhone, 
            `🚗 *Driver Arrived!*

${driver.name} is waiting outside
📍 *Pickup:* ${pendingRide.pickupName}
🚗 *Vehicle:* ${driver.vehicle} (${driver.plate})

⏰ *Trip starting in 5 seconds...*`, 
            DEMO_TIMINGS.DRIVER_ARRIVAL);

          await sendScheduledMessage(userPhone,
            `🚀 *Trip Started!*

📱 *Live tracking:* fast-cab.vercel.app/track/${bookingId}
⏱️ *ETA:* 15 seconds (demo mode)
📍 *Destination:* ${pendingRide.dropoffName}

🛡️ *Enjoy your safe ride!*`,
            DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START);

          await sendScheduledMessage(userPhone,
            `🎉 *Trip Completed!*

💰 *Total:* ₦${fare.toLocaleString()}
📍 *Arrived:* ${pendingRide.dropoffName}
⏱️ *Duration:* 15 seconds
⭐ *Rate ${driver.name}:* ⭐⭐⭐⭐⭐

🎭 *Demo complete!*

🔥 *Book another ride?*
${POPULAR_ROUTES.map(route => `💬 "${route}"`).join('\n')}

*Ready for your next ride?*`,
            DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION);
        }
      }
      
      // PRIORITY 5: Default/unrecognized messages
      else {
        console.log(`❓ UNRECOGNIZED: "${message}"`);
        
        responseMessage = `❓ *Not quite sure what you mean*

🚗 *To book a ride, try:*
${POPULAR_ROUTES.slice(0, 3).map(route => `💬 "${route}"`).join('\n')}

📍 *Available locations:*
Ikoyi, VI, Lekki, Ikeja, Surulere, Yaba, Lagos Island, Apapa, Ajah

💡 *Tip:* Say "ride from [pickup] to [destination]"

*Where would you like to go?*`;
      }
    }

    console.log(`✅ Response ready: ${responseMessage.substring(0, 50)}...`);

    // Return TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>
</Response>`;

    return res.status(200).send(twiml);

  } catch (error) {
    console.error('❌ [ERROR]:', error);
    
    return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>🔧 Temporary issue. Try: "ride from Ikoyi to VI"</Message></Response>');
  }
}