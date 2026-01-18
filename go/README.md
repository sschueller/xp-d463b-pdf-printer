# Bluetooth PDF Printing for Label Printer (Linux)

This Go script prints a PDF via Bluetooth to a label printer (ID: DD:0D:30:02:63:42) on a Linux PC, with configurable paper size.

## Features

- Converts PDF to monochrome bitmap using average‑brightness threshold (matching Android app).
- Generates ESC/POS raster image commands (GS v 0) with line spacing (ESC 3 0).
- Supports two connection modes:
  - **Serial port** (traditional RFCOMM virtual serial device) with configurable baud rate (9600‑115200).
  - **Direct Bluetooth socket** (bypasses serial port, uses Linux RFCOMM sockets directly).
- Supports 58 mm (384 dots) and 80 mm (576 dots) paper widths, with custom width calculation based on DPI (default 168 DPI).
- Dry‑run mode for testing (writes raw commands to a file).
- Debugging flags: `--verbose`, `--test` (send ESC @ and LF), `--self-test`, `--beep`, `--query` (printer detection), `--read` (read response).

## Requirements

### System Dependencies

- `poppler-utils` – for `pdftoppm` (PDF to PNG conversion)
- `bluez` – Bluetooth stack (includes `bluetoothctl`, `btattach`; `rfcomm` is optional)
- `go` 1.20 or later

Install on Debian/Ubuntu:

```bash
sudo apt install poppler-utils bluez
```

On Arch/Manjaro:

```bash
sudo pacman -S poppler-utils bluez-utils
```

> **Note:** The script can work with or without the `rfcomm` package. If you prefer the traditional serial‑port approach, you can set up the serial connection using `bluetoothctl` and `btattach` as described in the Bluetooth Setup section. For direct Bluetooth communication, no extra setup is needed beyond pairing.

### Go Dependencies

The script uses the following Go modules:

- `go.bug.st/serial` – for serial port communication (optional, used only when `--bluetooth=false`)
- `golang.org/x/image/draw` – for image scaling
- `golang.org/x/sys/unix` – for direct Bluetooth sockets

They are automatically fetched when you run `go mod tidy`.

## Installation

1. Clone or copy the script into a directory.
2. Navigate to the `desktop` folder and run:

```bash
go mod tidy
```

This will download the required dependencies.

## Usage

```bash
go run print_label.go --pdf <path-to-pdf> [options]
```

### Command‑Line Options

| Flag | Default | Description |
|------|---------|-------------|
| `--pdf` | (required) | Path to the PDF file to print. |
| `--paper-size` | 58 | Paper width in millimeters (58 or 80). For other widths, the script calculates dots based on DPI. |
| `--printer-id` | DD:0D:30:02:63:42 | Bluetooth MAC address of the label printer. Used when `--bluetooth=true`. |
| `--dpi` | 168 | Printer DPI (dots per inch) used for custom paper‑size calculation. Based on 58mm=384 dots. |
| `--output` | /dev/rfcomm0 | Serial port device (the RFCOMM virtual serial port bound to the printer). Ignored when `--bluetooth=true`. |
| `--mode` | 0 | Print mode: 0=normal, 1=double width, 2=double height, 3=double both. |
| `--dry-run` | false | If set, commands are written to a file instead of being sent to the printer. |
| `--output-file` | commands.bin | File to write commands when `--dry-run` is used. |
| `--bluetooth` | false | Use direct Bluetooth socket connection (bypasses serial port). |
| `--channel` | 1 | RFCOMM channel (default 1 for most printers). Used only with `--bluetooth=true`. |
| `--baud` | 115200 | Baud rate for serial port communication (9600, 19200, 38400, 57600, 115200). |
| `--verbose` | false | Enable verbose logging (prints command bytes and conversion details). |
| `--test` | false | Test connection only: send ESC @ and LF, then exit. |
| `--self-test` | false | Send self‑test command (US vt eot). |
| `--beep` | false | Send beep command (ESC B 3 3). |
| `--read` | false | Read response after sending command (timeout 2s). |
| `--query` | false | Send printer detection query (DLE EOT STX) and read response, then exit. |
| `--tspl` | false | Use TSPL command set (instead of ESC/POS). Try this if the printer doesn't respond to standard commands. |

### Examples

```bash
go run print_label.go --pdf multipage_test.pdf --bluetooth --printer-id DD:0D:30:02:63:42 --tspl --paper-size 100 --paper-height 150 --rotate 90 --speed 3 --density 12 --verbose
```

**Print a PDF on 58 mm paper using a serial port (default):**

```bash
go run print_label.go --pdf label.pdf
```

**Print on 80 mm paper with dry‑run to inspect commands:**

```bash
go run print_label.go --pdf label.pdf --paper-size 80 --dry-run
```

**Use direct Bluetooth connection (no serial port setup):**

```bash
go run print_label.go --pdf label.pdf --bluetooth --printer-id DD:0D:30:02:63:42 --channel 1
```

**Print using TSPL mode (recommended for this printer):**

```bash
go run print_label.go --pdf label.pdf --bluetooth --printer-id DD:0D:30:02:63:42 --tspl
```

**Use a custom serial port (e.g., after manually binding RFCOMM):**

```bash
go run print_label.go --pdf label.pdf --output /dev/rfcomm1
```

## Bluetooth Setup

### 1. Pairing

Pair the printer with your computer (using `bluetoothctl` or the desktop Bluetooth manager). The printer must be discoverable and its MAC address known.

