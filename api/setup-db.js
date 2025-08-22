const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database in project root
const dbPath = path.join(process.cwd(), 'fastcab.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
    process.exit(1);
  }
  console.log('📁 Connected to SQLite database at:', dbPath);
});

// Create tables
const createTables = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT UNIQUE NOT NULL,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) {
          console.error('❌ Error creating users table:', err);
          reject(err);
          return;
        }
        console.log('✅ Users table created');
      });

      // Conversations table
      db.run(`CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT NOT NULL,
        state TEXT DEFAULT 'welcome',
        data TEXT DEFAULT '{}',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (phone_number) REFERENCES users (phone_number)
      )`, (err) => {
        if (err) {
          console.error('❌ Error creating conversations table:', err);
          reject(err);
          return;
        }
        console.log('✅ Conversations table created');
      });

      // Rides table
      db.run(`CREATE TABLE IF NOT EXISTS rides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone_number TEXT NOT NULL,
        pickup_location TEXT,
        destination TEXT,
        ride_type TEXT,
        driver_name TEXT,
        driver_phone TEXT,
        fare INTEGER,
        status TEXT DEFAULT 'requested',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (phone_number) REFERENCES users (phone_number)
      )`, (err) => {
        if (err) {
          console.error('❌ Error creating rides table:', err);
          reject(err);
          return;
        }
        console.log('✅ Rides table created');
      });

      // Drivers table (mock data for MVP)
      db.run(`CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        vehicle_type TEXT,
        plate_number TEXT,
        rating REAL DEFAULT 5.0,
        status TEXT DEFAULT 'available'
      )`, (err) => {
        if (err) {
          console.error('❌ Error creating drivers table:', err);
          reject(err);
          return;
        }
        console.log('✅ Drivers table created');
        
        // Insert mock drivers for testing
        insertMockDrivers();
      });
    });

    setTimeout(() => {
      resolve();
    }, 1000);
  });
};

// Insert mock drivers for MVP testing
const insertMockDrivers = () => {
  const mockDrivers = [
    {
      name: 'Kemi Adebayo',
      phone: '08011234567',
      vehicle_type: 'Toyota Corolla',
      plate_number: 'LAG-123-AB',
      rating: 4.8
    },
    {
      name: 'Ahmed Suleiman',
      phone: '08023456789',
      vehicle_type: 'Honda Accord',
      plate_number: 'LAG-456-CD',
      rating: 4.9
    },
    {
      name: 'David Okafor',
      phone: '08034567890',
      vehicle_type: 'Mercedes C-Class',
      plate_number: 'LAG-789-EF',
      rating: 5.0
    },
    {
      name: 'Fatima Hassan',
      phone: '08045678901',
      vehicle_type: 'Toyota Camry',
      plate_number: 'LAG-012-GH',
      rating: 4.7
    },
    {
      name: 'Emeka Okonkwo',
      phone: '08056789012',
      vehicle_type: 'Hyundai Elantra',
      plate_number: 'LAG-345-IJ',
      rating: 4.9
    }
  ];

  // Check if drivers already exist
  db.get("SELECT COUNT(*) as count FROM drivers", (err, row) => {
    if (err) {
      console.error('❌ Error checking drivers:', err);
      return;
    }

    if (row.count === 0) {
      console.log('📝 Inserting mock drivers...');
      
      const stmt = db.prepare(`INSERT INTO drivers (name, phone, vehicle_type, plate_number, rating) 
                               VALUES (?, ?, ?, ?, ?)`);
      
      mockDrivers.forEach(driver => {
        stmt.run([driver.name, driver.phone, driver.vehicle_type, driver.plate_number, driver.rating]);
      });
      
      stmt.finalize((err) => {
        if (err) {
          console.error('❌ Error inserting drivers:', err);
        } else {
          console.log(`✅ ${mockDrivers.length} mock drivers inserted`);
        }
      });
    } else {
      console.log('✅ Drivers already exist in database');
    }
  });
};

// Initialize database
createTables()
  .then(() => {
    console.log('🎉 Database initialized successfully!');
    console.log('📊 Tables: users, conversations, rides, drivers');
    console.log('🚗 Mock drivers ready for testing');
    
    db.close((err) => {
      if (err) {
        console.error('❌ Error closing database:', err.message);
        process.exit(1);
      }
      console.log('✅ Database connection closed');
      process.exit(0);
    });
  })
  .catch((err) => {
    console.error('❌ Database initialization failed:', err);
    process.exit(1);
  });