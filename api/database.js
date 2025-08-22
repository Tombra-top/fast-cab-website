const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database path
const dbPath = path.join(process.cwd(), 'fastcab.db');

// Get database connection
const getDb = () => {
  return new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('❌ Database connection error:', err.message);
    }
  });
};

// Save or update user
const saveUser = (phoneNumber, name = null) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.run(
      `INSERT OR REPLACE INTO users (phone_number, name) VALUES (?, ?)`,
      [phoneNumber, name],
      function(err) {
        if (err) {
          console.error('❌ Error saving user:', err);
          reject(err);
        } else {
          console.log(`✅ User saved: ${phoneNumber}`);
          resolve(this.lastID);
        }
        db.close();
      }
    );
  });
};

// Get conversation state
const getConversation = (phoneNumber) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.get(
      `SELECT * FROM conversations WHERE phone_number = ? ORDER BY updated_at DESC LIMIT 1`,
      [phoneNumber],
      (err, row) => {
        if (err) {
          console.error('❌ Error getting conversation:', err);
          reject(err);
        } else {
          resolve(row);
        }
        db.close();
      }
    );
  });
};

// Update conversation state
const updateConversation = (phoneNumber, state, data = '{}') => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    // First, try to update existing conversation
    db.run(
      `UPDATE conversations SET state = ?, data = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE phone_number = ?`,
      [state, data, phoneNumber],
      function(err) {
        if (err) {
          console.error('❌ Error updating conversation:', err);
          reject(err);
          db.close();
          return;
        }
        
        // If no rows were updated, insert a new conversation
        if (this.changes === 0) {
          db.run(
            `INSERT INTO conversations (phone_number, state, data) VALUES (?, ?, ?)`,
            [phoneNumber, state, data],
            function(err) {
              if (err) {
                console.error('❌ Error inserting conversation:', err);
                reject(err);
              } else {
                console.log(`✅ Conversation created: ${phoneNumber} -> ${state}`);
                resolve(this.lastID);
              }
              db.close();
            }
          );
        } else {
          console.log(`✅ Conversation updated: ${phoneNumber} -> ${state}`);
          resolve(this.lastID);
          db.close();
        }
      }
    );
  });
};

// Save ride
const saveRide = (rideData) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    const {
      phone_number,
      pickup_location,
      destination,
      ride_type,
      driver_name,
      driver_phone,
      fare,
      status = 'requested'
    } = rideData;
    
    db.run(
      `INSERT INTO rides (phone_number, pickup_location, destination, ride_type, driver_name, driver_phone, fare, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [phone_number, pickup_location, destination, ride_type, driver_name, driver_phone, fare, status],
      function(err) {
        if (err) {
          console.error('❌ Error saving ride:', err);
          reject(err);
        } else {
          console.log(`✅ Ride saved: ${ride_type} for ${phone_number}`);
          resolve(this.lastID);
        }
        db.close();
      }
    );
  });
};

// Get ride by phone number
const getRide = (phoneNumber, status = null) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    let query = `SELECT * FROM rides WHERE phone_number = ?`;
    let params = [phoneNumber];
    
    if (status) {
      query += ` AND status = ?`;
      params.push(status);
    }
    
    query += ` ORDER BY created_at DESC LIMIT 1`;
    
    db.get(query, params, (err, row) => {
      if (err) {
        console.error('❌ Error getting ride:', err);
        reject(err);
      } else {
        resolve(row);
      }
      db.close();
    });
  });
};

// Update ride status
const updateRideStatus = (rideId, status) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.run(
      `UPDATE rides SET status = ? WHERE id = ?`,
      [status, rideId],
      function(err) {
        if (err) {
          console.error('❌ Error updating ride status:', err);
          reject(err);
        } else {
          console.log(`✅ Ride ${rideId} status updated to: ${status}`);
          resolve(this.changes);
        }
        db.close();
      }
    );
  });
};

// Get all drivers
const getDrivers = () => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    db.all(
      `SELECT * FROM drivers WHERE status = 'available' ORDER BY rating DESC`,
      [],
      (err, rows) => {
        if (err) {
          console.error('❌ Error getting drivers:', err);
          reject(err);
        } else {
          resolve(rows);
        }
        db.close();
      }
    );
  });
};

// Export functions
module.exports = {
  saveUser,
  getConversation,
  updateConversation,
  saveRide,
  getRide,
  updateRideStatus,
  getDrivers
};