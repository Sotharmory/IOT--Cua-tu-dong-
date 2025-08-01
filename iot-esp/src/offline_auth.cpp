#include "offline_auth.h"

const char* OfflineAuth::NAMESPACE = "offline_auth";

// Global instance
OfflineAuth offlineAuth;

OfflineAuth::OfflineAuth() {
  lastFailedAttempt = 0;
  globalFailedAttempts = 0;
  isLockedOut = false;
}

OfflineAuth::~OfflineAuth() {
  preferences.end();
}

bool OfflineAuth::begin() {
  if (!preferences.begin(NAMESPACE, false)) {
    Serial.println("[AUTH] Failed to initialize preferences");
    return false;
  }
  
  // Initialize system if first run
  if (!preferences.isKey("initialized")) {
    Serial.println("[AUTH] First run - initializing system");
    preferences.putBool("initialized", true);
    preferences.putUChar("user_count", 0);
    preferences.putULong("last_auth", 0);
    preferences.putUChar("failed_attempts", 0);
    
    // Add default admin user (PIN: 1234)
    addUser("admin", "1234", "", AUTH_PIN);
  }
  
  // Load system state
  globalFailedAttempts = preferences.getUChar("failed_attempts", 0);
  lastFailedAttempt = preferences.getULong("last_failed", 0);
  
  Serial.println("[AUTH] Offline authentication system initialized");
  return true;
}

void OfflineAuth::reset() {
  preferences.clear();
  globalFailedAttempts = 0;
  lastFailedAttempt = 0;
  isLockedOut = false;
  
  // Reinitialize
  preferences.putBool("initialized", true);
  preferences.putUChar("user_count", 0);
  preferences.putULong("last_auth", 0);
  preferences.putUChar("failed_attempts", 0);
  
  Serial.println("[AUTH] System reset complete");
}

String OfflineAuth::calculateSHA256(const String& input) {
  mbedtls_sha256_context ctx;
  unsigned char hash[32];
  
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0); // 0 for SHA-256
  mbedtls_sha256_update(&ctx, (const unsigned char*)input.c_str(), input.length());
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);
  
  return bytesToHex(hash, 32);
}

String OfflineAuth::bytesToHex(const uint8_t* bytes, size_t length) {
  String hex = "";
  for (size_t i = 0; i < length; i++) {
    if (bytes[i] < 16) hex += "0";
    hex += String(bytes[i], HEX);
  }
  hex.toLowerCase();
  return hex;
}

void OfflineAuth::hexToBytes(const String& hex, uint8_t* bytes) {
  for (size_t i = 0; i < hex.length(); i += 2) {
    String byteString = hex.substring(i, i + 2);
    bytes[i / 2] = (uint8_t)strtol(byteString.c_str(), NULL, 16);
  }
}

bool OfflineAuth::isSystemLocked() {
  // Lockout disabled - always return false
  return false;
}

void OfflineAuth::incrementFailedAttempts() {
  // Still track failed attempts for statistics but don't use for lockout
  globalFailedAttempts++;
  lastFailedAttempt = millis();
  preferences.putUChar("failed_attempts", globalFailedAttempts);
  preferences.putULong("last_failed", lastFailedAttempt);
}

void OfflineAuth::resetFailedAttempts() {
  globalFailedAttempts = 0;
  preferences.putUChar("failed_attempts", 0);
  isLockedOut = false;
}

bool OfflineAuth::addUser(const String& name, const String& pin, const String& nfcId, AuthType authType) {
  uint8_t userCount = preferences.getUChar("user_count", 0);
  
  if (userCount >= MAX_USERS) {
    Serial.println("[AUTH] Maximum users reached");
    return false;
  }
  
  // Find next available user ID
  uint8_t userId = 1;
  for (uint8_t i = 1; i <= MAX_USERS; i++) {
    String userKey = "user_" + String(i);
    if (!preferences.isKey(userKey.c_str())) {
      userId = i;
      break;
    }
  }
  
  OfflineUser user;
  user.id = userId;
  strncpy(user.name, name.c_str(), sizeof(user.name) - 1);
  user.name[sizeof(user.name) - 1] = '\0';
  
  // Hash the PIN
  String pinHash = calculateSHA256(pin);
  strncpy(user.pinHash, pinHash.c_str(), sizeof(user.pinHash) - 1);
  user.pinHash[sizeof(user.pinHash) - 1] = '\0';
  
  // Store NFC ID
  strncpy(user.nfcId, nfcId.c_str(), sizeof(user.nfcId) - 1);
  user.nfcId[sizeof(user.nfcId) - 1] = '\0';
  
  user.authType = authType;
  user.isActive = true;
  user.lastUsed = 0;
  user.failedAttempts = 0;
  
  // Save user to preferences
  String userKey = "user_" + String(userId);
  preferences.putBytes(userKey.c_str(), &user, sizeof(OfflineUser));
  
  // Update user count
  preferences.putUChar("user_count", userCount + 1);
  
  Serial.printf("[AUTH] User %s added with ID %d\n", name.c_str(), userId);
  return true;
}

