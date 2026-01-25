/**
 * Transport Layer for Web Serial and Web Bluetooth
 */

class Transport {
    constructor() {
        this.device = null;
        this.writer = null;
        this.reader = null;
        this.type = null; // 'serial' or 'bluetooth'
        this.characteristic = null;
        this.deviceName = null;
        this.onDisconnect = null;
    }

    isConnected() {
        return !!this.device;
    }

    async connect(type, options = {}) {
        if (this.isConnected()) {
            await this.disconnect();
        }

        this.type = type;

        if (type === 'serial') {
            await this.connectSerial(options);
        } else if (type === 'bluetooth') {
            await this.connectBluetooth(options);
        } else {
            throw new Error(`Unknown transport type: ${type}`);
        }
    }

    async disconnect() {
        if (!this.device) return;

        try {
            if (this.writer) {
                await this.writer.close();
                this.writer = null;
            }
            if (this.reader) {
                await this.reader.cancel();
                this.reader = null;
            }

            if (this.type === 'serial') {
                await this.device.close();
            } else if (this.type === 'bluetooth') {
                if (this.device.gatt.connected) {
                    this.device.gatt.disconnect();
                }
            }
        } catch (e) {
            console.error("Error disconnecting:", e);
        } finally {
            this.device = null;
            this.type = null;
            this.characteristic = null;
            this.deviceName = null;
            if (this.onDisconnect) {
                this.onDisconnect();
            }
        }
    }

    async write(data) {
        if (!this.isConnected()) throw new Error("Not connected");

        if (this.type === 'serial') {
            const writer = this.device.writable.getWriter();
            await writer.write(data);
            writer.releaseLock();
        } else if (this.type === 'bluetooth') {
            if (!this.characteristic) {
                throw new Error("Bluetooth characteristic not found");
            }

            // Chunking for BLE
            // Many devices support 20 bytes default, but can negotiate higher.
            // We'll use a safe chunk size or try to writeWithoutResponse if supported for speed.
            const chunkSize = 128;
            
            const canWriteWithoutResponse = this.characteristic.properties.writeWithoutResponse;
            console.log(`Writing ${data.length} bytes. Chunk size: ${chunkSize}. Mode: ${canWriteWithoutResponse ? 'WriteWithoutResponse' : 'WriteWithResponse'}`);

            for (let i = 0; i < data.length; i += chunkSize) {
                const chunk = data.slice(i, i + chunkSize);
                if (canWriteWithoutResponse) {
                    await this.characteristic.writeValueWithoutResponse(chunk);
                } else {
                    await this.characteristic.writeValue(chunk);
                }
            }
        }
    }

    // --- Serial Implementation ---

    async connectSerial(options) {
        if (!navigator.serial) {
            throw new Error("Web Serial API not supported in this browser.");
        }

        this.device = await navigator.serial.requestPort();
        await this.device.open({ baudRate: options.baudRate || 115200 });
        
        // Monitor disconnection
        this.device.addEventListener('disconnect', () => {
            this.disconnect();
        });
    }

    // --- Bluetooth Implementation ---

    async connectBluetooth(options) {
        if (!navigator.bluetooth) {
            throw new Error("Web Bluetooth API not supported in this browser.");
        }

        // Common printer service UUIDs
        // 18f0: Battery Service (often present)
        // 00001101-0000-1000-8000-00805f9b34fb: Serial Port Profile (SPP) - Not directly supported by Web Bluetooth usually
        // Many BLE printers use a custom service for serial data.
        // We need to scan for all services or specific ones.
        // Since we don't know the specific UUID, we might need to ask user or try common ones.
        // Or use acceptAllDevices: true and then inspect services.
        
        // Common BLE Serial Service UUIDs
        const services = [
            '00001800-0000-1000-8000-00805f9b34fb', // Generic Access (for device name)
            '000018f0-0000-1000-8000-00805f9b34fb', // Battery
            'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Some printers
            '0000ff00-0000-1000-8000-00805f9b34fb', // Generic
            '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent
            '00001101-0000-1000-8000-00805f9b34fb'  // SPP (often not exposed in BLE advertisement)
        ];

        let requestOptions = {
            acceptAllDevices: true,
            optionalServices: services
        };
        
        if (options.namePrefix) {
            requestOptions = {
                filters: [{ namePrefix: options.namePrefix }],
                optionalServices: services
            };
        }

        this.device = await navigator.bluetooth.requestDevice(requestOptions);
        
        this.device.addEventListener('gattserverdisconnected', () => {
            this.disconnect();
        });

        const server = await this.device.gatt.connect();
        
        // Try to read device name from Generic Access service
        try {
            const gaService = await server.getPrimaryService('00001800-0000-1000-8000-00805f9b34fb');
            const nameChar = await gaService.getCharacteristic('00002a00-0000-1000-8000-00805f9b34fb');
            const nameValue = await nameChar.readValue();
            this.deviceName = new TextDecoder().decode(nameValue);
            console.log("Device name:", this.deviceName);
        } catch (e) {
            console.warn("Could not read device name:", e);
            this.deviceName = null;
        }
        
        // Find a writable characteristic
        const primaryServices = await server.getPrimaryServices();
        console.log("Found services:", primaryServices.map(s => s.uuid));
        
        let fallbackChar = null;
        for (const service of primaryServices) {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
                console.log(`Char: ${char.uuid}, Props:`, char.properties);
                // Prefer writeWithoutResponse for speed
                if (char.properties.writeWithoutResponse) {
                    this.characteristic = char;
                    console.log("Selected fast characteristic (writeWithoutResponse):", char.uuid);
                    return;
                }
                // Keep track of a fallback characteristic that supports 'write'
                if (char.properties.write && !fallbackChar) {
                    fallbackChar = char;
                }
            }
        }

        if (fallbackChar) {
            this.characteristic = fallbackChar;
            console.log("Selected fallback characteristic (writeWithResponse):", fallbackChar.uuid);
            return;
        }
        
        if (!this.characteristic) {
            throw new Error("No writable characteristic found on device.");
        }
    }
}