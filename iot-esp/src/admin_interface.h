#pragma once

#include <Arduino.h>
#include "offline_auth.h"

class AdminInterface {
private:
  bool adminMode;
  String currentCommand;
  unsigned long lastActivity;
  static const unsigned long ADMIN_TIMEOUT = 60000; // 1 minute timeout
  
public:
  AdminInterface();
  
  // Admin mode management
  bool enterAdminMode(const String& adminPin = "1234");
  void exitAdminMode();
  bool isInAdminMode();
  
  // Command processing
  void processCommand(char key);
  void showAdminMenu();
  void showUserList();
  void showSystemStats();
  
  // Quick actions
  bool quickAddUser(const String& name, const String& pin);
  bool quickEnrollNfc(uint8_t userId);
  
  // Display helpers
  void displayMessage(const String& line1, const String& line2 = "", int delayMs = 2000);
  void displayScrollingText(const String& text);
  
  // Update loop
  void update(); // Call this in main loop to handle timeouts
};

extern AdminInterface adminInterface;