bool OfflineAuth::removeUser(uint8_t userId) {
  String userKey = "user_" + String(userId);
  if (!preferences.isKey(userKey.c_str())) {
    return false;
  }
  
  preferences.remove(userKey.c_str());
  
  uint8_t userCount = preferences.getUChar("user_count", 0);
  if (userCount > 0) {
    preferences.putUChar("user_count", userCount - 1);
  }
  
  Serial.printf("[AUTH] User %d removed\n", userId);
  return true;
}

OfflineUser OfflineAuth::getUser(uint8_t userId) {
  OfflineUser user;
  memset(&user, 0, sizeof(OfflineUser));
  
  String userKey = "user_" + String(userId);
  if (preferences.isKey(userKey.c_str())) {
    preferences.getBytes(userKey.c_str(), &user, sizeof(OfflineUser));
  }
  
  return user;
}

std::vector<OfflineUser> OfflineAuth::getUsers() {
  std::vector<OfflineUser> users;
  
  for (uint8_t i = 1; i <= MAX_USERS; i++) {
    String userKey = "user_" + String(i);
    if (preferences.isKey(userKey.c_str())) {
      OfflineUser user;
      preferences.getBytes(userKey.c_str(), &user, sizeof(OfflineUser));
      users.push_back(user);
    }
  }
  
  return users;
}

AuthResult OfflineAuth::authenticatePin(const String& pin) {
  AuthResult result = {false, 0, "", AUTH_PIN};
  
  // Remove system lockout check
  // if (isSystemLocked()) {
  //   result.message = "System locked";
  //   return result;
  // }
  
  String pinHash = calculateSHA256(pin);
  std::vector<OfflineUser> users = getUsers();
  
  for (const auto& user : users) {
    if (!user.isActive) continue;
    
    if ((user.authType == AUTH_PIN || user.authType == AUTH_COMBINED) && 
        String(user.pinHash) == pinHash) {
      
      // Remove user lockout check
      // if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      //   result.message = "User locked";
      //   return result;
      // }
      
      result.success = true;
      result.userId = user.id;
      result.message = "PIN authenticated";
      result.usedMethod = AUTH_PIN;
      
      // Update last used time and reset failed attempts
      OfflineUser updatedUser = user;
      updatedUser.lastUsed = millis();
      updatedUser.failedAttempts = 0;
      String userKey = "user_" + String(user.id);
      preferences.putBytes(userKey.c_str(), &updatedUser, sizeof(OfflineUser));
      
      resetFailedAttempts();
      preferences.putULong("last_auth", millis());
      
      Serial.printf("[AUTH] PIN authentication successful for user %s\n", user.name);
      return result;
    }
  }
  
  incrementFailedAttempts();
  result.message = "Invalid PIN";
  Serial.println("[AUTH] PIN authentication failed");
  return result;
}

AuthResult OfflineAuth::authenticateNfc(const String& nfcId) {
  AuthResult result = {false, 0, "", AUTH_NFC};
  
  // Remove system lockout check
  // if (isSystemLocked()) {
  //   result.message = "System locked";
  //   return result;
  // }
  
  std::vector<OfflineUser> users = getUsers();
  
  for (const auto& user : users) {
    if (!user.isActive) continue;
    
    if ((user.authType == AUTH_NFC || user.authType == AUTH_COMBINED) && 
        String(user.nfcId) == nfcId) {
      
      // Remove user lockout check
      // if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      //   result.message = "User locked";
      //   return result;
      // }
      
      result.success = true;
      result.userId = user.id;
      result.message = "NFC authenticated";
      result.usedMethod = AUTH_NFC;
      
      // Update last used time
      OfflineUser updatedUser = user;
      updatedUser.lastUsed = millis();
      updatedUser.failedAttempts = 0;
      String userKey = "user_" + String(user.id);
      preferences.putBytes(userKey.c_str(), &updatedUser, sizeof(OfflineUser));
      
      resetFailedAttempts();
      preferences.putULong("last_auth", millis());
      
      Serial.printf("[AUTH] NFC authentication successful for user %s\n", user.name);
      return result;
    }
  }
  
  incrementFailedAttempts();
  result.message = "Invalid NFC card";
  Serial.println("[AUTH] NFC authentication failed");
  return result;
}

