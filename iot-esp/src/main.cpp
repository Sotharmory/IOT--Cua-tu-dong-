#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Keypad.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "EspMQTTClient.h"
#include "offline_auth.h"

// LCD setup
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Keypad setup
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[ROWS] = {13, 12, 14, 27};
byte colPins[COLS] = {26, 25, 33, 32}; 

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

String pinInput = "";
String pendingNfcId = ""; // Store NFC ID for combined authentication
bool waitingForNfc = false; // Flag for combined auth
bool offlineMode = false; // Track if we're in offline mode

// Hardcoded WiFi credentials
const char* wifi_ssid = "HONG SY 4G";
const char* wifi_pass = "22226666";

// Enrollment state
bool enrollment = false;
uint8_t enrollmentUserId = 0;

// MQTT setup
EspMQTTClient client(
  wifi_ssid,
  wifi_pass,
  "165.232.169.151",  // MQTT Broker server ip
  "caxtiq",           // MQTT username
  "anthithhn1N_",     // MQTT password
  "TestClient"        // Client name
);

void showEnterPin() {
  lcd.clear();
  lcd.setCursor(0, 0);
  if (offlineMode) {
    lcd.print("OFFLINE - PIN:");
  } else {
    lcd.print("Enter PIN:");
  }
  lcd.setCursor(0, 1);
  for (int i = 0; i < pinInput.length(); i++) lcd.print("*");
}

void showSystemStatus() {
  lcd.clear();
  lcd.setCursor(0, 0);
  if (offlineAuth.getRemainingLockoutTime() > 0) {
    lcd.print("LOCKED:");
    lcd.setCursor(0, 1);
    uint32_t remaining = offlineAuth.getRemainingLockoutTime() / 1000;
    lcd.print(String(remaining) + "s left");
    return;
  }
  
  lcd.print("Users: " + String(offlineAuth.getUserCount()));
  lcd.setCursor(0, 1);
  lcd.print("Fails: " + String(offlineAuth.getFailedAttempts()));
}

void showWiFiStatus() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi: ");
  switch(WiFi.status()) {
    case WL_CONNECTED:
      lcd.print("OK");
      lcd.setCursor(0, 1);
      lcd.print("RSSI: " + String(WiFi.RSSI()) + "dBm");
      break;
    case WL_NO_SSID_AVAIL:
      lcd.print("NO SSID");
      break;
    case WL_CONNECT_FAILED:
      lcd.print("FAILED");
      break;
    case WL_CONNECTION_LOST:
      lcd.print("LOST");
      break;
    case WL_DISCONNECTED:
      lcd.print("DISC");
      break;
    default:
      lcd.print("ERR:" + String(WiFi.status()));
  }
  Serial.println("WiFi Status: " + String(WiFi.status()));
  Serial.println("WiFi RSSI: " + String(WiFi.RSSI()));
  Serial.println("Offline Mode: " + String(offlineMode ? "YES" : "NO"));
}

bool handleOfflineAuthentication(const String& credential, AuthType authType) {
  AuthResult result;
  
  if (authType == AUTH_PIN) {
    result = offlineAuth.authenticatePin(credential);
  } else if (authType == AUTH_NFC) {
    result = offlineAuth.authenticateNfc(credential);
  }
  
  lcd.clear();
  lcd.setCursor(0, 0);
  
  if (result.success) {
    lcd.print("Access Granted!");
    lcd.setCursor(0, 1);
    OfflineUser user = offlineAuth.getUser(result.userId);
    lcd.print("Welcome " + String(user.name));
    
    // Trigger door unlock
    Serial2.println("SERVO:90");
    delay(3000);
    return true;
  } else {
    lcd.print("Access Denied!");
    lcd.setCursor(0, 1);
    lcd.print(result.message);
    
    if (offlineAuth.getRemainingLockoutTime() > 0) {
      delay(2000);
      showSystemStatus();
      delay(3000);
    } else {
      delay(2000);
    }
    return false;
  }
}

