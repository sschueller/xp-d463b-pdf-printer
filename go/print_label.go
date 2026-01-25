package main

import (
	"bytes"
	"errors"
	"flag"
	"fmt"
	"image"
	"image/draw"
	"image/png"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	xdraw "golang.org/x/image/draw"
	"go.bug.st/serial"
	"golang.org/x/sys/unix"
)

// syncCloser wraps an os.File to Sync before closing
type syncCloser struct {
	*os.File
}

func (s *syncCloser) Close() error {
	_ = s.Sync()
	return s.File.Close()
}

// readWithTimeout reads from an io.Reader with a timeout.
// Returns the read bytes, or nil if timeout occurs.
func readWithTimeout(r io.Reader, timeout time.Duration) ([]byte, error) {
	done := make(chan struct{})
	var data []byte
	var err error
	go func() {
		buf := make([]byte, 128)
		n, e := r.Read(buf)
		if e != nil {
			err = e
		} else {
			data = buf[:n]
		}
		close(done)
	}()
	select {
	case <-done:
		return data, err
	case <-time.After(timeout):
		return nil, errors.New("timeout")
	}
}

// rotate90 rotates the image 90 degrees clockwise.
func rotate90(img image.Image) image.Image {
	bounds := img.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	newImg := image.NewRGBA(image.Rect(0, 0, height, width))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			newImg.Set(height-1-y, x, img.At(x, y))
		}
	}
	return newImg
}

// PageData holds the bitmap data for a single page
type PageData struct {
	Pixels []byte
	Width  int
	Height int
}

// pdfToBitmap converts a PDF to a list of 1-bit bitmaps (one per page) with given width in dots.
func pdfToBitmap(pdfPath string, widthDots int, rotate int, invert bool) ([]PageData, error) {
	// Create temporary directory for PNG output
	tmpDir, err := os.MkdirTemp("", "pdfprint")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	outputPrefix := filepath.Join(tmpDir, "output")
	// Run pdftoppm to generate PNGs at 203 DPI (printer DPI)
	// Removed -singlefile to support multiple pages
	cmd := exec.Command("pdftoppm", "-png", "-r", "203", pdfPath, outputPrefix)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("pdftoppm failed: %v, stderr: %s", err, stderr.String())
	}

	// Find all generated PNG files
	files, err := filepath.Glob(outputPrefix + "-*.png")
	if err != nil {
		return nil, fmt.Errorf("failed to glob PNG files: %v", err)
	}
	if len(files) == 0 {
		// Try without suffix if only one page and pdftoppm behavior differs?
		// Actually pdftoppm without -singlefile always adds -1, -2 etc. or -01 etc.
		// Let's check if output.png exists (maybe single page behavior?)
		if _, err := os.Stat(outputPrefix + ".png"); err == nil {
			files = []string{outputPrefix + ".png"}
		} else {
			return nil, fmt.Errorf("no PNG files generated")
		}
	}

	var pages []PageData

	for _, pngPath := range files {
		log.Printf("Processing page: %s", pngPath)
		
		// Load PNG
		f, err := os.Open(pngPath)
		if err != nil {
			return nil, fmt.Errorf("failed to open PNG %s: %v", pngPath, err)
		}
		defer f.Close()

		img, err := png.Decode(f)
		if err != nil {
			return nil, fmt.Errorf("failed to decode PNG %s: %v", pngPath, err)
		}
		log.Printf("Loaded image dimensions: %d x %d", img.Bounds().Dx(), img.Bounds().Dy())

		// Rotate if requested
		if rotate == 90 {
			log.Println("Rotating image 90 degrees clockwise")
			img = rotate90(img)
		}

		// Scale to target width while preserving aspect ratio
		srcBounds := img.Bounds()
		srcW := srcBounds.Dx()
		srcH := srcBounds.Dy()
		scale := float64(widthDots) / float64(srcW)
		dstW := widthDots
		dstH := int(float64(srcH) * scale)

		dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
		xdraw.ApproxBiLinear.Scale(dst, dst.Bounds(), img, srcBounds, draw.Over, nil)

		// Convert to grayscale and then to 1-bit using average threshold
		gray := image.NewGray(dst.Bounds())
		draw.Draw(gray, gray.Bounds(), dst, dst.Bounds().Min, draw.Src)

		pixels := thresholdAverage(gray)

		// Invert by default (unless --invert is set to disable it)
		if !invert {
			// log.Println("Inverting colors (default behavior)") // Reduce log spam
			for i := range pixels {
				if pixels[i] == 0 {
					pixels[i] = 1
				} else {
					pixels[i] = 0
				}
			}
		}

		// Ensure width is multiple of 8 by padding right with white (0)
		width := dstW
		height := dstH
		widthBytes := (width + 7) / 8
		paddedWidth := widthBytes * 8
		if paddedWidth != width {
			newPixels := make([]byte, paddedWidth*height)
			for y := 0; y < height; y++ {
				rowSrc := pixels[y*width : (y+1)*width]
				rowDst := newPixels[y*paddedWidth : (y+1)*paddedWidth]
				copy(rowDst[:width], rowSrc)
				for x := width; x < paddedWidth; x++ {
					rowDst[x] = 0
				}
			}
			pixels = newPixels
			width = paddedWidth
		}
		
		pages = append(pages, PageData{Pixels: pixels, Width: width, Height: height})
	}

	return pages, nil
}

