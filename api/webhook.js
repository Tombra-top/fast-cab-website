// Fast Cab - Complete Webhook with Twilio Client
// Optimized for Vercel deployment

const twilio = require('twilio');

// Configuration
const SANDBOX_CODE = "cap-pleasure";
const DEMO_TIMINGS = {
  DRIVER_ARRIVAL: 8000,
  TRIP_START: 5000, 
  TRIP_DURATION: 15000,
  AUTO_RESET: 8000
};

// In-memory session storage
const userSessions = new Map();
const rateLimitStore = new Map();

// Rate limiting
const RATE_LIMIT = {
  MAX_REQUESTS: 50,
  WINDOW_MS: 60000
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
    phone: '+2347012345671',
    vehicle_make: 'Toyota',
    vehicle_model: 'Corolla',
    plate_number: 'LAG-123-AB',
    rating: 4.8,
    total_trips: 245
  },
  {
    id: 2,
    name: 'Mary Johnson', 
    phone: '+2347012345672',
    vehicle_make: 'Honda',
    vehicle_model: 'Civic',
    plate_number: 'LAG-456-CD',
    rating: 4.9,
    total_trips: 189
  },
  {
    id: 3,
    name: 'David Wilson',
    phone: '+2347012345673', 
    vehicle_make: 'Toyota',
    vehicle_model: 'Camry',
    plate_number: 'LAG-789-EF',
    rating: 4.7,
    total_trips: 312
  }
];

// Utility functions
function calculateDistance(pickup, dropoff) {
  const pickup_coords = LAGOS_LOCATIONS[pickup.toLowerCase()];
  const dropoff_coords = LAGOS_LOCATIONS[dropoff.toLowerCase()];
  
  if (!pickup_coords || !dropoff_coords) return 10;
  
  const lat1 = pickup_coords.lat;
  const lon1 = pickup_coords.lng;
  const lat2 = dropoff_coords.lat;
  const lon2 = dropoff_coords.lng;
  
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
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
    /ride from ([^to]+) to (.+)/i,
    /book ride from ([^to]+) to (.+)/i,
    /from ([^to]+) to (.+)/i,
    /([^to]+) to (.+)/i
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

function checkRateLimit(phone) {
  const now = Date.now();
  const userRequests = rateLimitStore.get(phone) || [];
  const validRequests = userRequests.filter(time => now - time < RATE_LIMIT.WINDOW_MS);
  
  if (validRequests.length >= RATE_LIMIT.MAX_REQUESTS) {
    return false;
  }
  
  validRequests.push(now);
  rateLimitStore.set(phone, validRequests);
  return true;
}

function getUserSession(userPhone) {
  if (!userSessions.has(userPhone)) {
    userSessions.set(userPhone, {
      conversation_state: 'main_menu',
      sandbox_joined: false,
      booking_data: {}
    });
  }
  return userSessions.get(userPhone);
}

function updateUserSession(userPhone, updates) {
  const session = getUserSession(userPhone);
  Object.assign(session, updates);
  userSessions.set(userPhone, session);
}

// Initialize Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function sendScheduledMessage(to, message, delay) {
  setTimeout(async () => {
    try {
      await client.messages.create({
        body: message,
        from: 'whatsapp:+14155238886',
        to: `whatsapp:${to}`
      });
      console.log(`Scheduled message sent to ${to}`);
    } catch (error) {
      console.error('Error sending scheduled message:', error);
    }
  }, delay);
}