void sendUnlockRequest(const String& code) {
  // Try online authentication first if WiFi is available
  if (WiFi.status() == WL_CONNECTED && !offlineMode) {
    HTTPClient http;
    http.begin("http://165.232.169.151:3000/api/unlock");
    http.addHeader("Authorization", "meichan-auth");
    http.addHeader("Content-Type", "application/json");

    String payload = "{\"code\":\"" + code + "\"}";
    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.println("Unlock Response: " + response);
      lcd.clear();
      lcd.setCursor(0, 0);
      if (response.indexOf("\"success\":true") != -1) {
        lcd.print("Online Access!");
        lcd.setCursor(0, 1);
        lcd.print("Door Opening...");
        Serial2.println("SERVO:90");
        
        // Reset failed attempts on successful online auth
        offlineAuth.resetFailedAttempts();
        
        delay(3000);
        showEnterPin();
        return;
      } else {
        lcd.print("Online Failed!");
        delay(1000);
      }
    } else {
      Serial.println("Unlock POST failed");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("HTTP Error!");
      delay(1000);
    }
    http.end();
  }
  
  // If online fails or not available, try offline authentication
  // But don't count failures if we already tried online (server might be slow)
  AuthResult result = offlineAuth.authenticatePin(code);
  if (result.success) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Offline Access!");
    lcd.setCursor(0, 1);
    OfflineUser user = offlineAuth.getUser(result.userId);
    lcd.print("Welcome " + String(user.name));
    
    // Trigger door unlock
    Serial2.println("SERVO:90");
    delay(3000);
    showEnterPin();
    return;
  }
  
  // Both online and offline failed
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Access Denied!");
  lcd.setCursor(0, 1);
  lcd.print(result.message);
  
  if (offlineAuth.getRemainingLockoutTime() > 0) {
    delay(2000);
    showSystemStatus();
    delay(3000);
  } else {
    delay(2000);
  }
}

void sendNfcUnlockRequest(const String& nfcId) {
  // Try online authentication first if WiFi is available
  if (WiFi.status() == WL_CONNECTED && !offlineMode) {
    HTTPClient http;
    http.begin("http://165.232.169.151:3000/api/unlock");
    http.addHeader("Authorization", "meichan-auth");
    http.addHeader("Content-Type", "application/json");

    String payload = "{\"code\":\"" + nfcId + "\"}";
    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.println("NFC Unlock Response: " + response);
      lcd.clear();
      lcd.setCursor(0, 0);
      if (response.indexOf("\"success\":true") != -1) {
        lcd.print("NFC Access!");
        lcd.setCursor(0, 1);
        lcd.print("Door Opening...");
        Serial2.println("SERVO:90");
        
        // Reset failed attempts on successful online auth
        offlineAuth.resetFailedAttempts();
        
        delay(3000);
        showEnterPin();
        return;
      } else {
        lcd.print("Online NFC Failed!");
        delay(1000);
      }
    } else {
      Serial.println("NFC POST failed");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("HTTP Error!");
      delay(1000);
    }
    http.end();
  }
  
  // If online fails or not available, try offline NFC authentication
  AuthResult result = offlineAuth.authenticateNfc(nfcId);
  if (result.success) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Offline NFC!");
    lcd.setCursor(0, 1);
    OfflineUser user = offlineAuth.getUser(result.userId);
    lcd.print("Welcome " + String(user.name));
    
    // Trigger door unlock
    Serial2.println("SERVO:90");
    delay(3000);
    showEnterPin();
    return;
  }
  
  // Both online and offline failed
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Access Denied!");
  lcd.setCursor(0, 1);
  lcd.print("Unknown NFC Card");
  delay(2000);
}

void syncUsersFromServer() {
  if (WiFi.status() != WL_CONNECTED || offlineMode) {
    Serial.println("[SYNC] No internet connection for sync");
    return;
  }
  
  HTTPClient http;
  http.begin("http://165.232.169.151:3000/api/users");
  http.addHeader("Authorization", "meichan-auth");
  
  int httpResponseCode = http.GET();
  
  if (httpResponseCode == 200) {
    String response = http.getString();
    Serial.println("[SYNC] Users downloaded: " + response);
    
    // Parse JSON and add users to offline storage
    // Format expected: {"users":[{"name":"John","pin":"1234","nfc":"abc123","authType":1},...]}
    
    // Simple parsing (you might want to use ArduinoJson library)
    if (response.indexOf("\"users\":[") > 0) {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Syncing users...");
      
      // TODO: Parse JSON properly and add each user
      // For now, just show sync attempt
      lcd.setCursor(0, 1);
      lcd.print("Downloaded!");
      delay(2000);
    }
  } else {
    Serial.println("[SYNC] Failed to download users: " + String(httpResponseCode));
  }
  
  http.end();
}

