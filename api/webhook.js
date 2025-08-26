// Fast Cab WhatsApp Webhook - SERVERLESS COMPATIBLE
// Uses state management to work with Vercel's serverless functions

const twilio = require('twilio');

// Configuration
const DEMO_TIMINGS = {
  DRIVER_ARRIVAL: 8000,
  TRIP_START: 5000,
  TRIP_DURATION: 15000
};

// Lagos locations
const LAGOS_LOCATIONS = {
  'ikoyi': { name: 'Ikoyi' },
  'vi': { name: 'Victoria Island' },
  'victoria island': { name: 'Victoria Island' },
  'lekki': { name: 'Lekki' },
  'surulere': { name: 'Surulere' },
  'ikeja': { name: 'Ikeja' },
  'yaba': { name: 'Yaba' },
  'lagos island': { name: 'Lagos Island' },
  'island': { name: 'Lagos Island' },
  'apapa': { name: 'Apapa' },
  'ajah': { name: 'Ajah' }
};

// Ride types
const RIDE_TYPES = {
  'economy': { name: 'Economy', base_fare: 600, per_km: 120 },
  'comfort': { name: 'Comfort', base_fare: 900, per_km: 180 },
  'premium': { name: 'Premium', base_fare: 1500, per_km: 250 }
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
  }
];

// In-memory state for demo purposes (for production, use a database)
const userStates = new Map();

// UTILITY FUNCTIONS
function isSandboxJoin(message) {
  const msg = message.toLowerCase();
  return msg.includes('cap-pleasure') || msg.includes('join cap-pleasure');
}

function isConnectedUser(phone) {
  return userStates.has(phone) && userStates.get(phone).connected;
}

function parseRideRequest(message) {
  const msg = message.toLowerCase().trim();
  
  // Match patterns like "ride from X to Y" or just "X to Y"
  const patterns = [
    /(?:ride\s+)?from\s+([^to]+)\s+to\s+(.+)/i,
    /([a-z\s]+)\s+to\s+([a-z\s]+)/i
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

function findLocation(input) {
  const term = input.toLowerCase().trim();
  
  // Direct match
  if (LAGOS_LOCATIONS[term]) return term;
  
  // Handle abbreviations
  if (term === 'vi' || term === 'v.i' || term === 'v.i.') return 'victoria island';
  
  // Partial matching
  const matches = Object.keys(LAGOS_LOCATIONS).filter(loc => 
    loc.includes(term) || term.includes(loc)
  );
  
  return matches.length === 1 ? matches[0] : null;
}

function calculateFare(rideType, distance = 8) {
  const rate = RIDE_TYPES[rideType];
  return rate.base_fare + (rate.per_km * distance);
}

function generateBookingId() {
  return 'FC' + Date.now().toString(36).substr(-6).toUpperCase();
}

function getUserState(phone) {
  if (!userStates.has(phone)) {
    userStates.set(phone, {
      connected: false,
      currentRide: null,
      rideStage: null,
      lastInteraction: Date.now()
    });
  }
  return userStates.get(phone);
}

function updateUserState(phone, updates) {
  const currentState = getUserState(phone);
  userStates.set(phone, { ...currentState, ...updates, lastInteraction: Date.now() });
}

// Clean up old states to prevent memory leaks
function cleanupOldStates() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [phone, state] of userStates.entries()) {
    if (now - state.lastInteraction > oneHour) {
      userStates.delete(phone);
    }
  }
}

