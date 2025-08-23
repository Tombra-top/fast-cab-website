const twilio = require('twilio');
const crypto = require('crypto');

// Database functions (inline for serverless)
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Demo Configuration - Optimized for public testing
const DEMO_CONFIG = {
  simulationMode: true,
  fastSimulation: true, // Speeds up all timings for demo
  driverArrivalTime: 10000, // 10 seconds instead of real minutes
  tripDuration: 20000, // 20 seconds instead of real minutes
  maxUsersPerHour: 1000, // Support many concurrent users
  welcomeNewUsers: true, // Always welcome new users with demo info
  autoResetAfterTrip: true // Auto return to main menu after completion
};

// Security and validation utilities
const SECURITY = {
  maxMessageLength: 500,
  rateLimitWindow: 60000,
  maxRequestsPerWindow: 50, // Increased for demo
  allowedStates: [
    'greeting', 'main_menu', 'awaiting_booking', 'selecting_ride_type', 
    'confirming_booking', 'driver_assigned', 'driver_arriving', 'driver_arrived', 
    'trip_started', 'trip_completed', 'demo_complete'
  ],
  sanitizeInput: (input) => {
    return input.replace(/[<>\"'&]/g, '').trim().slice(0, 100);
  }
};

// Industry standard ride types optimized for Lagos demo
const RIDE_TYPES = {
  economy: {
    name: 'Economy',
    description: 'Affordable rides for everyday trips',
    icon: '🚗',
    baseFare: 600,
    perKmRate: 120,
    perMinuteRate: 15,
    eta: { min: 3, max: 8 },
    vehicles: ['Toyota Corolla', 'Honda Civic', 'Nissan Sentra']
  },
  comfort: {
    name: 'Comfort',
    description: 'More space and newer vehicles',
    icon: '🚙',
    baseFare: 900,
    perKmRate: 180,
    perMinuteRate: 25,
    eta: { min: 5, max: 12 },
    vehicles: ['Toyota Camry', 'Honda Accord', 'Hyundai Sonata']
  },
  premium: {
    name: 'Premium',
    description: 'Luxury vehicles with top-rated drivers',
    icon: '🚕',
    baseFare: 1500,
    perKmRate: 250,
    perMinuteRate: 35,
    eta: { min: 8, max: 15 },
    vehicles: ['Mercedes C-Class', 'BMW 3 Series', 'Audi A4']
  }
};

// Database connection
function getDbConnection() {
  const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/fastcab.db' : path.join(process.cwd(), 'fastcab.db');
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
}

// Enhanced database functions
function getUser(phone) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const stmt = db.prepare('SELECT * FROM users WHERE phone = ?');
    stmt.get([phone], (err, row) => {
      stmt.finalize();
      db.close();
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function createUser(phone, name = null) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const stmt = db.prepare('INSERT OR IGNORE INTO users (phone, name, created_at, demo_user) VALUES (?, ?, datetime("now"), 1)');
    stmt.run([phone, name], function(err) {
      stmt.finalize();
      if (err) {
        db.close();
        reject(err);
      } else {
        // Get the user (either newly created or existing)
        const getStmt = db.prepare('SELECT * FROM users WHERE phone = ?');
        getStmt.get([phone], (err, row) => {
          getStmt.finalize();
          db.close();
          if (err) reject(err);
          else resolve(row);
        });
      }
    });
  });
}

function updateConversationState(userId, state, data = null) {
  return new Promise((resolve, reject) => {
    if (!SECURITY.allowedStates.includes(state)) {
      reject(new Error('Invalid state'));
      return;
    }
    
    const db = getDbConnection();
    const stmt = db.prepare(`INSERT OR REPLACE INTO conversations (user_id, state, data, updated_at) 
                           VALUES (?, ?, ?, datetime("now"))`);
    stmt.run([userId, state, data], (err) => {
      stmt.finalize();
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function getConversationState(userId) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    const stmt = db.prepare('SELECT state, data FROM conversations WHERE user_id = ?');
    stmt.get([userId], (err, row) => {
      stmt.finalize();
      db.close();
      if (err) reject(err);
      else resolve(row ? { state: row.state, data: row.data } : { state: 'greeting', data: null });
    });
  });
}

function getAvailableDrivers(rideType, location = null) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    let query = 'SELECT * FROM drivers WHERE available = 1 AND ride_type = ?';
    let params = [rideType];
    
    if (location) {
      query += ' AND location LIKE ?';
      params.push(`%${location}%`);
    }
    
    query += ' ORDER BY rating DESC LIMIT 5';
    
    const stmt = db.prepare(query);
    stmt.all(params, (err, rows) => {
      stmt.finalize();
      db.close();
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function createRide(userId, driverId, pickup, destination, rideType, estimatedFare) {
  return new Promise((resolve, reject) => {
    const bookingId = generateBookingId();
    const db = getDbConnection();
    const stmt = db.prepare(`INSERT INTO rides (booking_id, user_id, driver_id, pickup_location, 
                           destination, ride_type, estimated_fare, status, created_at, is_demo) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime("now"), 1)`);
    
    stmt.run([bookingId, userId, driverId, pickup, destination, rideType, estimatedFare], function(err) {
      stmt.finalize();
      db.close();
      if (err) reject(err);
      else resolve({ 
        id: this.lastID, 
        bookingId, 
        userId, 
        driverId, 
        pickup, 
        destination, 
        rideType,
        estimatedFare,
        status: 'confirmed' 
      });
    });
  });
}

function updateRideStatus(bookingId, status, additionalData = {}) {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    let query = 'UPDATE rides SET status = ?, updated_at = datetime("now")';
    let params = [status];
    
    if (additionalData.actualFare) {
      query += ', actual_fare = ?';
      params.push(additionalData.actualFare);
    }
    
    if (additionalData.completedAt) {
      query += ', completed_at = ?';
      params.push(additionalData.completedAt);
    }
    
    query += ' WHERE booking_id = ?';
    params.push(bookingId);
    
    const stmt = db.prepare(query);
    stmt.run(params, (err) => {
      stmt.finalize();
      db.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

// Initialize enhanced database for demo
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        name TEXT,
        created_at TEXT,
        last_active TEXT,
        demo_user INTEGER DEFAULT 1
      )`,
      `CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        state TEXT DEFAULT 'greeting',
        data TEXT,
        updated_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id),
        UNIQUE(user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS rides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        booking_id TEXT UNIQUE NOT NULL,
        user_id INTEGER,
        driver_id INTEGER,
        pickup_location TEXT,
        destination TEXT,
        ride_type TEXT,
        estimated_fare INTEGER,
        actual_fare INTEGER,
        status TEXT DEFAULT 'pending',
        created_at TEXT,
        updated_at TEXT,
        completed_at TEXT,
        is_demo INTEGER DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (driver_id) REFERENCES drivers (id)
      )`,
      `CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        vehicle TEXT,
        vehicle_number TEXT,
        ride_type TEXT DEFAULT 'economy',
        rating REAL DEFAULT 5.0,
        total_trips INTEGER DEFAULT 0,
        available BOOLEAN DEFAULT 1,
        location TEXT,
        created_at TEXT
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
          insertMockDrivers(db, resolve, reject);
        }
      });
    });
  });
}

