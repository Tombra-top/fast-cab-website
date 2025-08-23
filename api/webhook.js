const twilio = require('twilio');

// Database functions (inline for serverless)
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database connection
function getDbConnection() {
  const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/fastcab.db' : path.join(process.cwd(), 'fastcab.db');
  return new sqlite3.Database(dbPath);
}

// Database functions
function getUser(phone) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    db.get('SELECT * FROM users WHERE phone = ?', [phone], (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function createUser(phone, name = null) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const query = 'INSERT INTO users (phone, name, created_at) VALUES (?, ?, datetime("now"))';
    db.run(query, [phone, name], function(err) {
      db.close();
      if (err) reject(err);
      else resolve({ id: this.lastID, phone, name });
    });
  });
}

function updateConversationState(userId, state) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const query = `INSERT OR REPLACE INTO conversations (user_id, state, updated_at) 
                   VALUES (?, ?, datetime("now"))`;
    db.run(query, [userId, state], (err) => {
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function getConversationState(userId) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    db.get('SELECT state FROM conversations WHERE user_id = ?', [userId], (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row ? row.state : 'greeting');
    });
  });
}

function getDrivers() {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    db.all('SELECT * FROM drivers WHERE available = 1 ORDER BY rating DESC', (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function createRide(userId, driverId, pickup, destination) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const query = `INSERT INTO rides (user_id, driver_id, pickup_location, destination, status, created_at) 
                   VALUES (?, ?, ?, ?, 'pending', datetime("now"))`;
    db.run(query, [userId, driverId, pickup, destination], function(err) {
      db.close();
      if (err) reject(err);
      else resolve({ id: this.lastID, userId, driverId, pickup, destination, status: 'pending' });
    });
  });
}

// Initialize database tables if they don't exist
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        name TEXT,
        created_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        state TEXT DEFAULT 'greeting',
        updated_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,
      `CREATE TABLE IF NOT EXISTS rides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        driver_id INTEGER,
        pickup_location TEXT,
        destination TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (driver_id) REFERENCES drivers (id)
      )`,
      `CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        vehicle TEXT,
        rating REAL DEFAULT 5.0,
        available BOOLEAN DEFAULT 1,
        location TEXT
      )`
    ];

    let completed = 0;
    tables.forEach(sql => {
      db.run(sql, (err) => {
        if (err) {
          db.close();
          reject(err);
          return;
        }
        completed++;
        if (completed === tables.length) {
          // Insert mock drivers if none exist
          db.get('SELECT COUNT(*) as count FROM drivers', (err, result) => {
            if (!err && result.count === 0) {
              const drivers = [
                ['John Doe', '+234701234567', 'Toyota Corolla', 4.8, 1, 'Lagos Island'],
                ['Jane Smith', '+234702345678', 'Honda Civic', 4.9, 1, 'Victoria Island'],
                ['Mike Johnson', '+234703456789', 'Hyundai Elantra', 4.7, 1, 'Ikeja'],
                ['Sarah Wilson', '+234704567890', 'Kia Rio', 4.6, 1, 'Lekki'],
                ['David Brown', '+234705678901', 'Nissan Sentra', 4.8, 1, 'Surulere']
              ];

              let insertCompleted = 0;
              drivers.forEach(driver => {
                db.run('INSERT INTO drivers (name, phone, vehicle, rating, available, location) VALUES (?, ?, ?, ?, ?, ?)', 
                  driver, (err) => {
                    insertCompleted++;
                    if (insertCompleted === drivers.length) {
                      db.close();
                      resolve();
                    }
                  });
              });
            } else {
              db.close();
              resolve();
            }
          });
        }
      });
    });
  });
}

// Parse request body
function parseBody(body) {
  if (!body) return {};
  
  if (typeof body === 'object') return body;
  
  if (typeof body === 'string') {
    try {
      // Try JSON first
      return JSON.parse(body);
    } catch {
      // Parse URL-encoded data
      const params = new URLSearchParams(body);
      const result = {};
      for (const [key, value] of params) {
        result[key] = value;
      }
      return result;
    }
  }
  
  return {};
}