// MAIN WEBHOOK HANDLER
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { Body: message, From: from } = req.body;
    
    if (!message || !from) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const userPhone = from.replace('whatsapp:', '');
    const userMessage = message.trim();
    const userState = getUserState(userPhone);
    
    console.log(`📱 [${userPhone.slice(-4)}]: "${userMessage}" - State: ${JSON.stringify(userState)}`);

    const twiml = new twilio.twiml.MessagingResponse();
    let response = '';

    // Clean up old states periodically
    if (Math.random() < 0.1) cleanupOldStates(); // ~10% of requests

    // STEP 1: Handle sandbox join
    if (isSandboxJoin(userMessage)) {
      console.log(`✅ User ${userPhone.slice(-4)} joining sandbox`);
      updateUserState(userPhone, { connected: true });
      
      response = `✅ Connected successfully!

🚖 Welcome to Fast Cab!

🔥 Popular routes (copy & send):
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"  
💬 "ride from Surulere to Yaba"

Ready to book your ride?`;
    }
    
    // STEP 2: Handle ride requests (from connected users)
    else if (isConnectedUser(userPhone) && parseRideRequest(userMessage)) {
      console.log(`🚗 Processing ride request from ${userPhone.slice(-4)}`);
      
      const rideRequest = parseRideRequest(userMessage);
      const { pickup, dropoff } = rideRequest;
      const pickupName = LAGOS_LOCATIONS[pickup].name;
      const dropoffName = LAGOS_LOCATIONS[dropoff].name;
      
      // Store ride info in state
      updateUserState(userPhone, { 
        currentRide: { pickup, dropoff },
        rideStage: 'selecting_ride'
      });
      
      response = `🚗 Available rides from ${pickupName} to ${dropoffName}:

1️⃣ 🚗 Economy - ₦${calculateFare('economy').toLocaleString()}
   ⏱️ 2-4 mins • Budget-friendly

2️⃣ 🚙 Comfort - ₦${calculateFare('comfort').toLocaleString()}
   ⏱️ 2-3 mins • More space + AC

3️⃣ 🚕 Premium - ₦${calculateFare('premium').toLocaleString()}
   ⏱️ 1-2 mins • Luxury experience

💬 Type 1, 2, or 3 to book`;
    }
    
    // STEP 3: Handle ride selection
    else if (isConnectedUser(userPhone) && ['1', '2', '3'].includes(userMessage) && userState.rideStage === 'selecting_ride') {
      console.log(`🎯 Ride selection ${userMessage} from ${userPhone.slice(-4)}`);
      
      const option = parseInt(userMessage);
      const rideTypes = Object.keys(RIDE_TYPES);
      const selectedType = rideTypes[option - 1];
      const ride = RIDE_TYPES[selectedType];
      
      const fare = calculateFare(selectedType);
      const bookingId = generateBookingId();
      const driver = DEMO_DRIVERS[Math.floor(Math.random() * DEMO_DRIVERS.length)];
      
      // Update state with booking details
      updateUserState(userPhone, {
        currentRide: {
          ...userState.currentRide,
          type: selectedType,
          fare,
          bookingId,
          driver,
          stage: 'driver_assigned',
          stageTimestamp: Date.now()
        },
        rideStage: 'driver_assigned'
      });
      
      response = `✅ Ride Confirmed!
🚕 ${ride.name} - ₦${fare.toLocaleString()}
📍 ${LAGOS_LOCATIONS[userState.currentRide.pickup].name} → ${LAGOS_LOCATIONS[userState.currentRide.dropoff].name}

👨‍✈️ Your Driver
📱 ${driver.name}
🚗 ${driver.vehicle}
🏷️ ${driver.plate}
⭐ ${driver.rating}/5 (${driver.trips.toLocaleString()} trips)

📍 Booking: ${bookingId}
⏰ Arriving soon...

💬 Type "track" to track driver
💬 Type "cancel" if needed`;
    }
    
    // STEP 4: Handle tracking requests
    else if (isConnectedUser(userPhone) && userMessage.toLowerCase() === 'track' && userState.rideStage) {
      if (!userState.currentRide || !userState.currentRide.bookingId) {
        response = "No active ride to track. Book a ride first with 'ride from [location] to [destination]'";
      } else {
        const { currentRide } = userState;
        response = `🔍 Live Trip Tracking

📍 Booking: ${currentRide.bookingId}
👨‍✈️ Driver: ${currentRide.driver.name}
📱 Phone: ${currentRide.driver.phone}
🚗 Vehicle: ${currentRide.driver.vehicle} (${currentRide.driver.plate})
🌐 Live map: fast-cab.vercel.app/track/${currentRide.bookingId}

📍 ${getRideStatus(userState)}`;

        // Simulate progression through ride stages based on time
        const timeSinceStage = Date.now() - userState.currentRide.stageTimestamp;
        
        if (userState.rideStage === 'driver_assigned' && timeSinceStage > DEMO_TIMINGS.DRIVER_ARRIVAL) {
          updateUserState(userPhone, {
            rideStage: 'driver_arrived',
            currentRide: {
              ...userState.currentRide,
              stage: 'driver_arrived',
              stageTimestamp: Date.now()
            }
          });
          response += "\n\n🚗 Driver has arrived at your location!";
        } 
        else if (userState.rideStage === 'driver_arrived' && timeSinceStage > DEMO_TIMINGS.TRIP_START) {
          updateUserState(userPhone, {
            rideStage: 'trip_started',
            currentRide: {
              ...userState.currentRide,
              stage: 'trip_started',
              stageTimestamp: Date.now()
            }
          });
          response += "\n\n🚀 Trip has started! En route to destination.";
        }
        else if (userState.rideStage === 'trip_started' && timeSinceStage > DEMO_TIMINGS.TRIP_DURATION) {
          updateUserState(userPhone, {
            rideStage: 'trip_completed',
            currentRide: {
              ...userState.currentRide,
              stage: 'trip_completed',
              stageTimestamp: Date.now()
            }
          });
          response += `\n\n🎉 Trip Completed! Please rate your driver and select payment method.`;
        }
      }
    }
    
    // STEP 5: Handle ratings
    else if (isConnectedUser(userPhone) && /^[1-5]$/.test(userMessage) && userState.rideStage === 'trip_completed') {
      const rating = parseInt(userMessage);
      const stars = '⭐'.repeat(rating);
      const ratingText = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating - 1];
      
      updateUserState(userPhone, {
        rideStage: 'rating_submitted',
        currentRide: {
          ...userState.currentRide,
          rating
        }
      });
      
      response = `✅ Rating submitted!
${stars} ${rating}/5 - ${ratingText}
👨‍✈️ Driver has been rated

💳 Payment method:
💬 Type "cash" or "transfer"`;
    }
    
    // STEP 6: Handle payments
    else if (isConnectedUser(userPhone) && ['cash', 'transfer'].includes(userMessage.toLowerCase()) && 
             (userState.rideStage === 'trip_completed' || userState.rideStage === 'rating_submitted')) {
      const paymentMethod = userMessage.toLowerCase();
      
      if (paymentMethod === 'cash') {
        response = `💰 Cash Payment Selected

✅ Payment confirmed!
💵 Pay driver directly

🎉 Trip completed successfully!

🔥 Book another ride?
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Yaba"`;
      } else {
        response = `💳 Bank Transfer Selected

✅ Payment confirmed!
🏦 Transfer to Fast Cab wallet

🎉 Trip completed successfully!

🔥 Book another ride?
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Yaba"`;
      }
      
      // Reset ride state but keep connection
      updateUserState(userPhone, {
        currentRide: null,
        rideStage: null
      });
    }
    
    // STEP 7: Handle cancellations
    else if (isConnectedUser(userPhone) && userMessage.toLowerCase() === 'cancel' && userState.rideStage) {
      response = `❌ Ride cancelled successfully.

🔥 Book another ride?
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Yaba"`;
      
      // Reset ride state
      updateUserState(userPhone, {
        currentRide: null,
        rideStage: null
      });
    }
    
    // STEP 8: Handle greetings from connected users
    else if (isConnectedUser(userPhone) && 
             (userMessage.toLowerCase().includes('hi') || 
              userMessage.toLowerCase().includes('hello') ||
              userMessage.toLowerCase().includes('demo'))) {
      
      response = `🚖 Welcome back to Fast Cab!

🔥 Popular routes (copy & send):
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Yaba"

Ready to book your ride?`;
    }
    
    // STEP 9: Handle new users or unconnected messages
    else {
      console.log(`🆕 New user ${userPhone.slice(-4)} or unconnected message`);
      
      // Check if it's a greeting from new user
      if (userMessage.toLowerCase().includes('hi') || 
          userMessage.toLowerCase().includes('demo') ||
          userMessage.toLowerCase().includes('hello')) {
        
        response = `🚖 Welcome to Fast Cab!
👋 Thanks for trying our service!

⚠️ Quick setup needed:

📋 Step 1: Copy this code:
join cap-pleasure

📋 Step 2: Send it here

📋 Step 3: Book rides like:
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"

⚡ Takes 10 seconds • No app needed

Copy & send the join code above to start!`;
      } else {
        response = `Please join first by sending:
join cap-pleasure`;
      }
    }

    console.log(`✅ [${userPhone.slice(-4)}] Response: ${response.substring(0, 50)}...`);
    
    twiml.message(response);
    res.type('text/xml').send(twiml.toString());

  } catch (error) {
    console.error('❌ Webhook error:', error);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('🔧 System temporarily unavailable. Try: "ride from Ikoyi to VI"');
    res.type('text/xml').send(twiml.toString());
  }
}

// Helper function to get ride status text
function getRideStatus(userState) {
  if (!userState.currentRide) return "No active ride";
  
  switch (userState.rideStage) {
    case 'driver_assigned':
      return "Driver is on the way to your location";
    case 'driver_arrived':
      return "Driver has arrived at pickup location";
    case 'trip_started':
      return "En route to destination";
    case 'trip_completed':
      return "Arrived at destination";
    default:
      return "Ride status unknown";
  }
}