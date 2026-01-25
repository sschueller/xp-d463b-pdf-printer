/**
 * Main Application Logic
 */

const App = {
    transport: null,
    selectedFile: null,
    presets: null,

    init() {
        this.loadPresets();
        this.bindEvents();
        this.toggleInterfaceOptions(document.getElementById('interface-type').value);
        this.log("Application initialized. Ready to connect.");
    },

    createTransport(type) {
        if (type === 'http') {
            return new HTTPTransport();
        } else {
            return new Transport();
        }
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
        // Connection
        document.getElementById('btn-connect').addEventListener('click', () => this.connect());
        document.getElementById('btn-disconnect').addEventListener('click', () => this.disconnect());
        
        document.getElementById('interface-type').addEventListener('change', (e) => this.toggleInterfaceOptions(e.target.value));

        // File Input
        document.getElementById('file-input').addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Print
        document.getElementById('btn-print').addEventListener('click', () => this.print());
        
        // Test Buttons
        document.getElementById('btn-test-feed').addEventListener('click', () => this.testFeed());
        document.getElementById('btn-self-test').addEventListener('click', () => this.selfTest());
        document.getElementById('btn-calibration').addEventListener('click', () => this.calibrationPattern());
        
        // Log
        document.getElementById('btn-clear-log').addEventListener('click', () => {
            document.getElementById('log').innerHTML = '';
        });

        // Preset Selection
        document.getElementById('paper-preset').addEventListener('change', (e) => this.applyPreset(e.target.value));

        // Transport Events will be set when transport is created
    },

    toggleInterfaceOptions(type) {
        const baudRateGroup = document.getElementById('baud-rate-group');
        const serverUrlGroup = document.getElementById('server-url-group');
        if (type === 'serial') {
            baudRateGroup.style.display = 'flex';
            serverUrlGroup.style.display = 'none';
        } else if (type === 'http') {
            baudRateGroup.style.display = 'none';
            serverUrlGroup.style.display = 'flex';
        } else {
            baudRateGroup.style.display = 'none';
            serverUrlGroup.style.display = 'none';
        }
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
        const type = document.getElementById('interface-type').value;
        const printerId = document.getElementById('printer-id').value;
        const baudRate = parseInt(document.getElementById('baud-rate').value) || 115200;
        const serverUrl = document.getElementById('server-url').value;
        
        try {
            this.log(`Connecting via ${type}...`);
            // Create appropriate transport
            this.transport = this.createTransport(type);
            // Set disconnect callback
            this.transport.onDisconnect = () => this.updateConnectionStatus(false);
            
            const options = {};
            if (type === 'serial') {
                options.baudRate = baudRate;
                options.namePrefix = printerId;
            } else if (type === 'bluetooth') {
                options.namePrefix = printerId;
            } else if (type === 'http') {
                options.serverUrl = serverUrl;
                options.deviceName = 'ESP32 Printer';
            }
            
            await this.transport.connect(type, options);
            this.updateConnectionStatus(true);
            const deviceName = this.transport.deviceName;
            if (deviceName) {
                this.log(`Connected successfully! Device name: ${deviceName}`, "success");
            } else {
                this.log("Connected successfully!", "success");
            }
        } catch (e) {
            this.log(`Connection failed: ${e.message}`, "error");
            console.error(e);
            // Clean up transport on failure
            this.transport = null;
        }
    },

    async disconnect() {
        if (!this.transport) {
            this.updateConnectionStatus(false);
            return;
        }
        try {
            await this.transport.disconnect();
            this.updateConnectionStatus(false);
            this.log("Disconnected.");
        } catch (e) {
            this.log(`Disconnect error: ${e.message}`, "error");
        } finally {
            this.transport = null;
        }
    },

    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connection-status');
        const btnConnect = document.getElementById('btn-connect');
        const btnDisconnect = document.getElementById('btn-disconnect');
        const btnPrint = document.getElementById('btn-print');
        
        if (connected) {
            statusEl.textContent = "Connected";
            statusEl.className = "status-badge status-connected";
            btnConnect.disabled = true;
            btnDisconnect.disabled = false;
            if (this.selectedFile) btnPrint.disabled = false;
        } else {
            statusEl.textContent = "Disconnected";
            statusEl.className = "status-badge status-disconnected";
            btnConnect.disabled = false;
            btnDisconnect.disabled = true;
            btnPrint.disabled = true;
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
        
        if (this.transport.isConnected()) {
            document.getElementById('btn-print').disabled = false;
        }
        
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
        if (!this.transport.isConnected()) {
            this.log("Not connected to printer.", "error");
            return;
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

    async testFeed() {
        if (!this.transport.isConnected()) return;
        try {
            // ESC/POS Feed: LF (0x0A)
            // TSPL Feed: FORMFEED? Or just empty print?
            // Let's send a simple LF for ESC/POS and nothing for TSPL?
            // Actually TSPL usually needs SIZE/GAP setup to feed correctly.
            // But let's try generic LF.
            const data = new Uint8Array([0x0A]);
            await this.transport.write(data);
            this.log("Sent Line Feed");
        } catch (e) {
            this.log(`Error: ${e.message}`, "error");
        }
    },

    async selfTest() {
        if (!this.transport.isConnected()) return;
        try {
            // ESC/POS Self Test: GS ( A (0x1D 0x28 0x41 ...) or US vt eot (0x1F 0x11 0x04)
            // Go code uses: 0x1F, 0x11, 0x04
            const data = new Uint8Array([0x1F, 0x11, 0x04]);
            await this.transport.write(data);
            this.log("Sent Self Test command");
        } catch (e) {
            this.log(`Error: ${e.message}`, "error");
        }
    },
    
    async calibrationPattern() {
        if (!this.transport.isConnected()) return;
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