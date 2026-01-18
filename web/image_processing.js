/**
 * Image processing utilities for label printing
 */

const ImageProcessing = {
    /**
     * Convert a PDF file to an array of 1-bit bitmap data
     * @param {File} file - The PDF file
     * @param {number} widthDots - Target width in dots
     * @param {boolean} rotate - Whether to rotate 90 degrees
     * @param {boolean} invert - Whether to invert colors (default true for black text on white paper)
     * @returns {Promise<Array<{pixels: Uint8Array, width: number, height: number}>>}
     */
    async processPdf(file, widthDots, rotate, invert) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        const pages = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.0 });
            
            // Calculate scale to match target width
            // If rotating, we match height to widthDots (because height becomes width)
            // Wait, if we rotate 90deg, the original height becomes the new width.
            // So we should scale based on the dimension that will become the width.
            // If rotate=true: original height -> target width. Scale = widthDots / originalHeight
            // If rotate=false: original width -> target width. Scale = widthDots / originalWidth
            
            let scale;
            if (rotate) {
                scale = widthDots / viewport.height;
            } else {
                scale = widthDots / viewport.width;
            }
            
            const scaledViewport = page.getViewport({ scale: scale });
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { willReadFrequently: true });
            canvas.width = Math.floor(scaledViewport.width);
            canvas.height = Math.floor(scaledViewport.height);

            await page.render({
                canvasContext: context,
                viewport: scaledViewport
            }).promise;

            let imageData = context.getImageData(0, 0, canvas.width, canvas.height);

            // Rotate if needed
            if (rotate) {
                imageData = this.rotate90(imageData);
            }

            // Convert to grayscale and then 1-bit
            const pixels = this.thresholdAverage(imageData, invert);
            
            // Ensure width is multiple of 8 for raster commands
            const width = imageData.width;
            const height = imageData.height;
            const widthBytes = Math.ceil(width / 8);
            const paddedWidth = widthBytes * 8;
            
            let finalPixels = pixels;
            
            if (paddedWidth !== width) {
                finalPixels = new Uint8Array(paddedWidth * height);
                for (let y = 0; y < height; y++) {
                    const rowSrc = pixels.subarray(y * width, (y + 1) * width);
                    const rowDstStart = y * paddedWidth;
                    finalPixels.set(rowSrc, rowDstStart);
                    // Padding is already 0 (white) initialized
                }
            }

            pages.push({
                pixels: finalPixels,
                width: paddedWidth,
                height: height,
                originalWidth: width // Keep track of original width if needed
            });
        }
        return pages;
    },

    /**
     * Rotate ImageData 90 degrees clockwise
     * @param {ImageData} imgData 
     * @returns {ImageData}
     */
    rotate90(imgData) {
        const width = imgData.width;
        const height = imgData.height;
        const newWidth = height;
        const newHeight = width;
        const newImgData = new ImageData(newWidth, newHeight);
        const src = imgData.data;
        const dst = newImgData.data;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcIdx = (y * width + x) * 4;
                const dstX = height - 1 - y;
                const dstY = x;
                const dstIdx = (dstY * newWidth + dstX) * 4;

                dst[dstIdx] = src[srcIdx];     // R
                dst[dstIdx + 1] = src[srcIdx + 1]; // G
                dst[dstIdx + 2] = src[srcIdx + 2]; // B
                dst[dstIdx + 3] = src[srcIdx + 3]; // A
            }
        }
        return newImgData;
    },

    /**
     * Convert ImageData to 1-bit pixels using average thresholding
     * @param {ImageData} imgData 
     * @param {boolean} invert - If true, dark pixels become 1 (black), light pixels become 0 (white). 
     *                           If false, dark pixels become 0, light pixels become 1.
     *                           Standard printers print '1' as black dot.
     *                           So usually we want dark colors -> 1.
     *                           The Go code says: "Invert by default... if pixels[i] == 0 { pixels[i] = 1 } else { pixels[i] = 0 }"
     *                           Wait, let's check the Go code logic carefully.
     *                           Go: val > average ? 0 (white) : 1 (black). This is standard "dark is black".
     *                           Then "if !invert { ... invert logic ... }".
     *                           So Go's "invert" flag actually DISABLES the inversion? 
     *                           "invert := flag.Bool("invert", false, "Disable default color inversion")"
     *                           Ah, the flag name is confusing in Go.
     *                           Let's stick to: output 1 = black dot, 0 = white/empty.
     *                           Usually: Dark pixel -> 1, Light pixel -> 0.
     * @returns {Uint8Array} 0 or 1 per pixel
     */
    thresholdAverage(imgData, invert) {
        const width = imgData.width;
        const height = imgData.height;
        const data = imgData.data;
        const totalPixels = width * height;
        const pixels = new Uint8Array(totalPixels);
        
        let sum = 0;
        
        // Calculate average brightness
        // Using simple average of RGB for brightness, or luminance formula
        // Go code uses: int(gray.GrayAt(...).Y) which is luminance
        for (let i = 0; i < totalPixels; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            // Luminance formula: 0.299R + 0.587G + 0.114B
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            sum += gray;
        }
        
        const average = sum / totalPixels;
        console.log(`Average brightness: ${average}`);

        for (let i = 0; i < totalPixels; i++) {
            const r = data[i * 4];
            const g = data[i * 4 + 1];
            const b = data[i * 4 + 2];
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            
            // Standard: Darker than average -> Black (1)
            let isBlack = gray <= average;
            
            // If "invert" is requested (meaning we want white text on black background?), we flip it.
            // But usually "invert" in UI means "Negative".
            // Let's assume the UI checkbox "Invert" means "Standard Black on White" if UNCHECKED?
            // No, usually "Invert" means "Negative".
            // The Go code:
            //   val > average -> 0 (white)
            //   else -> 1 (black)
            //   if !invert (default false) -> flip 0 and 1.
            //   So by default (invert=false), it FLIPS.
            //   Wait, if val > average (light), it becomes 0. If we flip, it becomes 1 (black).
            //   So by default, light pixels become black? That sounds like a negative.
            //   Let's re-read Go code carefully.
            //   Line 257: if val > average { pixels[idx] = 0 } else { pixels[idx] = 1 } -> Standard (Light=0, Dark=1)
            //   Line 145: if !invert { ... flip ... }
            //   So if invert flag is NOT set (false), it flips. So Standard -> Negative.
            //   So by default Go code produces Negative image?
            //   "log.Println("Inverting colors (default behavior)")"
            //   Maybe the input PDF is expected to be white text on black?
            //   Or maybe I'm misinterpreting "invert" flag description.
            //   "invert := flag.Bool("invert", false, "Disable default color inversion")"
            //   This implies there IS a default color inversion.
            
            // Let's implement standard behavior first: Dark = 1 (Black), Light = 0 (White).
            // And allow UI to flip it.
            
            if (invert) {
                // If UI says "Invert", we probably mean "Negative" (White on Black)
                // So Light -> 1 (Black dot), Dark -> 0 (White/Empty)
                // Wait, "Invert Colors" usually means swap Black and White.
                // If original is Black Text on White Paper.
                // Standard print: Text is Black (1), Paper is White (0).
                // Inverted print: Text is White (0), Paper is Black (1).
                
                // Let's stick to:
                // isBlack = true (Dark pixel) -> 1
                // isBlack = false (Light pixel) -> 0
                // if (invert) -> swap.
                
                pixels[i] = isBlack ? 0 : 1;
            } else {
                pixels[i] = isBlack ? 1 : 0;
            }
        }
        
        return pixels;
    },
    
    /**
     * Helper to visualize 1-bit pixels on a canvas
     */
    renderPixelsToCanvas(pixels, width, height, canvas) {
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(width, height);
        const data = imgData.data;
        
        for (let i = 0; i < pixels.length; i++) {
            const val = pixels[i] === 1 ? 0 : 255; // 1=Black, 0=White
            data[i * 4] = val;     // R
            data[i * 4 + 1] = val; // G
            data[i * 4 + 2] = val; // B
            data[i * 4 + 3] = 255; // A
        }
        
        ctx.putImageData(imgData, 0, 0);
    }
};