// ditherFloydSteinberg converts grayscale image to 1-bit using Floyd-Steinberg dithering.
// Input is *image.Gray, output is a byte slice where each byte is 0 (white) or 1 (black).
func ditherFloydSteinberg(gray *image.Gray) []byte {
	bounds := gray.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	pixels := make([]byte, width*height)

	// Create a temporary float64 matrix for error diffusion
	// For simplicity, we'll implement in-place using ints.
	// We'll copy gray values to a 2D array of ints.
	vals := make([][]int, height)
	for y := 0; y < height; y++ {
		vals[y] = make([]int, width)
		for x := 0; x < width; x++ {
			vals[y][x] = int(gray.GrayAt(bounds.Min.X+x, bounds.Min.Y+y).Y)
		}
	}

	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			old := vals[y][x]
			var new int
			if old < 128 {
				new = 0
				pixels[y*width+x] = 1 // black
			} else {
				new = 255
				pixels[y*width+x] = 0 // white
			}
			err := old - new

			// Distribute error to neighboring pixels
			if x+1 < width {
				vals[y][x+1] += err * 7 / 16
			}
			if y+1 < height {
				if x-1 >= 0 {
					vals[y+1][x-1] += err * 3 / 16
				}
				vals[y+1][x] += err * 5 / 16
				if x+1 < width {
					vals[y+1][x+1] += err * 1 / 16
				}
			}
		}
	}
	return pixels
}

// thresholdAverage converts grayscale image to 1-bit using average brightness threshold.
// Implements the same algorithm as Android's format_K_threshold.
// Returns pixel array where 0=white, 1=black.
func thresholdAverage(gray *image.Gray) []byte {
	bounds := gray.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	total := width * height
	pixels := make([]byte, total)

	// Compute sum of all pixel values
	sum := 0
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			sum += int(gray.GrayAt(bounds.Min.X+x, bounds.Min.Y+y).Y)
		}
	}
	average := sum / total
	log.Printf("Average brightness: %d (sum=%d, total=%d)", average, sum, total)

	// Threshold
	idx := 0
	blackCount := 0
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			val := int(gray.GrayAt(bounds.Min.X+x, bounds.Min.Y+y).Y)
			if val > average {
				pixels[idx] = 0 // white
			} else {
				pixels[idx] = 1 // black
				blackCount++
			}
			idx++
		}
	}
	log.Printf("Black pixels: %d (%.1f%%)", blackCount, float64(blackCount)*100.0/float64(total))
	return pixels
}

// generateRasterCommands converts 1-bit pixel array to ESC/POS raster commands.
// pixels: 0=white,1=black, row-major, width must be multiple of 8.
// mode: 0=normal,1=double width,2=double height,3=double both.
func generateRasterCommands(pixels []byte, width, height, mode int) []byte {
	widthBytes := width / 8
	cmdSize := widthBytes + 8
	total := height * cmdSize
	commands := make([]byte, total)

	// Precompute bit masks for each pixel position in a byte (MSB top)
	bitMask := [8]byte{128, 64, 32, 16, 8, 4, 2, 1}

	pixelIdx := 0
	for y := 0; y < height; y++ {
		offset := y * cmdSize
		// GS v 0 header
		commands[offset] = 0x1D // GS
		commands[offset+1] = 0x76 // 'v'
		commands[offset+2] = 0x30 // '0'
		commands[offset+3] = byte(mode & 1)
		commands[offset+4] = byte(widthBytes % 256)
		commands[offset+5] = byte(widthBytes / 256)
		commands[offset+6] = 1 // yL = 1 (height = 1 dot per command)
		commands[offset+7] = 0 // yH = 0

		// Pack 8 horizontal pixels into each byte
		for bx := 0; bx < widthBytes; bx++ {
			var b byte
			for bit := 0; bit < 8; bit++ {
				if pixels[pixelIdx] == 1 {
					b |= bitMask[bit]
				}
				pixelIdx++
			}
			commands[offset+8+bx] = b
		}
	}
	return commands
}


