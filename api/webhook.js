const twilio = require('twilio');
const crypto = require('crypto');

// Database functions (inline for serverless)
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Security and validation utilities
const SECURITY = {
  maxMessageLength: 500,
  rateLimitWindow: 60000, // 1 minute
  maxRequestsPerWindow: 20,
  allowedStates: ['greeting', 'main_menu', 'awaiting_booking', 'selecting_ride_type', 'confirming_booking', 'waiting_for_driver', 'driver_assigned', 'driver_arriving', 'trip_started', 'trip_completed'],
  sanitizeInput: (input) => {
    return input.replace(/[<>\"'&]/g, '').trim().slice(0, 100);
  }
};

// Industry standard ride types with realistic pricing for Lagos
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

// Database connection with connection pooling
function getDbConnection() {
  const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/fastcab.db' : path.join(process.cwd(), 'fastcab.db');
  return new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
}

// Enhanced database functions with error handling
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
    const stmt = db.prepare('INSERT INTO users (phone, name, created_at) VALUES (?, ?, datetime("now"))');
    stmt.run([phone, name], function(err) {
      stmt.finalize();
      db.close();
      if (err) reject(err);
      else resolve({ id: this.lastID, phone, name });
    });
  });
}

function updateConversationState(userId, state, data = null) {
  return new Promise((resolve, reject) => {
    // Validate state
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
                           destination, ride_type, estimated_fare, status, created_at) 
                           VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime("now"))`);
    
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

// Initialize enhanced database with ride types
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const db = getDbConnection();
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE NOT NULL,
        name TEXT,
        created_at TEXT,
        last_active TEXT
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
      // Economy drivers
      ['John Doe', '+234701234567', 'Toyota Corolla', 'LAG-123-AB', 'economy', 4.8, 245, 1, 'Lagos Island'],
      ['Jane Smith', '+234702345678', 'Honda Civic', 'LAG-456-CD', 'economy', 4.9, 189, 1, 'Victoria Island'],
      ['Mike Johnson', '+234703456789', 'Nissan Sentra', 'LAG-789-EF', 'economy', 4.7, 312, 1, 'Ikeja'],
      ['Sarah Wilson', '+234704567890', 'Toyota Vitz', 'LAG-012-GH', 'economy', 4.6, 167, 1, 'Lekki'],
      
      // Comfort drivers
      ['David Brown', '+234705678901', 'Toyota Camry', 'LAG-345-IJ', 'comfort', 4.8, 198, 1, 'Surulere'],
      ['Grace Adebayo', '+234706789012', 'Honda Accord', 'LAG-678-KL', 'comfort', 4.9, 234, 1, 'Yaba'],
      ['Samuel Okafor', '+234707890123', 'Hyundai Sonata', 'LAG-901-MN', 'comfort', 4.7, 156, 1, 'Gbagada'],
      ['Fatima Hassan', '+234708901234', 'Toyota Avalon', 'LAG-234-OP', 'comfort', 4.8, 203, 1, 'Apapa'],
      
      // Premium drivers
      ['Ahmed Bello', '+234709012345', 'Mercedes C-Class', 'LAG-567-QR', 'premium', 4.9, 145, 1, 'Ikoyi'],
      ['Olumide Peters', '+234710123456', 'BMW 3 Series', 'LAG-890-ST', 'premium', 4.8, 178, 1, 'VI'],
      ['Chioma Okeke', '+234711234567', 'Audi A4', 'LAG-123-UV', 'premium', 4.9, 134, 1, 'Lekki Phase 1']
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
  // Parse messages like "ride from ikoyi to vi" or "book ride lagos island to lekki"
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
  // Simulate distance and duration calculation
  const distance = Math.floor(Math.random() * 20) + 5; // 5-25 km
  const baseDuration = Math.floor(distance * 2.5) + Math.floor(Math.random() * 10); // Realistic Lagos traffic
  
  let options = '';
  let optionData = {};
  
  Object.keys(RIDE_TYPES).forEach((key, index) => {
    const rideType = RIDE_TYPES[key];
    const fare = calculateFare(key, distance, baseDuration);
    const eta = Math.floor(Math.random() * (rideType.eta.max - rideType.eta.min)) + rideType.eta.min;
    const duration = baseDuration + (index * 5); // Premium rides may take longer routes
    
    options += `*${index + 1}. ${rideType.icon} ${rideType.name}*\n`;
    options += `   💰 ₦${fare.toLocaleString()}\n`;
    options += `   ⏱️ ${eta} min pickup • ${duration} min trip\n`;
    options += `   📝 ${rideType.description}\n\n`;
    
    optionData[index + 1] = {
      type: key,
      fare,
      eta,
      duration,
      distance
    };
  });
  
  return { options, optionData };
}

function generateTrackingLink(bookingId) {
  return `https://fast-cab-website.vercel.app/track/${bookingId}`;
}

