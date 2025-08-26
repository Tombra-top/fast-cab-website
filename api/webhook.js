// Fast Cab WhatsApp Webhook - Fixed and Working Version

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract message data
    const from = req.body.From || '';
    const body = req.body.Body || '';
    const messageText = body.trim().toLowerCase();

    console.log(`📱 Incoming message from ${from}: "${messageText}"`);

    let responseMessage = '';

    // Route messages based on content
    if (isInitialGreeting(messageText)) {
      responseMessage = getWelcomeMessage();
      console.log('🎯 Route: Initial greeting');
    }
    else if (isSandboxJoin(messageText)) {
      responseMessage = getSandboxWelcome();
      console.log('🎯 Route: Sandbox join');
    }
    else if (isRideRequest(messageText)) {
      responseMessage = getRideOptions(messageText);
      console.log('🎯 Route: Ride request');
    }
    else if (isRideSelection(messageText)) {
      responseMessage = getBookingConfirmation(messageText);
      triggerFollowUpSequence(from);
      console.log('🎯 Route: Ride selection');
    }
    else if (isRating(messageText)) {
      responseMessage = getRatingResponse(messageText);
      console.log('🎯 Route: Rating');
    }
    else if (isPayment(messageText)) {
      responseMessage = getPaymentConfirmation(messageText);
      console.log('🎯 Route: Payment');
    }
    else if (isHelp(messageText)) {
      responseMessage = getHelpMessage();
      console.log('🎯 Route: Help');
    }
    else {
      responseMessage = getDefaultResponse();
      console.log('🎯 Route: Default response');
    }

    // Create TwiML XML response
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${responseMessage}</Message>
</Response>`;

    // Send response
    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(twimlResponse);

    console.log(`✅ Response sent to ${from}`);
    console.log(`📤 Response preview: ${responseMessage.substring(0, 100)}...`);

  } catch (error) {
    console.error('❌ Webhook error:', error);
    
    // Error response
    const errorResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>🚖 Fast Cab is temporarily unavailable. Please try again shortly.</Message>
</Response>`;

    res.setHeader('Content-Type', 'text/xml');
    res.status(200).send(errorResponse);
  }
}

// Message detection functions
function isInitialGreeting(text) {
  const greetings = [
    'hi! i want to try the fast cab demo',
    'hello',
    'hi',
    'start',
    'demo',
    'hey',
    'good morning',
    'good afternoon',
    'good evening'
  ];
  
  return greetings.some(greeting => text.includes(greeting));
}

function isSandboxJoin(text) {
  return text.includes('join cap-pleasure');
}

function isRideRequest(text) {
  return text.includes('ride from') || 
         (text.includes('from') && text.includes('to')) ||
         text.includes('book ride') ||
         text.includes('need ride');
}

function isRideSelection(text) {
  const trimmed = text.trim();
  return ['1', '2', '3'].includes(trimmed);
}

function isRating(text) {
  const trimmed = text.trim();
  return ['1', '2', '3', '4', '5'].includes(trimmed) && trimmed.length === 1;
}

function isPayment(text) {
  return text.includes('pay cash') || 
         text.includes('pay transfer') || 
         text.includes('pay card');
}

function isHelp(text) {
  return text.includes('help') || text.includes('menu') || text.includes('commands');
}

// Response message generators
function getWelcomeMessage() {
  return `🚖 *Welcome to Fast Cab Demo!*

To get started:
1️⃣ Send: *join cap-pleasure*
2️⃣ Wait for confirmation  
3️⃣ Request rides like: *"ride from lekki to vi"*

Ready to join the demo? 🚀`;
}

function getSandboxWelcome() {
  return `✅ *Welcome to Fast Cab Nigeria!*

🎉 You're now connected to our demo service!

*Popular Routes:*
🏢 Lekki → Victoria Island
🏠 Ikeja → Lekki Phase 1  
🏢 VI → Ikoyi
✈️ Ikeja → Airport

*How to book:*
Just send: *"ride from [pickup] to [destination]"*

Example: *"ride from lekki to vi"*

Try booking your first ride now! 🚖`;
}

function getRideOptions(messageText) {
  const locations = parseRideRequest(messageText);
  const pickup = locations.pickup || 'Your Location';
  const dropoff = locations.dropoff || 'Destination';
  
  const distance = Math.floor(Math.random() * 15) + 5;
  const basePrice = 800 + (distance * 120);
  
  return `🚖 *Ride Options: ${pickup} → ${dropoff}*

*1️⃣ Economy* 
🚗 Standard ride, affordable price
⏱️ 4-5 mins away
💰 ₦${basePrice.toLocaleString()}
⭐ 4.2 rating

*2️⃣ Comfort*
🚙 More space, air conditioning
⏱️ 3-4 mins away  
💰 ₦${Math.floor(basePrice * 1.3).toLocaleString()}
⭐ 4.6 rating

*3️⃣ Premium*
🚘 Luxury vehicle, professional driver
⏱️ 2-3 mins away
💰 ₦${Math.floor(basePrice * 1.6).toLocaleString()}
⭐ 4.8 rating

*Reply with 1, 2, or 3 to book* ⬇️`;
}