// generateTSPLCommands converts 1-bit pixel array to TSPL commands.
// pixels: 0=white,1=black, row-major.
// width, height: dimensions in dots.
// paperWidthMm: width of paper in mm (e.g., 58).
func generateTSPLCommands(pixels []byte, width, height int, paperWidthMm int, paperHeightMm int, speed int, density int, marginX, marginY int) []byte {
	var buf bytes.Buffer

	// 1. Setup commands
	// Use provided height or calculate from image
	hMm := paperHeightMm
	if hMm <= 0 {
		hMm = height / 8
		if hMm < 10 {
			hMm = 10
		}
	}

	// SIZE width mm, height mm
	buf.WriteString(fmt.Sprintf("SIZE %d mm,%d mm\r\n", paperWidthMm, hMm))
	// GAP 2 mm,0 mm (standard label gap)
	buf.WriteString("GAP 2 mm,0 mm\r\n")
	// DIRECTION 1
	buf.WriteString("DIRECTION 1\r\n")
	// SPEED
	buf.WriteString(fmt.Sprintf("SPEED %d\r\n", speed))
	// DENSITY
	buf.WriteString(fmt.Sprintf("DENSITY %d\r\n", density))
	// CLS (Clear buffer)
	buf.WriteString("CLS\r\n")

	// 2. Bitmap command
	// BITMAP X,Y,width(bytes),height,mode,data
	widthBytes := (width + 7) / 8
	// Use margins for X, Y
	buf.WriteString(fmt.Sprintf("BITMAP %d,%d,%d,%d,0,", marginX, marginY, widthBytes, height))
	
	// Write buffer so far to get byte slice
	commands := buf.Bytes()

	// 3. Append bitmap data
	// We need to pack pixels into bytes. The input 'pixels' is 1 byte per pixel (0 or 1).
	// TSPL expects 1 bit per pixel.
	bitmapData := make([]byte, widthBytes*height)
	for y := 0; y < height; y++ {
		for x := 0; x < widthBytes; x++ {
			var b byte
			for bit := 0; bit < 8; bit++ {
				pxIdx := y*width + x*8 + bit
				if pxIdx < len(pixels) && pixels[pxIdx] == 1 {
					b |= 1 << (7 - bit) // MSB first
				}
			}
			bitmapData[y*widthBytes+x] = b
		}
	}
	commands = append(commands, bitmapData...)

	// 4. Print command
	// PRINT copies, sets
	commands = append(commands, []byte("\r\nPRINT 1,1\r\n")...)

	return commands
}

// generateCalibrationPattern returns TSPL commands to print a calibration grid.
func generateCalibrationPattern(widthMm, heightMm, speed, density, marginX, marginY int) []byte {
	var buf bytes.Buffer
	
	// Setup
	buf.WriteString(fmt.Sprintf("SIZE %d mm,%d mm\r\n", widthMm, heightMm))
	buf.WriteString("GAP 2 mm,0 mm\r\n")
	buf.WriteString("DIRECTION 1\r\n")
	buf.WriteString(fmt.Sprintf("SPEED %d\r\n", speed))
	buf.WriteString(fmt.Sprintf("DENSITY %d\r\n", density))
	buf.WriteString("CLS\r\n")

	// Convert mm to dots (203 DPI = 8 dots/mm)
	wDots := widthMm * 8
	hDots := heightMm * 8

	// Draw bounding box (inset by 2 dots to be visible)
	buf.WriteString(fmt.Sprintf("BOX %d,%d,%d,%d,4\r\n", 2+marginX, 2+marginY, wDots-2+marginX, hDots-2+marginY))

	// Draw center crosshair
	centerX := wDots / 2
	centerY := hDots / 2
	buf.WriteString(fmt.Sprintf("BAR %d,%d,2,20\r\n", centerX-1+marginX, centerY-10+marginY)) // Vertical
	buf.WriteString(fmt.Sprintf("BAR %d,%d,20,2\r\n", centerX-10+marginX, centerY-1+marginY)) // Horizontal

	// Draw ruler ticks every 5mm (40 dots)
	// Horizontal ticks at top
	for x := 0; x < wDots; x += 40 {
		buf.WriteString(fmt.Sprintf("BAR %d,%d,2,10\r\n", x+marginX, 0+marginY))
	}
	// Vertical ticks at left
	for y := 0; y < hDots; y += 40 {
		buf.WriteString(fmt.Sprintf("BAR %d,%d,10,2\r\n", 0+marginX, y+marginY))
	}

	// Print text indicating size
	buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"3\",0,1,1,\"Size: %dx%d mm\"\r\n", 50+marginX, 50+marginY, widthMm, heightMm))
	buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"3\",0,1,1,\"Check margins\"\r\n", 50+marginX, 80+marginY))

	buf.WriteString("PRINT 1,1\r\n")
	return buf.Bytes()
}

