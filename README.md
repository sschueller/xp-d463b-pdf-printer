# Thermal Label Printer Tools

This repository contains tools for printing PDF labels to thermal printers using **ESC/POS** or **TSPL** command sets. It includes both a Go-based CLI tool for server/desktop environments and a web-based interface for direct printing from a browser.

## Project Structure

*   **`go/`**: A Go CLI application for processing PDFs and sending commands to printers via Serial or Bluetooth (RFCOMM).
*   **`web/`**: A client-side web application that uses Web Bluetooth and Web Serial APIs to print directly from the browser.
*   **`esp32/`**: ESP32 firmware that acts as a Wi-Fi to Bluetooth bridge for thermal printers, with a built-in web server serving the web interface.

## Features

*   **PDF to Bitmap Conversion**: Converts PDF pages to 1-bit monochrome bitmaps suitable for thermal printing.
*   **Dual Command Sets**: Supports both **ESC/POS** (common for receipt printers) and **TSPL** (common for label printers).
*   **Connection Types**:
    *   **Serial / USB**: Direct connection to printer ports.
    *   **Bluetooth**: Wireless printing via RFCOMM (Go) or Web Bluetooth (Web).
    *   **Wi-Fi to BLE Bridge**: ESP32 firmware that bridges Wi-Fi to Bluetooth LE printers.
*   **Image Processing**:
    *   Dithering and thresholding algorithms.
    *   Image rotation (90°).
    *   Inversion (White on Black).
*   **Calibration**: Tools to print calibration patterns and test feeds.

## Go CLI Tool

Located in the `go/` directory.

### Installation

```bash
cd go
go build -o print_label print_label.go
```

### Usage

```bash
./print_label --pdf label.pdf --printer-id "XX:XX:XX:XX:XX:XX" --bluetooth
```

**Common Flags:**
*   `--pdf`: Path to the PDF file.
*   `--paper-size`: Paper width in mm (default 58).
*   `--tspl`: Use TSPL command set (default is ESC/POS).
*   `--bluetooth`: Use Bluetooth connection.
*   `--output`: Serial port path (e.g., `/dev/rfcomm0`) if not using direct Bluetooth.
*   `--dry-run`: Write commands to a file instead of sending to a printer.

See `go/README.md` (if available) or run `./print_label --help` for more details.

## Web Interface

Located in the `web/` directory.

A pure HTML/JS application that runs in the browser. It leverages **Web Bluetooth** and **Web Serial** to communicate with printers without backend dependencies.

### Usage

1.  Open `web/index.html` in a modern browser (Chrome, Edge, or Opera recommended for Web API support).
2.  Select your interface (Bluetooth or Serial).
3.  Connect to your printer.
4.  Configure paper settings or choose a preset.
5.  Select a PDF and print.

See [web/README.md](web/README.md) for detailed instructions.

## ESP32 Firmware

Located in the `esp32/` directory.

ESP32 firmware that acts as a **Wi-Fi to Bluetooth bridge** for thermal printers, with a built-in web server serving the web interface. This allows you to print from any device on your Wi-Fi network to a Bluetooth thermal printer.

### Features

*   **Wi-Fi to Bluetooth Bridge**: Connect Bluetooth printers to your Wi-Fi network
*   **Built-in Web Server**: Serves the same web interface from the `data/` directory
*   **BLE Printer Support**: Connects to Bluetooth LE thermal printers
*   **TFT Display**: Provides real-time status information (WiFi, printer connection, uptime)
*   **Automatic Reconnection**: Reconnects to WiFi and printer if connections are lost
*   **Screen Timeout**: Saves power by turning off the display after inactivity
*   **REST API**: Provides endpoints for printer control and status checks

### Hardware Requirements

*   ESP32 development board (with WiFi and BLE support)
*   TFT display (compatible with TFT_eSPI library)
*   Push button for waking the screen
*   Bluetooth thermal printer (supporting TSPL or ESC/POS commands)

### Installation

1.  **Install PlatformIO**: If not already installed, install PlatformIO IDE for VSCode
2.  **Configure WiFi and Printer**:
    -   Copy `esp32/private_config.ini.dist` to `esp32/private_config.ini`
    -   Edit `private_config.ini` to add your WiFi credentials and printer MAC address
3.  **Upload Firmware**: Open the `esp32/` directory in PlatformIO and upload the firmware
4.  **Upload Filesystem**: Upload the `data/` directory to LittleFS using PlatformIO's "Upload File System Image" command

### Usage

1.  **Power on the ESP32**: The TFT display will show booting status
2.  **Connect to Wi-Fi**: The ESP32 will connect to your configured Wi-Fi network
3.  **Connect to Printer**: The ESP32 will scan for and connect to your configured Bluetooth printer
4.  **Access Web Interface**: Find the ESP32's IP address from the TFT display and open it in your browser
5.  **Print**: Use the web interface to select a PDF and print to the connected printer

### Configuration

The `private_config.ini` file contains all configurable parameters:
-   `WIFI_SSID`: Your Wi-Fi network name
-   `WIFI_PASS`: Your Wi-Fi network password
-   `PRINTER_MAC`: MAC address of your Bluetooth thermal printer
-   `PRINTER_SERVICEUUID`: BLE service UUID of the printer
-   `PRINTER_CHARACTERISTICUUID`: BLE characteristic UUID for printing
-   `PRINTER_DEVICENAMEUUID`: BLE characteristic UUID for device name

See `esp32/data/README.md` for detailed instructions on using the web interface.

## License

[MIT](LICENSE)