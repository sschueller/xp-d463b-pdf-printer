/**
 * Printer Command Generators (ESC/POS and TSPL)
 */

const PrinterCommands = {
    
    // --- ESC/POS Commands ---

    generateEscPosCommands(pages, options = {}) {
        // Backward compatibility: if options is a number, treat as mode
        let mode = 0;
        let invert = false;
        if (typeof options === 'number') {
            mode = options;
        } else {
            mode = options.mode || 0;
            invert = options.invert || false;
        }
        
        const chunks = [];
        let totalLength = 0;

        const addChunk = (chunk) => {
            const u8 = new Uint8Array(chunk);
            chunks.push(u8);
            totalLength += u8.length;
        };
        
        // Init
        addChunk(this.escPosInit());
        addChunk(this.escPosLineSpacing(0));
        
        for (const page of pages) {
            // Raster data
            const rasterCmds = this.generateRasterCommands(page.pixels, page.width, page.height, mode, invert);
            addChunk(rasterCmds);
            
            // Cut
            addChunk(this.escPosCut());
        }
        
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        
        return result;
    },

    escPosInit() {
        return [0x1B, 0x40]; // ESC @
    },

    escPosLineSpacing(n) {
        return [0x1B, 0x33, n]; // ESC 3 n
    },

    escPosCut() {
        return [0x1D, 0x56, 0x42, 0x01]; // GS V 66 1
    },

    generateRasterCommands(pixels, width, height, mode, invert = false) {
        const widthBytes = width / 8;
        const cmdSize = widthBytes + 8;
        const total = height * cmdSize;
        const commands = new Uint8Array(total);
        
        // Precompute bit masks (MSB top)
        const bitMask = [128, 64, 32, 16, 8, 4, 2, 1];
        
        let pixelIdx = 0;
        for (let y = 0; y < height; y++) {
            const offset = y * cmdSize;
            
            // GS v 0 header
            commands[offset] = 0x1D; // GS
            commands[offset + 1] = 0x76; // v
            commands[offset + 2] = 0x30; // 0
            commands[offset + 3] = mode & 1;
            commands[offset + 4] = widthBytes % 256; // xL
            commands[offset + 5] = Math.floor(widthBytes / 256); // xH
            commands[offset + 6] = 1; // yL
            commands[offset + 7] = 0; // yH
            
            // Pack pixels
            for (let bx = 0; bx < widthBytes; bx++) {
                let b = 0;
                for (let bit = 0; bit < 8; bit++) {
                    let bitValue = pixels[pixelIdx];
                    // If invert flag is false (unchecked), we need to invert bits for printer
                    if (!invert) {
                        bitValue = bitValue === 1 ? 0 : 1;
                    }
                    if (bitValue === 1) {
                        b |= bitMask[bit];
                    }
                    pixelIdx++;
                }
                commands[offset + 8 + bx] = b;
            }
        }
        
        return commands;
    },

    // --- TSPL Commands ---

    generateTsplCommands(pages, options) {
        const { paperWidth, paperHeight, speed, density, marginX, marginY, invert } = options;
        
        const chunks = [];
        let totalLength = 0;

        const addChunk = (chunk) => {
            const u8 = new Uint8Array(chunk);
            chunks.push(u8);
            totalLength += u8.length;
        };

        for (const page of pages) {
            const cmds = this.generateTsplPage(page.pixels, page.width, page.height, {
                paperWidth, paperHeight, speed, density, marginX, marginY, invert
            });
            addChunk(cmds);
        }
        
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        
        return result;
    },

    generateTsplPage(pixels, width, height, options) {
        const { paperWidth, paperHeight, speed, density, marginX, marginY, invert } = options;
        const encoder = new TextEncoder();
        
        const chunks = [];
        let totalLength = 0;

        const addChunk = (chunk) => {
            const u8 = new Uint8Array(chunk);
            chunks.push(u8);
            totalLength += u8.length;
        };

        // 1. Setup
        let hMm = paperHeight;
        if (!hMm || hMm <= 0) {
            hMm = Math.floor(height / 8);
            if (hMm < 10) hMm = 10;
        }

        addChunk(encoder.encode(`SIZE ${paperWidth} mm,${hMm} mm\r\n`));
        addChunk(encoder.encode(`GAP 2 mm,0 mm\r\n`));
        addChunk(encoder.encode(`DIRECTION 1\r\n`));
        addChunk(encoder.encode(`SPEED ${speed}\r\n`));
        addChunk(encoder.encode(`DENSITY ${density}\r\n`));
        addChunk(encoder.encode(`CLS\r\n`));

        // 2. Bitmap
        const widthBytes = Math.ceil(width / 8);
        addChunk(encoder.encode(`BITMAP ${marginX},${marginY},${widthBytes},${height},0,`));
        
        // 3. Bitmap Data
        const bitmapData = new Uint8Array(widthBytes * height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < widthBytes; x++) {
                let b = 0;
                for (let bit = 0; bit < 8; bit++) {
                    const pxIdx = y * width + x * 8 + bit;
                    if (pxIdx < pixels.length) {
                        let bitValue = pixels[pxIdx];
                        // If invert flag is false (unchecked), we need to invert bits for printer
                        if (!invert) {
                            bitValue = bitValue === 1 ? 0 : 1;
                        }
                        if (bitValue === 1) {
                            b |= 1 << (7 - bit); // MSB first
                        }
                    }
                }
                bitmapData[y * widthBytes + x] = b;
            }
        }
        
        addChunk(bitmapData);

        // 4. Print
        addChunk(encoder.encode(`\r\nPRINT 1,1\r\n`));

        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        return result;
    },
    
    generateCalibrationPattern(options) {
        const { paperWidth, paperHeight, speed, density, marginX, marginY } = options;
        const encoder = new TextEncoder();
        let cmds = [];
        
        cmds.push(...encoder.encode(`SIZE ${paperWidth} mm,${paperHeight} mm\r\n`));
        cmds.push(...encoder.encode(`GAP 2 mm,0 mm\r\n`));
        cmds.push(...encoder.encode(`DIRECTION 1\r\n`));
        cmds.push(...encoder.encode(`SPEED ${speed}\r\n`));
        cmds.push(...encoder.encode(`DENSITY ${density}\r\n`));
        cmds.push(...encoder.encode(`CLS\r\n`));
        
        const wDots = paperWidth * 8;
        const hDots = paperHeight * 8;
        
        // Box
        cmds.push(...encoder.encode(`BOX ${2+marginX},${2+marginY},${wDots-2+marginX},${hDots-2+marginY},4\r\n`));
        
        // Crosshair
        const centerX = Math.floor(wDots / 2);
        const centerY = Math.floor(hDots / 2);
        cmds.push(...encoder.encode(`BAR ${centerX-1+marginX},${centerY-10+marginY},2,20\r\n`));
        cmds.push(...encoder.encode(`BAR ${centerX-10+marginX},${centerY-1+marginY},20,2\r\n`));
        
        // Ticks
        for (let x = 0; x < wDots; x += 40) {
            cmds.push(...encoder.encode(`BAR ${x+marginX},${0+marginY},2,10\r\n`));
        }
        for (let y = 0; y < hDots; y += 40) {
            cmds.push(...encoder.encode(`BAR ${0+marginX},${y+marginY},10,2\r\n`));
        }
        
        // Text
        cmds.push(...encoder.encode(`TEXT ${50+marginX},${50+marginY},"3",0,1,1,"Size: ${paperWidth}x${paperHeight} mm"\r\n`));
        cmds.push(...encoder.encode(`TEXT ${50+marginX},${80+marginY},"3",0,1,1,"Check margins"\r\n`));
        
        cmds.push(...encoder.encode(`PRINT 1,1\r\n`));
        
        return new Uint8Array(cmds);
    }
};