// generateDensityTestPattern returns TSPL commands to print a test pattern for DPI/density tuning.
// Prints a grid of rectangles with varying densities and text labels.
// Also includes a DPI scaling test using text at different sizes.
func generateDensityTestPattern(widthMm, heightMm, speed, marginX, marginY int) []byte {
	var buf bytes.Buffer
	
	// Setup
	buf.WriteString(fmt.Sprintf("SIZE %d mm,%d mm\r\n", widthMm, heightMm))
	buf.WriteString("GAP 2 mm,0 mm\r\n")
	buf.WriteString("DIRECTION 1\r\n")
	buf.WriteString(fmt.Sprintf("SPEED %d\r\n", speed))
	buf.WriteString("CLS\r\n")

	// Convert mm to dots (203 DPI = 8 dots/mm)
	wDots := widthMm * 8
	hDots := heightMm * 8

	// Title
	buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"3\",0,1,1,\"DPI/Density Test\"\r\n", 10+marginX, 10+marginY))
	buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"2\",0,1,1,\"Find best print quality\"\r\n", 10+marginX, 30+marginY))

	// Density values to test (TSPL density range 0-15)
	densities := []int{0, 2, 4, 6, 8, 10, 12, 14}
	boxWidth := wDots / (len(densities) + 1)
	boxHeight := 20
	yStart := 60 + marginY

	for i, d := range densities {
		x := marginX + i*boxWidth + 5
		// Draw a filled rectangle with this density
		buf.WriteString(fmt.Sprintf("DENSITY %d\r\n", d))
		buf.WriteString(fmt.Sprintf("BAR %d,%d,%d,%d\r\n", x, yStart, boxWidth-10, boxHeight))
		// Label
		buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"1\",0,1,1,\"D=%d\"\r\n", x, yStart+boxHeight+5, d))
	}
	// Reset density to default
	buf.WriteString(fmt.Sprintf("DENSITY %d\r\n", 8))

	// DPI test: vertical lines at different widths (simulating DPI)
	yStart2 := yStart + boxHeight + 40
	buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"2\",0,1,1,\"Line width test\"\r\n", 10+marginX, yStart2-20))
	lineWidths := []int{1, 2, 3, 4, 5, 6}
	for i, w := range lineWidths {
		x := marginX + 20 + i*30
		buf.WriteString(fmt.Sprintf("BAR %d,%d,%d,30\r\n", x, yStart2, w, 30))
		buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"1\",0,1,1,\"%d\"\r\n", x, yStart2+35, w))
	}

	// DPI scaling test: text at different font sizes (simulating DPI effect)
	yStart3 := yStart2 + 80
	if yStart3+60 < hDots+marginY {
		buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"2\",0,1,1,\"DPI scaling (font size)\"\r\n", 10+marginX, yStart3-20))
		fontSizes := []int{1, 2, 3, 4, 5}
		for i, sz := range fontSizes {
			x := marginX + 20 + i*60
			buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"%d\",0,1,1,\"%dpt\"\r\n", x, yStart3, sz, sz))
		}
		// Explanation
		buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"1\",0,1,1,\"Higher DPI = sharper\"\r\n", 10+marginX, yStart3+40))
	}

	// Print a sample bitmap (small checkerboard)
	yStart4 := yStart3 + 100
	if yStart4+20 < hDots+marginY {
		buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"2\",0,1,1,\"Checkerboard\"\r\n", 10+marginX, yStart4-20))
		// Simple 8x8 checkerboard
		checkSize := 4
		for row := 0; row < 8; row++ {
			for col := 0; col < 8; col++ {
				if (row+col)%2 == 0 {
					x := marginX + 20 + col*checkSize
					y := yStart4 + row*checkSize
					buf.WriteString(fmt.Sprintf("BAR %d,%d,%d,%d\r\n", x, y, checkSize, checkSize))
				}
			}
		}
	}

	buf.WriteString("PRINT 1,1\r\n")
	return buf.Bytes()
}

