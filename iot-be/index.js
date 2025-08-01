const express = require('express');
const mqtt = require('mqtt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization'],
  },
});

const PORT = 3000;
const JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
const SALT_ROUNDS = 10;

// MQTT Setup
const mqttClient = mqtt.connect('mqtt://127.0.0.1', {
  username: 'caxtiq',
  password: 'anthithhn1N_',
});

mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  
  // Subscribe to ESP32 responses
  mqttClient.subscribe(['admin/response', 'mytopic/rfid', 'mytopic/pin'], (err) => {
    if (err) {
      console.error('MQTT subscription error:', err);
    } else {
      console.log('Subscribed to ESP32 topics');
    }
  });
});

// Handle MQTT messages from ESP32
mqttClient.on('message', (topic, message) => {
  const payload = message.toString();
  console.log(`MQTT received: ${topic} -> ${payload}`);
  
  if (topic === 'admin/response') {
    try {
      const response = JSON.parse(payload);
      // Update ESP32 status in database
      updateEsp32Status(response);
      // Emit to frontend via Socket.IO
      io.emit('esp32-response', { topic, payload: response });
    } catch (e) {
      // Handle plain text responses
      io.emit('esp32-response', { topic, payload });
    }
  } else if (topic === 'mytopic/rfid') {
    // NFC card detected
    io.emit('nfc-detected', { nfcId: payload, timestamp: Date.now() });
  } else if (topic === 'mytopic/pin') {
    // PIN entered on ESP32
    io.emit('pin-entered', { pin: payload, timestamp: Date.now() });
  }
});

// Helper function to update ESP32 status
const updateEsp32Status = (data) => {
  if (typeof data === 'object' && data.userCount !== undefined) {
    db.run(`
      INSERT OR REPLACE INTO esp32_status (id, last_sync, user_count, failed_attempts, lockout_time, is_online)
      VALUES (1, ?, ?, ?, ?, 1)
    `, [Date.now(), data.userCount || 0, data.failedAttempts || 0, data.lockoutTime || 0]);
  }
};

// SQLite Setup
const db = new sqlite3.Database(path.join(__dirname, 'codes.db'));

const initDB = () => {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS passwords (
        code TEXT PRIMARY KEY,
        type TEXT CHECK(type IN ('static', 'otp')) NOT NULL,
        expires_at INTEGER
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS nfc_cards (
        id TEXT PRIMARY KEY,
        enrolled_at INTEGER
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT,
        code TEXT,
        success INTEGER,
        time INTEGER,
        user_name TEXT,
        user_id INTEGER
      )
    `);

    // New table for ESP32 offline users
    db.run(`
      CREATE TABLE IF NOT EXISTS esp32_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        pin TEXT NOT NULL,
        nfc_id TEXT,
        auth_type INTEGER NOT NULL CHECK(auth_type IN (1, 2, 3)),
        is_active INTEGER DEFAULT 1,
        created_at INTEGER,
        synced_to_esp32 INTEGER DEFAULT 0
      )
    `);

    // ESP32 system status tracking
    db.run(`
      CREATE TABLE IF NOT EXISTS esp32_status (
        id INTEGER PRIMARY KEY,
        last_sync INTEGER,
        user_count INTEGER DEFAULT 0,
        failed_attempts INTEGER DEFAULT 0,
        lockout_time INTEGER DEFAULT 0,
        is_online INTEGER DEFAULT 0
      )
    `);

    // Admin users table
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT DEFAULT 'admin' CHECK(role IN ('admin', 'super_admin')),
        is_active INTEGER DEFAULT 1,
        created_at INTEGER,
        last_login INTEGER
      )
    `);

    // Guest accounts table
    db.run(`
      CREATE TABLE IF NOT EXISTS guest_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        phone TEXT,
        is_active INTEGER DEFAULT 1,
        approval_status TEXT CHECK(approval_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
        approved_by TEXT,
        approved_at INTEGER,
        created_at INTEGER,
        last_login INTEGER,
        email_verified INTEGER DEFAULT 0
      )
    `);

    // NFC card requests from guests
    db.run(`
      CREATE TABLE IF NOT EXISTS nfc_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_id INTEGER NOT NULL,
        reason TEXT NOT NULL,
        requested_at INTEGER,
        expires_at INTEGER,
        status TEXT CHECK(status IN ('pending', 'approved', 'rejected', 'expired')) DEFAULT 'pending',
        admin_notes TEXT,
        approved_by TEXT,
        approved_at INTEGER,
        nfc_card_id TEXT,
        pin_code TEXT,
        access_type TEXT CHECK(access_type IN ('nfc', 'pin')) DEFAULT 'nfc',
        FOREIGN KEY (guest_id) REFERENCES guest_accounts (id)
      )
    `);

    // Migrate existing guest_accounts table to add approval columns if they don't exist
    db.all("PRAGMA table_info(guest_accounts)", [], (err, columns) => {
      if (err) {
        console.error('Error checking table structure:', err);
        return;
      }
      
      const columnNames = columns.map(col => col.name);
      
      // Check and add approval_status column
      if (!columnNames.includes('approval_status')) {
        console.log('Adding approval_status column to guest_accounts...');
        db.run(`ALTER TABLE guest_accounts ADD COLUMN approval_status TEXT CHECK(approval_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending'`, (err) => {
          if (err) console.error('Error adding approval_status column:', err);
          else console.log('✅ approval_status column added successfully');
        });
      }
      
      // Check and add approved_by column
      if (!columnNames.includes('approved_by')) {
        console.log('Adding approved_by column to guest_accounts...');
        db.run(`ALTER TABLE guest_accounts ADD COLUMN approved_by TEXT`, (err) => {
          if (err) console.error('Error adding approved_by column:', err);
          else console.log('✅ approved_by column added successfully');
        });
      }
      
      // Check and add approved_at column
      if (!columnNames.includes('approved_at')) {
        console.log('Adding approved_at column to guest_accounts...');
        db.run(`ALTER TABLE guest_accounts ADD COLUMN approved_at INTEGER`, (err) => {
          if (err) console.error('Error adding approved_at column:', err);
          else console.log('✅ approved_at column added successfully');
        });
      }
      
      // Check and add pin_code column
      if (!columnNames.includes('pin_code')) {
        console.log('Adding pin_code column to guest_accounts...');
        db.run(`ALTER TABLE guest_accounts ADD COLUMN pin_code TEXT UNIQUE`, (err) => {
          if (err) console.error('Error adding pin_code column:', err);
          else console.log('✅ pin_code column added successfully');
        });
      }
    });

    // Migrate nfc_requests table to add new columns
    db.all("PRAGMA table_info(nfc_requests)", [], (err, columns) => {
      if (err) {
        console.error('Error checking nfc_requests table structure:', err);
        return;
      }
      
      const columnNames = columns.map(col => col.name);
      
      // Check and add pin_code column
      if (!columnNames.includes('pin_code')) {
        console.log('Adding pin_code column to nfc_requests...');
        db.run(`ALTER TABLE nfc_requests ADD COLUMN pin_code TEXT`, (err) => {
          if (err) console.error('Error adding pin_code column:', err);
          else console.log('✅ pin_code column added successfully');
        });
      }
      
      // Check and add access_type column
      if (!columnNames.includes('access_type')) {
        console.log('Adding access_type column to nfc_requests...');
        db.run(`ALTER TABLE nfc_requests ADD COLUMN access_type TEXT CHECK(access_type IN ('nfc', 'pin')) DEFAULT 'nfc'`, (err) => {
          if (err) console.error('Error adding access_type column:', err);
          else console.log('✅ access_type column added successfully');
        });
      }
    });

    // Migrate logs table to add user information columns
    db.all("PRAGMA table_info(logs)", [], (err, columns) => {
      if (err) {
        console.error('Error checking logs table structure:', err);
        return;
      }
      
      const columnNames = columns.map(col => col.name);
      
      // Check and add user_name column
      if (!columnNames.includes('user_name')) {
        console.log('Adding user_name column to logs...');
        db.run(`ALTER TABLE logs ADD COLUMN user_name TEXT`, (err) => {
          if (err) console.error('Error adding user_name column:', err);
          else console.log('✅ user_name column added successfully');
        });
      }
      
      // Check and add user_id column
      if (!columnNames.includes('user_id')) {
        console.log('Adding user_id column to logs...');
        db.run(`ALTER TABLE logs ADD COLUMN user_id INTEGER`, (err) => {
          if (err) console.error('Error adding user_id column:', err);
          else console.log('✅ user_id column added successfully');
        });
      }
    });

    // Migrate esp32_users table to add username column
    db.all("PRAGMA table_info(esp32_users)", [], (err, columns) => {
      if (err) {
        console.error('Error checking esp32_users table structure:', err);
        return;
      }
      
      const columnNames = columns.map(col => col.name);
      
      // Check and add username column
      if (!columnNames.includes('username')) {
        console.log('Adding username column to esp32_users...');
        db.run(`ALTER TABLE esp32_users ADD COLUMN username TEXT`, (err) => {
          if (err) console.error('Error adding username column:', err);
          else console.log('✅ username column added successfully');
        });
      }
    });
  });
};

