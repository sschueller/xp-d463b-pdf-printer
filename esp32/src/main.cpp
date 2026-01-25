#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <TFT_eSPI.h>
#include <BLEDevice.h>
#include <BLEClient.h>
#include <BLERemoteCharacteristic.h>
#include <BLEScan.h>

// WiFi credentials
const char* ssid = WIFI_SSID;
const char* password = WIFI_PASS;

// Printer configuration
const char* printerMac = PRINTER_MAC;
// Updated UUIDs based on device discovery
static BLEUUID serviceUUID(PRINTER_SERVICEUUID);
static BLEUUID characteristicUUID(PRINTER_CHARACTERISTICUUID); 
// BLE Device Name characteristic (standard UUID)
static BLEUUID deviceNameUUID(PRINTER_DEVICENAMEUUID);
// Storage for printer name
String printerName = "Unknown"; 

// BLE scan variables
BLEScan* pBLEScan = nullptr;
BLEAdvertisedDevice* myDevice = nullptr;
bool printerFound = false;
int scanCount = 0;
bool printerConnected = false;

// Client callback class
class MyClientCallback : public BLEClientCallbacks {
  void onConnect(BLEClient* pclient) {
    log_i("onConnect callback");
  }

  void onDisconnect(BLEClient* pclient) {
    printerConnected = false;
    log_i("onDisconnect callback");
  }
};

// Custom scan callback class
class MyAdvertisedDeviceCallbacks: public BLEAdvertisedDeviceCallbacks {
    void onResult(BLEAdvertisedDevice advertisedDevice) {
        scanCount++;
        
        if (advertisedDevice.getAddress().toString().equalsIgnoreCase("dd:0d:30:02:63:42")) {
            log_i("✅ PRINTER DETECTED!");
            
            // Stop scanning
            BLEDevice::getScan()->stop();
            
            // Store the device
            if (myDevice != nullptr) {
                delete myDevice;
            }
            myDevice = new BLEAdvertisedDevice(advertisedDevice);
            printerFound = true;
            
            log_i("  RSSI: %d dBm", advertisedDevice.getRSSI());
            
            if (advertisedDevice.haveServiceUUID()) {
                log_i("  Service UUID: %s", advertisedDevice.getServiceUUID().toString().c_str());
            } else {
                log_i("  No service UUID in advertisement");
            }
            
            if (advertisedDevice.haveAppearance()) {
                log_i("  Appearance: 0x%04X", advertisedDevice.getAppearance());
            }
            
            log_i("  TX Power: %d dBm", advertisedDevice.getTXPower());
        }
    }
};

// Global variables
AsyncWebServer server(80);
BLEClient* pClient = nullptr;
BLERemoteCharacteristic* pRemoteCharacteristic = nullptr;
String wifiIP = "";
TFT_eSPI tft = TFT_eSPI();
unsigned long previousMillis = 0;
const long lcdUpdateInterval = 1000; // 1 second
const long bleScanInterval = 10000; // 10 seconds
unsigned long previousBLEMillis = 0;

// Screen timeout variables
const int PIN_BUTTON = 14;
const int PIN_BACKLIGHT = 38;
const unsigned long SCREEN_TIMEOUT = 30000; // 30 seconds
unsigned long lastActivityTime = 0;
bool isScreenOn = true;

// Function declarations
void connectToWiFi();
void initLittleFS();
void setupWebServer();
void initBLE();
bool connectToPrinter();
void disconnectFromPrinter();
void printToBLEPrinter(const uint8_t* data, size_t length);
void updateLCD();
String getStatusJSON();
void startBLEScan();
void wakeScreen();
void checkScreenTimeout();