function insertMockDrivers(db, resolve, reject) {
  db.get('SELECT COUNT(*) as count FROM drivers', (err, result) => {
    if (err || result.count > 0) {
      db.close();
      resolve();
      return;
    }

    const drivers = [
      // Economy drivers - Popular Lagos areas
      ['John Doe', '+234701234567', 'Toyota Corolla', 'LAG-123-AB', 'economy', 4.8, 245, 1, 'Lagos Island'],
      ['Jane Smith', '+234702345678', 'Honda Civic', 'LAG-456-CD', 'economy', 4.9, 189, 1, 'Victoria Island'],
      ['Mike Johnson', '+234703456789', 'Nissan Sentra', 'LAG-789-EF', 'economy', 4.7, 312, 1, 'Ikeja'],
      ['Sarah Wilson', '+234704567890', 'Toyota Vitz', 'LAG-012-GH', 'economy', 4.6, 167, 1, 'Lekki'],
      ['Ahmed Hassan', '+234705678901', 'Hyundai Accent', 'LAG-345-IJ', 'economy', 4.8, 203, 1, 'Ikoyi'],
      
      // Comfort drivers
      ['David Brown', '+234706789012', 'Toyota Camry', 'LAG-678-KL', 'comfort', 4.8, 198, 1, 'Surulere'],
      ['Grace Adebayo', '+234707890123', 'Honda Accord', 'LAG-901-MN', 'comfort', 4.9, 234, 1, 'Yaba'],
      ['Samuel Okafor', '+234708901234', 'Hyundai Sonata', 'LAG-234-OP', 'comfort', 4.7, 156, 1, 'Gbagada'],
      ['Fatima Hassan', '+234709012345', 'Toyota Avalon', 'LAG-567-QR', 'comfort', 4.8, 203, 1, 'Apapa'],
      ['Peter Eze', '+234710123456', 'Nissan Altima', 'LAG-890-ST', 'comfort', 4.7, 178, 1, 'Maryland'],
      
      // Premium drivers
      ['Ahmed Bello', '+234711234567', 'Mercedes C-Class', 'LAG-123-UV', 'premium', 4.9, 145, 1, 'Ikoyi'],
      ['Olumide Peters', '+234712345678', 'BMW 3 Series', 'LAG-456-WX', 'premium', 4.8, 178, 1, 'VI'],
      ['Chioma Okeke', '+234713456789', 'Audi A4', 'LAG-789-YZ', 'premium', 4.9, 134, 1, 'Lekki Phase 1'],
      ['Emeka Nwankwo', '+234714567890', 'Lexus ES', 'LAG-012-AA', 'premium', 4.8, 156, 1, 'Banana Island'],
      ['Kemi Adebayo', '+234715678901', 'Mercedes E-Class', 'LAG-345-BB', 'premium', 4.9, 167, 1, 'Ikoyi']
    ];

    let insertCompleted = 0;
    drivers.forEach(driver => {
      const stmt = db.prepare(`INSERT INTO drivers (name, phone, vehicle, vehicle_number, ride_type, 
                              rating, total_trips, available, location, created_at) 
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))`);
      stmt.run(driver, (err) => {
        stmt.finalize();
        insertCompleted++;
        if (insertCompleted === drivers.length) {
          db.close();
          resolve();
        }
      });
    });
  });
}

