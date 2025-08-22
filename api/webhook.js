const twilio = require('twilio');
const { getConversation, updateConversation, saveUser, getRide, saveRide } = require('./database');

// Twilio credentials from environment
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(accountSid, authToken);

// Mock drivers for testing
const mockDrivers = [
  {
    id: 1,
    name: 'Kemi A.',
    phone: '08011234567',
    vehicle: 'Blue Toyota Corolla',
    plate: 'ABC-123-XY',
    rating: 4.8,
    arrival_time: 4,
    fare: { economy: 1200, comfort: 1800, premium: 2500 }
  },
  {
    id: 2,
    name: 'Ahmed S.',
    phone: '08023456789',
    vehicle: 'Black Honda Accord',
    plate: 'DEF-456-ZY',
    rating: 4.9,
    arrival_time: 3,
    fare: { economy: 1200, comfort: 1800, premium: 2500 }
  },
  {
    id: 3,
    name: 'David O.',
    phone: '08034567890',
    vehicle: 'White Mercedes C-Class',
    plate: 'GHI-789-WX',
    rating: 5.0,
    arrival_time: 2,
    fare: { economy: 1200, comfort: 1800, premium: 2500 }
  }
];

// Send WhatsApp message
const sendMessage = async (to, message) => {
  try {
    await client.messages.create({
      from: twilioPhoneNumber,
      to: to,
      body: message
    });
    console.log(`✅ Message sent to ${to}: ${message.substring(0, 50)}...`);
  } catch (error) {
    console.error('❌ Error sending message:', error.message);
  }
};

// Bot conversation states and responses
const botResponses = {
  welcome: (userData) => {
    return `🚖 *Welcome to Fast Cab!*

Book rides instantly via WhatsApp - no app needed!

*What can I help you with?*

1️⃣ 🚗 Book a Ride
2️⃣ 📍 Track Current Ride  
3️⃣ 📞 Support

*Reply with 1, 2, or 3*`;
  },

  request_pickup: () => {
    return `🎯 *Let's get you moving!*

📍 *Where should I pick you up?*

- Share your live location 📍
- OR type your area (e.g. "Victoria Island", "Ikeja", "Lekki")`;
  },

  request_destination: (pickup) => {
    return `✅ Pickup: *${pickup}*

🏁 *Where are you going?*

- Share destination location 📍  
- OR type destination area`;
  },

  show_drivers: (pickup, destination) => {
    return `🔍 *Finding drivers...*

✅ *3 drivers found!*

🚗 *ECONOMY* - ₦1,200
👨‍🚗 Kemi A. • 4.8⭐ • 4 mins away

🚙 *COMFORT* - ₦1,800  
👨‍🚗 Ahmed S. • 4.9⭐ • 3 mins away

🏪 *PREMIUM* - ₦2,500
👨‍🚗 David O. • 5.0⭐ • 2 mins away

*Choose: 1, 2, or 3*`;
  },

  confirm_booking: (driverType, pickup, destination) => {
    const driver = mockDrivers[parseInt(driverType) - 1];
    const fare = driver.fare[driverType === '1' ? 'economy' : driverType === '2' ? 'comfort' : 'premium'];
    
    return `✅ *Booking confirmed!*

👨‍🚗 *Driver: ${driver.name}*
🚗 ${driver.vehicle} • ${driver.plate}
⭐ ${driver.rating}/5 rating
💰 Fare: ₦${fare.toLocaleString()}

📞 *Driver: ${driver.phone}*
📍 *From:* ${pickup}
📍 *To:* ${destination}

⏰ *Arriving in ${driver.arrival_time} minutes*

💡 *I'll update you when driver arrives and trip starts!*`;
  },

  driver_arrived: (driverData) => {
    return `🎉 *Driver Arrived!*

👨‍🚗 *${driverData.name} is here*
🚗 ${driverData.vehicle} (${driverData.plate})
📱 Call: ${driverData.phone}

*Please head to your driver now*`;
  },

  trip_started: (destination) => {
    return `🛣️ *Trip Started!*

📍 En route to: *${destination}*
⏱️ ETA: *18 minutes*

🛡️ *Trip is being tracked for your safety*

*Sit back and relax!* ✨`;
  },

  trip_completed: (pickup, destination, fare) => {
    return `🎉 *Trip Completed!*

📍 *Arrived at ${destination}*
⏱️ *Journey: 16 minutes*
💰 *Fare: ₦${fare.toLocaleString()}*

💳 *How would you like to pay?*

1️⃣ 💵 Cash
2️⃣ 💳 Card  
3️⃣ 🏦 Transfer
4️⃣ 📱 Mobile Money

*Choose: 1, 2, 3, or 4*`;
  },

  rating_request: (paymentMethod) => {
    return `✅ *Payment: ${paymentMethod} Selected*

⭐ *Quick rating:*

*Tap your rating:*
1️⃣⭐ 2️⃣⭐⭐ 3️⃣⭐⭐⭐ 4️⃣⭐⭐⭐⭐ 5️⃣⭐⭐⭐⭐⭐`;
  },

  trip_summary: (rating, pickup, destination, fare, driverName) => {
    return `⭐ *Thanks for the ${rating}-star rating!*

🎉 *Trip Summary*
📍 ${pickup} → ${destination}  
⏱️ 16 mins • ₦${fare.toLocaleString()}
👨‍🚗 ${driverName} • ${rating}⭐

*Need another ride?*
Reply *"1"* anytime! 🚖

*Thanks for choosing Fast Cab!* 💚`;
  },

  support: () => {
    return `📞 *Fast Cab Support*

*Common issues:*
1️⃣ Cancel current ride
2️⃣ Driver not found
3️⃣ Payment issue  
4️⃣ Lost item
5️⃣ Emergency

📱 *Urgent?* Call: ${process.env.SUPPORT_PHONE || '0701-XXX-XXXX'}
📧 Email: help@fastcab.ng

*What do you need help with?*`;
  },

  invalid_option: () => {
    return `🤔 I didn't understand that.

Please choose from the available options or type:
• *"1"* to book a ride
• *"help"* for support
• *"hi"* to start over`;
  }
};