void sendEnrollRequest(const String& nfcId) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin("http://165.232.169.151:3000/api/enroll");
    http.addHeader("Authorization", "meichan-auth");
    http.addHeader("Content-Type", "application/json");

    String payload = "{\"id\":\"" + nfcId + "\"}";
    int httpResponseCode = http.POST(payload);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.println("Enroll Response: " + response);
      lcd.clear();
      lcd.setCursor(0, 0);
      if (response.indexOf("\"success\":true") != -1) {
        lcd.print("Enroll success!");
      } else {
        lcd.print("Enroll failed!");
      }
    } else {
      Serial.println("Enroll POST failed");
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Enroll Error!");
    }
    delay(2000);
    http.end();
  } else {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("No WiFi!");
    delay(2000);
  }
}

void setup() {
  Wire.begin(21, 22); // LCD I2C pins
  lcd.init();
  lcd.backlight();

  Serial.begin(115200); // Debug
  Serial2.begin(9600, SERIAL_8N1, 16, 17); // RX2=GPIO16, TX2=GPIO17

  // Initialize offline authentication system
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Initializing...");
  
  if (!offlineAuth.begin()) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Auth Init Failed!");
    delay(3000);
  } else {
    lcd.setCursor(0, 1);
    lcd.print("Auth Ready");
    delay(1000);
  }

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting...");
  lcd.setCursor(0, 1);
  lcd.print(wifi_ssid);
  
  // Configure WiFi for better stability
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
  WiFi.begin(wifi_ssid, wifi_pass);

  unsigned long startAttemptTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Connected!");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP());
    Serial.println();
    Serial.print("WiFi connected! IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal strength: ");
    Serial.println(WiFi.RSSI());
    offlineMode = false;
    delay(2000);
  } else {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Failed!");
    lcd.setCursor(0, 1);
    lcd.print("Offline Mode");
    Serial.println();
    Serial.println("WiFi connection failed!");
    offlineMode = true;
    delay(2000);
  }
  
  showEnterPin();
}

void onConnectionEstablished() {
  offlineMode = false; // We have MQTT connection, so we're online
  
  client.subscribe("mytopic/test", [] (const String &payload)  {
    Serial.println(payload);
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("MQTT msg:");
    lcd.setCursor(0, 1);
    lcd.print(payload.substring(0, 16));
    delay(2000);
    showEnterPin();
  });

  client.subscribe("mytopic/open", [] (const String &payload) {
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Opening...");
    Serial2.println("SERVO:90"); // Command Arduino to move servo
    showEnterPin();
  });

  client.subscribe("auth/nfc-register", [] (const String &payload) {
    // For Arduino NFC writing - payload should be enrollment data
    Serial2.print("WRITE_NFC:");
    Serial2.println(payload);
  });

  client.subscribe("mytopic/activate", [] (const String &payload) {
    Serial.print("Activate payload: ");
    Serial.println(payload);
    if (payload == "enroll") {
      enrollment = true;
      enrollmentUserId = 1; // Default to user 1, can be changed via admin commands
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Enroll mode ON");
      lcd.setCursor(0, 1);
      lcd.print("User ID: " + String(enrollmentUserId));
      delay(2000);
    } else if (payload.startsWith("enroll:")) {
      // Format: "enroll:userId"
      enrollmentUserId = payload.substring(7).toInt();
      enrollment = true;
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Enroll mode ON");
      lcd.setCursor(0, 1);
      lcd.print("User ID: " + String(enrollmentUserId));
      delay(2000);
    }
  });

  // Admin commands for user management (controlled by backend/frontend)
  client.subscribe("admin/add-user", [] (const String &payload) {
    // Format: "name:pin:nfcId:authType" where authType is 1=PIN, 2=NFC, 3=COMBINED
    int firstColon = payload.indexOf(':');
    int secondColon = payload.indexOf(':', firstColon + 1);
    int thirdColon = payload.indexOf(':', secondColon + 1);
    
    if (firstColon > 0 && secondColon > 0 && thirdColon > 0) {
      String name = payload.substring(0, firstColon);
      String pin = payload.substring(firstColon + 1, secondColon);
      String nfcId = payload.substring(secondColon + 1, thirdColon);
      AuthType authType = (AuthType)payload.substring(thirdColon + 1).toInt();
      
      if (offlineAuth.addUser(name, pin, nfcId, authType)) {
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("User Added:");
        lcd.setCursor(0, 1);
        lcd.print(name);
        client.publish("admin/response", "User " + name + " added successfully");
        delay(2000);
        
        // Sync with server after adding user
        syncUsersFromServer();
        showEnterPin();
      } else {
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("Add User Failed");
        client.publish("admin/response", "Failed to add user " + name);
        delay(2000);
        showEnterPin();
      }
    }
  });

  client.subscribe("admin/remove-user", [] (const String &payload) {
    uint8_t userId = payload.toInt();
    if (offlineAuth.removeUser(userId)) {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("User Removed");
      lcd.setCursor(0, 1);
      lcd.print("ID: " + String(userId));
      client.publish("admin/response", "User " + String(userId) + " removed");
      delay(2000);
      
      // Sync with server after removing user
      syncUsersFromServer();
      showEnterPin();
    } else {
      client.publish("admin/response", "Failed to remove user " + String(userId));
    }
  });

  client.subscribe("admin/list-users", [] (const String &payload) {
    std::vector<OfflineUser> users = offlineAuth.getUsers();
    String userList = "{\"users\":[";
    for (size_t i = 0; i < users.size(); i++) {
      const auto& user = users[i];
      if (i > 0) userList += ",";
      userList += "{\"id\":" + String(user.id) + 
                  ",\"name\":\"" + String(user.name) + "\"" +
                  ",\"authType\":" + String(user.authType) +
                  ",\"isActive\":" + (user.isActive ? "true" : "false") +
                  ",\"lastUsed\":" + String(user.lastUsed) +
                  ",\"failedAttempts\":" + String(user.failedAttempts) + "}";
    }
    userList += "]}";
    client.publish("admin/response", userList);
  });

  client.subscribe("admin/system-status", [] (const String &payload) {
    String status = "{\"userCount\":" + String(offlineAuth.getUserCount()) + 
                   ",\"failedAttempts\":" + String(offlineAuth.getFailedAttempts()) +
                   ",\"lockoutTime\":" + String(offlineAuth.getRemainingLockoutTime()) +
                   ",\"lastAuth\":" + String(offlineAuth.getLastAuthTime()) + "}";
    client.publish("admin/response", status);
  });

  client.subscribe("admin/reset-system", [] (const String &payload) {
    if (payload == "CONFIRM_RESET") {
      offlineAuth.reset();
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("System Reset!");
      lcd.setCursor(0, 1);
      lcd.print("By Remote Admin");
      delay(3000);
      
      // Sync with server after system reset
      syncUsersFromServer();
      showEnterPin();
      client.publish("admin/response", "System reset complete");
    }
  });

  client.publish("mytopic/test", "Offline Auth System Ready");
  
  // Auto-sync users from server on connection
  delay(1000); // Wait a moment for connection to stabilize
  syncUsersFromServer();
}