AuthResult OfflineAuth::authenticateCombined(const String& pin, const String& nfcId) {
  AuthResult result = {false, 0, "", AUTH_COMBINED};
  
  // Remove system lockout check
  // if (isSystemLocked()) {
  //   result.message = "System locked";
  //   return result;
  // }
  
  String pinHash = calculateSHA256(pin);
  std::vector<OfflineUser> users = getUsers();
  
  for (const auto& user : users) {
    if (!user.isActive || user.authType != AUTH_COMBINED) continue;
    
    if (String(user.pinHash) == pinHash && String(user.nfcId) == nfcId) {
      
      // Remove user lockout check
      // if (user.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      //   result.message = "User locked";
      //   return result;
      // }
      
      result.success = true;
      result.userId = user.id;
      result.message = "Combined auth successful";
      result.usedMethod = AUTH_COMBINED;
      
      // Update last used time
      OfflineUser updatedUser = user;
      updatedUser.lastUsed = millis();
      updatedUser.failedAttempts = 0;
      String userKey = "user_" + String(user.id);
      preferences.putBytes(userKey.c_str(), &updatedUser, sizeof(OfflineUser));
      
      resetFailedAttempts();
      preferences.putULong("last_auth", millis());
      
      Serial.printf("[AUTH] Combined authentication successful for user %s\n", user.name);
      return result;
    }
  }
  
  incrementFailedAttempts();
  result.message = "Invalid credentials";
  Serial.println("[AUTH] Combined authentication failed");
  return result;
}

bool OfflineAuth::enrollNfcCard(const String& nfcId, uint8_t userId) {
  OfflineUser user = getUser(userId);
  if (user.id == 0) {
    return false;
  }
  
  strncpy(user.nfcId, nfcId.c_str(), sizeof(user.nfcId) - 1);
  user.nfcId[sizeof(user.nfcId) - 1] = '\0';
  
  String userKey = "user_" + String(userId);
  preferences.putBytes(userKey.c_str(), &user, sizeof(OfflineUser));
  
  Serial.printf("[AUTH] NFC card enrolled for user %d\n", userId);
  return true;
}

bool OfflineAuth::isNfcCardEnrolled(const String& nfcId) {
  std::vector<OfflineUser> users = getUsers();
  
  for (const auto& user : users) {
    if (String(user.nfcId) == nfcId) {
      return true;
    }
  }
  
  return false;
}

String OfflineAuth::getNfcEnrollmentData(uint8_t userId) {
  OfflineUser user = getUser(userId);
  if (user.id == 0) {
    return "";
  }
  
  // Create enrollment data that Arduino can write to NFC card
  // Format: "AUTH:userId:userName:authType"
  String enrollmentData = "AUTH:" + String(user.id) + ":" + String(user.name) + ":" + String(user.authType);
  
  // Ensure data fits in NFC block (16 bytes max for MIFARE Classic)
  if (enrollmentData.length() > 16) {
    enrollmentData = enrollmentData.substring(0, 16);
  }
  
  return enrollmentData;
}

uint32_t OfflineAuth::getRemainingLockoutTime() {
  if (!isLockedOut) return 0;
  
  uint32_t timePassed = millis() - lastFailedAttempt;
  if (timePassed >= LOCKOUT_TIME) {
    return 0;
  }
  
  return LOCKOUT_TIME - timePassed;
}

uint8_t OfflineAuth::getUserCount() {
  return preferences.getUChar("user_count", 0);
}

uint32_t OfflineAuth::getLastAuthTime() {
  return preferences.getULong("last_auth", 0);
}

uint8_t OfflineAuth::getFailedAttempts() {
  return globalFailedAttempts;
}