// Seed default admin user
const seedDefaultAdmin = async () => {
  // Check if admin user already exists
  db.get(`SELECT id FROM admin_users WHERE username = ?`, ['admin'], async (err, row) => {
    if (err) {
      console.error('Error checking for admin user:', err);
      return;
    }
    
    if (!row) {
      // Create default admin user
      console.log('Creating default admin user...');
      const passwordHash = await bcrypt.hash('admin', SALT_ROUNDS);
      const createdAt = Date.now();
      
      db.run(`
        INSERT INTO admin_users (username, email, password_hash, full_name, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, ['admin', 'admin@localhost', passwordHash, 'Default Administrator', 'super_admin', createdAt], function(err) {
        if (err) {
          console.error('Error creating default admin user:', err);
        } else {
          console.log('✅ Default admin user created successfully!');
          console.log('   Username: admin');
          console.log('   Password: admin');
          console.log('   ⚠️  Please change the default password in production!');
        }
      });
    } else {
      console.log('Default admin user already exists');
    }
  });
};

initDB();
seedDefaultAdmin();

// Middleware
app.use(express.json());
app.use(cors({ origin: '*' }));

// JWT Token verification middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
};

// Admin authentication middleware (legacy support)
const adminAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  // Legacy admin auth
  if (authHeader === 'meichan-auth') {
    req.user = { type: 'admin', id: 1, username: 'admin' };
    return next();
  }
  
  // JWT-based auth
  verifyToken(req, res, () => {
    if (req.user.type !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
};

// Guest authentication middleware (updated for JWT)
const guestAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header required' });
  }

  // Legacy admin access
  if (authHeader === 'meichan-auth') {
    req.user = { type: 'admin', id: 1, username: 'admin' };
    return next();
  }

  // Legacy guest format: "guest:username:password" - will be deprecated
  if (authHeader.startsWith('guest:')) {
    const [, username, password] = authHeader.split(':');
    if (!username || !password) {
      return res.status(401).json({ error: 'Invalid guest credentials format' });
    }

    db.get(
      `SELECT id, username, full_name, email, password_hash, is_active FROM guest_accounts WHERE username = ?`,
      [username],
      async (err, guest) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (!guest || !guest.is_active) {
          return res.status(401).json({ error: 'Invalid guest credentials' });
        }
        
        // For legacy compatibility, check plain text password
        const isValid = await bcrypt.compare(password, guest.password_hash) || password === guest.password_hash;
        if (!isValid) {
          return res.status(401).json({ error: 'Invalid guest credentials' });
        }
        
        req.user = { 
          type: 'guest', 
          id: guest.id, 
          username: guest.username, 
          full_name: guest.full_name,
          email: guest.email 
        };
        next();
      }
    );
  } else {
    // JWT-based auth
    verifyToken(req, res, (err) => {
      if (err) return err;
      next();
    });
  }
};

// Helper function to format user names as {fullname}({username})
const formatUserName = (fullname, username) => {
  if (!fullname && !username) return null;
  if (!username) return fullname;
  if (!fullname) return username;
  return `${fullname}(${username})`;
};

const logAttempt = (method, code, success, userName = null, userId = null) => {
  const time = Date.now();
  const log = { method, code, success, time, user_name: userName, user_id: userId };
  db.run(
    `INSERT INTO logs (method, code, success, time, user_name, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [method, code, success ? 1 : 0, time, userName, userId],
    () => {
      io.emit('log-update');
      io.emit('new-log', log); // This is what the frontend expects
    }
  );
};


// Routes
app.post('/api/open', adminAuth, (req, res) => {
  mqttClient.publish('mytopic/open', 'open', (err) => {
    if (err) return res.status(500).json({ success: false, message: 'MQTT error' });
    res.json({ success: true, message: 'MQTT open sent' });
  });
});

app.post('/api/unlock', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code or NFC ID required' });

  const now = Date.now();

  // First check if it's an ESP32 user PIN
  db.get(`SELECT * FROM esp32_users WHERE pin = ? AND is_active = 1`, [code], (err, esp32User) => {
    if (err) {
      logAttempt('esp32_pin', code, false, 'Lỗi Hệ Thống', null);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (esp32User) {
      // Found ESP32 user by PIN
      mqttClient.publish('mytopic/open', 'unlock');
      const formattedName = formatUserName(esp32User.name, esp32User.username);
      logAttempt('esp32_pin', code, true, formattedName, esp32User.id);
      res.json({ success: true, method: 'esp32_pin', user: formattedName });
      return;
    }

    // Check if it's an ESP32 user NFC ID
    db.get(`SELECT * FROM esp32_users WHERE nfc_id = ? AND is_active = 1`, [code], (err, esp32NfcUser) => {
      if (err) {
        logAttempt('esp32_nfc', code, false, 'Lỗi Hệ Thống', null);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (esp32NfcUser) {
        // Found ESP32 user by NFC
        mqttClient.publish('mytopic/open', 'unlock');
        const formattedName = formatUserName(esp32NfcUser.name, esp32NfcUser.username);
        logAttempt('esp32_nfc', code, true, formattedName, esp32NfcUser.id);
        res.json({ success: true, method: 'esp32_nfc', user: formattedName });
        return;
      }

      // Check if it's a 6-digit password
      if (/^\d{6}$/.test(code)) {
        db.get(`SELECT * FROM passwords WHERE code = ? AND expires_at > ?`, [code, now], (err, row) => {
          if (err) {
            logAttempt('password', code, false, 'Lỗi Hệ Thống', null);
            return res.status(500).json({ error: 'Database error' });
          }
          if (!row) {
            logAttempt('password', code, false, 'Mã Không Hợp Lệ', null);
            return res.status(401).json({ error: 'Invalid or expired code' });
          }

          if (row.type === 'otp') {
            db.run(`DELETE FROM passwords WHERE code = ?`, [code]);
          }

          mqttClient.publish('mytopic/open', 'unlock');
          logAttempt('password', code, true, 'Quản Trị Viên(admin)', null);
          io.emit('password-update');
          res.json({ success: true, method: 'password', type: row.type });
        });
      } else {
        // Check if it's a valid NFC ID
        db.get(`SELECT * FROM nfc_cards WHERE id = ?`, [code], (err, row) => {
          if (err) {
            logAttempt('nfc', code, false, 'Lỗi Hệ Thống', null);
            return res.status(500).json({ error: 'Database error' });
          }
          if (!row) {
            logAttempt('nfc', code, false, 'Thẻ Không Hợp Lệ', null);
            return res.status(401).json({ error: 'Code not recognized' });
          }

          mqttClient.publish('mytopic/open', 'unlock');
          logAttempt('nfc', code, true, 'Quản Trị Viên NFC(admin)', null);
          res.json({ success: true, method: 'nfc', id: code });
        });
      }
    });
  });
});

app.post('/api/create-code', adminAuth, (req, res) => {
  const { code, ttlSeconds = 300, type = 'otp' } = req.body;
  if (!code || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid 6-digit code' });
  if (!['otp', 'static'].includes(type)) return res.status(400).json({ error: 'Invalid type (otp/static)' });

  const expiresAt = Date.now() + ttlSeconds * 1000;
  db.run(`INSERT OR REPLACE INTO passwords (code, type, expires_at) VALUES (?, ?, ?)`, [code, type, expiresAt], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    io.emit('password-update');
    res.json({ success: true, code, type, expiresAt });
  });
});

app.post('/api/delete-code', adminAuth, (req, res) => {
  const { code } = req.body;
  if (!code || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid code format' });

  db.run(`DELETE FROM passwords WHERE code = ?`, [code], function (err) {
    if (err) return res.status(500).json({ error: 'Failed to delete code' });
    if (this.changes === 0) return res.status(404).json({ error: 'Code not found' });
    io.emit('password-update');
    res.json({ success: true, message: 'Code deleted' });
  });
});

app.post('/api/enroll', adminAuth, (req, res) => {
  const id = req.body?.id;
  if (!id) {
    mqttClient.publish('mytopic/activate', 'enroll');
    return res.json({ success: true, message: 'Tap card on ESP32 to enroll' });
  }

  const enrolledAt = Date.now();
  db.run(`INSERT OR REPLACE INTO nfc_cards (id, enrolled_at) VALUES (?, ?)`, [id, enrolledAt], (err) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    io.emit('nfc-update');
    res.json({ success: true, id, enrolledAt });
  });
});

app.post('/api/disenroll', adminAuth, (req, res) => {
  const { id } = req.body;
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Invalid NFC card ID' });

  db.run(`DELETE FROM nfc_cards WHERE id = ?`, [id], function (err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (this.changes === 0) return res.status(404).json({ error: 'NFC card not found' });
    mqttClient.publish('mytopic/deactivate', id);
    io.emit('nfc-update');
    res.json({ success: true, message: 'NFC card revoked' });
  });
});

app.get('/api/active-passwords', adminAuth, (req, res) => {
  const now = Date.now();
  db.all(`SELECT code, type, expires_at FROM passwords WHERE expires_at > ?`, [now], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/active-nfc-cards', adminAuth, (req, res) => {
  db.all(`SELECT id, enrolled_at FROM nfc_cards`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.get('/api/logs', adminAuth, (req, res) => {
  const { page = 1, limit = 50, sortBy = 'time', sortOrder = 'desc', filterBy, filterValue, startDate, endDate } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  // Validate sortBy parameter
  const allowedSortFields = ['time', 'date', 'user_name', 'method', 'success'];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'time';
  
  // Validate sortOrder parameter
  const order = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  
  // Build WHERE clause for filtering
  let whereClause = '';
  let queryParams = [];
  
  // Handle date range filtering
  if (startDate || endDate) {
    const dateConditions = [];
    
    if (startDate) {
      const startTimestamp = new Date(startDate).getTime();
      dateConditions.push('time >= ?');
      queryParams.push(startTimestamp);
    }
    
    if (endDate) {
      const endTimestamp = new Date(endDate).getTime();
      dateConditions.push('time <= ?');
      queryParams.push(endTimestamp);
    }
    
    whereClause = `WHERE ${dateConditions.join(' AND ')}`;
  }
  
  // Handle other filtering
  if (filterBy && filterValue) {
    const allowedFilterFields = ['method', 'user_name', 'success'];
    if (allowedFilterFields.includes(filterBy)) {
      const filterCondition = filterBy === 'success' 
        ? `${filterBy} = ?` 
        : `${filterBy} LIKE ?`;
      
      if (whereClause) {
        whereClause += ` AND ${filterCondition}`;
      } else {
        whereClause = `WHERE ${filterCondition}`;
      }
      
      if (filterBy === 'success') {
        const successValue = filterValue.toLowerCase() === 'true' ? 1 : 0;
        queryParams.push(successValue);
      } else {
        queryParams.push(`%${filterValue}%`);
      }
    }
  }
  
  // Handle sorting by user_name with null values (put them at the end) or date sorting
  let orderClause;
  if (sortField === 'user_name') {
    orderClause = `ORDER BY ${sortField} IS NULL, ${sortField} ${order}`;
  } else if (sortField === 'date') {
    // Sort by date (YYYY-MM-DD) extracted from timestamp
    orderClause = `ORDER BY DATE(time / 1000, 'unixepoch') ${order}`;
  } else {
    orderClause = `ORDER BY ${sortField} ${order}`;
  }

  // Get total count for pagination
  const countQuery = `SELECT COUNT(*) as total FROM logs ${whereClause}`;
  db.get(countQuery, queryParams, (countErr, countResult) => {
    if (countErr) return res.status(500).json({ error: 'Database error' });
    
    const total = countResult.total;
    const totalPages = Math.ceil(total / Number(limit));
    
    // Get the actual logs
    const dataQuery = `SELECT method, code, success, time, user_name, user_id FROM logs ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
    const dataParams = [...queryParams, limit, offset];
    
    db.all(dataQuery, dataParams, (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({
        logs: rows,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: total,
          totalPages: totalPages,
          sortBy: sortField,
          sortOrder: order.toLowerCase(),
          filterBy: filterBy || null,
          filterValue: filterValue || null,
          startDate: startDate || null,
          endDate: endDate || null
        }
      });
    });
  });
});

// ESP32 User Management Endpoints

// Add user to ESP32
app.post('/api/esp32/add-user', adminAuth, (req, res) => {
  const { name, username, pin, nfcId = '', authType } = req.body;
  
  if (!name || !username || !pin || !authType) {
    return res.status(400).json({ error: 'Name, username, PIN, and auth type are required' });
  }
  
  if (![1, 2, 3].includes(Number(authType))) {
    return res.status(400).json({ error: 'Auth type must be 1 (PIN), 2 (NFC), or 3 (Combined)' });
  }

  const createdAt = Date.now();
  
  // Save to database
  db.run(`
    INSERT INTO esp32_users (name, username, pin, nfc_id, auth_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [name, username, pin, nfcId, authType, createdAt], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Send to ESP32 via MQTT
    const mqttPayload = `${name}:${pin}:${nfcId}:${authType}`;
    mqttClient.publish('admin/add-user', mqttPayload, (mqttErr) => {
      if (mqttErr) {
        console.error('MQTT publish error:', mqttErr);
        return res.status(500).json({ error: 'Failed to sync with ESP32' });
      }
      
      // Mark as synced (will be confirmed by ESP32 response)
      db.run(`UPDATE esp32_users SET synced_to_esp32 = 1 WHERE id = ?`, [this.lastID]);
      
      io.emit('esp32-user-update');
      res.json({ 
        success: true, 
        userId: this.lastID,
        message: 'User added and synced to ESP32'
      });
    });
  });
});

// Remove user from ESP32
app.post('/api/esp32/remove-user', adminAuth, (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  // Get user info first
  db.get(`SELECT * FROM esp32_users WHERE id = ?`, [userId], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Remove from ESP32 via MQTT (using the ESP32's internal user ID would be ideal)
    mqttClient.publish('admin/remove-user', userId.toString(), (mqttErr) => {
      if (mqttErr) {
        console.error('MQTT publish error:', mqttErr);
        return res.status(500).json({ error: 'Failed to sync with ESP32' });
      }

      // Remove from database
      db.run(`DELETE FROM esp32_users WHERE id = ?`, [userId], (dbErr) => {
        if (dbErr) {
          return res.status(500).json({ error: 'Database error' });
        }

        io.emit('esp32-user-update');
        res.json({ 
          success: true, 
          message: `User ${user.name} removed from ESP32`
        });
      });
    });
  });
});

// Assign PIN to existing ESP32 user
app.post('/api/esp32/assign-pin', adminAuth, (req, res) => {
  const { userId, pin } = req.body;
  
  if (!userId || !pin) {
    return res.status(400).json({ error: 'User ID and PIN are required' });
  }
  
  if (!/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-8 digits' });
  }

  // Check if PIN is already in use by another user
  db.get(`SELECT name FROM esp32_users WHERE pin = ? AND id != ? AND is_active = 1`, [pin, userId], (err, existingUser) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (existingUser) {
      return res.status(400).json({ error: `PIN already assigned to ${existingUser.name}` });
    }

    // Get the user to update
    db.get(`SELECT * FROM esp32_users WHERE id = ?`, [userId], (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Update the PIN
      db.run(`UPDATE esp32_users SET pin = ? WHERE id = ?`, [pin, userId], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Send updated user to ESP32 via MQTT
        const mqttPayload = `${user.name}:${pin}:${user.nfc_id || ''}:${user.auth_type}`;
        mqttClient.publish('admin/add-user', mqttPayload, (mqttErr) => {
          if (mqttErr) {
            console.error('MQTT publish error:', mqttErr);
            return res.status(500).json({ error: 'Failed to sync with ESP32' });
          }

          io.emit('esp32-user-update');
          res.json({ 
            success: true, 
            message: `PIN ${pin} assigned to ${user.name}`,
            user: { ...user, pin: pin }
          });
        });
      });
    });
  });
});

// Get all ESP32 users
app.get('/api/esp32/users', adminAuth, (req, res) => {
  db.all(`
    SELECT id, name, username, pin, nfc_id, auth_type, is_active, created_at, synced_to_esp32 
    FROM esp32_users 
    ORDER BY created_at DESC
  `, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Get ESP32 system status
app.get('/api/esp32/status', adminAuth, (req, res) => {
  // Request fresh status from ESP32
  mqttClient.publish('admin/system-status', '', (err) => {
    if (err) {
      console.error('MQTT publish error:', err);
    }
  });

  // Return last known status from database
  db.get(`SELECT * FROM esp32_status WHERE id = 1`, [], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json(row || { 
      last_sync: 0, 
      user_count: 0, 
      failed_attempts: 0, 
      lockout_time: 0, 
      is_online: 0 
    });
  });
});

// List users on ESP32 (request from ESP32)
app.post('/api/esp32/list-users', adminAuth, (req, res) => {
  mqttClient.publish('admin/list-users', '', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to request user list from ESP32' });
    }
    
    res.json({ 
      success: true, 
      message: 'User list requested from ESP32. Check Socket.IO for response.' 
    });
  });
});

// Factory reset ESP32
app.post('/api/esp32/reset', adminAuth, (req, res) => {
  const { confirm } = req.body;
  
  if (confirm !== 'CONFIRM_RESET') {
    return res.status(400).json({ error: 'Must provide confirm: "CONFIRM_RESET"' });
  }

  mqttClient.publish('admin/reset-system', 'CONFIRM_RESET', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to reset ESP32' });
    }

    // Clear local database
    db.run(`DELETE FROM esp32_users`, [], (dbErr) => {
      if (dbErr) {
        console.error('Database clear error:', dbErr);
      }
    });

    db.run(`DELETE FROM esp32_status WHERE id = 1`, [], (dbErr) => {
      if (dbErr) {
        console.error('Status clear error:', dbErr);
      }
    });

    io.emit('esp32-user-update');
    res.json({ 
      success: true, 
      message: 'ESP32 factory reset initiated' 
    });
  });
});

// NFC enrollment endpoint
app.post('/api/esp32/enroll-nfc', adminAuth, (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  // Activate enrollment mode for specific user
  mqttClient.publish('mytopic/activate', `enroll:${userId}`, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to activate enrollment mode' });
    }

    res.json({ 
      success: true, 
      message: `NFC enrollment activated for user ${userId}. Tap card on ESP32.` 
    });
  });
});

// ESP32 User Sync Endpoint (for ESP32 to pull all users)
app.get('/api/users', (req, res) => {
  // Simple auth check for ESP32
  const authHeader = req.headers.authorization;
  if (authHeader !== 'meichan-auth') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Get all active ESP32 users in format ESP32 expects
  db.all(`
    SELECT name, pin, nfc_id, auth_type 
    FROM esp32_users 
    WHERE is_active = 1 
    ORDER BY created_at ASC
  `, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Format response for ESP32 parsing
    const users = rows.map(user => ({
      name: user.name,
      pin: user.pin,
      nfc: user.nfc_id || '',
      authType: user.auth_type
    }));

    res.json({ users });
  });
});

// Trigger ESP32 to scan for NFC card (for guest access approval)
app.post('/api/admin/scan-nfc', adminAuth, (req, res) => {
  const { requestId } = req.body;
  
  // Send command to ESP32 to start scanning mode
  mqttClient.publish('mytopic/activate', 'scan-for-admin', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to activate NFC scanning mode' });
    }

    res.json({ 
      success: true, 
      message: 'NFC scanning activated. Please tap a card on the ESP32.',
      requestId: requestId
    });
  });
});

// ===== AUTHENTICATION SYSTEM =====

// Admin registration (requires existing admin authentication)
app.post('/api/auth/admin/register', verifyToken, async (req, res) => {
  // Only allow existing admins to create new admin accounts
  if (req.user.type !== 'admin') {
    return res.status(403).json({ error: 'Only administrators can create admin accounts' });
  }
  
  const { username, email, password, full_name } = req.body;
  
  if (!username || !email || !password || !full_name) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const createdAt = Date.now();

    db.run(`
      INSERT INTO admin_users (username, email, password_hash, full_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [username, email, passwordHash, full_name, createdAt], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Username or email already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      
      const token = jwt.sign(
        { 
          id: this.lastID, 
          username, 
          email, 
          type: 'admin',
          role: 'admin'
        }, 
        JWT_SECRET, 
        { expiresIn: '24h' }
      );

      res.json({
        success: true,
        message: 'Admin account created successfully',
        user: {
          id: this.lastID,
          username,
          email,
          full_name,
          type: 'admin',
          role: 'admin'
        },
        token
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin login
app.post('/api/auth/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get(`
    SELECT id, username, email, password_hash, full_name, role, is_active 
    FROM admin_users 
    WHERE username = ? OR email = ?
  `, [username, username], async (err, admin) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!admin || !admin.is_active) {
      return res.status(401).json({ error: 'Invalid credentials or account disabled' });
    }

    try {
      const isValidPassword = await bcrypt.compare(password, admin.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Update last login
      db.run('UPDATE admin_users SET last_login = ? WHERE id = ?', [Date.now(), admin.id]);

      const token = jwt.sign(
        { 
          id: admin.id, 
          username: admin.username, 
          email: admin.email, 
          type: 'admin',
          role: admin.role
        }, 
        JWT_SECRET, 
        { expiresIn: '24h' }
      );

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          id: admin.id,
          username: admin.username,
          email: admin.email,
          full_name: admin.full_name,
          type: 'admin',
          role: admin.role
        },
        token
      });
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// Guest registration (updated with password hashing)
app.post('/api/auth/guest/register', async (req, res) => {
  const { username, email, password, full_name, phone } = req.body;
  
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'Username, password, and full name are required' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const createdAt = Date.now();
    
    db.run(`
      INSERT INTO guest_accounts (username, email, password_hash, full_name, phone, created_at, approval_status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `, [username, email, passwordHash, full_name, phone, createdAt], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Username or email already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Don't auto-login, just return success message
      res.json({ 
        success: true, 
        message: 'Registration successful! Your account is pending admin approval. You will be able to log in once approved.',
        requiresApproval: true
      });

      // Notify admins via socket
      io.emit('new-user-registration', {
        id: this.lastID,
        username,
        full_name,
        email,
        registeredAt: createdAt
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Guest login (updated with password hashing)
app.post('/api/auth/guest/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get(`
    SELECT id, username, email, password_hash, full_name, phone, is_active, approval_status 
    FROM guest_accounts 
    WHERE username = ? OR email = ?
  `, [username, username], async (err, guest) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!guest || !guest.is_active) {
      return res.status(401).json({ error: 'Invalid credentials or account disabled' });
    }

    // Check approval status
    if (guest.approval_status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending admin approval. Please wait for approval before logging in.' });
    }
    
    if (guest.approval_status === 'rejected') {
      return res.status(403).json({ error: 'Your account has been rejected by an administrator.' });
    }

    try {
      const isValidPassword = await bcrypt.compare(password, guest.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Update last login
      db.run('UPDATE guest_accounts SET last_login = ? WHERE id = ?', [Date.now(), guest.id]);

      const token = jwt.sign(
        { 
          id: guest.id, 
          username: guest.username, 
          email: guest.email, 
          type: 'guest'
        }, 
        JWT_SECRET, 
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        message: 'Login successful',
        user: {
          id: guest.id,
          username: guest.username,
          email: guest.email,
          full_name: guest.full_name,
          phone: guest.phone,
          type: 'guest'
        },
        token
      });
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// Token verification endpoint
app.post('/api/auth/verify', verifyToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// Refresh token endpoint
app.post('/api/auth/refresh', verifyToken, (req, res) => {
  const newToken = jwt.sign(
    { 
      id: req.user.id, 
      username: req.user.username, 
      email: req.user.email, 
      type: req.user.type,
      role: req.user.role
    }, 
    JWT_SECRET, 
    { expiresIn: req.user.type === 'admin' ? '24h' : '7d' }
  );

  res.json({
    success: true,
    token: newToken
  });
});

// Logout endpoint (client-side token removal)
app.post('/api/auth/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// ===== LEGACY GUEST SYSTEM (for backward compatibility) =====

// Legacy guest registration (will be deprecated)
app.post('/api/guest/register', async (req, res) => {
  const { username, password, full_name, email, phone } = req.body;
  
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'Username, password, and full name are required' });
  }

  const createdAt = Date.now();
  
  db.run(`
    INSERT INTO guest_accounts (username, password, full_name, email, phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [username, password, full_name, email, phone, createdAt], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'Username already exists' });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({ 
      success: true, 
      message: 'Guest account created successfully',
      guestId: this.lastID 
    });
  });
});

