# Thermal Label Printer Tools

This repository contains tools for printing PDF labels to thermal printers using **ESC/POS** or **TSPL** command sets. It includes both a Go-based CLI tool for server/desktop environments and a web-based interface for direct printing from a browser.

## Project Structure

*   **`go/`**: A Go CLI application for processing PDFs and sending commands to printers via Serial or Bluetooth (RFCOMM).
*   **`web/`**: A client-side web application that uses Web Bluetooth and Web Serial APIs to print directly from the browser.

## Features

*   **PDF to Bitmap Conversion**: Converts PDF pages to 1-bit monochrome bitmaps suitable for thermal printing.
*   **Dual Command Sets**: Supports both **ESC/POS** (common for receipt printers) and **TSPL** (common for label printers).
*   **Connection Types**:
    *   **Serial / USB**: Direct connection to printer ports.
    *   **Bluetooth**: Wireless printing via RFCOMM (Go) or Web Bluetooth (Web).
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

## License

[MIT](LICENSE)