void setup() {
  Serial.begin(115200);
  
  // Initialize Button
  pinMode(PIN_BUTTON, INPUT_PULLUP);

  // Initialize Backlight
  pinMode(PIN_BACKLIGHT, OUTPUT);
  digitalWrite(PIN_BACKLIGHT, HIGH); // Turn on backlight initially
  lastActivityTime = millis();

  // Initialize LCD
  tft.init();
  tft.setRotation(1); // Landscape orientation
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  tft.setTextSize(2);
  tft.setCursor(50, 80);
  tft.println("Booting...");

  // Connect to WiFi
  connectToWiFi();

  // Initialize LittleFS
  initLittleFS();

  // Setup web server
  setupWebServer();

  // Initialize BLE and connect to printer
  initBLE();
  
  // Perform initial BLE scan
  // startBLEScan(); // Don't scan in setup, let loop handle it to avoid race conditions

  // Start server
  server.begin();
  log_i("Web server started");

  // Show initial status on LCD
  updateLCD();
}

void startBLEScan() {
  log_i("\n=== STARTING BLE SCAN ===");
  scanCount = 0;
  printerFound = false;
  
  // Clear previous scan results
  pBLEScan->clearResults();
  
  // Start active scan with our callback
  pBLEScan->start(5, false); // 5 second scan, passive
  
  log_i("=== SCAN INITIATED ===\n");
}

void loop() {
  unsigned long currentMillis = millis();

  // Check button press to wake screen
  if (digitalRead(PIN_BUTTON) == LOW) {
    wakeScreen();
  }

  // Check screen timeout
  checkScreenTimeout();

  // Update LCD periodically only if screen is on
  if (isScreenOn && currentMillis - previousMillis >= lcdUpdateInterval) {
    previousMillis = currentMillis;
    updateLCD();
  }

  // Scan for printer periodically
  if (currentMillis - previousBLEMillis >= bleScanInterval) {
    previousBLEMillis = currentMillis;
    startBLEScan();
  }

  // Reconnect to printer if disconnected and we found it
  if (!printerConnected && printerFound) {
    log_i("Printer disconnected, attempting to reconnect...");
    if (connectToPrinter()) {
        printerFound = false; // Reset so we don't keep trying if successful
    } else {
        // If connection failed, we might need to scan again
        printerFound = false;
    }
    delay(2000); // Wait before retrying
  }

  // Reconnect to WiFi if disconnected
  if (WiFi.status() != WL_CONNECTED) {
    log_i("WiFi disconnected, attempting to reconnect...");
    connectToWiFi();
  }

  delay(100);
}

void connectToWiFi() {
  Serial.print("Connecting to WiFi ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    wifiIP = WiFi.localIP().toString();
    Serial.println("\nWiFi connected");
    Serial.println("IP address: " + wifiIP);
  } else {
    Serial.println("\nWiFi connection failed");
    wifiIP = "";
  }
}

void initLittleFS() {
  if (!LittleFS.begin()) {
    log_e("LittleFS mount failed");
    return;
  }
  log_i("LittleFS initialized successfully");
}

void setupWebServer() {
  // Serve static files from LittleFS
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  // Status endpoint
  server.on("/status", HTTP_GET, [](AsyncWebServerRequest* request) {
    String json = getStatusJSON();
    request->send(200, "application/json", json);
  });

  // Print endpoint
  server.on("/print", HTTP_POST, [](AsyncWebServerRequest* request) {
    if (!printerConnected) {
      request->send(500, "text/plain", "Printer not connected");
      return;
    }

    AsyncWebServerResponse* response = request->beginResponse(200, "text/plain", "Print successful");
    request->send(response);
  }, NULL, [](AsyncWebServerRequest* request, uint8_t* data, size_t len, size_t index, size_t total) {
    printToBLEPrinter(data, len);
  });

  // Connect printer endpoint
  server.on("/connect", HTTP_GET, [](AsyncWebServerRequest* request) {
    if (connectToPrinter()) {
      request->send(200, "text/plain", "Printer connected");
    } else {
      request->send(500, "text/plain", "Failed to connect to printer");
    }
  });

  // Disconnect printer endpoint
  server.on("/disconnect", HTTP_GET, [](AsyncWebServerRequest* request) {
    disconnectFromPrinter();
    request->send(200, "text/plain", "Printer disconnected");
  });

  log_i("Web server routes configured");
}

