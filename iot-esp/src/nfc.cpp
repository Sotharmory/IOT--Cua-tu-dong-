#include <Arduino.h>
#include <MFRC522.h>
#include <LiquidCrystal_I2C.h>

extern MFRC522 mfrc522;
extern LiquidCrystal_I2C lcd;

void enrollNfcCard(const String& payload) {
  mfrc522.PCD_Init();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Tap card to write");
  Serial.println("[NFC] Waiting for card...");

  // Wait for a new card
  while (!mfrc522.PICC_IsNewCardPresent() || !mfrc522.PICC_ReadCardSerial()) {
    delay(100);
  }
  Serial.println("[NFC] Card detected!");

  // Authenticate block 4 (first data block on most cards)
  byte block = 4;
  MFRC522::MIFARE_Key key;
  for (byte i = 0; i < 6; i++) key.keyByte[i] = 0xFF; // default key

  Serial.println("[NFC] Authenticating block 4...");
  MFRC522::StatusCode status = mfrc522.PCD_Authenticate(
    MFRC522::PICC_CMD_MF_AUTH_KEY_A, block, &key, &(mfrc522.uid)
  );
  if (status != MFRC522::STATUS_OK) {
    Serial.print("[NFC] Auth failed: ");
    Serial.println(mfrc522.GetStatusCodeName(status));
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Auth failed");
    delay(2000);
    return;
  }
  Serial.println("[NFC] Auth success!");

  // Prepare data (16 bytes per block)
  byte buffer[18];
  byte len = payload.length();
  Serial.print("[NFC] Writing payload: ");
  Serial.println(payload);
  for (byte i = 0; i < 16; i++) {
    if (i < len) buffer[i] = payload[i];
    else buffer[i] = 0x00;
  }

  status = mfrc522.MIFARE_Write(block, buffer, 16);
  if (status == MFRC522::STATUS_OK) {
    Serial.println("[NFC] Write success!");
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Write success!");
  } else {
    Serial.print("[NFC] Write failed: ");
    Serial.println(mfrc522.GetStatusCodeName(status));
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Write failed!");
  }
  delay(2000);

  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Enter PIN:");
  lcd.setCursor(0, 1);
  Serial.println("[NFC] Enrollment done, returning to PIN entry.");
}