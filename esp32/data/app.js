/**
 * Main Application Logic
 */

const App = {
    transport: null,
    selectedFile: null,
    presets: null,
    printerConnected: false,

    init() {
        this.loadPresets();
        this.bindEvents();
        // Automatically connect on init
        this.connect();
        
        // Start polling status
        this.checkStatus();
        setInterval(() => this.checkStatus(), 2000);

        this.log("Application initialized. Ready to print.");
    },

    async checkStatus() {
        try {
            const response = await fetch('/status');
            if (!response.ok) return;
            const status = await response.json();
            
            const isConnected = status.printer === 'connected';
            const statusEl = document.getElementById('printer-status');
            const nameEl = document.getElementById('printer-name');
            
            if (statusEl) {
                if (isConnected) {
                    statusEl.textContent = 'Printer: Connected';
                    statusEl.className = 'status-badge status-connected';
                } else {
                    statusEl.textContent = 'Printer: Disconnected';
                    statusEl.className = 'status-badge status-disconnected';
                }
            }
            
            if (nameEl) {
                if (status.printerName && status.printerName !== 'Unknown') {
                    nameEl.textContent = status.printerName;
                    nameEl.style.display = 'block';
                } else {
                    nameEl.textContent = '';
                    nameEl.style.display = 'none';
                }
            }

            // Auto-connect logic
            if (isConnected && !this.printerConnected) {
                if (!this.transport || !this.transport.isConnected()) {
                    this.log("Printer connected! Initializing transport...", "success");
                    await this.connect();
                } else {
                    this.log("Printer connected!", "success");
                }
            } else if (!isConnected && this.printerConnected) {
                this.log("Printer disconnected.", "warning");
            }

            this.printerConnected = isConnected;

        } catch (e) {
            // Silent fail for polling
        }
    },

    createTransport() {
        // Always HTTP
        return new HTTPTransport();
    },

    loadPresets() {
        try {
            // Load presets from JavaScript file to avoid CORS issues
            this.presets = PaperPresets.presets;
            
            // Populate preset dropdown
            const select = document.getElementById('paper-preset');
            select.innerHTML = '';
            this.presets.forEach(preset => {
                const option = document.createElement('option');
                option.value = preset.name.toLowerCase().replace(/\s+/g, '').replace(/\(|\)/g, '');
                option.textContent = preset.name;
                select.appendChild(option);
            });
            
            this.log(`Loaded ${this.presets.length} paper presets`);
        } catch (error) {
            this.log(`Failed to load presets: ${error.message}`, "error");
            console.error(error);
        }
    },

    bindEvents() {
        // File Input
        document.getElementById('file-input').addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Print
        document.getElementById('btn-print').addEventListener('click', () => this.print());
        
        // Calibration
        const btnCalibration = document.getElementById('btn-calibration');
        if (btnCalibration) {
            btnCalibration.addEventListener('click', () => this.calibrationPattern());
        }
        
        // Log
        document.getElementById('btn-clear-log').addEventListener('click', () => {
            document.getElementById('log').innerHTML = '';
        });

        // Preset Selection
        document.getElementById('paper-preset').addEventListener('change', (e) => this.applyPreset(e.target.value));
    },

    applyPreset(presetId) {
        const preset = this.presets.find(p => p.name.toLowerCase().replace(/\s+/g, '').replace(/\(|\)/g, '') === presetId);
        if (!preset) {
            this.log(`Preset ${presetId} not found`, "error");
            return;
        }

        // Apply preset values to input fields
        document.getElementById('paper-width').value = preset.paperWidth;
        document.getElementById('paper-height').value = preset.paperHeight;
        document.getElementById('dpi').value = preset.dpi;
        document.getElementById('margin-x').value = preset.marginX;
        document.getElementById('margin-y').value = preset.marginY;

        // Toggle input fields based on preset type
        const isCustom = presetId === 'custom';
        document.getElementById('paper-width').disabled = !isCustom;
        document.getElementById('paper-height').disabled = !isCustom;
        document.getElementById('dpi').disabled = !isCustom;
        document.getElementById('margin-x').disabled = !isCustom;
        document.getElementById('margin-y').disabled = !isCustom;

        this.log(`Applied preset: ${preset.name}`);
        
        // Regenerate preview if file is selected
        if (this.selectedFile) {
            this.generatePreview();
        }
    },

    async connect() {
        try {
            this.transport = this.createTransport();
            // Connect using default options (current origin)
            await this.transport.connect('http');
            this.log("Connected to printer.", "success");
        } catch (e) {
            this.log(`Connection failed: ${e.message}`, "error");
            console.error(e);
            this.transport = null;
        }
    },

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        if (file.type !== 'application/pdf') {
            this.log("Please select a PDF file.", "error");
            return;
        }
        
        this.selectedFile = file;
        this.log(`Selected file: ${file.name}`);
        
        // Enable print button if file is selected (we assume always connected)
        document.getElementById('btn-print').disabled = false;
        
        // Preview
        await this.generatePreview();
    },

    async generatePreview() {
        if (!this.selectedFile) return;
        
        const container = document.getElementById('preview-container');
        container.innerHTML = '<p>Generating preview...</p>';
        
        try {
            const options = this.getOptions();
            const pages = await ImageProcessing.processPdf(
                this.selectedFile,
                options.widthDots,
                options.rotate,
                options.invert
            );
            
            container.innerHTML = '';
            
            // Add page selection controls if there are multiple pages
            if (pages.length > 1) {
                const controls = document.createElement('div');
                controls.style.marginBottom = '20px';
                controls.style.display = 'flex';
                controls.style.gap = '10px';
                controls.style.flexWrap = 'wrap';
                
                const selectAllBtn = document.createElement('button');
                selectAllBtn.textContent = 'Select All';
                selectAllBtn.className = 'secondary';
                selectAllBtn.style.padding = '5px 10px';
                selectAllBtn.style.fontSize = '12px';
                selectAllBtn.addEventListener('click', () => {
                    const checkboxes = container.querySelectorAll('.page-checkbox');
                    checkboxes.forEach(cb => cb.checked = true);
                });
                
                const clearAllBtn = document.createElement('button');
                clearAllBtn.textContent = 'Clear All';
                clearAllBtn.className = 'secondary';
                clearAllBtn.style.padding = '5px 10px';
                clearAllBtn.style.fontSize = '12px';
                clearAllBtn.addEventListener('click', () => {
                    const checkboxes = container.querySelectorAll('.page-checkbox');
                    checkboxes.forEach(cb => cb.checked = false);
                });
                
                controls.appendChild(selectAllBtn);
                controls.appendChild(clearAllBtn);
                container.appendChild(controls);
            }
            
            pages.forEach((page, i) => {
                const pageWrapper = document.createElement('div');
                pageWrapper.style.marginBottom = '20px';
                pageWrapper.style.textAlign = 'center';
                
                const canvas = document.createElement('canvas');
                ImageProcessing.renderPixelsToCanvas(page.pixels, page.width, page.height, canvas);
                pageWrapper.appendChild(canvas);
                
                const info = document.createElement('div');
                info.style.marginTop = '10px';
                
                if (pages.length > 1) {
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'page-checkbox';
                    checkbox.id = `page-${i+1}`;
                    checkbox.checked = true;
                    checkbox.style.marginRight = '5px';
                    
                    const label = document.createElement('label');
                    label.htmlFor = `page-${i+1}`;
                    label.textContent = `Page ${i+1}: ${page.width}x${page.height} dots`;
                    
                    info.appendChild(checkbox);
                    info.appendChild(label);
                } else {
                    info.textContent = `Page ${i+1}: ${page.width}x${page.height} dots`;
                }
                
                pageWrapper.appendChild(info);
                container.appendChild(pageWrapper);
            });
            
            this.log(`Preview generated for ${pages.length} pages.`);
        } catch (e) {
            container.innerHTML = `<p style="color:red">Preview failed: ${e.message}</p>`;
            this.log(`Preview error: ${e.message}`, "error");
            console.error(e);
        }
    },
    
    getSelectedPages() {
        const checkboxes = document.querySelectorAll('.page-checkbox');
        const selectedIndices = [];
        checkboxes.forEach((cb, index) => {
            if (cb.checked) {
                selectedIndices.push(index);
            }
        });
        return selectedIndices;
    },

    getOptions() {
        const paperWidthMm = parseInt(document.getElementById('paper-width').value) || 58;
        const paperHeightMm = parseInt(document.getElementById('paper-height').value) || 40;
        const dpi = parseInt(document.getElementById('dpi').value) || 203;
        
        // Calculate width in dots
        // 1 inch = 25.4 mm
        // dots = mm * dpi / 25.4
        const widthDots = Math.floor(paperWidthMm * dpi / 25.4);
        
        return {
            cmdSet: document.getElementById('cmd-set').value,
            paperWidth: paperWidthMm,
            paperHeight: paperHeightMm,
            dpi: dpi,
            widthDots: widthDots,
            speed: parseInt(document.getElementById('speed').value) || 4,
            density: parseInt(document.getElementById('density').value) || 8,
            marginX: parseInt(document.getElementById('margin-x').value) || 0,
            marginY: parseInt(document.getElementById('margin-y').value) || 0,
            invert: document.getElementById('invert').checked,
            rotate: document.getElementById('rotate').checked
        };
    },

    async print() {
        if (!this.selectedFile) return;
        if (!this.transport || !this.transport.isConnected()) {
            // Try to reconnect if not connected
             await this.connect();
             if (!this.transport || !this.transport.isConnected()) {
                this.log("Not connected to printer.", "error");
                return;
             }
        }
        
        try {
            this.log("Processing PDF...");
            const options = this.getOptions();
            const pages = await ImageProcessing.processPdf(
                this.selectedFile,
                options.widthDots,
                options.rotate,
                options.invert
            );
            
            // Get selected pages
            const selectedIndices = this.getSelectedPages();

            // If it's a single page, it's always selected (no checkboxes generated)
            if (pages.length === 1 && selectedIndices.length === 0) {
                selectedIndices.push(0);
            }

            if (selectedIndices.length === 0) {
                this.log("No pages selected for printing.", "error");
                return;
            }
            
            const selectedPages = selectedIndices.map(index => pages[index]);
            
            this.log(`Generating ${options.cmdSet.toUpperCase()} commands for ${selectedPages.length} selected page(s)...`);
            let data;
            if (options.cmdSet === 'tspl') {
                data = PrinterCommands.generateTsplCommands(selectedPages, options);
            } else {
                data = PrinterCommands.generateEscPosCommands(selectedPages, options);
            }
            
            this.log(`Sending ${data.length} bytes to printer...`);
            await this.transport.write(data);
            this.log("Print job sent successfully!", "success");
            
        } catch (e) {
            this.log(`Print failed: ${e.message}`, "error");
            console.error(e);
        }
    },
    
    async calibrationPattern() {
        if (!this.transport || !this.transport.isConnected()) {
             await this.connect();
             if (!this.transport || !this.transport.isConnected()) return;
        }
        try {
            const options = this.getOptions();
            if (options.cmdSet !== 'tspl') {
                this.log("Calibration pattern requires TSPL mode", "error");
                return;
            }
            
            this.log("Generating calibration pattern...");
            const data = PrinterCommands.generateCalibrationPattern(options);
            
            this.log(`Sending ${data.length} bytes...`);
            await this.transport.write(data);
            this.log("Sent calibration pattern", "success");
        } catch (e) {
            this.log(`Error: ${e.message}`, "error");
        }
    },

    log(message, type = "info") {
        const logEl = document.getElementById('log');
        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        
        const time = new Date().toLocaleTimeString();
        entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;
        
        logEl.appendChild(entry);
        logEl.scrollTop = logEl.scrollHeight;
    }
};

// Start app
window.addEventListener('DOMContentLoaded', () => {
    App.init();
});