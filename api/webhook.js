// Fast Cab WhatsApp Webhook - SERVERLESS COMPATIBLE
// Uses stateless approach to work with Vercel's serverless functions

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

// UTILITY FUNCTIONS
function isSandboxJoin(message) {
  const msg = message.toLowerCase();
  return msg.includes('cap-pleasure') || msg.includes('join cap-pleasure');
}

function isConnectedUser(message) {
  // After joining sandbox, users can send ride requests directly
  // We detect this by checking if Twilio would have blocked unconnected users
  const msg = message.toLowerCase().trim();
  
  // These are commands only connected users would send
  const connectedCommands = [
    'ride from',
    'track',
    'cancel',
    'cash',
    'transfer'
  ];
  
  // If user is sending ride requests or commands, they must be connected
  return connectedCommands.some(cmd => msg.includes(cmd)) || 
         /^[1-5]$/.test(message) || // ratings 1-5
         ['1', '2', '3'].includes(message); // ride selections
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

// Send scheduled messages
async function sendDelayedMessage(userPhone, message, delay) {
  setTimeout(async () => {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log(`[SCHEDULED]: ${message.substring(0, 50)}...`);
      return;
    }
    
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.messages.create({
        from: 'whatsapp:+14155238886',
        to: `whatsapp:${userPhone}`,
        body: message
      });
    } catch (error) {
      console.error('Scheduled message error:', error);
    }
  }, delay);
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
    
    console.log(`📱 [${userPhone.slice(-4)}]: "${userMessage}"`);

    const twiml = new twilio.twiml.MessagingResponse();
    let response = '';

    // STEP 1: Handle sandbox join
    if (isSandboxJoin(userMessage)) {
      console.log(`✅ User ${userPhone.slice(-4)} joining sandbox`);
      
      response = `✅ Connected successfully!

🚖 Welcome to Fast Cab!

🔥 Popular routes (copy & send):
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"  
💬 "ride from Surulere to Yaba"

Ready to book your ride?`;
    }
    
    // STEP 2: Handle ride requests (from connected users)
    else if (parseRideRequest(userMessage)) {
      console.log(`🚗 Processing ride request from ${userPhone.slice(-4)}`);
      
      const rideRequest = parseRideRequest(userMessage);
      const { pickup, dropoff } = rideRequest;
      const pickupName = LAGOS_LOCATIONS[pickup].name;
      const dropoffName = LAGOS_LOCATIONS[dropoff].name;
      
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
    else if (['1', '2', '3'].includes(userMessage) && isConnectedUser(userMessage)) {
      console.log(`🎯 Ride selection ${userMessage} from ${userPhone.slice(-4)}`);
      
      const option = parseInt(userMessage);
      const rideTypes = Object.keys(RIDE_TYPES);
      const selectedType = rideTypes[option - 1];
      const ride = RIDE_TYPES[selectedType];
      
      const fare = calculateFare(selectedType);
      const bookingId = generateBookingId();
      const driver = DEMO_DRIVERS[Math.floor(Math.random() * DEMO_DRIVERS.length)];
      
      response = `✅ Ride Confirmed!
🚕 ${ride.name} - ₦${fare.toLocaleString()}
📍 Pickup → Destination

👨‍✈️ Your Driver
📱 ${driver.name}
🚗 ${driver.vehicle}
🏷️ ${driver.plate}
⭐ ${driver.rating}/5 (${driver.trips.toLocaleString()} trips)

📍 Booking: ${bookingId}
⏰ Arriving in 8 seconds...

💬 Type "track" to track driver
💬 Type "cancel" if needed`;

      // Start automated sequence
      sendDelayedMessage(userPhone, 
        `🚗 Driver Arrived!
${driver.name} is waiting outside
📍 Pickup location
🚗 Vehicle: ${driver.vehicle} (${driver.plate})`, 
        DEMO_TIMINGS.DRIVER_ARRIVAL);

      sendDelayedMessage(userPhone,
        `🚀 Trip Started!
📱 Live tracking: fast-cab.vercel.app/track/${bookingId}
⏱️ ETA: 15 seconds
📍 En route to destination
🛡️ Enjoy your safe ride!`,
        DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START);

      sendDelayedMessage(userPhone,
        `🎉 Trip Completed!
💰 Total: ₦${fare.toLocaleString()}
📍 Arrived at destination

⭐ Rate ${driver.name}? (Optional)
💬 Type "1" to "5" for rating OR skip to payment

💳 Payment method:
💬 Type "cash" or "transfer"

Choose rating + payment OR just payment above`,
        DEMO_TIMINGS.DRIVER_ARRIVAL + DEMO_TIMINGS.TRIP_START + DEMO_TIMINGS.TRIP_DURATION);
    }
    
    // STEP 4: Handle ratings
    else if (/^[1-5]$/.test(userMessage) && isConnectedUser(userMessage)) {
      const rating = parseInt(userMessage);
      const stars = '⭐'.repeat(rating);
      const ratingText = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'][rating - 1];
      
      response = `✅ Rating submitted!
${stars} ${rating}/5 - ${ratingText}
👨‍✈️ Driver has been rated

💳 Payment method:
💬 Type "cash" or "transfer"`;
    }
    
    // STEP 5: Handle payments
    else if (['cash', 'transfer'].includes(userMessage.toLowerCase()) && isConnectedUser(userMessage)) {
      const paymentMethod = userMessage.toLowerCase();
      
      if (paymentMethod === 'cash') {
        response = `💰 Cash Payment Selected

✅ Payment confirmed!
💵 Pay driver directly upon arrival

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
    }
    
    // STEP 6: Handle tracking
    else if (userMessage.toLowerCase() === 'track' && isConnectedUser(userMessage)) {
      response = `🔍 Live Trip Tracking

📍 Booking: FC123ABC
👨‍✈️ Driver: Emeka Johnson
📱 Phone: +234701****890
🚗 Vehicle: Toyota Corolla (LAG-234-XY)
🌐 Live map: fast-cab.vercel.app/track/FC123ABC

📍 Current: En route to destination
⏱️ ETA: Few minutes

🛡️ Your safety is our priority!`;
    }
    
    // STEP 7: Handle greetings from connected users
    else if ((userMessage.toLowerCase().includes('hi') || 
              userMessage.toLowerCase().includes('hello') ||
              userMessage.toLowerCase().includes('demo')) && 
              isConnectedUser(userMessage)) {
      
      response = `🚖 Welcome back to Fast Cab!

🔥 Popular routes (copy & send):
💬 "ride from Ikoyi to VI"
💬 "ride from Lekki to Ikeja"
💬 "ride from Surulere to Yaba"

Ready to book your ride?`;
    }
    
    // STEP 8: Handle new users or unconnected messages
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