// Main webhook handler
export default async function handler(req, res) {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Content-Type', 'application/xml');

  if (req.method !== 'POST') {
    return res.status(405).end('Method Not Allowed');
  }

  try {
    const { Body: rawBody, From: from } = req.body;
    
    if (!rawBody || !from) {
      return res.status(400).end('Missing required parameters');
    }

    const userPhone = from.replace('whatsapp:', '');
    const message = rawBody.trim();

    console.log(`[WEBHOOK] Received from ${userPhone}: ${message}`);

    // Rate limiting
    if (!checkRateLimit(userPhone)) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>⚠️ Too many requests. Please wait a moment before trying again.</Message>
</Response>`;
      return res.status(200).send(twiml);
    }

    const session = getUserSession(userPhone);
    let responseMessage = '';

    // Handle sandbox join - FIXED
    if (message.toLowerCase().includes('join cap-pleasure') || 
        message.toLowerCase().includes(`join ${SANDBOX_CODE}`) ||
        message.toLowerCase() === 'join cap-pleasure' ||
        message.toLowerCase() === `join ${SANDBOX_CODE}`) {
      
      console.log(`[SANDBOX] User ${userPhone} joined sandbox`);
      
      responseMessage = `✅ *Great! You've joined the Fast Cab sandbox!*

🎉 *Welcome to the demo!* You can now test our ride-hailing bot.

🚖 *Let's start:*
💬 Send: *Hi* to see the main menu
💬 Or try: *"ride from Ikoyi to VI"*

⏱️ *Demo features:* Instant booking • 3 ride types • Full trip simulation

*Ready to experience the future of ride-hailing?*`;
      
      // CRITICAL FIX: Properly update session
      updateUserSession(userPhone, { 
        sandbox_joined: true, 
        conversation_state: 'sandbox_confirmed' 
      });
    }
    
    // Handle greetings - FIXED
    else if (['hi', 'hello', 'start'].includes(message.toLowerCase())) {
      
      console.log(`[GREETING] User ${userPhone}, sandbox_joined: ${session.sandbox_joined}`);
      
      if (!session.sandbox_joined) {
        responseMessage = `🚖 *Welcome to Fast Cab Demo!*

⚠️ *First-time setup needed:*

*Step 1:* Copy this code:
\`\`\`join ${SANDBOX_CODE}\`\`\`

*Step 2:* Send it in this chat

*Step 3:* Wait for confirmation, then say "Hi" again

🎯 *One-time setup* • Works for 72 hours • No app needed

*Please send the join code above to continue...*`;
      } else {
        responseMessage = `🚖 *Welcome to Fast Cab Demo!*

🎭 *This is a live simulation* - Experience our ride-hailing bot!

✨ *Try these commands:*
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Surulere" 
💬 "ride from Ikeja to Yaba"

🚗 *Available everywhere in Lagos*
⚡ *Instant booking • Upfront pricing*
👨‍✈️ *Professional drivers • Real-time updates*

*What would you like to do?*`;
        updateUserSession(userPhone, { conversation_state: 'main_menu' });
      }
    }
    
    // Handle ride requests
    else if (session.sandbox_joined) {
      const rideRequest = parseRideRequest(message);
      
      if (rideRequest) {
        const { pickup, dropoff } = rideRequest;
        
        if (!validateLocation(pickup) || !validateLocation(dropoff)) {
          responseMessage = `❌ *Location not recognized*

📍 *Available Lagos areas:*
• Ikoyi, Victoria Island (VI), Lekki
• Surulere, Ikeja, Yaba, Lagos Island
• Apapa, Ajah

💬 *Try:* "ride from Ikoyi to VI"
Or type *0* for main menu`;
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
Or type *0* for main menu`;
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
⭐ ${driver.rating}/5 • ${driver.total_trips} trips
📱 ${driver.phone}

⏰ *Arriving in 8 seconds* *(demo speed)*

🔔 *You'll be notified when driver arrives!*
🎭 *This is a simulation - sit back and watch!*`;

        // Schedule automated messages
        await sendScheduledMessage(userPhone, 
          `🚗 *Demo Driver Arrived!*
${driver.name} is waiting for you
📍 *Location:* ${pickup}
🚗 *${driver.vehicle_make} ${driver.vehicle_model}* (${driver.plate_number})
📱 ${driver.phone}

⏰ *Please come out in 2 minutes*
🎭 *Demo: Starting trip automatically...*`, 
          DEMO_TIMINGS.DRIVER_ARRIVAL);

        await sendScheduledMessage(userPhone,
          `🚀 *Demo Trip Started!*
📍 *Live tracking:* fast-cab-demo.vercel.app/track/${bookingId}
⏱️ *ETA:* 15 seconds *(demo speed)*

🛡️ *Safety features active*
🎭 *Demo trip in progress...*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START);

        await sendScheduledMessage(userPhone,
          `🎉 *Demo Trip Completed!*
💰 *Fare:* ₦${fare.toLocaleString()}
⏱️ *Trip time:* 15 seconds
📍 *Arrived at:* ${dropoff}

⭐ *Rate your driver:* ${driver.name}
Thank you for using Fast Cab Demo!

🔄 *Try another ride?* 
💬 Type "ride from [pickup] to [destination]"
💬 Or say "Hi" for main menu`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION);

        await sendScheduledMessage(userPhone,
          `🚖 *Ready for Another Demo Ride?*

✨ *Try different routes:*
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Ajah"
💬 "ride from Yaba to Apapa"

🎯 *What did you think?*
Share your feedback on this demo!

💬 *Type your next ride request...*`,
          DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION + DEMO_TIMINGS.AUTO_RESET);

        // Reset user session after demo
        setTimeout(() => {
          updateUserSession(userPhone, { conversation_state: 'main_menu' });
        }, DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION + DEMO_TIMINGS.AUTO_RESET);
      }
      
      // Handle other commands
      else if (['0', 'menu', 'main menu'].includes(message.toLowerCase())) {
        responseMessage = `🚖 *Fast Cab Demo - Main Menu*

💬 *Try these commands:*
"ride from [pickup] to [destination]"

📍 *Popular routes:*
• "ride from Ikoyi to VI"
• "ride from Lekki to Surulere"
• "ride from Ikeja to Yaba"

⚡ *Features:* Instant booking • 3 ride types • Upfront pricing`;
        updateUserSession(userPhone, { conversation_state: 'main_menu' });
      }
      
      else {
        responseMessage = `❓ *Not sure what you mean*

💬 *Try:*
"ride from [pickup] to [destination]"

📍 *Examples:*
"ride from Ikoyi to VI"
"ride from Lekki to Surulere"

Or type *0* for main menu`;
      }
    } else {
      responseMessage = `🔒 *Sandbox Setup Required*

To use Fast Cab demo, please:

*Step 1:* Copy and send this:
\`\`\`join ${SANDBOX_CODE}\`\`\`

*Step 2:* Wait for confirmation

*Step 3:* Say "Hi" to start demo

🎯 *Quick one-time setup!*`;
    }