// Send WhatsApp message
async function sendWhatsAppMessage(to, message) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log('⚠️ Twilio credentials not found, skipping message send');
      return { success: false, error: 'No credentials' };
    }

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER || 'whatsapp:+14155238886',
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
    });

    console.log(`✅ Message sent successfully: ${result.sid}`);
    return { success: true, sid: result.sid };
  } catch (error) {
    console.error('❌ Error sending message:', error);
    return { success: false, error: error.message };
  }
}

// Handle WhatsApp messages
async function handleWhatsAppMessage(from, body) {
  try {
    console.log(`📨 Processing message from ${from}: "${body}"`);

    // Initialize database first
    await initializeDatabase();

    // Clean phone number
    const phoneNumber = from.replace('whatsapp:', '');
    
    // Get or create user
    let user = await getUser(phoneNumber);
    if (!user) {
      user = await createUser(phoneNumber);
      console.log(`👤 New user created: ${phoneNumber}`);
    }

    // Get conversation state
    const currentState = await getConversationState(user.id);
    console.log(`💬 Current state for user ${user.id}: ${currentState}`);

    let response = '';
    let newState = currentState;

    // Handle conversation flow
    switch (currentState) {
      case 'greeting':
        if (body.toLowerCase().includes('hi') || body.toLowerCase().includes('hello') || body.toLowerCase().includes('hey')) {
          response = `🚖 Welcome to Fast Cab! How can I help you today?

1️⃣ Book a ride
2️⃣ Track my ride
3️⃣ Contact support
4️⃣ Rate my last ride

Reply with a number to continue.`;
          newState = 'main_menu';
        } else {
          response = `🚖 Welcome to Fast Cab! 

Please say "Hi" or "Hello" to get started.`;
        }
        break;

      case 'main_menu':
        switch (body.trim()) {
          case '1':
            response = `🚗 Great! Let's book you a ride.

Please tell me your pickup location (e.g., Lagos Island, Victoria Island, Ikeja, etc.)`;
            newState = 'waiting_pickup';
            break;
          case '2':
            response = `🔍 Track Your Ride

Sorry, you don't have any active rides to track right now.

Reply with any key to return to the main menu.`;
            newState = 'main_menu';
            break;
          case '3':
            response = `📞 Contact Support

For immediate assistance, please call: +234-800-FASTCAB

Or email us at: support@fastcab.ng

Reply with any key to return to the main menu.`;
            newState = 'main_menu';
            break;
          case '4':
            response = `⭐ Rate Your Last Ride

You haven't taken any rides with us yet!

Reply with any key to return to the main menu.`;
            newState = 'main_menu';
            break;
          default:
            response = `❓ Please choose a valid option (1, 2, 3, or 4):

1️⃣ Book a ride
2️⃣ Track my ride  
3️⃣ Contact support
4️⃣ Rate my last ride`;
        }
        break;

      case 'waiting_pickup':
        const pickup = body.trim();
        response = `📍 Pickup: ${pickup}

Now please tell me your destination.`;
        
        // Store pickup location temporarily (in a real app, you'd use a session store)
        await updateConversationState(user.id, `waiting_destination:${pickup}`);
        newState = `waiting_destination:${pickup}`;
        break;

      case (currentState.startsWith('waiting_destination:') ? currentState : ''):
        const pickupLocation = currentState.split(':')[1];
        const destination = body.trim();
        
        // Get available drivers
        const drivers = await getDrivers();
        
        if (drivers.length === 0) {
          response = `😔 Sorry, no drivers are currently available in your area.

Please try again later or contact support.

Reply with any key to return to the main menu.`;
          newState = 'main_menu';
        } else {
          response = `🚗 Available drivers for your trip:
📍 From: ${pickupLocation}
📍 To: ${destination}

`;
          
          drivers.slice(0, 3).forEach((driver, index) => {
            response += `${index + 1}️⃣ ${driver.name}
   🚗 ${driver.vehicle}
   ⭐ ${driver.rating}/5.0
   📍 Currently in ${driver.location}
   
`;
          });
          
          response += `Please reply with the number of your preferred driver (1, 2, or 3).`;
          
          // Store trip details
          await updateConversationState(user.id, `selecting_driver:${pickupLocation}:${destination}:${drivers.map(d => d.id).slice(0, 3).join(',')}`);
          newState = `selecting_driver:${pickupLocation}:${destination}:${drivers.map(d => d.id).slice(0, 3).join(',')}`;
        }
        break;

      case (currentState.startsWith('selecting_driver:') ? currentState : ''):
        const [, pickup2, dest, driverIds] = currentState.split(':');
        const driverIdArray = driverIds.split(',');
        const selectedIndex = parseInt(body.trim()) - 1;
        
        if (selectedIndex >= 0 && selectedIndex < driverIdArray.length) {
          const selectedDriverId = driverIdArray[selectedIndex];
          
          // Create the ride
          const ride = await createRide(user.id, selectedDriverId, pickup2, dest);
          
          // Get driver details
          const allDrivers = await getDrivers();
          const selectedDriver = allDrivers.find(d => d.id == selectedDriverId);
          
          response = `🎉 Ride booked successfully!

📋 Booking Details:
🚗 Driver: ${selectedDriver.name}
📱 Driver Phone: ${selectedDriver.phone}
🚙 Vehicle: ${selectedDriver.vehicle}
📍 Pickup: ${pickup2}
📍 Destination: ${dest}
🆔 Ride ID: #${ride.id}

Your driver will arrive in approximately 10-15 minutes.

Thank you for choosing Fast Cab! 🚖

Reply with any key to return to the main menu.`;
          
          newState = 'main_menu';
        } else {
          response = `❓ Please select a valid driver option (1, 2, or 3).`;
        }
        break;

      default:
        response = `🚖 Welcome back to Fast Cab!

1️⃣ Book a ride
2️⃣ Track my ride
3️⃣ Contact support  
4️⃣ Rate my last ride

Reply with a number to continue.`;
        newState = 'main_menu';
    }

    // Update conversation state
    await updateConversationState(user.id, newState);

    // Send response
    const result = await sendWhatsAppMessage(from, response);
    
    console.log(`✅ Conversation updated: ${user.id} -> ${newState}`);
    return { success: true, response, result };

  } catch (error) {
    console.error('❌ Error processing message:', error);
    
    // Send error message to user
    await sendWhatsAppMessage(from, `😔 Sorry, something went wrong. Please try again or contact support.`);
    
    return { success: false, error: error.message };
  }
}