// generateDensityTestPatternWithDPI extends the test pattern to include a bitmap scaled at different DPI values.
func generateDensityTestPatternWithDPI(widthMm, heightMm, speed, marginX, marginY, dpi int) []byte {
	var buf bytes.Buffer
	
	// Setup
	buf.WriteString(fmt.Sprintf("SIZE %d mm,%d mm\r\n", widthMm, heightMm))
	buf.WriteString("GAP 2 mm,0 mm\r\n")
	buf.WriteString("DIRECTION 1\r\n")
	buf.WriteString(fmt.Sprintf("SPEED %d\r\n", speed))
	buf.WriteString("CLS\r\n")

	// Convert mm to dots using given DPI
	wDots := int(float64(widthMm) * float64(dpi) / 25.4)
	hDots := int(float64(heightMm) * float64(dpi) / 25.4)

	// Title with DPI info
	buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"3\",0,1,1,\"DPI/Density Test (DPI=%d)\"\r\n", 10+marginX, 10+marginY, dpi))
	buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"2\",0,1,1,\"Find best print quality\"\r\n", 10+marginX, 30+marginY))

	// Density test (same as before)
	densities := []int{0, 2, 4, 6, 8, 10, 12, 14}
	boxWidth := wDots / (len(densities) + 1)
	boxHeight := int(float64(20) * float64(dpi) / 203.0) // scale height with DPI
	yStart := 60 + marginY

	for i, d := range densities {
		x := marginX + i*boxWidth + 5
		buf.WriteString(fmt.Sprintf("DENSITY %d\r\n", d))
		buf.WriteString(fmt.Sprintf("BAR %d,%d,%d,%d\r\n", x, yStart, boxWidth-10, boxHeight))
		buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"1\",0,1,1,\"D=%d\"\r\n", x, yStart+boxHeight+5, d))
	}
	buf.WriteString(fmt.Sprintf("DENSITY %d\r\n", 8))

	// DPI scaling test: show actual DPI value
	yStart2 := yStart + boxHeight + 60
	buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"2\",0,1,1,\"DPI: %d (dots/mm=%.1f)\"\r\n", 10+marginX, yStart2, dpi, float64(dpi)/25.4))

	// Print a gradient bitmap (simulate DPI effect)
	yStart3 := yStart2 + 40
	if yStart3+40 < hDots+marginY {
		buf.WriteString(fmt.Sprintf("TEXT %d,%d,\"2\",0,1,1,\"Gradient (DPI effect)\"\r\n", 10+marginX, yStart3-20))
		// Draw a simple gradient bar
		barWidth := wDots - 20
		barHeight := 20
		for i := 0; i < barWidth; i += 2 {
			density := i * 15 / barWidth
			buf.WriteString(fmt.Sprintf("DENSITY %d\r\n", density))
			buf.WriteString(fmt.Sprintf("BAR %d,%d,2,%d\r\n", marginX+10+i, yStart3, barHeight))
		}
		buf.WriteString(fmt.Sprintf("DENSITY %d\r\n", 8))
	}

	buf.WriteString("PRINT 1,1\r\n")
	return buf.Bytes()
}

// generateInitCommand returns ESC @
func generateInitCommand() []byte {
	return []byte{0x1B, 0x40}
}

// generateCutCommand returns GS V 66 1 (partial cut)
func generateCutCommand() []byte {
	return []byte{0x1D, 0x56, 0x42, 0x01}
}

// generateLineSpacingCommand returns ESC 3 n (set line spacing to n dots)
func generateLineSpacingCommand(n int) []byte {
	return []byte{0x1B, 0x33, byte(n)}
}

// generateQueryCommand returns DLE EOT STX (16,4,2) used for printer detection
func generateQueryCommand() []byte {
	return []byte{0x10, 0x04, 0x02}
}

// openSerialPort opens a serial port at given path with default settings for printer.
func openSerialPort(port string, baudRate int) (io.ReadWriteCloser, error) {
	mode := &serial.Mode{
		BaudRate: baudRate,
		DataBits: 8,
		Parity:   serial.NoParity,
		StopBits: serial.OneStopBit,
	}
	return serial.Open(port, mode)
}

// openBluetoothSocket connects to a Bluetooth device via RFCOMM.
// mac: Bluetooth MAC address in format "XX:XX:XX:XX:XX:XX"
// channel: RFCOMM channel (default 1 for printers)
func openBluetoothSocket(mac string, channel int) (io.ReadWriteCloser, error) {
	// Parse MAC address
	hw, err := net.ParseMAC(mac)
	if err != nil {
		return nil, fmt.Errorf("invalid MAC address %s: %v", mac, err)
	}
	if len(hw) != 6 {
		return nil, fmt.Errorf("MAC address must be 6 bytes, got %d", len(hw))
	}
	// Convert to little-endian order as required by SockaddrRFCOMM
	var addrBytes [6]byte
	for i := 0; i < 6; i++ {
		addrBytes[i] = hw[5-i]
	}

	// Create socket
	fd, err := unix.Socket(unix.AF_BLUETOOTH, unix.SOCK_STREAM, unix.BTPROTO_RFCOMM)
	if err != nil {
		return nil, fmt.Errorf("failed to create socket: %v", err)
	}

	// Connect
	sa := &unix.SockaddrRFCOMM{
		Addr:    addrBytes,
		Channel: uint8(channel),
	}
	if err := unix.Connect(fd, sa); err != nil {
		unix.Close(fd)
		return nil, fmt.Errorf("failed to connect: %v", err)
	}

	// Convert fd to os.File
	file := os.NewFile(uintptr(fd), "bluetooth")
	log.Printf("Bluetooth socket connected (fd=%d)", fd)
	return file, nil
}

