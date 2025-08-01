#include "admin_interface.h"
#include <LiquidCrystal_I2C.h>

extern LiquidCrystal_I2C lcd;

AdminInterface adminInterface;

AdminInterface::AdminInterface() {
  adminMode = false;
  currentCommand = "";
  lastActivity = 0;
}

bool AdminInterface::enterAdminMode(const String& adminPin) {
  if (adminPin == "1234") { // Default admin PIN
    adminMode = true;
    lastActivity = millis();
    showAdminMenu();
    return true;
  }
  return false;
}

void AdminInterface::exitAdminMode() {
  adminMode = false;
  currentCommand = "";
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Admin mode OFF");
  delay(1000);
}

bool AdminInterface::isInAdminMode() {
  return adminMode;
}

void AdminInterface::processCommand(char key) {
  if (!adminMode) return;
  
  lastActivity = millis();
  
  switch (key) {
    case 'A': // Show users
      showUserList();
      break;
      
    case 'B': // System stats
      showSystemStats();
      break;
      
    case 'C': // Quick add user
      quickAddUser("QuickUser", "1111");
      break;
      
    case 'D': // Exit admin mode
      exitAdminMode();
      break;
      
    case '*': // Back to menu
      showAdminMenu();
      break;
      
    case '#': // Refresh current view
      if (currentCommand == "users") {
        showUserList();
      } else if (currentCommand == "stats") {
        showSystemStats();
      } else {
        showAdminMenu();
      }
      break;
  }
}

void AdminInterface::showAdminMenu() {
  currentCommand = "menu";
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("ADMIN MENU");
  lcd.setCursor(0, 1);
  lcd.print("A:Users B:Stats");
  delay(1500);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("C:AddUser D:Exit");
  lcd.setCursor(0, 1);
  lcd.print("*:Menu #:Refresh");
}

void AdminInterface::showUserList() {
  currentCommand = "users";
  std::vector<OfflineUser> users = offlineAuth.getUsers();
  
  if (users.empty()) {
    displayMessage("No users found", "A:Menu #:Refresh");
    return;
  }
  
  for (size_t i = 0; i < users.size(); i++) {
    const auto& user = users[i];
    String line1 = String(user.id) + ":" + String(user.name);
    String line2 = "Type:" + String(user.authType) + " " + (user.isActive ? "ON" : "OFF");
    
    lcd.clear();
    lcd.setCursor(0, 0);
    if (line1.length() > 16) {
      displayScrollingText(line1);
    } else {
      lcd.print(line1);
    }
    lcd.setCursor(0, 1);
    lcd.print(line2);
    delay(2000);
  }
  
  displayMessage("End of users", "A:Menu #:Refresh");
}

void AdminInterface::showSystemStats() {
  currentCommand = "stats";
  
  // Page 1: User counts and attempts
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Users: " + String(offlineAuth.getUserCount()));
  lcd.setCursor(0, 1);
  lcd.print("Fails: " + String(offlineAuth.getFailedAttempts()));
  delay(2000);
  
  // Page 2: Lockout info
  uint32_t lockoutTime = offlineAuth.getRemainingLockoutTime();
  lcd.clear();
  lcd.setCursor(0, 0);
  if (lockoutTime > 0) {
    lcd.print("LOCKED: " + String(lockoutTime / 1000) + "s");
  } else {
    lcd.print("Status: UNLOCKED");
  }
  lcd.setCursor(0, 1);
  lcd.print("LastAuth: " + String(offlineAuth.getLastAuthTime() / 1000));
  delay(2000);
  
  displayMessage("Stats complete", "A:Menu #:Refresh");
}

bool AdminInterface::quickAddUser(const String& name, const String& pin) {
  if (offlineAuth.addUser(name, pin, "", AUTH_PIN)) {
    displayMessage("User added!", name + " PIN:" + pin);
    return true;
  } else {
    displayMessage("Add failed!", "Max users reached?");
    return false;
  }
}

bool AdminInterface::quickEnrollNfc(uint8_t userId) {
  OfflineUser user = offlineAuth.getUser(userId);
  if (user.id == 0) {
    displayMessage("User not found", "ID: " + String(userId));
    return false;
  }
  
  displayMessage("Tap NFC card", "For: " + String(user.name));
  return true;
}

void AdminInterface::displayMessage(const String& line1, const String& line2, int delayMs) {
  lcd.clear();
  lcd.setCursor(0, 0);
  if (line1.length() > 16) {
    displayScrollingText(line1);
  } else {
    lcd.print(line1);
  }
  
  if (line2.length() > 0) {
    lcd.setCursor(0, 1);
    if (line2.length() > 16) {
      lcd.print(line2.substring(0, 16));
    } else {
      lcd.print(line2);
    }
  }
  
  delay(delayMs);
}

void AdminInterface::displayScrollingText(const String& text) {
  if (text.length() <= 16) {
    lcd.print(text);
    return;
  }
  
  for (int i = 0; i <= text.length() - 16; i++) {
    lcd.setCursor(0, 0);
    lcd.print(text.substring(i, i + 16));
    delay(300);
  }
}

void AdminInterface::update() {
  if (adminMode && (millis() - lastActivity > ADMIN_TIMEOUT)) {
    exitAdminMode();
  }
}
