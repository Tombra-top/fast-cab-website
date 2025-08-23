const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

// Your actual Twilio sandbox code (get from console.twilio.com)
const SANDBOX_CODE = "cap-pleasure"; // Replace with your actual code

// Demo-optimized timings
const DEMO_TIMINGS = {
  DRIVER_ARRIVAL: 8000,
  TRIP_START: 5000,
  TRIP_DURATION: 15000,
  AUTO_RESET: 8000
};

// Rate limiting for demo
const RATE_LIMIT = {
  MAX_REQUESTS: 50,
  WINDOW_MS: 60000
};

const rateLimitStore = new Map();
let db = new sqlite3.Database(':memory:');

// Initialize database (same as before)
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    phone TEXT PRIMARY KEY,
    conversation_state TEXT DEFAULT 'main_menu',
    pickup_location TEXT,
    dropoff_location TEXT,
    selected_ride_type TEXT,
    booking_id TEXT,
    driver_id INTEGER,
    sandbox_joined INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    user_phone TEXT,
    pickup_location TEXT,
    dropoff_location TEXT,
    ride_type TEXT,
    fare INTEGER,
    driver_id INTEGER,
    status TEXT DEFAULT 'confirmed',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY,
    name TEXT,
    phone TEXT,
    vehicle_make TEXT,
    vehicle_model TEXT,
    plate_number TEXT,
    rating REAL,
    total_trips INTEGER,
    current_location TEXT,
    is_available INTEGER DEFAULT 1
  )`);

  // Insert demo drivers
  const drivers = [
    [1, 'John Doe', '+2347012345671', 'Toyota', 'Corolla', 'LAG-123-AB', 4.8, 245, 'Ikoyi', 1],
    [2, 'Mary Johnson', '+2347012345672', 'Honda', 'Civic', 'LAG-456-CD', 4.9, 189, 'Victoria Island', 1],
    [3, 'David Wilson', '+2347012345673', 'Toyota', 'Camry', 'LAG-789-EF', 4.7, 312, 'Lekki', 1],
    [4, 'Sarah Ahmed', '+2347012345674', 'Honda', 'Accord', 'LAG-321-GH', 4.9, 278, 'Surulere', 1],
    [5, 'Mike Okafor', '+2347012345675', 'Mercedes', 'C-Class', 'LAG-654-IJ', 4.8, 156, 'Ikeja', 1],
    [6, 'Grace Adebayo', '+2347012345676', 'BMW', '3 Series', 'LAG-987-KL', 4.9, 203, 'Lagos Island', 1]
  ];

  const stmt = db.prepare(`INSERT OR REPLACE INTO drivers 
    (id, name, phone, vehicle_make, vehicle_model, plate_number, rating, total_trips, current_location, is_available) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  
  drivers.forEach(driver => {
    stmt.run(driver);
  });
  stmt.finalize();
});

// Ride types and location data (same as before)
const RIDE_TYPES = {
  'economy': {
    name: '🚗 Economy',
    description: 'Affordable rides for everyday trips',
    base_fare: 600,
    per_km: 120,
    pickup_time_min: 3,
    pickup_time_max: 7
  },
  'comfort': {
    name: '🚙 Comfort', 
    description: 'More space and newer vehicles',
    base_fare: 900,
    per_km: 180,
    pickup_time_min: 5,
    pickup_time_max: 12
  },
  'premium': {
    name: '🚕 Premium',
    description: 'Luxury vehicles with top-rated drivers', 
    base_fare: 1500,
    per_km: 250,
    pickup_time_min: 8,
    pickup_time_max: 15
  }
};

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

// Utility functions (same as before)
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
  return 'FC' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