void initBLE() {
  BLEDevice::init("ESP32_Printer");
  
  // Set security
  // BLESecurity *pSecurity = new BLESecurity();
  // pSecurity->setAuthenticationMode(ESP_LE_AUTH_BOND);
  // pSecurity->setCapability(ESP_IO_CAP_NONE);
  // pSecurity->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
  
  // Set connection parameters
  // BLEDevice::setPower(ESP_PWR_LVL_P9); // Increase power if needed
  
  log_i("BLE initialized");

  // Initialize BLE scan with our custom callback
  pBLEScan = BLEDevice::getScan();
  pBLEScan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
  pBLEScan->setActiveScan(true); // Active scan for better discovery
  pBLEScan->setInterval(100);
  pBLEScan->setWindow(99);
}

bool connectToPrinter() {
  if (printerConnected) {
    log_i("Printer already connected");
    return true;
  }

  if (!printerFound || myDevice == nullptr) {
    log_i("Printer not found in scan yet");
    return false;
  }

  log_i("Connecting to printer %s", myDevice->getAddress().toString().c_str());

  // Clean up any existing client
  if (pClient != nullptr) {
    if (pClient->isConnected()) {
      pClient->disconnect();
    }
    // delete pClient; // Avoid deleting to prevent crashes if callbacks are pending
    pClient = nullptr;
  }

  // Create new client
  pClient = BLEDevice::createClient();
  if (pClient == nullptr) {
    log_e("Failed to create BLE client");
    return false;
  }
  pClient->setClientCallbacks(new MyClientCallback());

  log_i("Created BLE client");

  // Try connection using the advertised device object
  bool connected = pClient->connect(myDevice);
  
  if (!connected) {
    log_e("❌ Connection failed");
    pClient->disconnect();
    pClient = nullptr;
    printerConnected = false;
    return false;
  }

  log_i("✅ Connected to printer");
  
  // Set MTU
  pClient->setMTU(247); 
  
  // Authenticate/Bond if needed
  // pClient->authenticate(); // Some devices require explicit call
  
  delay(100); // Reduced delay

  if (!pClient->isConnected()) {
      log_e("❌ Disconnected after MTU update");
      pClient->disconnect();
      pClient = nullptr;
      printerConnected = false;
      return false;
  }

  // Get service and characteristic
  BLERemoteService* pRemoteService = pClient->getService(serviceUUID);
  if (pRemoteService == nullptr) {
    log_e("❌ Failed to find service: %s", serviceUUID.toString().c_str());
    pClient->disconnect();
    pClient = nullptr;
    printerConnected = false;
    return false;
  }

  log_i("✅ Found service: %s", serviceUUID.toString().c_str());

  pRemoteCharacteristic = pRemoteService->getCharacteristic(characteristicUUID);
  if (pRemoteCharacteristic == nullptr) {
    log_e("❌ Failed to find characteristic: %s", characteristicUUID.toString().c_str());
    
    pClient->disconnect();
    pClient = nullptr;
    printerConnected = false;
    return false;
  }

  log_i("✅ Found characteristic: %s", characteristicUUID.toString().c_str());

  // Try to read printer name from device name characteristic (00002a00-0000-1000-8000-00805f9b34fb)
  // First, check if we can find the generic access service (00001800-0000-1000-8000-00805f9b34fb)
  BLEUUID genericAccessServiceUUID("00001800-0000-1000-8000-00805f9b34fb");
  BLERemoteService* pGenericAccessService = pClient->getService(genericAccessServiceUUID);
  
  if (pGenericAccessService != nullptr) {
    log_i("✅ Found Generic Access service");
    
    BLERemoteCharacteristic* pDeviceNameCharacteristic = pGenericAccessService->getCharacteristic(deviceNameUUID);
    
    if (pDeviceNameCharacteristic != nullptr) {
      log_i("✅ Found Device Name characteristic");
      
      if (pDeviceNameCharacteristic->canRead()) {
        printerName = pDeviceNameCharacteristic->readValue();
        log_i("✅ Printer name: %s", printerName.c_str());
      } else {
        log_w("❌ Device Name characteristic is not readable");
      }
    } else {
      log_w("❌ Did not find Device Name characteristic");
    }
  } else {
    log_w("❌ Did not find Generic Access service");
  }

  printerConnected = true;
  log_i("✅ Printer connection established successfully!");
  return true;
}