void loop() {
  static unsigned long lastWiFiCheck = 0;
  static unsigned long wifiLostTime = 0;
  static bool reconnecting = false;
  
  // Check WiFi status every 5 seconds instead of every loop
  if (millis() - lastWiFiCheck > 5000) {
    lastWiFiCheck = millis();
    
    if (!offlineMode && WiFi.status() == WL_CONNECTED) {
      client.loop();
      reconnecting = false;
    } else if (!offlineMode && WiFi.status() != WL_CONNECTED) {
      if (!reconnecting) {
        // First time detecting WiFi loss
        wifiLostTime = millis();
        reconnecting = true;
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("WiFi Reconnecting");
        lcd.setCursor(0, 1);
        lcd.print("Please wait...");
        
        // Try to reconnect
        WiFi.disconnect();
        delay(1000);
        WiFi.begin(wifi_ssid, wifi_pass);
      } else if (millis() - wifiLostTime > 30000) {
        // After 30 seconds of failed reconnection, go offline
        offlineMode = true;
        reconnecting = false;
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("WiFi Lost!");
        lcd.setCursor(0, 1);
        lcd.print("Offline Mode");
        delay(2000);
        showEnterPin();
      }
    } else if (offlineMode && WiFi.status() == WL_CONNECTED) {
      // WiFi reconnected, switch back to online mode
      offlineMode = false;
      reconnecting = false;
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("WiFi Restored!");
      lcd.setCursor(0, 1);
      lcd.print("Online Mode");
      delay(2000);
      showEnterPin();
    } else if (offlineMode && WiFi.status() != WL_CONNECTED) {
      // In offline mode but periodically try to reconnect
      if (!reconnecting) {
        reconnecting = true;
        WiFi.begin(wifi_ssid, wifi_pass);
      }
    }
  }
  
  // If connected and not offline, run MQTT client
  if (!offlineMode && WiFi.status() == WL_CONNECTED) {
    client.loop();
  }

  // Check for system lockout
  if (offlineAuth.getRemainingLockoutTime() > 0) {
    static unsigned long lastLockoutUpdate = 0;
    if (millis() - lastLockoutUpdate > 5000) { // Update every 5 seconds
      showSystemStatus();
      lastLockoutUpdate = millis();
    }
    return; // Don't process input when locked out
  }

  // --- Keypad logic with enhanced features ---
  char key = keypad.getKey();
  if (key) {
    if (key == '#') { // Submit PIN
      if (pinInput.length() > 0) {
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("Authenticating...");
        
        if (!offlineMode) {
          client.publish("mytopic/pin", pinInput); // Publish PIN to MQTT
        }
        
        sendUnlockRequest(pinInput);
        pinInput = "";
        showEnterPin();
      }
    } else if (key == '*') { // Clear input or show system status
      if (pinInput.length() == 0) {
        // Show system status when PIN is empty and * is pressed
        showSystemStatus();
        delay(3000);
        showEnterPin();
      } else {
        // Clear PIN input
        pinInput = "";
        lcd.setCursor(0, 1);
        lcd.print("                "); // Clear line
        lcd.setCursor(0, 1);
      }
    } else if (key == 'D' && pinInput.length() == 0) {
      // Show WiFi status when PIN is empty and D is pressed
      showWiFiStatus();
      delay(3000);
      showEnterPin();
    } else if (key == 'C' && pinInput.length() == 0) {
      // Add test user when PIN is empty and C is pressed
      if (offlineAuth.addUser("TestUser", "1234", "", AUTH_PIN)) {
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("Test User Added!");
        lcd.setCursor(0, 1);
        lcd.print("PIN: 1234");
        Serial.println("Test user added: PIN 1234");
      } else {
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("Add User Failed!");
      }
      delay(3000);
      showEnterPin();
    } else if (key == 'B' && pinInput.length() == 0) {
      // Sync users from server when PIN is empty and B is pressed
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Syncing...");
      syncUsersFromServer();
      showEnterPin();
    } else if (pinInput.length() < 8) { // Max 8 digits
      pinInput += key;
      lcd.setCursor(0, 1);
      lcd.print("                "); // Clear line
      lcd.setCursor(0, 1);
      for (int i = 0; i < pinInput.length(); i++) {
        lcd.print("*");
      }
    }
  }

  // Handle responses from Arduino (NFC UID, write status, servo status)
  if (Serial2.available()) {
    String response = Serial2.readStringUntil('\n');
    response.trim();
    Serial.print("From Arduino: ");
    Serial.println(response);

    if (response.startsWith("NFC_UID:")) {
      String uid = response.substring(8);
      
      if (!offlineMode) {
        client.publish("mytopic/rfid", uid);
      }

      if (enrollment) {
        // Enroll NFC card to specified user
        if (offlineAuth.enrollNfcCard(uid, enrollmentUserId)) {
          lcd.clear();
          lcd.setCursor(0, 0);
          lcd.print("NFC Enrolled!");
          lcd.setCursor(0, 1);
          lcd.print("User " + String(enrollmentUserId));
          
          // Get enrollment data and write to card via Arduino
          String enrollmentData = offlineAuth.getNfcEnrollmentData(enrollmentUserId);
          if (enrollmentData.length() > 0) {
            Serial2.print("WRITE_NFC:");
            Serial2.println(enrollmentData);
            lcd.clear();
            lcd.setCursor(0, 0);
            lcd.print("Writing to card");
            lcd.setCursor(0, 1);
            lcd.print("Please wait...");
          }
          
          enrollment = false; // Reset enrollment after use
        } else {
          lcd.clear();
          lcd.setCursor(0, 0);
          lcd.print("Enroll Failed!");
        }
        delay(2000);
        
        // Also try online enrollment if available
        if (!offlineMode) {
          sendEnrollRequest(uid);
        }
      } else {
        // Try offline NFC authentication
        if (handleOfflineAuthentication(uid, AUTH_NFC)) {
          // Success handled in function
        } else if (!offlineMode) {
          // Fall back to online NFC authentication
          sendNfcUnlockRequest(uid);
        } else {
          // In offline mode and NFC failed
          lcd.clear();
          lcd.setCursor(0, 0);
          lcd.print("Access Denied!");
          lcd.setCursor(0, 1);
          lcd.print("Unknown NFC");
          delay(2000);
        }
      }
      showEnterPin();
    } else if (response == "NFC_WRITE_OK") {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Write  success!");
      delay(2000);
      showEnterPin();
    } else if (response == "NFC_WRITE_FAIL") {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Write failed!");
      delay(2000);
      showEnterPin();
    } else if (response == "SERVO_OK") {
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("Door Opened!");
      delay(2000);
      showEnterPin();
    }
  }
}