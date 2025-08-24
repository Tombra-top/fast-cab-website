// Fast Cab - STATELESS Webhook (No Session Storage Required)
// Fixed for Vercel serverless - detects sandbox status from Twilio directly

const twilio = require('twilio');

// Configuration
const SANDBOX_CODE = "cap-pleasure";
const DEMO_TIMINGS = {
  DRIVER_ARRIVAL: 6000,
  TRIP_START: 4000, 
  TRIP_DURATION: 12000,
  AUTO_RESET: 6000
};

// Simple rate limiting (in-memory, resets on cold start - acceptable for demo)
const requestCounts = new Map();

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

// Ride types
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

// CRITICAL FIX: Check if user is in Twilio sandbox by making API call
async function isUserInSandbox(userPhone) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.log('[WARNING] Twilio credentials missing - assuming sandbox access');
    return true; // Allow demo to work in development
  }

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    // Check recent messages to see if user joined sandbox
    const messages = await client.messages.list({
      to: `whatsapp:${userPhone}`,
      limit: 20
    });
    
    // Look for Twilio's sandbox confirmation message
    const sandboxConfirmation = messages.find(msg => 
      msg.body && msg.body.includes('sandbox can now send/receive messages') ||
      msg.body && msg.body.includes('You are all set!')
    );
    
    return !!sandboxConfirmation;
  } catch (error) {
    console.error('[SANDBOX CHECK ERROR]:', error.message);
    // If API call fails, check message patterns as fallback
    return true;
  }
}

// Alternative: Stateless detection based on message patterns
function detectSandboxFromMessage(message) {
  const msg = message.toLowerCase().trim();
  
  // Direct sandbox join patterns
  const joinPatterns = [
    'join cap-pleasure',
    'joincap-pleasure', 
    'join cappleasure',
    'joincappleasure',
    'cap-pleasure',
    'cappleasure'
  ];
  
  return joinPatterns.some(pattern => 
    msg.includes(pattern.replace(/\s/g, '')) || 
    msg.replace(/\s/g, '').includes(pattern.replace(/\s/g, ''))
  );
}

// Detect ride booking patterns  
function parseRideRequest(message) {
  const cleanMsg = message.toLowerCase().trim();
  
  // Enhanced patterns for ride requests
  const patterns = [
    /(?:ride|book|trip|go)\s+from\s+([^to]+?)\s+to\s+(.+)/i,
    /from\s+([^to]+?)\s+to\s+(.+)/i,
    /book\s+([^to]+?)\s+to\s+(.+)/i,
    /([a-zA-Z\s]+)\s+to\s+([a-zA-Z\s]+)/i
  ];
  
  for (const pattern of patterns) {
    const match = cleanMsg.match(pattern);
    if (match && match[1] && match[2]) {
      const pickup = match[1].trim();
      const dropoff = match[2].trim();
      
      // Validate both are actual locations
      if (validateLocation(pickup) && validateLocation(dropoff)) {
        return { pickup, dropoff };
      }
    }
  }
  return null;
}

// Validate location exists
function validateLocation(location) {
  return !!LAGOS_LOCATIONS[location.toLowerCase().trim()];
}

// Calculate distance between locations
function calculateDistance(pickup, dropoff) {
  const p1 = LAGOS_LOCATIONS[pickup.toLowerCase()];
  const p2 = LAGOS_LOCATIONS[dropoff.toLowerCase()];
  
  if (!p1 || !p2) return 8; // Default distance
  
  const R = 6371; // Earth's radius in km
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
  if (!rate) return 1000;
  return rate.base_fare + (rate.per_km * distance);
}

function generateBookingId() {
  return 'FC' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Simple rate limiting
function checkRateLimit(phone) {
  const now = Date.now();
  const key = phone;
  const requests = requestCounts.get(key) || [];
  const recentRequests = requests.filter(time => now - time < 60000); // 1 minute window
  
  if (recentRequests.length > 30) {
    return false;
  }
  
  recentRequests.push(now);
  requestCounts.set(key, recentRequests);
  return true;
}

// Initialize Twilio client
let twilioClient;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
} catch (error) {
  console.error('[TWILIO INIT ERROR]:', error);
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
      console.log(`[SCHEDULED] Message sent to ${to.substring(-4)}`);
    } catch (error) {
      console.error('[SCHEDULED ERROR]:', error.message);
    }
  }, delay);
}