func main() {
	pdfPath := flag.String("pdf", "", "Path to PDF file")
	paperSize := flag.Int("paper-size", 58, "Paper width in mm (58, 80, 100)")
	paperHeight := flag.Int("paper-height", 0, "Paper height in mm (optional, for TSPL SIZE command)")
	printerID := flag.String("printer-id", "DD:0D:30:02:63:42", "Bluetooth MAC address")
	dpi := flag.Int("dpi", 203, "Printer DPI (dots per inch). Standard is 203. For 58mm ESC/POS, use 168.")
	outputPort := flag.String("output", "/dev/rfcomm0", "Serial port path (e.g., /dev/rfcomm0) or USB device path")
	mode := flag.Int("mode", 0, "Print mode (0=normal,1=double width,2=double height,3=double both)")
	dryRun := flag.Bool("dry-run", false, "If true, do not send to serial port, instead write commands to file")
	outputFile := flag.String("output-file", "commands.bin", "File to write commands when dry-run is enabled")
	bluetooth := flag.Bool("bluetooth", false, "Use direct Bluetooth connection (instead of serial port)")
	usb := flag.Bool("usb", false, "Use USB device (treats output as a file, default /dev/usb/lp0)")
	channel := flag.Int("channel", 1, "RFCOMM channel (default 1)")
	baud := flag.Int("baud", 115200, "Baud rate for serial port")
	verbose := flag.Bool("verbose", false, "Enable verbose logging")
	test := flag.Bool("test", false, "Test connection only: send ESC @ and LF, then exit")
	selfTest := flag.Bool("self-test", false, "Send self-test command (US vt eot)")
	beep := flag.Bool("beep", false, "Send beep command (ESC B 3 3)")
	readResponse := flag.Bool("read", false, "Read response after sending command (timeout 2s)")
	query := flag.Bool("query", false, "Send printer detection query (DLE EOT STX) and read response, then exit")
	tspl := flag.Bool("tspl", false, "Use TSPL command set (instead of ESC/POS)")
	rotate := flag.Int("rotate", 0, "Rotate image 90 degrees (only 90 supported)")
	invert := flag.Bool("invert", false, "Disable default color inversion")
	speed := flag.Int("speed", 4, "Print speed (TSPL)")
	density := flag.Int("density", 8, "Print density (TSPL)")
	marginX := flag.Int("margin-x", 0, "Left margin in dots")
	marginY := flag.Int("margin-y", 0, "Top margin in dots")
	calibration := flag.Bool("calibration-pattern", false, "Print a calibration pattern to check alignment")
	densityTest := flag.Bool("density-test", false, "Print a test pattern to determine optimal DPI/density")
	flag.Parse()

	// Helper to open port
	openPort := func() (io.ReadWriteCloser, error) {
		if *bluetooth {
			log.Printf("Connecting to Bluetooth device %s channel %d", *printerID, *channel)
			return openBluetoothSocket(*printerID, *channel)
		} else if *usb {
			devicePath := *outputPort
			if devicePath == "/dev/rfcomm0" {
				devicePath = "/dev/usb/lp0"
			}
			log.Printf("Opening USB device %s", devicePath)

			// Use O_WRONLY | O_SYNC to ensure data is flushed immediately
			// NOTE: Opening with O_RDWR might lock the device or cause issues if we don't read.
			// We'll stick to O_WRONLY unless reading is explicitly requested.
			openFlags := os.O_WRONLY | os.O_SYNC
			if *readResponse || *query {
				openFlags = os.O_RDWR | os.O_SYNC
			}

			f, err := os.OpenFile(devicePath, openFlags, 0)
			if err != nil {
				if os.IsPermission(err) {
					log.Printf("Permission denied. Try 'sudo' or adding user to 'lp' group.")
				}
				return nil, err
			}
			
			// Reset printer if just testing connection to ensure clean state
			// But only if we are not reading, as reset might clear buffers
			return &syncCloser{f}, nil
		} else {
			log.Printf("Opening serial port %s at %d baud", *outputPort, *baud)
			return openSerialPort(*outputPort, *baud)
		}
	}

	// If any of the test flags are set, run test mode
	if *test || *selfTest || *beep || *query || *calibration || *densityTest {
		port, err := openPort()
		if err != nil {
			log.Fatalf("Failed to open connection: %v", err)
		}
		defer port.Close()

		// Send commands based on flags
		if *calibration {
			if !*tspl {
				log.Fatal("Calibration pattern requires --tspl flag")
			}
			if *paperHeight <= 0 {
				log.Fatal("Calibration pattern requires --paper-height")
			}
			log.Printf("Printing calibration pattern for %dx%d mm", *paperSize, *paperHeight)
			cmds := generateCalibrationPattern(*paperSize, *paperHeight, *speed, *density, *marginX, *marginY)
			// Debug hex dump
			log.Printf("Hex dump of calibration commands:")
			for i, b := range cmds {
				fmt.Printf("%02x ", b)
				if (i+1) % 16 == 0 {
					fmt.Println()
				}
			}
			fmt.Println()
			_, err := port.Write(cmds)
			if err != nil {
				log.Fatalf("Failed to send calibration commands: %v", err)
			}
			// Force flush and wait
			if f, ok := port.(*syncCloser); ok {
				f.Sync()
			}
			time.Sleep(100 * time.Millisecond)
			log.Println("Calibration pattern sent.")
			return
		}

		if *densityTest {
			if !*tspl {
				log.Fatal("Density test requires --tspl flag")
			}
			if *paperHeight <= 0 {
				*paperHeight = 30 // default height
			}
			log.Printf("Printing DPI/density test pattern for %dx%d mm (DPI=%d)", *paperSize, *paperHeight, *dpi)
			cmds := generateDensityTestPatternWithDPI(*paperSize, *paperHeight, *speed, *marginX, *marginY, *dpi)
			log.Printf("Hex dump of density test commands:")
			for i, b := range cmds {
				fmt.Printf("%02x ", b)
				if (i+1) % 16 == 0 {
					fmt.Println()
				}
			}
			fmt.Println()
			_, err := port.Write(cmds)
			if err != nil {
				log.Fatalf("Failed to send density test commands: %v", err)
			}
			if f, ok := port.(*syncCloser); ok {
				f.Sync()
			}
			time.Sleep(100 * time.Millisecond)
			log.Println("Density test pattern sent.")
			return
		}

		if *test {
			if *tspl {
				// TSPL simple test label
				// SIZE 50 mm, 30 mm; GAP 2 mm, 0 mm; CLS; TEXT ...; PRINT 1,1
				cmds := []byte("SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm\r\nCLS\r\nTEXT 20,20,\"3\",0,1,1,\"TEST OK\"\r\nPRINT 1,1\r\n")
				log.Printf("Sending TSPL test label: %q", string(cmds))
				log.Printf("Hex dump of commands:")
				for i, b := range cmds {
					fmt.Printf("%02x ", b)
					if (i+1) % 16 == 0 {
						fmt.Println()
					}
				}
				fmt.Println()
				_, err := port.Write(cmds)
				if err != nil {
					log.Fatalf("Failed to send TSPL test commands: %v", err)
				}
				// Force flush and wait a bit
				if f, ok := port.(*syncCloser); ok {
					f.Sync()
				}
				time.Sleep(100 * time.Millisecond)
			} else {
				// ESC/POS
				initCmd := []byte{0x1B, 0x40} // ESC @
				textCmd := []byte("TEST OK")
				feedCmd := []byte{0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00} // 3 LFs + Cut
				
				log.Printf("Sending ESC @ + 'TEST OK' + LF/Cut")
				log.Printf("Hex dump of initCmd: %x", initCmd)
				log.Printf("Hex dump of textCmd: %x", textCmd)
				log.Printf("Hex dump of feedCmd: %x", feedCmd)
				port.Write(initCmd)
				port.Write(textCmd)
				_, err = port.Write(feedCmd)
				if err != nil {
					log.Fatalf("Failed to send test commands: %v", err)
				}
			}
			log.Println("Test commands sent.")
		}
		if *selfTest {
			if *tspl {
				// TSPL self-test
				selfTestCmd := []byte("SELFTEST\r\n")
				log.Printf("Sending TSPL self-test command: %q", string(selfTestCmd))
				_, err := port.Write(selfTestCmd)
				if err != nil {
					log.Fatalf("Failed to send TSPL self-test command: %v", err)
				}
			} else {
				// ESC/POS self-test: US vt eot = 31, 17, 4
				selfTestCmd := []byte{0x1F, 0x11, 0x04}
				log.Printf("Sending ESC/POS self-test command %v", selfTestCmd)
				_, err := port.Write(selfTestCmd)
				if err != nil {
					log.Fatalf("Failed to send self-test command: %v", err)
				}
			}
			log.Println("Self-test command sent. Printer may beep or print test page.")
		}
		if *beep {
			// ESC B m n (m=3, n=3) as used in Android
			beepCmd := []byte{0x1B, 0x42, 0x03, 0x03}
			log.Printf("Sending beep command %v", beepCmd)
			_, err := port.Write(beepCmd)
			if err != nil {
				log.Fatalf("Failed to send beep command: %v", err)
			}
			log.Println("Beep command sent. Printer should beep.")
		}
		if *query {
			queryCmd := generateQueryCommand()
			log.Printf("Sending printer detection query (DLE EOT STX): %x", queryCmd)
			_, err := port.Write(queryCmd)
			if err != nil {
				log.Fatalf("Failed to send query command: %v", err)
			}
			log.Println("Query sent. Printer may respond with status byte.")
		}

		// Optionally read response
		if *readResponse {
			log.Printf("Reading response (timeout 2s)...")
			data, err := readWithTimeout(port, 2*time.Second)
			if err != nil {
				if err.Error() == "timeout" {
					log.Printf("No response received within 2 seconds")
				} else {
					log.Printf("Read error: %v", err)
				}
			} else {
				log.Printf("Received %d bytes: %x", len(data), data)
			}
		}
		return
	}

	if *pdfPath == "" {
		log.Fatal("Missing required flag: --pdf")
	}

	// Map paper size to dot width
	var widthDots int
	switch *paperSize {
	case 58:
		// For ESC/POS, 58mm is often 384 dots. For TSPL (203 DPI), it's ~464 dots.
		if *tspl {
			widthDots = 464 // 58mm * 203dpi / 25.4
		} else {
			widthDots = 384
		}
	case 80:
		if *tspl {
			widthDots = 640 // 80mm * 203dpi / 25.4
		} else {
			widthDots = 576
		}
	case 100:
		widthDots = int(100.0 * float64(*dpi) / 25.4) // ~800 at 203 DPI
	default:
		// Compute based on mm * DPI / 25.4
		widthDots = int(float64(*paperSize) * float64(*dpi) / 25.4)
	}

	log.Printf("Converting PDF %s to bitmap with width %d dots", *pdfPath, widthDots)
	pages, err := pdfToBitmap(*pdfPath, widthDots, *rotate, *invert)
	if err != nil {
		log.Fatalf("PDF conversion failed: %v", err)
	}
	log.Printf("Converted %d pages", len(pages))

	// Generate commands for all pages
	var allCommands []byte
	
	if *tspl {
		log.Println("Generating TSPL commands...")
		for i, page := range pages {
			log.Printf("Processing page %d (%dx%d)", i+1, page.Width, page.Height)
			pageCmds := generateTSPLCommands(page.Pixels, page.Width, page.Height, *paperSize, *paperHeight, *speed, *density, *marginX, *marginY)
			allCommands = append(allCommands, pageCmds...)
		}
	} else {
		log.Println("Generating ESC/POS commands...")
		// ESC/POS init commands (once at start)
		queryCmd := generateQueryCommand()
		initCmd := generateInitCommand()
		lineSpacingCmd := generateLineSpacingCommand(0)
		
		allCommands = append(allCommands, queryCmd...)
		allCommands = append(allCommands, initCmd...)
		allCommands = append(allCommands, lineSpacingCmd...)

		for i, page := range pages {
			log.Printf("Processing page %d", i+1)
			commands := generateRasterCommands(page.Pixels, page.Width, page.Height, *mode)
			allCommands = append(allCommands, commands...)
			
			// Cut after each page? Or just at end? Usually after each label.
			cutCmd := generateCutCommand()
			allCommands = append(allCommands, cutCmd...)
		}
	}

	if *verbose {
		log.Printf("Total command size: %d bytes", len(allCommands))
		if len(allCommands) > 0 {
			end := 64
			if len(allCommands) < end {
				end = len(allCommands)
			}
			log.Printf("First %d bytes of commands: %x", end, allCommands[:end])
			log.Printf("First %d bytes of commands (string): %s", end, string(allCommands[:end]))
		}
	}

	if *dryRun {
		log.Printf("Dry-run enabled, writing commands to %s", *outputFile)
		err := os.WriteFile(*outputFile, allCommands, 0644)
		if err != nil {
			log.Fatalf("Failed to write commands file: %v", err)
		}
		log.Printf("Wrote %d bytes to %s", len(allCommands), *outputFile)
		return
	}

	var port io.ReadWriteCloser
	if *bluetooth {
		log.Printf("Connecting to Bluetooth device %s channel %d", *printerID, *channel)
		port, err = openBluetoothSocket(*printerID, *channel)
		if err != nil {
			log.Fatalf("Failed to open Bluetooth socket: %v", err)
		}
	} else if *usb {
		devicePath := *outputPort
		if devicePath == "/dev/rfcomm0" {
			devicePath = "/dev/usb/lp0"
		}
		log.Printf("Opening USB device %s", devicePath)
		// Use the same openPort helper to ensure consistent flags
		port, err = openPort()
		if err != nil {
			log.Fatalf("Failed to open USB device: %v", err)
		}
	} else {
		log.Printf("Opening serial port %s at %d baud", *outputPort, *baud)
		port, err = openSerialPort(*outputPort, *baud)
		if err != nil {
			log.Fatalf("Failed to open serial port: %v", err)
		}
	}
	defer port.Close()

	// Send commands in chunks to avoid blocking
	chunkSize := 4096 // 4KB chunks
	total := len(allCommands)
	log.Printf("Sending %d bytes in chunks of %d...", total, chunkSize)
	
	for i := 0; i < total; i += chunkSize {
		end := i + chunkSize
		if end > total {
			end = total
		}
		chunk := allCommands[i:end]
		n, err := port.Write(chunk)
		if err != nil {
			log.Fatalf("Failed to send chunk %d-%d: %v", i, end, err)
		}
		if *verbose {
			log.Printf("Sent chunk %d-%d (%d bytes)", i, i+n, n)
		}
		// Small delay to allow printer to process
		time.Sleep(10 * time.Millisecond)
	}
	log.Printf("Sent total %d bytes", total)

	// Explicitly close port here to ensure flush happens before exit
	port.Close()
	log.Println("Print job completed successfully")
}