void disconnectFromPrinter() {
  if (pClient && pClient->isConnected()) {
    pClient->disconnect();
  }
  // We don't delete pClient here to avoid race conditions with callbacks
  pRemoteCharacteristic = nullptr;
  printerConnected = false;
  log_i("Printer disconnected");
}

void printToBLEPrinter(const uint8_t* data, size_t length) {
  wakeScreen(); // Wake screen on print activity

  if (!printerConnected || !pRemoteCharacteristic) {
    log_e("Cannot print: printer not connected");
    return;
  }

  if (pRemoteCharacteristic->canWrite()) {
    // Manual chunking to avoid BLE library "long write" issues
    // MTU is set to 247. Max payload is MTU - 3 = 244.
    // We use 240 to be safe.
    const size_t CHUNK_SIZE = 240; 
    size_t offset = 0;
    
    while (offset < length) {
      size_t remaining = length - offset;
      size_t currentChunkSize = (remaining > CHUNK_SIZE) ? CHUNK_SIZE : remaining;
      
      pRemoteCharacteristic->writeValue(const_cast<uint8_t*>(data + offset), currentChunkSize, true);
      offset += currentChunkSize;
    }
    log_i("Printed %d bytes in chunks", length);
  } else {
    log_e("Characteristic cannot be written");
  }
}

void updateLCD() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextSize(2);
  
  // WiFi status
  tft.setTextColor(TFT_GREEN);
  tft.setCursor(0, 0);
  if (WiFi.status() == WL_CONNECTED) {
    tft.print("WiFi: ");
    tft.print(wifiIP);
  } else {
    tft.setTextColor(TFT_RED);
    tft.println("WiFi: Disconnected");
  }

  // Printer status
  tft.setTextSize(2);
  tft.setCursor(0, 30);
  if (printerConnected) {
    tft.setTextColor(TFT_GREEN);
    tft.println("Printer: Connected");
    tft.setTextSize(1);
    tft.setCursor(0, 60);
    tft.setTextColor(TFT_WHITE);
    tft.print("Name: ");
    tft.println(printerName);
  } else {
    tft.setTextColor(TFT_RED);
    tft.println("Printer: Disconnected");
  }

  // Last action (default to idle)
  tft.setTextSize(1);
  tft.setTextColor(TFT_WHITE);
  tft.setCursor(0, 80);
  tft.println("Last Action: Idle");

  // Uptime
  tft.setTextSize(1);
  tft.setCursor(0, 100);
  unsigned long uptime = millis() / 1000;
  tft.print("Uptime: ");
  tft.print(uptime);
  tft.println(" sec");
}

String getStatusJSON() {
  String json = "{";
  json += "\"wifi\":\"";
  json += (WiFi.status() == WL_CONNECTED) ? "connected" : "disconnected";
  json += "\",";
  json += "\"ip\":\"" + wifiIP + "\",";
  json += "\"printer\":\"";
  json += printerConnected ? "connected" : "disconnected";
  json += "\",";
  json += "\"printerName\":\"" + printerName + "\",";
  json += "\"uptime\":";
  json += String(millis() / 1000);
  json += "}";
  return json;
}

void wakeScreen() {
  lastActivityTime = millis();
  if (!isScreenOn) {
    digitalWrite(PIN_BACKLIGHT, HIGH);
    isScreenOn = true;
    updateLCD(); // Refresh content immediately
    log_i("Screen woke up");
  }
}

void checkScreenTimeout() {
  if (isScreenOn && (millis() - lastActivityTime > SCREEN_TIMEOUT)) {
    digitalWrite(PIN_BACKLIGHT, LOW);
    isScreenOn = false;
    log_i("Screen timeout - backlight off");
  }
}