// Main webhook handler
module.exports = async (req, res) => {
  console.log(`📥 ${req.method} ${req.url} - ${new Date().toISOString()}`);

  // Handle GET requests (health check)
  if (req.method === 'GET') {
    const healthCheck = {
      message: "Fast Cab WhatsApp Webhook is working!",
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        hasTwilioSid: !!process.env.TWILIO_ACCOUNT_SID,
        hasTwilioToken: !!process.env.TWILIO_AUTH_TOKEN,
        hasTwilioPhone: !!process.env.TWILIO_PHONE_NUMBER
      }
    };
    
    return res.status(200).json(healthCheck);
  }

  // Handle POST requests (webhooks)
  if (req.method === 'POST') {
    try {
      const body = parseBody(req.body);
      console.log('📨 Received webhook body:', body);

      const { From, Body } = body;

      if (!From || !Body) {
        console.log('⚠️ Missing From or Body in request');
        return res.status(400).json({ error: 'Missing From or Body' });
      }

      // Process the message
      const result = await handleWhatsAppMessage(From, Body);
      
      // Always return 200 to Twilio
      return res.status(200).json({ 
        success: true, 
        processed: result.success,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Webhook error:', error);
      
      // Still return 200 to prevent Twilio retries
      return res.status(200).json({ 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Method not allowed
  return res.status(405).json({ error: 'Method not allowed' });
};