// Utility functions
function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
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

function generateBookingId() {
  const prefix = 'FC';
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 4);
  return `${prefix}${timestamp}${random}`.toUpperCase();
}

function parseRideRequest(message) {
  const patterns = [
    /(?:ride|book)\s+(?:from\s+)?(.+?)\s+to\s+(.+)/i,
    /(.+?)\s+to\s+(.+)/i
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return {
        pickup: SECURITY.sanitizeInput(match[1]),
        destination: SECURITY.sanitizeInput(match[2])
      };
    }
  }
  return null;
}

function calculateFare(rideType, distance, duration) {
  const type = RIDE_TYPES[rideType];
  if (!type) return 0;
  
  const baseFare = type.baseFare;
  const distanceFare = distance * type.perKmRate;
  const timeFare = duration * type.perMinuteRate;
  
  return Math.round(baseFare + distanceFare + timeFare);
}

function generateRideOptions(pickup, destination) {
  const distance = Math.floor(Math.random() * 20) + 5; // 5-25 km
  const baseDuration = Math.floor(distance * 2.5) + Math.floor(Math.random() * 10);
  
  let options = '';
  let optionData = {};
  
  Object.keys(RIDE_TYPES).forEach((key, index) => {
    const rideType = RIDE_TYPES[key];
    const fare = calculateFare(key, distance, baseDuration);
    const eta = Math.floor(Math.random() * (rideType.eta.max - rideType.eta.min)) + rideType.eta.min;
    const duration = baseDuration + (index * 5);
    
    // Convert to demo timings (seconds instead of minutes)
    const demoEta = DEMO_CONFIG.fastSimulation ? Math.floor(eta / 6) : eta; // 10 seconds instead of 1 minute
    const demoDuration = DEMO_CONFIG.fastSimulation ? Math.floor(duration / 3) : duration;
    
    options += `*${index + 1}. ${rideType.icon} ${rideType.name}*\n`;
    options += `   💰 ₦${fare.toLocaleString()}\n`;
    if (DEMO_CONFIG.fastSimulation) {
      options += `   ⏱️ ${demoEta}s pickup • ${demoDuration}s trip *(Demo Mode)*\n`;
    } else {
      options += `   ⏱️ ${eta} min pickup • ${duration} min trip\n`;
    }
    options += `   📝 ${rideType.description}\n\n`;
    
    optionData[index + 1] = {
      type: key,
      fare,
      eta: demoEta,
      duration: demoDuration,
      distance
    };
  });
  
  return { options, optionData };
}

function generateTrackingLink(bookingId) {
  return `https://fast-cab-website.vercel.app/track/${bookingId}`;
}

// Enhanced WhatsApp messaging
async function sendWhatsAppMessage(to, message) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log('⚠️ Twilio credentials not configured');
      return { success: false, error: 'No credentials' };
    }

    if (message.length > 1600) {
      message = message.substring(0, 1600) + '...';
    }

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER || 'whatsapp:+14155238886',
      to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
    });

    console.log(`✅ Message sent: ${result.sid}`);
    return { success: true, sid: result.sid };
  } catch (error) {
    console.error('❌ Message send error:', error);
    return { success: false, error: error.message };
  }
}

