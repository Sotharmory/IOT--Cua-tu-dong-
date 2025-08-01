#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <mbedtls/sha256.h>
#include <vector>

// Authentication types
enum AuthType {
  AUTH_PIN = 1,
  AUTH_NFC = 2,
  AUTH_COMBINED = 3  // PIN + NFC required
};

// User structure for offline storage
struct OfflineUser {
  uint8_t id;
  char name[32];
  char pinHash[65];  // SHA256 hash as hex string
  char nfcId[33];    // NFC UID as hex string
  AuthType authType;
  bool isActive;
  uint32_t lastUsed;
  uint8_t failedAttempts;
};

// Authentication result
struct AuthResult {
  bool success;
  uint8_t userId;
  String message;
  AuthType usedMethod;
};

class OfflineAuth {
private:
  Preferences preferences;
  static const uint8_t MAX_USERS = 10;
  static const uint8_t MAX_FAILED_ATTEMPTS = 5;
  static const uint32_t LOCKOUT_TIME = 300000; // 5 minutes in milliseconds
  static const char* NAMESPACE;
  
  // Security settings
  uint32_t lastFailedAttempt;
  uint8_t globalFailedAttempts;
  bool isLockedOut;
  
  // Helper functions
  String calculateSHA256(const String& input);
  String bytesToHex(const uint8_t* bytes, size_t length);
  void hexToBytes(const String& hex, uint8_t* bytes);
  bool isSystemLocked();
  void incrementFailedAttempts();
  
public:
  OfflineAuth();
  ~OfflineAuth();
  
  // Initialization
  bool begin();
  void reset(); // Factory reset - clears all users
  
  // User management
  bool addUser(const String& name, const String& pin, const String& nfcId, AuthType authType);
  bool removeUser(uint8_t userId);
  bool updateUser(uint8_t userId, const String& name, const String& pin, const String& nfcId, AuthType authType);
  bool activateUser(uint8_t userId, bool active);
  std::vector<OfflineUser> getUsers();
  OfflineUser getUser(uint8_t userId);
  
  // Authentication methods
  AuthResult authenticatePin(const String& pin);
  AuthResult authenticateNfc(const String& nfcId);
  AuthResult authenticateCombined(const String& pin, const String& nfcId);
  AuthResult authenticate(const String& credential, AuthType method);
  
  // NFC card management (works with Arduino NFC handler)
  bool enrollNfcCard(const String& nfcId, uint8_t userId);
  bool isNfcCardEnrolled(const String& nfcId);
  String getNfcEnrollmentData(uint8_t userId); // Get data to write to NFC card via Arduino
  
  // Security features
  bool isUserLocked(uint8_t userId);
  void unlockUser(uint8_t userId);
  uint32_t getRemainingLockoutTime();
  void resetFailedAttempts(); // Reset global failed attempt counter
  
  // Statistics
  uint8_t getUserCount();
  uint32_t getLastAuthTime();
  uint8_t getFailedAttempts();
};

// Global instance
extern OfflineAuth offlineAuth;
