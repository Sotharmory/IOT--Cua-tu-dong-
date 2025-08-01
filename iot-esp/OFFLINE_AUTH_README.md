# ESP32 Offline Authentication System

This system provides robust offline authentication capabilities for your ESP32-based IoT access control device.

## Features

### 🔐 Authentication Methods
- **PIN Authentication**: Secure PIN-based access
- **NFC Authentication**: RFID/NFC card-based access  
- **Combined Authentication**: Requires both PIN + NFC for maximum security

### 🛡️ Security Features
- **SHA-256 Hash Encryption**: All PINs are stored as secure hashes
- **Failed Attempt Lockout**: System locks after 5 failed attempts for 5 minutes
- **User-Level Lockout**: Individual users can be locked after multiple failures
- **Secure Storage**: All data stored in ESP32's encrypted preferences

### 📡 Hybrid Operation
- **Offline-First**: Primary authentication works without internet
- **Online Fallback**: Falls back to server authentication when offline auth fails
- **Seamless Switching**: Automatically switches between online/offline modes

### 👥 User Management (via Backend/Frontend)
- **Remote User Management**: Add, remove, and modify users via MQTT commands
- **Real-time Status**: Get system status and user information remotely
- **Bulk Operations**: Import/export user data for backup and restore

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Arduino Uno   │    │      ESP32       │    │  Backend/Web    │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ NFC Reader  │ │◄──►│ │ Offline Auth │ │◄──►│ │ Admin Panel │ │
│ │ (MFRC522)   │ │    │ │ Engine       │ │    │ │             │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ Servo Motor │ │    │ │ LCD + Keypad │ │    │ │ MQTT Broker │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └──────────────────┘    └─────────────────┘
        │                        │                        │
        └────────── Serial2 ─────┴──────── WiFi/MQTT ────┘
```

## Quick Start

### 1. Default Setup
- **Default Admin User**: `admin` with PIN `1234`
- **System starts in offline mode** if WiFi connection fails
- **All authentication data** stored locally on ESP32

### 2. Adding Users via MQTT
```json
// Topic: admin/add-user
// Payload format: "name:pin:nfcId:authType"
// Example: "john:5678::1" (PIN only)
// Example: "jane:1234:A1B2C3D4:3" (PIN + NFC required)
```

### 3. Authentication Types
- `1` = PIN only
- `2` = NFC only  
- `3` = PIN + NFC both required

### 4. NFC Enrollment
```json
// Topic: mytopic/activate
// Payload: "enroll:userId" (e.g., "enroll:2")
// Then tap NFC card to enroll it to that user
```

## MQTT Commands

### Admin Commands (Backend → ESP32)
| Topic | Payload | Description |
|-------|---------|-------------|
| `admin/add-user` | `name:pin:nfcId:authType` | Add new user |
| `admin/remove-user` | `userId` | Remove user by ID |
| `admin/list-users` | (empty) | Get all users (JSON) |
| `admin/system-status` | (empty) | Get system status (JSON) |
| `admin/reset-system` | `CONFIRM_RESET` | Factory reset |
| `mytopic/activate` | `enroll:userId` | Enable NFC enrollment |

### ESP32 Responses
| Topic | Description |
|-------|-------------|
| `admin/response` | JSON responses with status/data |
| `mytopic/pin` | PIN entered (when online) |
| `mytopic/rfid` | NFC card detected (when online) |

## Local Controls

### Keypad Functions
- **Numbers (0-9)**: Enter PIN
- **#**: Submit PIN for authentication
- **\***: Clear PIN input OR show system status (when PIN is empty)

### LCD Display
- **Normal Mode**: Shows "Enter PIN:" or "OFFLINE - PIN:"
- **Authentication**: Shows "Access Granted/Denied" with user name
- **System Status**: Shows user count, failed attempts, lockout time
- **Enrollment**: Shows "Tap NFC card" when in enrollment mode

## Security Considerations

### 🔒 Data Protection
- All PINs stored as SHA-256 hashes (never plaintext)
- User data encrypted in ESP32 flash memory
- Failed attempts tracked per user and globally

### ⚡ Failsafe Operation
- Continues working without internet connection
- Falls back to online authentication if offline fails
- System locks protect against brute force attacks

### 🔄 Recovery Options
- Factory reset via MQTT command
- System unlocks automatically after lockout period
- Manual user management via backend interface

## Technical Details

### Storage Capacity
- **Maximum Users**: 10 users
- **PIN Length**: Up to 8 digits
- **User Name**: Up to 31 characters
- **NFC ID**: Up to 32 characters

### Security Limits
- **Failed Attempts**: 5 attempts before user lockout
- **Global Lockout**: 5 system-wide failures = 5-minute lockout
- **Hash Algorithm**: SHA-256 for PIN security

### Communication
- **ESP32 ↔ Arduino**: Serial2 (9600 baud)
- **ESP32 ↔ Backend**: WiFi + MQTT
- **Data Format**: JSON for structured responses

## Troubleshooting

### Common Issues
1. **"Auth Init Failed"**: ESP32 preferences corruption - try factory reset
2. **"System Locked"**: Too many failed attempts - wait for timeout
3. **"No WiFi!"**: Check credentials, system continues in offline mode
4. **"Add User Failed"**: Maximum users reached or invalid data

### Recovery Procedures
1. **Factory Reset**: Send `CONFIRM_RESET` to `admin/reset-system` topic
2. **User Lockout**: Individual users unlock automatically after successful auth
3. **System Lockout**: Waits 5 minutes then auto-unlocks
4. **Lost Admin Access**: Factory reset creates default admin user

## Integration Examples

### Backend User Management
```javascript
// Add user via MQTT
mqttClient.publish('admin/add-user', 'john:5678::1');

// Get system status
mqttClient.publish('admin/system-status', '');

// Listen for responses
mqttClient.on('message', (topic, message) => {
  if (topic === 'admin/response') {
    const response = JSON.parse(message.toString());
    console.log(response);
  }
});
```

### Frontend Integration
The backend should expose REST APIs that translate to MQTT commands for the frontend to manage users, view status, and handle enrollment.

This system provides a robust, secure, and flexible authentication solution that works reliably both online and offline!