```bash
bluetoothctl
[bluetooth]# scan on
... wait for printer to appear ...
[bluetooth]# pair DD:0D:30:02:63:42
[bluetooth]# trust DD:0D:30:02:63:42
```

### 2. Connection Method

#### A) Direct Bluetooth Socket (Recommended)

If you run the script with `--bluetooth`, no further setup is required. The script will open a Bluetooth RFCOMM socket directly to the printer. Ensure the printer is powered on and in range.

#### B) Serial Port (Legacy)

If you prefer the serial‑port approach (e.g., for compatibility with other tools), you can create a virtual serial device.

- **Using `rfcomm` (if available):**

  ```bash
  sudo rfcomm bind 0 DD:0D:30:02:63:42 1
  ```

  This creates `/dev/rfcomm0`. You may need to adjust permissions.

- **Using `bluetoothctl` and `btattach` (alternative):**

  ```bash
  bluetoothctl
  [bluetooth]# connect DD:0D:30:02:63:42
  ```

  If the connection succeeds, the system may automatically create a serial port (check `dmesg` or `ls /dev/rfcomm*`).

  If not, you can use `btattach`:

  ```bash
  sudo btattach -B /dev/ttyS0 -P rfcomm -S 115200 -N DD:0D:30:02:63:42
  ```

  This command varies depending on your Bluetooth adapter. Consult `btattach --help` for details.

### 3. Permissions

Ensure your user has read/write permissions on the serial device (e.g., `/dev/rfcomm0`). You may need to add yourself to the `dialout` group or adjust udev rules.

### 4. Testing the Connection

The script provides several debugging flags to verify the connection and printer responsiveness.

**Serial port test (manual):**

```bash
echo -e "\x1B\x40" | sudo tee /dev/rfcomm0   # Send ESC @ (printer init)
```

If the printer reacts (e.g., beeps or feeds paper), the connection is working.

**Using the script’s test flags:**

- **Basic connection test** (sends ESC @ and LF):
  ```bash
  go run print_label.go --test --output /dev/rfcomm0
  ```
  Use `--bluetooth` and `--printer-id` for direct Bluetooth.

- **Self‑test command** (makes the printer print a test page):
  ```bash
  go run print_label.go --self-test --output /dev/rfcomm0
  ```

- **Beep command** (makes the printer beep):
  ```bash
  go run print_label.go --beep --output /dev/rfcomm0
  ```

- **Printer detection query** (sends DLE EOT STX and reads response):
  ```bash
  go run print_label.go --query --read --output /dev/rfcomm0
  ```
  If the printer responds, you will see the status bytes printed.

- **Dry‑run** (generate commands without sending):
  ```bash
  go run print_label.go --pdf label.pdf --dry-run --verbose
  ```
  This writes the raw ESC/POS commands to `commands.bin` and logs the command bytes.

**Direct Bluetooth test:** Run any of the above commands with `--bluetooth` (and optionally `--channel`) to test the direct Bluetooth socket connection.

## How It Works

1. **PDF → PNG**: The script calls `pdftoppm` with 203 DPI (configurable via `--dpi`) to generate a PNG image.
2. **Scaling**: The image is scaled to the target dot width while preserving aspect ratio. The dot width is derived from the paper size (58 mm = 384 dots, 80 mm = 576 dots) or calculated as `mm × DPI ÷ 25.4`.
3. **Thresholding**: The scaled image is converted to grayscale and then to a 1‑bit bitmap using an average‑brightness threshold (the same algorithm used by the Android app). This produces a black‑and‑white image suitable for thermal printing.
4. **ESC/POS Command Generation**: Each row of the bitmap is packed into ESC/POS raster commands (GS v 0). The commands include line spacing (`ESC 3 0`), printer initialization (`ESC @`), and a paper‑cut command (`GS V 66 1`). Before printing, a printer detection query (`DLE EOT STX`) may be sent (if `--query` is used).
5. **Transmission**: The command stream is sent either over a serial port (with configurable baud rate) or directly via a Bluetooth RFCOMM socket (using the Linux kernel’s RFCOMM protocol).

## Testing Without a Printer

Use the `--dry-run` flag to generate a binary file containing the raw ESC/POS commands. You can inspect the file with a hex editor or send it later via `cat`:

```bash
cat commands.bin > /dev/rfcomm0
```

## Limitations

- The script has only been tested with the specific label printer (MAC DD:0D:30:02:63:42) and may need adjustment for other ESC/POS printers.
- Bluetooth pairing must be done manually before running the script.
- The dithering algorithm is basic; for better quality you may want to adjust the threshold or use a different dithering method.
- Direct Bluetooth connection requires Linux kernel RFCOMM support and appropriate permissions (CAP_NET_RAW or root). The script may need to be run with `sudo` if your user lacks the necessary capabilities.

## Troubleshooting

### Dual Bluetooth Services
Some printers may expose multiple Bluetooth services (e.g., "Misc" and "Imaging") with the same MAC address. If the default channel (1) does not work, try other channels (e.g., 2) using the `--channel` flag. You can inspect available channels using `sdptool browse <MAC>`.

### Read Timeout
When using the `--read` flag or during printer detection, the script waits for a response from the printer. To prevent hanging, a 2-second timeout is enforced. If you see "No response received within 2 seconds", it means the printer did not send any data back. This is normal for some commands or if the printer is busy.

## License

This project is provided as‑is under the MIT License.