// Guest login (returns auth token format)
app.post('/api/guest/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  db.get(`
    SELECT id, username, full_name, email, phone, is_active 
    FROM guest_accounts 
    WHERE username = ? AND password = ?
  `, [username, password], (err, guest) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!guest || !guest.is_active) {
      return res.status(401).json({ error: 'Invalid credentials or account disabled' });
    }

    res.json({
      success: true,
      guest: {
        id: guest.id,
        username: guest.username,
        full_name: guest.full_name,
        email: guest.email,
        phone: guest.phone
      },
      authToken: `guest:${username}:${password}`
    });
  });
});

// Request NFC card (guest endpoint - updated for JWT)
app.post('/api/guest/request-nfc', guestAuth, (req, res) => {
  const { reason, duration_hours = 24 } = req.body;
  
  if (req.user.type !== 'guest' && req.user.type !== 'admin') {
    return res.status(403).json({ error: 'Guest or admin access required' });
  }

  if (!reason) {
    return res.status(400).json({ error: 'Reason is required' });
  }

  const requestedAt = Date.now();
  const expiresAt = requestedAt + (duration_hours * 60 * 60 * 1000);
  const guestId = req.user.type === 'guest' ? req.user.id : req.body.guest_id;

  if (!guestId) {
    return res.status(400).json({ error: 'Guest ID is required for admin requests' });
  }

  db.run(`
    INSERT INTO nfc_requests (guest_id, reason, requested_at, expires_at)
    VALUES (?, ?, ?, ?)
  `, [guestId, reason, requestedAt, expiresAt], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Notify admins via Socket.IO
    io.emit('new-nfc-request', {
      requestId: this.lastID,
      guestName: req.user.full_name || req.user.username,
      reason: reason,
      requestedAt: requestedAt,
      expiresAt: expiresAt
    });

    res.json({ 
      success: true, 
      message: 'NFC card request submitted successfully',
      requestId: this.lastID,
      expiresAt: expiresAt
    });
  });
});

// Get guest's own requests (updated for JWT)
app.get('/api/guest/my-requests', guestAuth, (req, res) => {
  if (req.user.type !== 'guest') {
    return res.status(403).json({ error: 'Guest access required' });
  }

  db.all(`
    SELECT id, reason, requested_at, expires_at, status, admin_notes, 
           approved_by, approved_at, nfc_card_id, pin_code, access_type
    FROM nfc_requests 
    WHERE guest_id = ? 
    ORDER BY requested_at DESC
  `, [req.user.id], (err, requests) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json(requests);
  });
});

// Get guest's own access logs (updated for JWT)
app.get('/api/guest/my-logs', guestAuth, (req, res) => {
  if (req.user.type !== 'guest') {
    return res.status(403).json({ error: 'Guest access required' });
  }

  // Query parameters
  const sortField = req.query.sortBy || 'time';
  const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Number(req.query.limit) || 50, 100); // Limit to 100 max
  const offset = Number(req.query.offset) || 0;

  const allowedSortFields = ['time', 'date', 'method', 'success'];
  const finalSortField = allowedSortFields.includes(sortField) ? sortField : 'time';
  const order = sortOrder.toUpperCase();

  // Build WHERE clause to filter by the guest's username
  const whereClause = `WHERE user_name = ?`;
  const queryParams = [req.user.username];

  // Handle sorting by date sorting
  let orderClause;
  if (finalSortField === 'date') {
    // Sort by date (YYYY-MM-DD) extracted from timestamp
    orderClause = `ORDER BY DATE(time / 1000, 'unixepoch') ${order}`;
  } else {
    orderClause = `ORDER BY ${finalSortField} ${order}`;
  }

  // Get total count for pagination
  const countQuery = `SELECT COUNT(*) as total FROM logs ${whereClause}`;
  db.get(countQuery, queryParams, (countErr, countResult) => {
    if (countErr) return res.status(500).json({ error: 'Database error' });
    
    const total = countResult.total;
    const totalPages = Math.ceil(total / Number(limit));
    
    // Get the actual logs
    const dataQuery = `SELECT method, code, success, time, user_name, user_id FROM logs ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
    const dataParams = [...queryParams, limit, offset];
    
    db.all(dataQuery, dataParams, (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({
        logs: rows,
        pagination: {
          total,
          totalPages,
          currentPage: Math.floor(offset / limit) + 1,
          limit,
          offset
        }
      });
    });
  });
});