// Enhanced WhatsApp messaging with retry logic
async function sendWhatsAppMessage(to, message) {
  try {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      console.log('⚠️ Twilio credentials not configured');
      return { success: false, error: 'No credentials' };
    }

    // Validate message length
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

// Main conversation handler with industry best practices
async function handleWhatsAppMessage(from, body) {
  try {
    // Security validations
    if (!from || !body) {
      throw new Error('Missing required parameters');
    }
    
    if (body.length > SECURITY.maxMessageLength) {
      await sendWhatsAppMessage(from, '❌ Message too long. Please keep messages under 500 characters.');
      return { success: false, error: 'Message too long' };
    }

    console.log(`📨 Processing: ${from} -> "${body}"`);

    // Initialize database
    await initializeDatabase();

    const phoneNumber = from.replace('whatsapp:', '');
    const message = SECURITY.sanitizeInput(body);
    
    // Get or create user
    let user = await getUser(phoneNumber);
    if (!user) {
      user = await createUser(phoneNumber);
      console.log(`👤 New user: ${phoneNumber}`);
    }

    // Get conversation state
    const conversation = await getConversationState(user.id);
    const currentState = conversation.state || 'greeting';
    const conversationData = conversation.data ? JSON.parse(conversation.data) : {};
    
    console.log(`💬 State: ${currentState}`, conversationData);

    let response = '';
    let newState = currentState;
    let newData = conversationData;

    // Enhanced conversation flow
    switch (currentState) {
      case 'greeting':
        if (/^(hi|hello|hey|start|book|ride)/i.test(message)) {
          response = `🚖 *Welcome to Fast Cab*\n\n` +
                    `Lagos' most reliable ride-hailing service! 🌟\n\n` +
                    `*Quick Booking:*\n` +
                    `📱 Type: *"ride from [pickup] to [destination]"*\n` +
                    `Example: "ride from Ikoyi to VI"\n\n` +
                    `*Or choose an option:*\n` +
                    `1️⃣ Book a ride\n` +
                    `2️⃣ Track my ride\n` +
                    `3️⃣ My trips\n` +
                    `4️⃣ Support\n\n` +
                    `💬 *What would you like to do?*`;
          newState = 'main_menu';
        } else {
          response = `🚖 *Welcome to Fast Cab!*\n\nTo get started, say *"Hi"* or *"Book ride"* 👋`;
        }
        break;

      case 'main_menu':
        // Check for direct ride booking format
        const rideRequest = parseRideRequest(message);
        
        if (rideRequest) {
          const { options, optionData } = generateRideOptions(rideRequest.pickup, rideRequest.destination);
          
          response = `🚗 *Available Rides*\n\n` +
                    `📍 *From:* ${rideRequest.pickup}\n` +
                    `📍 *To:* ${rideRequest.destination}\n\n` +
                    `${options}` +
                    `💬 *Reply 1, 2, or 3 to select your ride*\n` +
                    `📱 Or type *0* for main menu`;
                    
          newState = 'selecting_ride_type';
          newData = {
            pickup: rideRequest.pickup,
            destination: rideRequest.destination,
            rideOptions: optionData
          };
        } else if (/^[1-4]$/.test(message)) {
          switch (message) {
            case '1':
              response = `🚗 *Book Your Ride*\n\n` +
                        `📱 *Quick booking format:*\n` +
                        `"ride from [pickup] to [destination]"\n\n` +
                        `*Examples:*\n` +
                        `• ride from Lagos Island to VI\n` +
                        `• book ride Ikoyi to Lekki\n` +
                        `• Ikeja to Maryland\n\n` +
                        `💬 *Type your pickup and destination*`;
              newState = 'awaiting_booking';
              break;
            case '2':
              response = `🔍 *Track Your Ride*\n\n` +
                        `No active rides found.\n\n` +
                        `Once you book a ride, you can track it here! 📍\n\n` +
                        `💬 Reply *0* for main menu`;
              break;
            case '3':
              response = `📋 *Your Trip History*\n\n` +
                        `No completed trips yet.\n\n` +
                        `Your ride history will appear here after your first trip! 🚗\n\n` +
                        `💬 Reply *0* for main menu`;
              break;
            case '4':
              response = `📞 *Fast Cab Support*\n\n` +
                        `🕐 *Available 24/7*\n\n` +
                        `📞 Call: +234-800-FAST-CAB\n` +
                        `📧 Email: support@fastcab.ng\n` +
                        `💬 WhatsApp: This number\n\n` +
                        `⚡ *Average response: 90 seconds*\n\n` +
                        `💬 Reply *0* for main menu`;
              break;
          }
        } else if (message === '0') {
          response = `🚖 *Fast Cab Main Menu*\n\n` +
                    `1️⃣ Book a ride\n` +
                    `2️⃣ Track my ride\n` +
                    `3️⃣ My trips\n` +
                    `4️⃣ Support\n\n` +
                    `💬 *Or type: "ride from [pickup] to [destination]"*`;
        } else {
          response = `❓ *Invalid option*\n\n` +
                    `📱 Type: "ride from [pickup] to [destination]"\n` +
                    `🔢 Or reply 1, 2, 3, or 4\n\n` +
                    `💡 Example: "ride from Ikoyi to VI"`;
        }
        break;

      case 'awaiting_booking':
        const bookingRequest = parseRideRequest(message);
        
        if (message === '0') {
          response = `🚖 *Back to Main Menu*\n\n` +
                    `1️⃣ Book a ride\n2️⃣ Track my ride\n3️⃣ My trips\n4️⃣ Support\n\n` +
                    `💬 *Or type: "ride from [pickup] to [destination]"*`;
          newState = 'main_menu';
          newData = {};
        } else if (bookingRequest) {
          const { options, optionData } = generateRideOptions(bookingRequest.pickup, bookingRequest.destination);
          
          response = `🚗 *Available Rides*\n\n` +
                    `📍 *From:* ${bookingRequest.pickup}\n` +
                    `📍 *To:* ${bookingRequest.destination}\n\n` +
                    `${options}` +
                    `💬 *Reply 1, 2, or 3 to select*\n` +
                    `📱 Or type *0* for main menu`;
                    
          newState = 'selecting_ride_type';
          newData = {
            pickup: bookingRequest.pickup,
            destination: bookingRequest.destination,
            rideOptions: optionData
          };
        } else {
          response = `📍 *Please specify pickup and destination*\n\n` +
                    `📱 Format: "ride from [pickup] to [destination]"\n\n` +
                    `*Examples:*\n` +
                    `• ride from Ikoyi to VI\n` +
                    `• Lagos Island to Lekki\n\n` +
                    `💬 Try again or type *0* for menu`;
        }
        break;

      case 'selecting_ride_type':
        if (message === '0') {
          response = `🚖 *Back to Main Menu*\n\n` +
                    `1️⃣ Book a ride\n2️⃣ Track my ride\n3️⃣ My trips\n4️⃣ Support\n\n` +
                    `💬 *Or type: "ride from [pickup] to [destination]"*`;
          newState = 'main_menu';
          newData = {};
        } else if (/^[1-3]$/.test(message)) {
          const selectedOption = newData.rideOptions[message];
          
          if (selectedOption) {
            // Find available driver for selected ride type
            const drivers = await getAvailableDrivers(selectedOption.type, newData.pickup);
            
            if (drivers.length === 0) {
              response = `😔 *No ${RIDE_TYPES[selectedOption.type].name} drivers available*\n\n` +
                        `Try a different ride type or try again in 2-3 minutes.\n\n` +
                        `⏰ *Peak hours:* 7-9 AM, 5-8 PM\n\n` +
                        `💬 Reply *1* to try again or *0* for menu`;
              newState = 'no_drivers';
            } else {
              const selectedDriver = drivers[0]; // Get best available driver
              
              response = `✅ *Ride Confirmed!*\n\n` +
                        `🚗 *${RIDE_TYPES[selectedOption.type].name}* - ₦${selectedOption.fare.toLocaleString()}\n` +
                        `📍 From: ${newData.pickup}\n` +
                        `📍 To: ${newData.destination}\n\n` +
                        `👨‍✈️ *Your Driver*\n` +
                        `📛 ${selectedDriver.name}\n` +
                        `🚗 ${selectedDriver.vehicle} (${selectedDriver.vehicle_number})\n` +
                        `⭐ ${selectedDriver.rating}/5 • ${selectedDriver.total_trips} trips\n` +
                        `📱 ${selectedDriver.phone}\n\n` +
                        `⏱️ *Arriving in ${selectedOption.eta} minutes*\n\n` +
                        `🔔 You'll be notified when driver arrives!`;
                        
              // Create ride in database
              const ride = await createRide(user.id, selectedDriver.id, newData.pickup, 
                                         newData.destination, selectedOption.type, selectedOption.fare);
              
              newState = 'driver_assigned';
              newData = {
                bookingId: ride.bookingId,
                driverId: selectedDriver.id,
                driverName: selectedDriver.name,
                driverPhone: selectedDriver.phone,
                vehicle: `${selectedDriver.vehicle} (${selectedDriver.vehicle_number})`,
                eta: selectedOption.eta,
                fare: selectedOption.fare,
                pickup: newData.pickup,
                destination: newData.destination
              };
              
              // Simulate driver arriving after ETA
              setTimeout(async () => {
                try {
                  await updateRideStatus(ride.bookingId, 'driver_arrived');
                  const arrivalMessage = `🚗 *Driver Arrived!*\n\n` +
                                       `${selectedDriver.name} is waiting for you\n` +
                                       `📍 Location: ${newData.pickup}\n` +
                                       `🚗 ${selectedDriver.vehicle} (${selectedDriver.vehicle_number})\n` +
                                       `📱 ${selectedDriver.phone}\n\n` +
                                       `⏰ *Please come out in 2 minutes*`;
                  await sendWhatsAppMessage(from, arrivalMessage);
                } catch (error) {
                  console.error('Error sending arrival notification:', error);
                }
              }, selectedOption.eta * 60 * 1000); // Convert minutes to milliseconds
            }
          }
        } else {
          response = `❓ *Please select a valid option*\n\n` +
                    `💬 Reply *1*, *2*, or *3* to choose your ride\n` +
                    `📱 Or type *0* for main menu`;
        }
        break;

      case 'driver_assigned':
        if (message === '0') {
          response = `🚖 *Your ride is active*\n\n` +
                    `Driver: ${newData.driverName}\n` +
                    `Vehicle: ${newData.vehicle}\n` +
                    `Status: En route to pickup\n\n` +
                    `💬 Type *track* to get tracking link`;
        } else if (/track/i.test(message)) {
          const trackingLink = generateTrackingLink(newData.bookingId);
          response = `📍 *Track Your Ride*\n\n` +
                    `🆔 Booking: ${newData.bookingId}\n` +
                    `🔗 Live tracking: ${trackingLink}\n\n` +
                    `📱 You'll get updates as your trip progresses!`;
        } else {
          response = `🚗 *Your ride is confirmed*\n\n` +
                    `Driver: ${newData.driverName}\n` +
                    `ETA: ${newData.eta} minutes\n\n` +
                    `💬 Type *track* for live updates`;
        }
        break;

      default:
        response = `🚖 *Welcome back to Fast Cab!*\n\n` +
                  `📱 Type: "ride from [pickup] to [destination]"\n\n` +
                  `*Or choose:*\n` +
                  `1️⃣ Book a ride\n` +
                  `2️⃣ Track my ride\n` +
                  `3️⃣ My trips\n` +
                  `4️⃣ Support\n\n` +
                  `💡 Example: "ride from Ikoyi to VI"`;
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
    
    // Security: Don't expose internal errors to users
    const errorResponse = `😔 *Service temporarily unavailable*\n\n` +
                         `Please try again in a moment.\n\n` +
                         `💬 Type *Hi* to restart or contact support`;
    await sendWhatsAppMessage(from, errorResponse);
    
    return { 
      success: false, 
      error: 'Internal processing error' 
    };
  }
}

// Simulate driver actions (for demo purposes)
async function simulateDriverActions(bookingId, userPhone) {
  try {
    // Simulate trip start after driver arrival
    setTimeout(async () => {
      try {
        await updateRideStatus(bookingId, 'trip_started');
        const tripStartMessage = `🚀 *Trip Started!*\n\n` +
                               `Your driver has started the trip to your destination.\n\n` +
                               `📍 Live tracking: ${generateTrackingLink(bookingId)}\n` +
                               `⏱️ ETA: ${Math.floor(Math.random() * 20) + 15} minutes\n\n` +
                               `🛡️ *Safety features active*\n` +
                               `📞 Emergency: Hold power button\n` +
                               `📱 Share trip with contacts`;
        
        await sendWhatsAppMessage(`whatsapp:${userPhone}`, tripStartMessage);
        
        // Simulate trip completion
        setTimeout(async () => {
          const completionTime = new Date().toISOString();
          const actualFare = Math.floor(Math.random() * 500) + 800; // Vary fare slightly
          
          await updateRideStatus(bookingId, 'completed', { 
            actualFare, 
            completedAt: completionTime 
          });
          
          const completionMessage = `🎉 *Trip Completed!*\n\n` +
                                  `Thank you for choosing Fast Cab! 🚖\n\n` +
                                  `📋 *Trip Summary*\n` +
                                  `🆔 Booking: ${bookingId}\n` +
                                  `💰 Fare: ₦${actualFare.toLocaleString()}\n` +
                                  `⭐ Rate your driver to help improve our service\n\n` +
                                  `💬 Reply with 1-5 stars or type *book* for another ride`;
          
          await sendWhatsAppMessage(`whatsapp:${userPhone}`, completionMessage);
        }, 15 * 60 * 1000); // 15 minutes trip duration
        
      } catch (error) {
        console.error('Error in trip start simulation:', error);
      }
    }, 3 * 60 * 1000); // 3 minutes after driver arrival
    
  } catch (error) {
    console.error('Error in driver simulation:', error);
  }
}

// Enhanced webhook handler with security and compliance
module.exports = async (req, res) => {
  const startTime = Date.now();
  const requestId = crypto.randomBytes(8).toString('hex');
  
  console.log(`📥 [${requestId}] ${req.method} ${req.url} - ${new Date().toISOString()}`);

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Health check endpoint
  if (req.method === 'GET') {
    const healthCheck = {
      status: 'healthy',
      service: 'Fast Cab WhatsApp Bot',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
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
        securityEnabled: true,
        databaseInitialized: true
      }
    };
    
    return res.status(200).json(healthCheck);
  }

  // Handle WhatsApp webhooks
  if (req.method === 'POST') {
    try {
      // Parse and validate request body
      const body = parseBody(req.body);
      console.log(`📨 [${requestId}] Webhook payload:`, {
        From: body.From,
        Body: body.Body ? `"${body.Body.substring(0, 50)}..."` : 'undefined',
        MessageSid: body.MessageSid
      });

      const { From, Body, MessageSid } = body;

      // Validate required fields
      if (!From || !Body) {
        console.log(`⚠️ [${requestId}] Missing required fields`);
        return res.status(200).json({ 
          success: false, 
          error: 'Missing required fields',
          requestId 
        });
      }

      // Validate phone number format
      if (!From.startsWith('whatsapp:+')) {
        console.log(`⚠️ [${requestId}] Invalid phone number format: ${From}`);
        return res.status(200).json({ 
          success: false, 
          error: 'Invalid phone format',
          requestId 
        });
      }

      // Process the WhatsApp message
      const result = await handleWhatsAppMessage(From, Body);
      
      const processingTime = Date.now() - startTime;
      console.log(`✅ [${requestId}] Processed in ${processingTime}ms`);
      
      // Always return 200 to Twilio to prevent retries
      return res.status(200).json({ 
        success: true, 
        processed: result.success,
        processingTime,
        requestId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ [${requestId}] Webhook error (${processingTime}ms):`, error);
      
      // Still return 200 to prevent Twilio retries
      return res.status(200).json({ 
        success: false, 
        error: 'Internal processing error',
        processingTime,
        requestId,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Method not allowed
  console.log(`❌ [${requestId}] Method ${req.method} not allowed`);
  return res.status(405).json({ 
    error: 'Method not allowed',
    allowed: ['GET', 'POST'],
    requestId
  });
};