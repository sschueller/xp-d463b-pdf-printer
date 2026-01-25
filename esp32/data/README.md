# Web Label Printer

A browser-based tool for printing PDF labels directly to thermal printers using **Web Bluetooth** or **Web Serial** APIs. This application runs entirely client-side, with no backend server required.

## Features

*   **Direct Browser Printing**: Connect to Bluetooth (BLE) or USB/Serial printers directly from Chrome/Edge.
*   **PDF Support**: Renders PDFs to canvas and converts them to printer-ready bitmaps.
*   **Dual Command Sets**:
    *   **TSPL**: Standard for many label printers (e.g., Xprinter, TSC).
    *   **ESC/POS**: Standard for receipt printers.
*   **Image Processing**:
    *   Automatic dithering for monochrome printing.
    *   Rotation (90°) and Inversion support.
*   **Paper Presets**: Pre-configured settings for common label sizes.
*   **Diagnostics**:
    *   Self-test commands.
    *   Calibration patterns to check alignment and margins.
    *   Live connection logging.

## Prerequisites

*   **Browser**: A modern browser that supports Web Bluetooth or Web Serial.
    *   **Google Chrome** (Recommended)
    *   **Microsoft Edge**
    *   **Opera**
    *   *Note: Firefox and Safari do not currently support these APIs.*
*   **Hardware**:
    *   A thermal printer with Bluetooth or USB interface.
    *   For Bluetooth: Ensure your computer has Bluetooth enabled.

## Usage

1.  **Open the Application**:
    Simply open `index.html` in your browser. You can serve it via a local web server (e.g., `python3 -m http.server`) or open the file directly (though some browser security settings might restrict file access).

2.  **Connect to Printer**:
    *   Select **Interface**: Choose "Web Bluetooth (BLE)" or "Web Serial".
    *   Click **Connect Printer**.
    *   A browser dialog will appear. Select your printer from the list and click "Pair" or "Connect".

3.  **Configure Settings**:
    *   **Command Set**: Choose TSPL (labels) or ESC/POS (receipts).
    *   **Paper Preset**: Select a preset (e.g., "58mm Label") or choose "Custom" to enter dimensions manually.
    *   **Paper Width/Height**: Enter the dimensions in mm.
    *   **DPI**: Usually 203 for standard thermal printers.

4.  **Print**:
    *   Click **Select PDF File** and choose a document.
    *   A preview will be generated below.
    *   (Optional) Select specific pages to print if the PDF has multiple pages.
    *   Click **Print Label**.

## Troubleshooting

*   **"Device not found"**: Ensure the printer is on and not connected to another device. For Bluetooth, try unpairing it from your OS settings first, as Web Bluetooth handles the pairing directly.
*   **Garbage output**: Check the **Baud Rate** (for Serial) or **Command Set**. Sending ESC/POS commands to a TSPL printer (or vice versa) will result in raw text printing.
*   **Misalignment**: Use the **Calibration Pattern** button to print a grid. Adjust **Margin X** and **Margin Y** settings based on the output.

## Development

*   `app.js`: Main application logic and UI handling.
*   `transport.js`: Handles Web Bluetooth and Web Serial connections.
*   `printer_commands.js`: Generates binary commands (ESC/POS, TSPL) from pixel data.
*   `image_processing.js`: Handles PDF rendering and bitmap conversion.
*   `paper_presets.js`: Configuration for common paper sizes.