function sanitizeInput(input) {
  return input.trim().replace(/[<>\"'&]/g, '');
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

function scheduleAutomatedMessage(phone, message, delay, newState = null) {
  setTimeout(() => {
    console.log(`[SCHEDULED] Sending to ${phone}: ${message}`);
    if (newState) {
      updateUserState(phone, newState);
    }
  }, delay);
}

function updateUserState(phone, state, additionalData = {}) {
  const updates = { conversation_state: state, updated_at: new Date().toISOString(), ...additionalData };
  const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
  const values = Object.values(updates);
  
  db.run(`UPDATE users SET ${setClause} WHERE phone = ?`, [...values, phone]);
}

// New function to detect if user needs to join sandbox
function needsSandboxJoin(message) {
  const joinPatterns = [
    /join\s+[\w-]+/i,
    new RegExp(`join\\s+${SANDBOX_CODE}`, 'i')
  ];
  
  return joinPatterns.some(pattern => pattern.test(message));
}

// New function to detect Twilio sandbox error messages
function isTwilioSandboxError(message) {
  const errorPatterns = [
    /not connected to a sandbox/i,
    /need to connect it first/i,
    /sending.*join.*sandbox/i
  ];
  
  return errorPatterns.some(pattern => pattern.test(message));
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
    const { Body: rawBody, From: from, To: to } = req.body;
    
    if (!rawBody || !from) {
      return res.status(400).end('Missing required parameters');
    }

    const userPhone = from.replace('whatsapp:', '');
    const message = sanitizeInput(rawBody);

    console.log(`[WEBHOOK] Received from ${userPhone}: ${message}`);

    // Rate limiting
    if (!checkRateLimit(userPhone)) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>⚠️ Too many requests. Please wait a moment before trying again.</Message>
</Response>`;
      return res.status(200).send(twiml);
    }

    // Get or create user
    db.get('SELECT * FROM users WHERE phone = ?', [userPhone], (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      if (!user) {
        db.run('INSERT INTO users (phone) VALUES (?)', [userPhone], function(err) {
          if (err) console.error('Error creating user:', err);
        });
        user = { phone: userPhone, conversation_state: 'main_menu', sandbox_joined: 0 };
      }

      let responseMessage = '';
      let newState = user.conversation_state;

      // Handle sandbox join process
      if (needsSandboxJoin(message)) {
        responseMessage = `✅ *Great! You've joined the Fast Cab sandbox!*

🎉 *Welcome to the demo!* You can now test our ride-hailing bot.

🚖 *Let's start:*
💬 Send: *Hi* to see the main menu
💬 Or try: *"ride from Ikoyi to VI"*

⏱️ *Demo features:* Instant booking • 3 ride types • Full trip simulation

*Ready to experience the future of ride-hailing?*`;
        
        // Mark user as sandbox joined
        updateUserState(userPhone, 'main_menu', { sandbox_joined: 1 });
        newState = 'main_menu';
      }
      
      // Handle main menu and greetings
      else if (message.toLowerCase() === 'hi' || message.toLowerCase() === 'hello' || message.toLowerCase() === 'start') {
        
        // Check if user has joined sandbox
        if (user.sandbox_joined === 0) {
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
        }
        newState = 'main_menu';
      }
      
      // Handle ride booking requests
      else {
        // Check sandbox status first
        if (user.sandbox_joined === 0) {
          responseMessage = `🔒 *Sandbox Setup Required*

To use Fast Cab demo, please:

*Step 1:* Copy and send this:
\`\`\`join ${SANDBOX_CODE}\`\`\`

*Step 2:* Wait for confirmation

*Step 3:* Say "Hi" to start demo

🎯 *Quick one-time setup!*`;
        } else {
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
              // Process booking (same logic as before)
              const distance = calculateDistance(pickup, dropoff);
              const pickupName = LAGOS_LOCATIONS[pickup.toLowerCase()].name;
              const dropoffName = LAGOS_LOCATIONS[dropoff.toLowerCase()].name;
              const estimatedTime = Math.max(10, distance * 2.5);
              
              updateUserState(userPhone, 'selecting_ride', {
                pickup_location: pickupName,
                dropoff_location: dropoffName
              });
              
              responseMessage = `🚗 *Available Demo Rides*
📍 *From:* ${pickupName}
📍 *To:* ${dropoffName}
📏 *Distance:* ~${distance}km

`;
              
              let optionNumber = 1;
              Object.entries(RIDE_TYPES).forEach(([key, ride]) => {
                const fare = calculateFare(key, distance);
                const pickupTime = Math.floor(Math.random() * (ride.pickup_time_max - ride.pickup_time_min + 1)) + ride.pickup_time_min;
                const tripTime = Math.round(estimatedTime);
                
                responseMessage += `*${optionNumber}. ${ride.name}*
💰 ₦${fare.toLocaleString()}
⏱️ ${pickupTime}s pickup • ${tripTime}s trip *(demo speed)*
📝 ${ride.description}

`;
                optionNumber++;
              });
              
              responseMessage += `💬 *Reply 1, 2, or 3 to select your ride*
Or type *0* for main menu`;
              newState = 'selecting_ride';
            }
          }
          
          // Handle ride selection
          else if (user.conversation_state === 'selecting_ride' && ['1', '2', '3'].includes(message)) {
            const rideTypes = Object.keys(RIDE_TYPES);
            const selectedRideKey = rideTypes[parseInt(message) - 1];
            const selectedRide = RIDE_TYPES[selectedRideKey];
            
            const distance = calculateDistance(user.pickup_location, user.dropoff_location);
            const fare = calculateFare(selectedRideKey, distance);
            const bookingId = generateBookingId();
            
            db.get('SELECT * FROM drivers WHERE is_available = 1 ORDER BY RANDOM() LIMIT 1', (err, driver) => {
              if (err || !driver) {
                console.error('Error selecting driver:', err);
                return;
              }
              
              db.run(`INSERT INTO bookings (id, user_phone, pickup_location, dropoff_location, ride_type, fare, driver_id) 
                      VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [bookingId, userPhone, user.pickup_location, user.dropoff_location, selectedRideKey, fare, driver.id]);
              
              updateUserState(userPhone, 'ride_confirmed', {
                booking_id: bookingId,
                driver_id: driver.id,
                selected_ride_type: selectedRideKey
              });
              
              const pickupTime = Math.floor(Math.random() * (selectedRide.pickup_time_max - selectedRide.pickup_time_min + 1)) + selectedRide.pickup_time_min;
              
              responseMessage = `✅ *Demo Ride Confirmed!*
${selectedRide.name} - ₦${fare.toLocaleString()}
📍 *From:* ${user.pickup_location}
📍 *To:* ${user.dropoff_location}

👨‍✈️ *Your Demo Driver*
📛 *${driver.name}*
🚗 *${driver.vehicle_make} ${driver.vehicle_model}* (${driver.plate_number})
⭐ ${driver.rating}/5 • ${driver.total_trips} trips
📱 ${driver.phone}

⏰ *Arriving in ${pickupTime} seconds* *(demo speed)*

🔔 *You'll be notified when driver arrives!*
🎭 *This is a simulation - sit back and watch!*`;

              // Schedule all automated messages
              scheduleAutomatedMessage(userPhone, 
                `🚗 *Demo Driver Arrived!*
${driver.name} is waiting for you
📍 *Location:* ${user.pickup_location}
🚗 *${driver.vehicle_make} ${driver.vehicle_model}* (${driver.plate_number})
📱 ${driver.phone}

⏰ *Please come out in 2 minutes*
🎭 *Demo: Starting trip automatically...*`, 
                DEMO_TIMINGS.DRIVER_ARRIVAL, 'driver_arrived');

              scheduleAutomatedMessage(userPhone,
                `🚀 *Demo Trip Started!*
📍 *Live tracking:* https://fast-cab-website.vercel.app/track/${bookingId}
⏱️ *ETA:* 15 seconds *(demo speed)*

🛡️ *Safety features active*
🎭 *Demo trip in progress...*`,
                DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START, 'trip_started');

              scheduleAutomatedMessage(userPhone,
                `🎉 *Demo Trip Completed!*
💰 *Fare:* ₦${fare.toLocaleString()}
⏱️ *Trip time:* 15 seconds
📍 *Arrived at:* ${user.dropoff_location}

⭐ *Rate your driver:* ${driver.name}
Thank you for using Fast Cab Demo!

🔄 *Try another ride?* 
💬 Type "ride from [pickup] to [destination]"
💬 Or type "book" for quick booking`,
                DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION, 'trip_completed');

              scheduleAutomatedMessage(userPhone,
                `🚖 *Ready for Another Demo Ride?*

✨ *Try different routes:*
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Ajah"
💬 "ride from Yaba to Apapa"

🎯 *What did you think?*
Share your feedback on this demo!

💬 *Type your next ride request...*`,
                DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION + DEMO_TIMINGS.AUTO_RESET, 'main_menu');
            });
          }
          
          // Handle other commands
          else if (message === '0' || message.toLowerCase() === 'menu' || message.toLowerCase() === 'main menu') {
            responseMessage = `🚖 *Fast Cab Demo - Main Menu*

💬 *Try these commands:*
"ride from [pickup] to [destination]"

📍 *Popular routes:*
• "ride from Ikoyi to VI"
• "ride from Lekki to Surulere"
• "ride from Ikeja to Yaba"

⚡ *Features:* Instant booking • 3 ride types • Upfront pricing`;
            newState = 'main_menu';
          }
          
          else if (message.toLowerCase().includes('book') || message.toLowerCase().includes('another ride')) {
            responseMessage = `🚗 *Quick Booking*

💬 *Format:* "ride from [pickup] to [destination]"

📍 *Example:*
"ride from Ikoyi to Victoria Island"
"ride from Lekki to Surulere"
"ride from Ikeja to Yaba"

*What's your route?*`;
            newState = 'main_menu';
          }
          
          // Default fallback
          else {
            responseMessage = `❓ *Not sure what you mean*

💬 *Try:*
"ride from [pickup] to [destination]"

📍 *Examples:*
"ride from Ikoyi to VI"
"ride from Lekki to Surulere"

Or type *0* for main menu`;
          }
        }
      }

      // Send response
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage}</Message>
</Response>`;

      // Update user state if changed
      if (newState !== user.conversation_state) {
        updateUserState(userPhone, newState);
      }

      res.status(200).send(twiml);
    });

  } catch (error) {
    console.error('Webhook error:', error);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>🚖 Fast Cab Demo temporarily unavailable. Please try again in a moment!</Message>
</Response>`;
    res.status(200).send(twiml);
  }
}