// Process incoming messages
const processMessage = async (phoneNumber, messageBody, userData) => {
  const conversation = await getConversation(phoneNumber);
  const state = conversation ? conversation.state : 'welcome';
  const data = conversation ? JSON.parse(conversation.data) : {};

  console.log(`📱 Processing message from ${phoneNumber}: "${messageBody}" (state: ${state})`);

  let response = '';
  let newState = state;
  let newData = { ...data };

  // Handle different conversation states
  switch (state) {
    case 'welcome':
      if (messageBody === '1' || messageBody.toLowerCase().includes('book')) {
        response = botResponses.request_pickup();
        newState = 'awaiting_pickup';
      } else if (messageBody === '2' || messageBody.toLowerCase().includes('track')) {
        response = botResponses.support(); // For now, redirect to support
      } else if (messageBody === '3' || messageBody.toLowerCase().includes('support') || messageBody.toLowerCase().includes('help')) {
        response = botResponses.support();
        newState = 'support';
      } else {
        response = botResponses.welcome();
      }
      break;

    case 'awaiting_pickup':
      newData.pickup = messageBody;
      response = botResponses.request_destination(messageBody);
      newState = 'awaiting_destination';
      break;

    case 'awaiting_destination':
      newData.destination = messageBody;
      response = botResponses.show_drivers(newData.pickup, messageBody);
      newState = 'choosing_ride';
      break;

    case 'choosing_ride':
      if (['1', '2', '3'].includes(messageBody)) {
        const driver = mockDrivers[parseInt(messageBody) - 1];
        const rideType = messageBody === '1' ? 'economy' : messageBody === '2' ? 'comfort' : 'premium';
        const fare = driver.fare[rideType];
        
        newData.driver = driver;
        newData.rideType = rideType;
        newData.fare = fare;
        
        // Save ride to database
        await saveRide({
          phone_number: phoneNumber,
          pickup_location: newData.pickup,
          destination: newData.destination,
          ride_type: rideType,
          driver_name: driver.name,
          driver_phone: driver.phone,
          fare: fare,
          status: 'confirmed'
        });

        response = botResponses.confirm_booking(messageBody, newData.pickup, newData.destination);
        newState = 'ride_confirmed';

        // Simulate driver arrival after 30 seconds
        setTimeout(async () => {
          await sendMessage(phoneNumber, botResponses.driver_arrived(driver));
          await updateConversation(phoneNumber, 'driver_arrived', JSON.stringify(newData));
          
          // Simulate trip start after another 30 seconds
          setTimeout(async () => {
            await sendMessage(phoneNumber, botResponses.trip_started(newData.destination));
            await updateConversation(phoneNumber, 'trip_in_progress', JSON.stringify(newData));
            
            // Simulate trip completion after 2 minutes
            setTimeout(async () => {
              await sendMessage(phoneNumber, botResponses.trip_completed(newData.pickup, newData.destination, fare));
              await updateConversation(phoneNumber, 'awaiting_payment', JSON.stringify(newData));
            }, 120000); // 2 minutes
          }, 30000); // 30 seconds
        }, 30000); // 30 seconds

      } else {
        response = botResponses.invalid_option();
      }
      break;

    case 'awaiting_payment':
      if (['1', '2', '3', '4'].includes(messageBody)) {
        const paymentMethods = ['Cash', 'Card', 'Transfer', 'Mobile Money'];
        const paymentMethod = paymentMethods[parseInt(messageBody) - 1];
        
        newData.paymentMethod = paymentMethod;
        response = botResponses.rating_request(paymentMethod);
        newState = 'awaiting_rating';
      } else {
        response = botResponses.invalid_option();
      }
      break;

    case 'awaiting_rating':
      if (['1', '2', '3', '4', '5'].includes(messageBody)) {
        const rating = messageBody;
        response = botResponses.trip_summary(rating, newData.pickup, newData.destination, newData.fare, newData.driver.name);
        newState = 'welcome';
        newData = {}; // Reset conversation data
      } else {
        response = botResponses.invalid_option();
      }
      break;

    case 'support':
      // Handle support queries
      response = `Thanks for your message. A support agent will get back to you shortly.

Meanwhile, you can:
• Reply *"1"* to book a new ride
• Call ${process.env.SUPPORT_PHONE || '0701-XXX-XXXX'} for urgent issues`;
      newState = 'welcome';
      break;

    default:
      response = botResponses.welcome();
      newState = 'welcome';
      newData = {};
  }

  // Update conversation state
  await updateConversation(phoneNumber, newState, JSON.stringify(newData));
  
  return response;
};

// Main webhook handler
const handleWebhook = async (req, res) => {
  try {
    console.log('📨 Received webhook:', req.body);

    const { From, To, Body } = req.body;
    
    if (!From || !Body) {
      console.log('❌ Missing From or Body in webhook');
      return res.status(400).send('Bad Request');
    }

    // Clean phone number
    const phoneNumber = From.replace('whatsapp:', '');
    const messageBody = Body.trim();

    // Save/update user
    await saveUser(phoneNumber);

    // Process the message and get response
    const response = await processMessage(phoneNumber, messageBody, {});

    // Send response
    await sendMessage(From, response);

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
};

module.exports = handleWebhook;