// Demo simulation function - Fast-paced for public testing
async function startDemoSimulation(bookingId, userPhone, driverName, vehicle, vehicleNumber, eta, pickup) {
  try {
    const phone = userPhone.replace('whatsapp:', '');
    
    // Driver arriving notification (fast demo timing)
    setTimeout(async () => {
      try {
        await updateRideStatus(bookingId, 'driver_arrived');
        const arrivalMessage = `🚗 *Driver Arrived!* *(Demo)*\n\n` +
                             `${driverName} is at your pickup location\n` +
                             `📍 ${pickup}\n` +
                             `🚗 ${vehicle} (${vehicleNumber})\n\n` +
                             `🎭 *This is a simulation for demo purposes*`;
        await sendWhatsAppMessage(`whatsapp:${phone}`, arrivalMessage);
        
        // Trip start (5 seconds after arrival)
        setTimeout(async () => {
          await updateRideStatus(bookingId, 'trip_started');
          const tripStartMessage = `🚀 *Trip Started!* *(Demo)*\n\n` +
                                 `📍 Live tracking: ${generateTrackingLink(bookingId)}\n` +
                                 `⏱️ Demo trip duration: ~15 seconds\n\n` +
                                 `🛡️ *Safety features active*\n` +
                                 `🎭 *Simulation in progress...*`;
          await sendWhatsAppMessage(`whatsapp:${phone}`, tripStartMessage);
          
          // Trip completion (15 seconds after start)
          setTimeout(async () => {
            const completionTime = new Date().toISOString();
            const actualFare = Math.floor(Math.random() * 200) + 800;
            
            await updateRideStatus(bookingId, 'completed', { 
              actualFare, 
              completedAt: completionTime 
            });
            
            const completionMessage = `🎉 *Trip Completed!* *(Demo)*\n\n` +
                                    `Thank you for testing Fast Cab! 🚖\n\n` +
                                    `📋 *Demo Trip Summary*\n` +
                                    `🆔 Booking: ${bookingId}\n` +
                                    `💰 Fare: ₦${actualFare.toLocaleString()}\n\n` +
                                    `✨ *What did you think?*\n` +
                                    `• Professional booking flow?\n` +
                                    `• Clear ride options?\n` +
                                    `• Realistic driver experience?\n\n` +
                                    `💬 Type *"book"* to try another ride!\n` +
                                    `🔄 Or share your feedback with us!`;
            
            await sendWhatsAppMessage(`whatsapp:${phone}`, completionMessage);
            
            // Auto-reset to main menu after 5 seconds
            setTimeout(async () => {
              const resetMessage = `🚖 *Ready for Another Ride?*\n\n` +
                                 `1️⃣ Book another ride\n` +
                                 `2️⃣ Share feedback\n` +
                                 `3️⃣ Learn about Fast Cab\n\n` +
                                 `💬 Or type: "ride from [pickup] to [destination]"`;
              await sendWhatsAppMessage(`whatsapp:${phone}`, resetMessage);
              
              // Reset user state to main_menu
              const userObj = await getUser(phone);
              if (userObj) {
                await updateConversationState(userObj.id, 'main_menu', '{}');
              }
            }, 5000);
            
          }, 15000); // 15 seconds trip
        }, 5000); // 5 seconds after arrival
      } catch (error) {
        console.error('Error in demo simulation:', error);
      }
    }, eta * 1000); // Use the calculated ETA in milliseconds
    
  } catch (error) {
    console.error('Error starting demo simulation:', error);
  }
}