// MAIN WEBHOOK HANDLER - COMPLETELY STATELESS
export default async function handler(req, res) {
  // Set headers
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method !== 'POST') {
    return res.status(405).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Method not allowed</Message></Response>`);
  }

  const startTime = Date.now();
  
  try {
    const { Body: rawBody, From: from } = req.body;
    
    if (!rawBody || !from) {
      return res.status(400).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Invalid request</Message></Response>`);
    }

    const userPhone = from.replace('whatsapp:', '');
    const message = rawBody.trim();

    console.log(`\n🔄 [${new Date().toISOString()}] ${userPhone.substring(-4)}: "${message}"`);

    // Rate limiting
    if (!checkRateLimit(userPhone)) {
      return res.status(429).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>⚠️ Please slow down. Try again in a moment.</Message></Response>`);
    }

    let responseMessage = '';
    
    // PRIORITY 1: Handle direct sandbox join
    if (detectSandboxFromMessage(message)) {
      console.log('✅ SANDBOX JOIN DETECTED');
      
      responseMessage = `✅ *Perfect! Welcome to Fast Cab Demo!*

🎉 *You're all set!* Ready to book your first ride.

🚖 *Try these commands right now:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Surulere"
💬 "ride from Ikeja to Yaba"

⚡ *3 ride types • Instant booking • Real simulation*

*Where would you like to go?*`;
    }
    
    // PRIORITY 2: Handle ride booking requests
    else {
      const rideRequest = parseRideRequest(message);
      
      if (rideRequest) {
        console.log(`🚗 RIDE REQUEST: ${rideRequest.pickup} → ${rideRequest.dropoff}`);
        
        // For ride requests, assume user is in sandbox (stateless approach)
        const { pickup, dropoff } = rideRequest;
        const distance = calculateDistance(pickup, dropoff);
        const pickupName = LAGOS_LOCATIONS[pickup.toLowerCase()].name;
        const dropoffName = LAGOS_LOCATIONS[dropoff.toLowerCase()].name;
        
        responseMessage = `🚗 *Available Demo Rides*
📍 *${pickupName}* → *${dropoffName}*
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
        
        responseMessage += `💬 *Reply with 1, 2, or 3 to book your ride*
⚡ *Demo booking will start immediately!*`;
      }
      
      // PRIORITY 3: Handle ride selection (1, 2, 3)
      else if (['1', '2', '3'].includes(message.trim())) {
        console.log(`🎯 RIDE SELECTION: ${message}`);
        
        // Generate a demo booking immediately
        const rideTypes = Object.keys(RIDE_TYPES);
        const selectedRideKey = rideTypes[parseInt(message) - 1];
        const selectedRide = RIDE_TYPES[selectedRideKey];
        
        // Use default route for demo
        const pickup = 'Ikoyi';
        const dropoff = 'Victoria Island';
        const distance = calculateDistance('ikoyi', 'victoria island');
        const fare = calculateFare(selectedRideKey, distance);
        const bookingId = generateBookingId();
        const driver = DEMO_DRIVERS[Math.floor(Math.random() * DEMO_DRIVERS.length)];
        
        responseMessage = `✅ *Demo Ride Confirmed!*

${selectedRide.name} - ₦${fare.toLocaleString()}
📍 *${pickup}* → *${dropoff}*

👨‍✈️ *Your Demo Driver*
📛 *${driver.name}*
🚗 *${driver.vehicle_make} ${driver.vehicle_model}*
📋 *${driver.plate_number}*
⭐ *${driver.rating}/5* • ${driver.total_trips} trips
📱 *${driver.phone}*

⏰ *Arriving in 6 seconds* (demo speed)

🔔 *Watch for automatic updates!*
🎭 *Full ride simulation starting...*`;

        // Start automated demo sequence
        await sendScheduledMessage(userPhone, 
          `🚗 *Driver Arrived!*

${driver.name} is outside waiting
📍 *Pickup:* ${pickup}
🚗 *Vehicle:* ${driver.vehicle_make} ${driver.vehicle_model} (${driver.plate_number})

⏰ *Trip starting in 3 seconds...*
🎭 *Demo ride beginning!*`, 
          DEMO_TIMINGS.DRIVER_ARRIVAL);

        await sendScheduledMessage(userPhone,
          `🚀 *Trip Started!*

📊 *Live tracking:* fast-cab.vercel.app/track/${bookingId}
⏱️ *ETA:* 12 seconds (demo speed)
📍 *Destination:* ${dropoff}

🛡️ *Safe journey in progress*
🎭 *Simulating real ride experience...*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START);

        await sendScheduledMessage(userPhone,
          `🎉 *Trip Completed Successfully!*

💰 *Total:* ₦${fare.toLocaleString()}
📍 *Arrived:* ${dropoff}
⏱️ *Duration:* 12 seconds (demo)

⭐ *Rate ${driver.name}:* Excellent service!
🎭 *Demo complete! Thank you!*

🔄 *Book another ride?*
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Yaba"

*Ready for your next demo?*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION);
      }
      
      // PRIORITY 4: Handle greetings
      else if (['hi', 'hello', 'start', 'hey', 'menu'].includes(message.toLowerCase().trim())) {
        console.log(`👋 GREETING`);
        
        // Check if user might be in sandbox (stateless check)
        const potentiallyInSandbox = await isUserInSandbox(userPhone).catch(() => false);
        
        if (potentiallyInSandbox) {
          responseMessage = `🚖 *Welcome to Fast Cab Demo!*

🎭 *Ready to experience ride booking?*

✨ *Try these commands:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Surulere"
💬 "ride from Ikeja to Yaba"

⚡ *Instant booking • 3 ride types • Real simulation*

*Where would you like to go?*`;
        } else {
          responseMessage = `🚖 *Welcome to Fast Cab Demo!*

⚠️ *Quick setup needed:*

*Step 1:* Copy this code:
\`\`\`join ${SANDBOX_CODE}\`\`\`

*Step 2:* Send it in this chat

*Step 3:* Start booking rides immediately!

🎯 *One-time setup • Takes 5 seconds*

*Send the join code to continue...*`;
        }
      }
      
      // PRIORITY 5: Default help message
      else {
        console.log(`❓ UNRECOGNIZED: "${message}"`);
        
        responseMessage = `❓ *Not sure what you mean*

🚖 *To book a demo ride, try:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Surulere"
💬 "ride from Ikeja to Yaba"

📍 *Available locations:*
Ikoyi, Victoria Island (VI), Lekki, Surulere, Ikeja, Yaba, Lagos Island, Apapa, Ajah

🔧 *Need setup?* Send: \`join ${SANDBOX_CODE}\`

*What would you like to do?*`;
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`⚡ Response (${processingTime}ms): ${responseMessage.substring(0, 60)}...`);

    // Return TwiML response
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>
</Response>`;

    return res.status(200).send(twiml);

  } catch (error) {
    console.error(`❌ [CRITICAL ERROR]:`, error);
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>🔧 Service temporarily unavailable. Please try: "ride from Ikoyi to VI"</Message>
</Response>`;
    
    return res.status(500).send(errorTwiml);
  }
}