function getBookingConfirmation(selection) {
  const rideTypes = {
    '1': { name: 'Economy', icon: '🚗', car: 'Toyota Corolla' },
    '2': { name: 'Comfort', icon: '🚙', car: 'Honda Accord' },  
    '3': { name: 'Premium', icon: '🚘', car: 'Mercedes C-Class' }
  };
  
  const ride = rideTypes[selection];
  const drivers = ['Adebayo K.', 'Funmi A.', 'Chidi O.', 'Aisha M.'];
  const driver = drivers[Math.floor(Math.random() * drivers.length)];
  
  return `✅ *${ride.name} Ride Booked!* ${ride.icon}

*Driver:* ${driver}
*Car:* ${ride.car} (ABC-123-XY)
*ETA:* 3 mins

🔄 *Status:* Driver is on the way...`;
}

function getRatingResponse(rating) {
  const stars = '⭐'.repeat(parseInt(rating));
  
  return `${stars} *Thank you for rating!*

Your ${rating}-star rating helps us improve our service.

*Payment Options:*
💵 Reply *"pay cash"* - Pay driver directly
💳 Reply *"pay transfer"* - Bank transfer  
🎫 Reply *"pay card"* - Card payment

Thank you for choosing Fast Cab! 🚖✨`;
}

function getPaymentConfirmation(paymentText) {
  const paymentMethod = paymentText.includes('cash') ? 'Cash' : 
                       paymentText.includes('transfer') ? 'Bank Transfer' : 'Card';
  
  return `✅ *Payment Method: ${paymentMethod}*

💰 *Amount:* ₦2,500
✅ *Status:* Payment confirmed!

🎉 *Thank you for using Fast Cab!*

*Book another ride anytime:*
Just send: *"ride from [pickup] to [destination]"*

Safe travels! 🚖💙`;
}

function getHelpMessage() {
  return `🚖 *Fast Cab Help*

*How to book:*
📍 *"ride from lekki to vi"*
📍 *"from ikeja to airport"*

*Commands:*
🆘 *"help"* - Show this menu
🚖 *"ride from X to Y"* - Book a ride
💰 *"1, 2, 3"* - Select ride option
⭐ *"1-5"* - Rate your trip
💳 *"pay cash/transfer"* - Payment

Need a ride? Just tell us where! 🚗`;
}

function getDefaultResponse() {
  return `🤔 I didn't understand that.

*To book a ride:*
📍 Send: *"ride from [pickup] to [destination]"*

*Example:*
*"ride from lekki to vi"*

*Need help?* Send *"help"*

What's your destination? 🚖`;
}

// Helper functions
function parseRideRequest(message) {
  const patterns = [
    /ride from (.+?) to (.+)/i,
    /from (.+?) to (.+)/i,
    /(.+?) to (.+)/i
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        pickup: normalizeLocation(match[1].trim()),
        dropoff: normalizeLocation(match[2].trim())
      };
    }
  }
  
  return { pickup: 'Your Location', dropoff: 'Destination' };
}

function normalizeLocation(location) {
  const locationMap = {
    'vi': 'Victoria Island',
    'victoria island': 'Victoria Island',
    'lekki': 'Lekki Phase 1',
    'ikeja': 'Ikeja GRA',
    'airport': 'MM Airport',
    'ikoyi': 'Ikoyi',
    'surulere': 'Surulere',
    'yaba': 'Yaba'
  };
  
  const normalized = location.toLowerCase().trim();
  return locationMap[normalized] || 
         location.charAt(0).toUpperCase() + location.slice(1).toLowerCase();
}

// Follow-up message sequence
function triggerFollowUpSequence(phoneNumber) {
  console.log(`🚀 Starting follow-up sequence for ${phoneNumber}`);
  
  const messages = [
    {
      delay: 8000,
      type: 'driver-arrived',
      content: `🚗 *Driver has arrived!*

Your driver is outside. Look for the Honda Accord (ABC-123-XY).

🎯 *Status:* Trip started - on our way to destination...`
    },
    {
      delay: 16000,
      type: 'trip-progress', 
      content: `🛣️ *Trip in progress...*

📍 Current location: Halfway to destination
⏱️ ETA: 8 minutes remaining
🚦 Traffic: Light

Driver is taking the fastest route for you! 🚖`
    },
    {
      delay: 24000,
      type: 'almost-there',
      content: `🎯 *Almost there!*

📍 2 minutes to destination
🚖 Preparing to arrive

Get ready to exit the vehicle safely! ✨`
    },
    {
      delay: 32000,
      type: 'trip-completed',
      content: `🏁 *Trip completed!*

Hope you enjoyed your ride with Fast Cab!

*Trip Summary:*
💰 Fare: ₦2,500
⏱️ Duration: 18 mins  
📍 Distance: 12.3 km

*Rate your experience:*
⭐ Reply 1-5 stars (5 = excellent)
or
💰 *Pay Now:* Reply "pay cash" or "pay transfer"`
    }
  ];

  // Schedule messages (these will only work in production with Twilio setup)
  messages.forEach((msg) => {
    setTimeout(() => {
      sendFollowUpMessage(phoneNumber, msg.content, msg.type);
    }, msg.delay);
  });
}

async function sendFollowUpMessage(phoneNumber, message, messageType) {
  console.log(`📤 Would send ${messageType} to ${phoneNumber}:`);
  console.log(message);
  
  // In production, uncomment and add your Twilio credentials:
  /*
  const twilio = require('twilio');
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  
  try {
    await client.messages.create({
      body: message,
      from: 'whatsapp:+14155238886', // Your Twilio sandbox number
      to: phoneNumber
    });
    console.log(`✅ Sent ${messageType} to ${phoneNumber}`);
  } catch (error) {
    console.error(`❌ Error sending ${messageType}:`, error);
  }
  */
}