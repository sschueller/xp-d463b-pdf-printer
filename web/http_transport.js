/**
 * HTTP Transport for ESP32 Web Server
 */

class HTTPTransport {
    constructor() {
        this.serverUrl = null;
        this.deviceName = null;
        this.onDisconnect = null;
    }

    isConnected() {
        return !!this.serverUrl;
    }

    async connect(type, options = {}) {
        if (this.isConnected()) {
            await this.disconnect();
        }

        // type should be 'http'
        if (type !== 'http') {
            throw new Error(`HTTPTransport only supports 'http' type, got ${type}`);
        }

        // options should contain serverUrl or we can construct from host/port
        let serverUrl = options.serverUrl;
        if (!serverUrl) {
            const host = options.host || window.location.hostname || '192.168.1.1';
            const port = options.port || 80;
            const protocol = options.protocol || (port === 443 ? 'https' : 'http');
            serverUrl = `${protocol}://${host}:${port}`;
        }

        // Ensure no trailing slash
        this.serverUrl = serverUrl.replace(/\/$/, '');
        this.deviceName = options.deviceName || 'ESP32 Printer';

        // Test connection by fetching /status
        try {
            const response = await fetch(`${this.serverUrl}/status`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                mode: 'cors',
                cache: 'no-cache'
            });
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            console.log('Server status:', data);
        } catch (error) {
            throw new Error(`Failed to connect to server: ${error.message}`);
        }

        // Connected successfully
        return;
    }

    async disconnect() {
        this.serverUrl = null;
        this.deviceName = null;
        if (this.onDisconnect) {
            this.onDisconnect();
        }
    }

    async write(data) {
        if (!this.isConnected()) throw new Error("Not connected");

        // Convert data to ArrayBuffer if needed
        let buffer;
        if (data instanceof ArrayBuffer) {
            buffer = data;
        } else if (data instanceof Uint8Array) {
            buffer = data.buffer;
        } else if (typeof data === 'string') {
            const encoder = new TextEncoder();
            buffer = encoder.encode(data).buffer;
        } else {
            throw new Error('Unsupported data type for HTTP write');
        }

        // POST binary data to /print endpoint
        const response = await fetch(`${this.serverUrl}/print`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
            },
            body: buffer,
            mode: 'cors',
            cache: 'no-cache'
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Print request failed: ${response.status} ${response.statusText} - ${text}`);
        }

        // Optionally read response text
        const responseText = await response.text();
        if (responseText) {
            console.log('Server response:', responseText);
        }
    }
}