// Main conversation handler optimized for demo
async function handleWhatsAppMessage(from, body) {
  try {
    if (!from || !body) {
      throw new Error('Missing required parameters');
    }
    
    if (body.length > SECURITY.maxMessageLength) {
      await sendWhatsAppMessage(from, '❌ Message too long. Please keep messages under 500 characters.');
      return { success: false, error: 'Message too long' };
    }

    console.log(`📨 Processing: ${from} -> "${body}"`);

    await initializeDatabase();

    const phoneNumber = from.replace('whatsapp:', '');
    const message = SECURITY.sanitizeInput(body);
    
    // Get or create user
    let user = await getUser(phoneNumber);
    if (!user) {
      user = await createUser(phoneNumber);
      console.log(`👤 New demo user: ${phoneNumber}`);
    }

    const conversation = await getConversationState(user.id);
    const currentState = conversation.state || 'greeting';
    const conversationData = conversation.data ? JSON.parse(conversation.data) : {};
    
    console.log(`💬 State: ${currentState}`, conversationData);

    let response = '';
    let newState = currentState;
    let newData = conversationData;

    // Enhanced conversation flow for demo
    switch (currentState) {
      case 'greeting':
        if (/^(hi|hello|hey|start|book|ride|test|demo)/i.test(message)) {
          response = `🚖 *Welcome to Fast Cab Demo!*\n\n` +
                    `🎭 *This is a live simulation* for testing our ride-hailing platform!\n\n` +
                    `✨ *Try our instant booking:*\n` +
                    `📱 Type: *"ride from [pickup] to [destination]"*\n\n` +
                    `🌟 *Popular Lagos routes:*\n` +
                    `• "ride from Ikoyi to VI"\n` +
                    `• "ride from Lekki to Ikeja"\n` +
                    `• "ride from Lagos Island to Maryland"\n\n` +
                    `*Or choose an option:*\n` +
                    `1️⃣ Book a ride\n` +
                    `2️⃣ See demo features\n` +
                    `3️⃣ About Fast Cab\n\n` +
                    `⚡ *Everything happens in seconds for demo!*`;
          newState = 'main_menu';
        } else {
          response = `🚖 *Welcome to Fast Cab Demo!*\n\n` +
                    `🎭 This is a live simulation of our ride-hailing platform.\n\n` +
                    `To get started, say *"Hi"* or *"Test"* 👋`;
        }
        break;

      case 'main_menu':
        const rideRequest = parseRideRequest(message);
        
        if (rideRequest) {
          const { options, optionData } = generateRideOptions(rideRequest.pickup, rideRequest.destination);
          
          response = `🚗 *Available Rides* *(Demo)*\n\n` +
                    `📍 *From:* ${rideRequest.pickup}\n` +
                    `📍 *To:* ${rideRequest.destination}\n\n` +
                    `${options}` +
                    `⚡ *Demo Mode:* Times are in seconds for fast testing!\n\n` +
                    `💬 *Reply 1, 2, or 3 to select your ride*`;
                    
          newState = 'selecting_ride_type';
          newData = {
            pickup: rideRequest.pickup,
            destination: rideRequest.destination,
            rideOptions: optionData
          };
        } else if (/^[1-3]$/.test(message)) {
          switch (message) {
            case '1':
              response = `🚗 *Quick Ride Booking* *(Demo)*\n\n` +
                        `📱 *Instant booking format:*\n` +
                        `"ride from [pickup] to [destination]"\n\n` +
                        `🌟 *Try these Lagos routes:*\n` +
                        `• ride from Ikoyi to VI\n` +
                        `• ride from Lekki to Ikeja\n` +
                        `• ride from Lagos Island to Maryland\n` +
                        `• ride from Surulere to Yaba\n\n` +
                        `💬 *Type your pickup and destination now!*`;
              newState = 'awaiting_booking';
        } else {
          response = `❓ *Try one of these:*\n\n` +
                    `📱 "ride from Ikoyi to VI"\n` +
                    `🔢 Reply 1, 2, or 3\n` +
                    `📖 "about" for more info\n\n` +
                    `💡 *Tip:* Use real Lagos locations for best demo experience!`;
        }
        break;

      case 'awaiting_booking':
        const bookingRequest = parseRideRequest(message);
        
        if (message === '0' || /menu/i.test(message)) {
          response = `🚖 *Back to Demo Menu*\n\n` +
                    `1️⃣ Book a ride\n` +
                    `2️⃣ See demo features\n` +
                    `3️⃣ About Fast Cab\n\n` +
                    `💬 *Or type: "ride from [pickup] to [destination]"*`;
          newState = 'main_menu';
          newData = {};
        } else if (bookingRequest) {
          const { options, optionData } = generateRideOptions(bookingRequest.pickup, bookingRequest.destination);
          
          response = `🚗 *Available Demo Rides*\n\n` +
                    `📍 *From:* ${bookingRequest.pickup}\n` +
                    `📍 *To:* ${bookingRequest.destination}\n\n` +
                    `${options}` +
                    `⚡ *Demo speeds: Pickup in seconds, not minutes!*\n\n` +
                    `💬 *Reply 1, 2, or 3 to select*`;
                    
          newState = 'selecting_ride_type';
          newData = {
            pickup: bookingRequest.pickup,
            destination: bookingRequest.destination,
            rideOptions: optionData
          };
        } else {
          response = `📍 *Please use this format:*\n\n` +
                    `📱 "ride from [pickup] to [destination]"\n\n` +
                    `🌟 *Lagos examples:*\n` +
                    `• ride from Ikoyi to Victoria Island\n` +
                    `• ride from Lekki to Ikeja\n` +
                    `• ride from Lagos Island to Maryland\n\n` +
                    `💬 *Try again or type "menu"*`;
        }
        break;

      case 'selecting_ride_type':
        if (message === '0' || /menu/i.test(message)) {
          response = `🚖 *Back to Demo Menu*\n\n` +
                    `1️⃣ Book a ride\n` +
                    `2️⃣ See demo features\n` +
                    `3️⃣ About Fast Cab\n\n` +
                    `💬 *Or type: "ride from [pickup] to [destination]"*`;
          newState = 'main_menu';
          newData = {};
        } else if (/^[1-3]$/.test(message)) {
          const selectedOption = newData.rideOptions[message];
          
          if (selectedOption) {
            // Find available driver for demo
            const drivers = await getAvailableDrivers(selectedOption.type, newData.pickup);
            
            if (drivers.length === 0) {
              response = `😔 *No ${RIDE_TYPES[selectedOption.type].name} drivers* *(Demo Issue)*\n\n` +
                        `This shouldn't happen in demo mode!\n` +
                        `Our mock drivers might be busy. 😄\n\n` +
                        `💬 Reply *1* to try again or *menu* to go back`;
              newState = 'no_drivers';
            } else {
              const selectedDriver = drivers[Math.floor(Math.random() * drivers.length)]; // Random driver for variety
              
              response = `✅ *Demo Ride Confirmed!*\n\n` +
                        `🚗 *${RIDE_TYPES[selectedOption.type].name}* - ₦${selectedOption.fare.toLocaleString()}\n` +
                        `📍 From: ${newData.pickup}\n` +
                        `📍 To: ${newData.destination}\n\n` +
                        `👨‍✈️ *Your Demo Driver*\n` +
                        `📛 ${selectedDriver.name}\n` +
                        `🚗 ${selectedDriver.vehicle} (${selectedDriver.vehicle_number})\n` +
                        `⭐ ${selectedDriver.rating}/5 • ${selectedDriver.total_trips} trips\n` +
                        `📱 ${selectedDriver.phone}\n\n` +
                        `⚡ *Demo Mode:* Arriving in ${selectedOption.eta} seconds!\n\n` +
                        `🎭 *Watch the magic happen...*`;
                        
              // Create demo ride
              const ride = await createRide(user.id, selectedDriver.id, newData.pickup, 
                                         newData.destination, selectedOption.type, selectedOption.fare);
              
              newState = 'driver_assigned';
              newData = {
                bookingId: ride.bookingId,
                driverId: selectedDriver.id,
                driverName: selectedDriver.name,
                driverPhone: selectedDriver.phone,
                vehicle: selectedDriver.vehicle,
                vehicleNumber: selectedDriver.vehicle_number,
                eta: selectedOption.eta,
                fare: selectedOption.fare,
                pickup: newData.pickup,
                destination: newData.destination
              };
              
              // Start the demo simulation
              await startDemoSimulation(
                ride.bookingId,
                from,
                selectedDriver.name,
                selectedDriver.vehicle,
                selectedDriver.vehicle_number,
                selectedOption.eta,
                newData.pickup
              );
            }
          }
        } else {
          response = `❓ *Please select a ride:*\n\n` +
                    `💬 Reply *1*, *2*, or *3*\n` +
                    `📱 Or type *menu* to go back`;
        }
        break;

      case 'driver_assigned':
        if (/track/i.test(message)) {
          const trackingLink = generateTrackingLink(newData.bookingId);
          response = `📍 *Demo Tracking Link*\n\n` +
                    `🆔 Booking: ${newData.bookingId}\n` +
                    `🔗 Live tracking: ${trackingLink}\n\n` +
                    `🎭 *Note:* This is a demo link for simulation\n` +
                    `📱 In production, this would show real-time GPS tracking!`;
        } else if (/menu/i.test(message)) {
          response = `🚗 *Demo ride is active!*\n\n` +
                    `Driver: ${newData.driverName}\n` +
                    `Vehicle: ${newData.vehicle} (${newData.vehicleNumber})\n` +
                    `Status: En route (demo simulation)\n\n` +
                    `💬 Type *track* for tracking link`;
        } else if (/^(book|another|new)/i.test(message)) {
          response = `🚗 *Your current demo ride is still active!*\n\n` +
                    `Driver: ${newData.driverName} is coming to pick you up.\n\n` +
                    `⏳ Please wait for the demo to complete, then you can book another ride!\n\n` +
                    `💬 Type *track* to see tracking info`;
        } else {
          response = `🚗 *Your demo ride is confirmed!*\n\n` +
                    `Driver: ${newData.driverName}\n` +
                    `ETA: ${newData.eta} seconds (demo time)\n\n` +
                    `💬 Type *track* for live updates or just wait for notifications! 🎭`;
        }
        break;

      case 'trip_completed':
      case 'demo_complete':
        if (/^(book|ride|another|new)/i.test(message)) {
          response = `🚗 *Ready for Another Demo Ride?*\n\n` +
                    `📱 *Quick booking:* "ride from [pickup] to [destination]"\n\n` +
                    `🌟 *Try different routes:*\n` +
                    `• Different ride types (Economy/Comfort/Premium)\n` +
                    `• Various Lagos locations\n` +
                    `• Experience the full flow again!\n\n` +
                    `💬 *What route would you like to try?*`;
          newState = 'awaiting_booking';
          newData = {};
        } else if (/^[1-5]$/.test(message)) {
          // Rating received
          response = `⭐ *Thanks for rating ${message}/5 stars!*\n\n` +
                    `🎉 Your feedback helps improve our demo!\n\n` +
                    `🚖 *Ready for another ride?*\n` +
                    `📱 Type: "ride from [pickup] to [destination]"\n\n` +
                    `💬 Or type *feedback* to share detailed thoughts`;
          newState = 'main_menu';
          newData = {};
        } else if (/feedback/i.test(message)) {
          response = `💭 *We'd love your feedback!*\n\n` +
                    `✨ *What did you think of:*\n` +
                    `• The booking flow?\n` +
                    `• Ride type selection?\n` +
                    `• Driver details & communication?\n` +
                    `• Overall user experience?\n\n` +
                    `🚀 *This demo helps us build the best ride-hailing service for Lagos!*\n\n` +
                    `💬 Share your thoughts or type *book* for another ride!`;
        } else {
          response = `🎉 *Demo completed successfully!*\n\n` +
                    `💬 *What's next?*\n` +
                    `📱 Type *book* for another demo ride\n` +
                    `⭐ Rate your experience (1-5)\n` +
                    `💭 Type *feedback* to share thoughts\n` +
                    `📖 Type *about* to learn more`;
          newState = 'main_menu';
          newData = {};
        }
        break;

      case 'no_drivers':
        if (message === '1') {
          response = `🚗 *Let's try the demo again!*\n\n` +
                    `📱 *Format:* "ride from [pickup] to [destination]"\n\n` +
                    `🌟 *Popular routes:*\n` +
                    `• ride from Ikoyi to VI\n` +
                    `• ride from Lekki to Ikeja\n\n` +
                    `💬 *Type your route!*`;
          newState = 'awaiting_booking';
          newData = {};
        } else if (/menu/i.test(message) || message === '0') {
          response = `🚖 *Demo Menu*\n\n` +
                    `1️⃣ Book a ride\n` +
                    `2️⃣ See demo features\n` +
                    `3️⃣ About Fast Cab\n\n` +
                    `💬 *Or type: "ride from [pickup] to [destination]"*`;
          newState = 'main_menu';
          newData = {};
        } else {
          response = `💬 Reply *1* to try booking again or *menu* for main options`;
        }
        break;

      default:
        response = `🚖 *Welcome back to Fast Cab Demo!*\n\n` +
                  `🎭 *This is a live simulation* of our ride platform\n\n` +
                  `📱 *Quick booking:* "ride from [pickup] to [destination]"\n\n` +
                  `*Popular test routes:*\n` +
                  `• ride from Ikoyi to VI\n` +
                  `• ride from Lekki to Ikeja\n` +
                  `• ride from Lagos Island to Maryland\n\n` +
                  `💬 *Try it now!*`;
        newState = 'main_menu';
        newData = {};
        break;
    }

    // Update conversation state
    await updateConversationState(user.id, newState, JSON.stringify(newData));
    console.log(`✅ State updated: ${user.id} -> ${newState}`);

    // Send response
    const messageResult = await sendWhatsAppMessage(from, response);
    
    return { 
      success: true, 
      response, 
      newState, 
      messageResult 
    };

  } catch (error) {
    console.error('❌ Error in handleWhatsAppMessage:', error);
    
    const errorResponse = `😔 *Demo temporarily unavailable*\n\n` +
                         `Please try again in a moment.\n\n` +
                         `💬 Type *Hi* to restart or contact us for support`;
    await sendWhatsAppMessage(from, errorResponse);
    
    return { 
      success: false, 
      error: 'Internal processing error' 
    };
  }
}

// Enhanced webhook handler for demo
module.exports = async (req, res) => {
  const startTime = Date.now();
  const requestId = crypto.randomBytes(8).toString('hex');
  
  console.log(`📥 [${requestId}] ${req.method} ${req.url} - ${new Date().toISOString()}`);

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Access-Control-Allow-Origin', 'https://fast-cab-website.vercel.app');

  // Health check with demo info
  if (req.method === 'GET') {
    const healthCheck = {
      status: 'healthy',
      service: 'Fast Cab Demo Bot',
      version: '2.0.0-demo',
      mode: 'simulation',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      demo: {
        simulationMode: DEMO_CONFIG.simulationMode,
        fastSimulation: DEMO_CONFIG.fastSimulation,
        driverArrivalTime: `${DEMO_CONFIG.driverArrivalTime/1000}s`,
        tripDuration: `${DEMO_CONFIG.tripDuration/1000}s`,
        maxUsersPerHour: DEMO_CONFIG.maxUsersPerHour
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: process.memoryUsage(),
        hasTwilioSid: !!process.env.TWILIO_ACCOUNT_SID,
        hasTwilioToken: !!process.env.TWILIO_AUTH_TOKEN,
        hasTwilioPhone: !!process.env.TWILIO_PHONE_NUMBER
      },
      features: {
        rideTypes: Object.keys(RIDE_TYPES),
        demoDrivers: 15,
        securityEnabled: true,
        databaseInitialized: true,
        multiUserSupport: true
      },
      instructions: {
        testCommands: [
          "Hi - Start the demo",
          "ride from Ikoyi to VI - Quick booking",
          "book - Manual booking flow",
          "about - Learn about Fast Cab"
        ],
        whatsappNumber: "+1 415 523 8886",
        joinCode: "join cap-pleasure"
      }
    };
    
    return res.status(200).json(healthCheck);
  }

  // Handle WhatsApp webhooks
  if (req.method === 'POST') {
    try {
      const body = parseBody(req.body);
      console.log(`📨 [${requestId}] Demo webhook:`, {
        From: body.From,
        Body: body.Body ? `"${body.Body.substring(0, 50)}..."` : 'undefined',
        MessageSid: body.MessageSid
      });

      const { From, Body, MessageSid } = body;

      if (!From || !Body) {
        console.log(`⚠️ [${requestId}] Missing required fields`);
        return res.status(200).json({ 
          success: false, 
          error: 'Missing required fields',
          requestId 
        });
      }

      if (!From.startsWith('whatsapp:+')) {
        console.log(`⚠️ [${requestId}] Invalid phone format: ${From}`);
        return res.status(200).json({ 
          success: false, 
          error: 'Invalid phone format',
          requestId 
        });
      }

      // Process the demo message
      const result = await handleWhatsAppMessage(From, Body);
      
      const processingTime = Date.now() - startTime;
      console.log(`✅ [${requestId}] Demo processed in ${processingTime}ms`);
      
      return res.status(200).json({ 
        success: true, 
        processed: result.success,
        mode: 'demo',
        processingTime,
        requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ [${requestId}] Demo error (${processingTime}ms):`, error);
      
      return res.status(200).json({ 
        success: false, 
        error: 'Internal processing error',
        mode: 'demo',
        processingTime,
        requestId,
        timestamp: new Date().toISOString()
      });
    }
  }

  console.log(`❌ [${requestId}] Method ${req.method} not allowed`);
  return res.status(405).json({ 
    error: 'Method not allowed',
    allowed: ['GET', 'POST'],
    requestId
  });
};_booking';
              break;
            case '2':
              response = `✨ *Fast Cab Demo Features*\n\n` +
                        `🚗 *3 Ride Types:* Economy, Comfort, Premium\n` +
                        `💰 *Real-time Pricing:* Dynamic fare calculation\n` +
                        `👨‍✈️ *Driver Profiles:* Name, rating, vehicle details\n` +
                        `📍 *Live Tracking:* Shareable trip links\n` +
                        `⚡ *Instant Booking:* One message to book\n` +
                        `🛡️ *Safety Features:* Emergency contacts\n\n` +
                        `🎭 *Demo speeds up everything for testing!*\n\n` +
                        `💬 Try: "ride from Ikoyi to VI"`;
              break;
            case '3':
              response = `🚖 *About Fast Cab*\n\n` +
                        `🌟 Lagos' next-generation ride-hailing platform\n\n` +
                        `✨ *What makes us different:*\n` +
                        `• WhatsApp-first booking (no app needed)\n` +
                        `• Transparent, upfront pricing\n` +
                        `• Professional driver network\n` +
                        `• Multiple ride categories\n` +
                        `• Real-time tracking & updates\n\n` +
                        `🚀 *Currently in development*\n` +
                        `📱 This is our MVP demo for validation\n\n` +
                        `💬 Ready to test? Type "book ride"!`;
              break;
          }
        } else if (message === '0' || /menu/i.test(message)) {
          response = `🚖 *Fast Cab Demo Menu*\n\n` +
                    `1️⃣ Book a ride\n` +
                    `2️⃣ See demo features\n` +
                    `3️⃣ About Fast Cab\n\n` +
                    `💬 *Or type: "ride from [pickup] to [destination]"*`;
        } else if (/^(book|test|try)/i.test(message)) {
          response = `🚗 *Let's Book Your Demo Ride!*\n\n` +
                    `📱 *Format:* "ride from [pickup] to [destination]"\n\n` +
                    `🌟 *Popular test routes:*\n` +
                    `• ride from Ikoyi to VI\n` +
                    `• ride from Lekki to Ikeja\n` +
                    `• ride from Lagos Island to Maryland\n\n` +
                    `💬 *Type your route now!*`;
          newState = 'awaiting_booking';
        }