// ===== ADMIN GUEST MANAGEMENT =====

// Get all guest accounts
app.get('/api/admin/guests', adminAuth, (req, res) => {
  db.all(`
    SELECT id, username, full_name, email, phone, created_at, is_active, approval_status, approved_by, approved_at, pin_code
    FROM guest_accounts 
    ORDER BY created_at DESC
  `, [], (err, guests) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json(guests);
  });
});

// Get pending user registrations
app.get('/api/admin/guests/pending', adminAuth, (req, res) => {
  db.all(`
    SELECT id, username, full_name, email, phone, created_at
    FROM guest_accounts 
    WHERE approval_status = 'pending'
    ORDER BY created_at ASC
  `, [], (err, pendingUsers) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json(pendingUsers);
  });
});

// Get all NFC requests
app.get('/api/admin/nfc-requests', adminAuth, (req, res) => {
  const { status = 'all' } = req.query;
  
  let query = `
    SELECT nr.*, ga.full_name as guest_name, ga.username, ga.email, ga.phone
    FROM nfc_requests nr
    JOIN guest_accounts ga ON nr.guest_id = ga.id
  `;
  
  let params = [];
  if (status !== 'all') {
    query += ' WHERE nr.status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY nr.requested_at DESC';

  db.all(query, params, (err, requests) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json(requests);
  });
});

