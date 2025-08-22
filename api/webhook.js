// Fast Cab WhatsApp Webhook Handler - Fixed for Vercel
const twilio = require('twilio');

// Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Import database functions
const { 
  getUser, 
  createUser, 
  updateUser, 
  getConversation, 
  updateConversation, 
  createRide, 
  updateRide, 
  getDrivers 
} = require('./database');

// Helper function to parse URL-encoded body
function parseBody(body) {
  const params = new URLSearchParams(body);
  const result = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

// Helper function to send WhatsApp message
async function sendMessage(to, message) {
  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });
    console.log(`✅ Message sent to ${to}`);
  } catch (error) {
    console.error(`❌ Error sending message:`, error);
  }
}

// Main webhook handler
module.exports = async (req, res) => {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Handle GET requests (for testing)
    if (req.method === 'GET') {
      return res.status(200).json({
        message: 'Fast Cab WhatsApp Webhook is working!',
        timestamp: new Date().toISOString(),
        environment: {
          nodeVersion: process.version,
          hasTwilioSid: !!process.env.TWILIO_ACCOUNT_SID,
          hasTwilioToken: !!process.env.TWILIO_AUTH_TOKEN,
          hasTwilioPhone: !!process.env.TWILIO_PHONE_NUMBER
        }
      });
    }

    // Handle POST requests (WhatsApp messages)
    if (req.method === 'POST') {
      console.log('📨 Received webhook request');
      
      // Parse the request body
      let body;
      if (typeof req.body === 'string') {
        body = parseBody(req.body);
      } else if (req.body && typeof req.body === 'object') {
        body = req.body;
      } else {
        // If body is still undefined, it might be raw data
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString();
          body = parseBody(rawBody);
          return handleWhatsAppMessage(body, res);
        });
        return;
      }

      return await handleWhatsAppMessage(body, res);
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

async function handleWhatsAppMessage(body, res) {
  try {
    const { Body: message, From: from, To: to } = body;
    
    console.log(`📱 Message from ${from}: "${message}"`);

    if (!message || !from) {
      console.log('❌ Missing message or sender info');
      return res.status(400).json({ error: 'Missing message or sender info' });
    }

    // Clean phone number (remove whatsapp: prefix)
    const phoneNumber = from.replace('whatsapp:', '');
    
    // Get or create user
    let user = await getUser(phoneNumber);
    if (!user) {
      user = await createUser(phoneNumber);
      console.log(`👤 New user created: ${phoneNumber}`);
    }

    // Get conversation state
    let conversation = await getConversation(user.id);
    
    const userMessage = message.trim().toLowerCase();
    
    // Handle conversation flow
    if (!conversation || conversation.state === 'completed') {
      // Start new conversation
      if (userMessage.includes('hi') || userMessage.includes('hello') || userMessage.includes('start')) {
        await updateConversation(user.id, 'menu', {});
        await sendMessage(from, 
          `🚖 Welcome to Fast Cab!\n\n` +
          `1️⃣ Book a Ride\n` +
          `2️⃣ Check Ride Status\n` +
          `3️⃣ Support\n\n` +
          `Reply with a number to continue.`
        );
      } else {
        await sendMessage(from, 
          `👋 Hi! Welcome to Fast Cab.\n\n` +
          `Send "hi" to get started with booking your ride!`
        );
      }
    }
    else if (conversation.state === 'menu') {
      if (userMessage === '1') {
        await updateConversation(user.id, 'pickup_location', {});
        await sendMessage(from, 
          `📍 Great! Let's book your ride.\n\n` +
          `Please share your pickup location:`
        );
      } else if (userMessage === '2') {
        await sendMessage(from, 
          `🚗 You don't have any active rides.\n\n` +
          `Send "1" to book a new ride!`
        );
      } else if (userMessage === '3') {
        await sendMessage(from, 
          `📞 Fast Cab Support\n\n` +
          `📧 Email: support@fastcab.ng\n` +
          `📱 Phone: +234 901 234 5678\n\n` +
          `Send "1" to book a ride.`
        );
      } else {
        await sendMessage(from, 
          `❌ Invalid option. Please choose:\n\n` +
          `1️⃣ Book a Ride\n` +
          `2️⃣ Check Ride Status\n` +
          `3️⃣ Support`
        );
      }
    }
    else if (conversation.state === 'pickup_location') {
      // Save pickup location and ask for destination
      await updateConversation(user.id, 'destination_location', { 
        pickup_location: message 
      });
      await sendMessage(from, 
        `✅ Pickup: ${message}\n\n` +
        `📍 Now, what's your destination?`
      );
    }
    else if (conversation.state === 'destination_location') {
      // Save destination and show drivers
      const conversationData = conversation.data || {};
      conversationData.destination_location = message;
      
      await updateConversation(user.id, 'selecting_driver', conversationData);
      
      const drivers = await getDrivers();
      let driverMessage = `🚗 Available drivers:\n\n`;
      
      drivers.forEach((driver, index) => {
        driverMessage += `${index + 1}️⃣ ${driver.name}\n`;
        driverMessage += `⭐ ${driver.rating}/5 (${driver.trips} trips)\n`;
        driverMessage += `💰 ₦${driver.price_per_km}/km\n`;
        driverMessage += `🕐 ${driver.eta} mins away\n\n`;
      });
      
      driverMessage += `Reply with driver number (1-5)`;
      
      await sendMessage(from, driverMessage);
    }
    else if (conversation.state === 'selecting_driver') {
      const driverIndex = parseInt(userMessage) - 1;
      const drivers = await getDrivers();
      
      if (driverIndex >= 0 && driverIndex < drivers.length) {
        const selectedDriver = drivers[driverIndex];
        const conversationData = conversation.data;
        
        // Create ride
        const ride = await createRide(
          user.id,
          conversationData.pickup_location,
          conversationData.destination_location,
          selectedDriver.id
        );
        
        await updateConversation(user.id, 'ride_booked', { ride_id: ride.id });
        
        await sendMessage(from,
          `🎉 Ride booked successfully!\n\n` +
          `👤 Driver: ${selectedDriver.name}\n` +
          `📍 From: ${conversationData.pickup_location}\n` +
          `📍 To: ${conversationData.destination_location}\n` +
          `🕐 ETA: ${selectedDriver.eta} minutes\n` +
          `📱 Driver will call you shortly.\n\n` +
          `Ride ID: #${ride.id}\n\n` +
          `Thank you for choosing Fast Cab! 🚖`
        );
        
        // Mark conversation as completed
        await updateConversation(user.id, 'completed', {});
      } else {
        await sendMessage(from, 
          `❌ Invalid driver selection. Please choose 1-5.`
        );
      }
    }
    else {
      // Handle unexpected state
      await updateConversation(user.id, 'menu', {});
      await sendMessage(from, 
        `🚖 Welcome back to Fast Cab!\n\n` +
        `1️⃣ Book a Ride\n` +
        `2️⃣ Check Ride Status\n` +
        `3️⃣ Support\n\n` +
        `Reply with a number to continue.`
      );
    }

    console.log('✅ Message processed successfully');
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('❌ Error processing message:', error);
    return res.status(500).json({ error: error.message });
  }
}