// Approve/Reject access request with PIN or NFC options
app.post('/api/admin/nfc-request/:requestId/respond', adminAuth, (req, res) => {
  const { requestId } = req.params;
  const { action, admin_notes, access_type, nfc_card_id, approved_by = 'Admin' } = req.body;
  
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Action must be approve or reject' });
  }

  if (action === 'approve') {
    if (!access_type || !['pin', 'nfc'].includes(access_type)) {
      return res.status(400).json({ error: 'access_type must be "pin" or "nfc" for approval' });
    }
    
    if (access_type === 'nfc' && !nfc_card_id) {
      return res.status(400).json({ error: 'NFC card ID is required when access_type is "nfc"' });
    }
  }

  const approvedAt = Date.now();
  const status = action === 'approve' ? 'approved' : 'rejected';
  
  // Generate 6-digit PIN if access_type is 'pin'
  let pinCode = null;
  if (action === 'approve' && access_type === 'pin') {
    pinCode = Math.floor(100000 + Math.random() * 900000).toString(); // Generate 6-digit PIN
  }

  db.run(`
    UPDATE nfc_requests 
    SET status = ?, admin_notes = ?, approved_by = ?, approved_at = ?, 
        nfc_card_id = ?, pin_code = ?, access_type = ?
    WHERE id = ?
  `, [status, admin_notes, approved_by, approvedAt, nfc_card_id, pinCode, access_type, requestId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    // Handle approval actions based on access type
    if (action === 'approve') {
      if (access_type === 'nfc') {
        // Add NFC card to system
        db.run(`
          INSERT OR REPLACE INTO nfc_cards (id, enrolled_at) 
          VALUES (?, ?)
        `, [nfc_card_id, Date.now()], (enrollErr) => {
          if (enrollErr) {
            console.error('Failed to enroll NFC card:', enrollErr);
          } else {
            mqttClient.publish('mytopic/activate', nfc_card_id);
            io.emit('nfc-update');
          }
        });
      } else if (access_type === 'pin') {
        // Add PIN code to system with expiration based on request
        db.get('SELECT expires_at FROM nfc_requests WHERE id = ?', [requestId], (getErr, request) => {
          if (!getErr && request) {
            db.run(`
              INSERT OR REPLACE INTO passwords (code, type, expires_at) 
              VALUES (?, 'static', ?)
            `, [pinCode, request.expires_at], (pinErr) => {
              if (pinErr) {
                console.error('Failed to create PIN code:', pinErr);
              } else {
                io.emit('password-update');
              }
            });
          }
        });

        // Also add guest PIN to ESP32 offline authentication system
        db.get(`
          SELECT nr.*, ga.full_name as guest_name, ga.username
          FROM nfc_requests nr
          JOIN guest_accounts ga ON nr.guest_id = ga.id
          WHERE nr.id = ?
        `, [requestId], (guestErr, guestRequest) => {
          if (!guestErr && guestRequest) {
            const guestName = guestRequest.guest_name; // Use full name
            const guestUsername = `guest_${guestRequest.username}`; // Create unique username
            
            // Add to ESP32 offline users database
            db.run(`
              INSERT INTO esp32_users (name, username, pin, nfc_id, auth_type, created_at, synced_to_esp32)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [guestName, guestUsername, pinCode, '', 1, Date.now(), 0], function(esp32Err) {
              if (esp32Err) {
                console.error('Failed to add guest PIN to ESP32 users:', esp32Err);
              } else {
                // Send to ESP32 via MQTT for offline authentication
                const mqttPayload = `${guestName}:${pinCode}::1`; // PIN-only auth type
                mqttClient.publish('admin/add-user', mqttPayload, (mqttErr) => {
                  if (mqttErr) {
                    console.error('MQTT publish error for guest PIN:', mqttErr);
                  } else {
                    // Mark as synced to ESP32
                    db.run(`UPDATE esp32_users SET synced_to_esp32 = 1 WHERE id = ?`, [this.lastID]);
                    console.log(`✅ Guest PIN ${pinCode} added to ESP32 offline system for ${guestName}`);
                    io.emit('esp32-user-update');
                  }
                });
              }
            });
          }
        });
      }
    }

    // Get request details for notification
    db.get(`
      SELECT nr.*, ga.full_name as guest_name, ga.username
      FROM nfc_requests nr
      JOIN guest_accounts ga ON nr.guest_id = ga.id
      WHERE nr.id = ?
    `, [requestId], (getErr, request) => {
      if (!getErr && request) {
        io.emit('nfc-request-responded', {
          requestId: requestId,
          status: status,
          guestName: request.guest_name,
          accessType: access_type,
          nfcCardId: nfc_card_id,
          pinCode: pinCode
        });
      }
    });

    res.json({ 
      success: true, 
      message: `Request ${action}d successfully`,
      requestId: requestId,
      status: status,
      accessType: access_type,
      pinCode: pinCode,
      nfcCardId: nfc_card_id
    });
  });
});

// Toggle guest account status
app.post('/api/admin/guests/:guestId/toggle', adminAuth, (req, res) => {
  const { guestId } = req.params;
  
  db.get('SELECT is_active FROM guest_accounts WHERE id = ?', [guestId], (err, guest) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    const newStatus = guest.is_active ? 0 : 1;
    
    db.run('UPDATE guest_accounts SET is_active = ? WHERE id = ?', [newStatus, guestId], function(updateErr) {
      if (updateErr) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json({ 
        success: true, 
        message: `Guest account ${newStatus ? 'activated' : 'deactivated'}`,
        guestId: guestId,
        is_active: newStatus
      });
    });
  });
});

// Approve or reject user registration
app.post('/api/admin/guests/:guestId/approve', adminAuth, (req, res) => {
  const { guestId } = req.params;
  const { action, adminNotes } = req.body; // action: 'approve' or 'reject'
  
  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be "approve" or "reject"' });
  }

  // Get admin info from JWT
  const adminUsername = req.user.username;
  const approvedAt = Date.now();
  
  db.get('SELECT username, full_name, approval_status FROM guest_accounts WHERE id = ?', [guestId], (err, guest) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    if (guest.approval_status !== 'pending') {
      return res.status(400).json({ error: `Guest has already been ${guest.approval_status}` });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    
    db.run(`
      UPDATE guest_accounts 
      SET approval_status = ?, approved_by = ?, approved_at = ?
      WHERE id = ?
    `, [newStatus, adminUsername, approvedAt, guestId], function(updateErr) {
      if (updateErr) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json({ 
        success: true, 
        message: `User ${guest.username} has been ${action}d`,
        guestId: guestId,
        approval_status: newStatus,
        approved_by: adminUsername
      });

      // Notify via socket
      io.emit('user-approval-update', {
        guestId,
        username: guest.username,
        full_name: guest.full_name,
        action: newStatus,
        approved_by: adminUsername,
        approved_at: approvedAt
      });
    });
  });
});

// Delete user account (admin only)
app.delete('/api/admin/guests/:guestId', adminAuth, (req, res) => {
  const { guestId } = req.params;
  
  db.get('SELECT username, full_name FROM guest_accounts WHERE id = ?', [guestId], (err, guest) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    // Delete related NFC requests first (foreign key constraint)
    db.run('DELETE FROM nfc_requests WHERE guest_id = ?', [guestId], (requestErr) => {
      if (requestErr) {
        return res.status(500).json({ error: 'Error deleting related data' });
      }

      // Remove guest's ESP32 entries (if any)
      const guestUsername = `guest_${guest.username}`;
      db.all(`SELECT id FROM esp32_users WHERE username = ?`, [guestUsername], (esp32Err, esp32Users) => {
        if (!esp32Err && esp32Users.length > 0) {
          esp32Users.forEach(esp32User => {
            // Remove from ESP32 via MQTT
            mqttClient.publish('admin/remove-user', esp32User.id.toString(), (mqttErr) => {
              if (!mqttErr) {
                // Remove from local database
                db.run(`DELETE FROM esp32_users WHERE id = ?`, [esp32User.id], (delErr) => {
                  if (!delErr) {
                    console.log(`✅ Guest ESP32 entry removed: ${guestName}`);
                    io.emit('esp32-user-update');
                  }
                });
              }
            });
          });
        }
      });

      // Now delete the guest account
      db.run('DELETE FROM guest_accounts WHERE id = ?', [guestId], function(deleteErr) {
        if (deleteErr) {
          return res.status(500).json({ error: 'Database error' });
        }
        
        res.json({ 
          success: true, 
          message: `User ${guest.username} has been permanently deleted`,
          deletedUser: {
            id: guestId,
            username: guest.username,
            full_name: guest.full_name
          }
        });

        // Notify via socket
        io.emit('user-deleted', {
          guestId,
          username: guest.username,
          full_name: guest.full_name,
          deleted_by: req.user.username,
          deleted_at: Date.now()
        });
      });
    });
  });
});

// Assign PIN code to guest
app.post('/api/admin/guests/:guestId/assign-pin', adminAuth, (req, res) => {
  const guestId = parseInt(req.params.guestId);
  const { pin_code } = req.body;

  if (!pin_code || pin_code.length < 4) {
    return res.status(400).json({ error: 'PIN code must be at least 4 digits' });
  }

  // Check if guest exists
  db.get('SELECT * FROM guest_accounts WHERE id = ?', [guestId], (err, guest) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    // Check if PIN already exists for another user
    db.get('SELECT id, username FROM guest_accounts WHERE pin_code = ? AND id != ?', [pin_code, guestId], (pinErr, existingUser) => {
      if (pinErr) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (existingUser) {
        return res.status(400).json({ error: `PIN code already assigned to user: ${existingUser.username}` });
      }

      // Update guest with PIN code
      db.run(
        'UPDATE guest_accounts SET pin_code = ? WHERE id = ?',
        [pin_code, guestId],
        function(updateErr) {
          if (updateErr) {
            return res.status(500).json({ error: 'Failed to assign PIN code' });
          }

          res.json({
            message: `PIN code assigned successfully to ${guest.username}`,
            guest: {
              id: guestId,
              username: guest.username,
              pin_code: pin_code
            }
          });

          // Notify via socket
          io.emit('pin-assigned', {
            guestId,
            username: guest.username,
            pin_code,
            assigned_by: req.user.username,
            assigned_at: Date.now()
          });
        }
      );
    });
  });
});

// Remove PIN code from guest
app.delete('/api/admin/guests/:guestId/pin', adminAuth, (req, res) => {
  const guestId = parseInt(req.params.guestId);

  // Check if guest exists
  db.get('SELECT * FROM guest_accounts WHERE id = ?', [guestId], (err, guest) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!guest) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    // Remove PIN code
    db.run(
      'UPDATE guest_accounts SET pin_code = NULL WHERE id = ?',
      [guestId],
      function(updateErr) {
        if (updateErr) {
          return res.status(500).json({ error: 'Failed to remove PIN code' });
        }

        res.json({
          message: `PIN code removed successfully from ${guest.username}`,
          guest: {
            id: guestId,
            username: guest.username
          }
        });

        // Notify via socket
        io.emit('pin-removed', {
          guestId,
          username: guest.username,
          removed_by: req.user.username,
          removed_at: Date.now()
        });
      }
    );
  });
});

// Check expired requests and auto-expire them
setInterval(() => {
  const now = Date.now();
  
  // Get expired approved PIN requests before marking them expired
  db.all(`
    SELECT nr.*, ga.username, nr.pin_code
    FROM nfc_requests nr
    JOIN guest_accounts ga ON nr.guest_id = ga.id
    WHERE nr.status = 'approved' AND nr.access_type = 'pin' AND nr.expires_at < ?
  `, [now], (err, expiredPinRequests) => {
    if (!err && expiredPinRequests.length > 0) {
      // Remove expired guest PINs from ESP32 offline system
      expiredPinRequests.forEach(request => {
        const guestUsername = `guest_${request.username}`;
        
        // Find ESP32 user ID and remove from ESP32
        db.get(`SELECT id FROM esp32_users WHERE username = ? AND pin = ?`, [guestUsername, request.pin_code], (findErr, esp32User) => {
          if (!findErr && esp32User) {
            // Remove from ESP32 via MQTT
            mqttClient.publish('admin/remove-user', esp32User.id.toString(), (mqttErr) => {
              if (!mqttErr) {
                // Remove from local database
                db.run(`DELETE FROM esp32_users WHERE id = ?`, [esp32User.id], (delErr) => {
                  if (!delErr) {
                    console.log(`✅ Expired guest PIN removed from ESP32: ${guestName}`);
                    io.emit('esp32-user-update');
                  }
                });
              }
            });
          }
        });
        
        // Also remove from temporary passwords table
        if (request.pin_code) {
          db.run(`DELETE FROM passwords WHERE code = ?`, [request.pin_code]);
        }
      });
    }
  });

  // Mark pending requests as expired
  db.run(`
    UPDATE nfc_requests 
    SET status = 'expired' 
    WHERE status = 'pending' AND expires_at < ?
  `, [now], (err) => {
    if (err) {
      console.error('Error updating expired requests:', err);
    }
  });
}, 60000); // Check every minute

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
