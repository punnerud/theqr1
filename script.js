class QRScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlay = document.getElementById('overlay');
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.result = document.getElementById('result');
        this.status = document.getElementById('status');
        this.codesScanned = document.getElementById('codes-scanned');
        this.codesList = document.getElementById('codes-list');
        
        this.stream = null;
        this.animationId = null;
        this.qrData = null;
        
        // Track multiple QR codes with timing
        this.trackedCodes = new Map(); // Map of code data -> tracking info
        this.activeOverlays = new Map(); // Map of code data -> overlay element
        
        this.init();
    }
    
    async init() {
        try {
            // Load QR code data
            const response = await fetch('qr-data.json');
            this.qrData = await response.json();
            
            // Set up event listeners
            this.startBtn.addEventListener('click', () => this.startScanning());
            this.stopBtn.addEventListener('click', () => this.stopScanning());
            
            this.status.textContent = 'Ready to scan QR codes';
            
            // Start timing update loop
            this.startTimingUpdates();
        } catch (error) {
            console.error('Error initializing:', error);
            this.status.textContent = 'Error loading QR data';
        }
    }
    
    async startScanning() {
        try {
            // Request camera access
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // Use back camera on mobile
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });
            
            this.video.srcObject = this.stream;
            this.video.setAttribute('playsinline', true);
            this.video.play();
            
            // Wait for video to load
            this.video.addEventListener('loadedmetadata', () => {
                this.canvas.width = this.video.videoWidth;
                this.canvas.height = this.video.videoHeight;
                this.startQRDetection();
            });
            
            this.startBtn.style.display = 'none';
            this.stopBtn.style.display = 'inline-block';
            this.status.textContent = 'Scanning for QR codes...';
            this.codesScanned.style.display = 'block';
            
        } catch (error) {
            console.error('Error accessing camera:', error);
            this.status.textContent = 'Camera access denied or not available';
        }
    }
    
    stopScanning() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        this.video.srcObject = null;
        this.clearAllOverlays();
        this.trackedCodes.clear();
        
        this.startBtn.style.display = 'inline-block';
        this.stopBtn.style.display = 'none';
        this.status.textContent = 'Scanner stopped';
        this.result.textContent = '';
        this.result.className = 'result';
        this.codesScanned.style.display = 'none';
    }
    
    startQRDetection() {
        const detect = () => {
            if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
                this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
                const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
                
                // Find all QR codes in the image
                const detectedCodes = this.findAllQRCodes(imageData);
                this.handleMultipleQRCodes(detectedCodes);
            }
            
            this.animationId = requestAnimationFrame(detect);
        };
        
        detect();
    }
    
    findAllQRCodes(imageData) {
        const codes = [];
        
        // For now, jsQR only finds one code at a time
        // We could implement multiple detection by scanning different regions
        // But for simplicity, we'll use the single detection and track over time
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
            codes.push(code);
        }
        
        // TODO: In a more advanced implementation, we could:
        // 1. Divide the image into regions and scan each
        // 2. Use a different library that supports multiple QR detection
        // 3. Track movement of codes to maintain multiple simultaneous codes
        
        return codes;
    }
    
    handleMultipleQRCodes(detectedCodes) {
        const currentTime = Date.now();
        const currentlyVisible = new Set();
        
        // Process all detected codes
        for (const code of detectedCodes) {
            currentlyVisible.add(code.data);
            
            // Update or create tracking info
            if (!this.trackedCodes.has(code.data)) {
                const matchedQR = this.qrData.qrCodes.find(qr => qr.text === code.data);
                this.trackedCodes.set(code.data, {
                    data: code.data,
                    matchedQR: matchedQR,
                    firstSeen: currentTime,
                    lastSeen: currentTime,
                    isVisible: true
                });
            } else {
                // Update existing tracking
                const tracking = this.trackedCodes.get(code.data);
                tracking.lastSeen = currentTime;
                tracking.isVisible = true;
            }
            
            // Create or update overlay
            this.createOrUpdateOverlay(code);
        }
        
        // Mark codes as not visible if they weren't detected this frame
        for (const [codeData, tracking] of this.trackedCodes) {
            if (!currentlyVisible.has(codeData)) {
                tracking.isVisible = false;
                // Remove overlay for invisible codes
                if (this.activeOverlays.has(codeData)) {
                    this.activeOverlays.get(codeData).remove();
                    this.activeOverlays.delete(codeData);
                }
            }
        }
        
        // Update the codes list display
        this.updateCodesDisplay();
    }
    
    createOrUpdateOverlay(code) {
        const codeData = code.data;
        const tracking = this.trackedCodes.get(codeData);
        
        // Remove existing overlay if it exists
        if (this.activeOverlays.has(codeData)) {
            this.activeOverlays.get(codeData).remove();
        }
        
        // Create new overlay
        const overlayBox = document.createElement('div');
        overlayBox.className = 'qr-overlay-box';
        
        if (tracking.matchedQR) {
            overlayBox.style.borderColor = tracking.matchedQR.color;
            overlayBox.style.backgroundColor = tracking.matchedQR.color + '20';
        } else {
            overlayBox.style.borderColor = '#ffffff';
            overlayBox.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        }
        
        // Calculate position and size
        const videoRect = this.video.getBoundingClientRect();
        const scaleX = videoRect.width / this.canvas.width;
        const scaleY = videoRect.height / this.canvas.height;
        
        const left = code.location.topLeftCorner.x * scaleX;
        const top = code.location.topLeftCorner.y * scaleY;
        const width = (code.location.topRightCorner.x - code.location.topLeftCorner.x) * scaleX;
        const height = (code.location.bottomLeftCorner.y - code.location.topLeftCorner.y) * scaleY;
        
        overlayBox.style.left = left + 'px';
        overlayBox.style.top = top + 'px';
        overlayBox.style.width = width + 'px';
        overlayBox.style.height = height + 'px';
        
        this.overlay.appendChild(overlayBox);
        this.activeOverlays.set(codeData, overlayBox);
    }
    
    updateCodesDisplay() {
        const currentTime = Date.now();
        const codesArray = Array.from(this.trackedCodes.values());
        
        // Filter codes that were seen in the last 10 seconds
        const recentCodes = codesArray.filter(tracking => {
            const timeSinceLastSeen = (currentTime - tracking.lastSeen) / 1000;
            return timeSinceLastSeen <= 10;
        });
        
        // Sort by most recently seen
        recentCodes.sort((a, b) => b.lastSeen - a.lastSeen);
        
        // Update the display
        this.codesList.innerHTML = '';
        
        if (recentCodes.length === 0) {
            this.codesList.innerHTML = '<div style="text-align: center; opacity: 0.7; padding: 20px;">No codes scanned in the last 10 seconds</div>';
            return;
        }
        
        for (const tracking of recentCodes) {
            const timeSinceLastSeen = Math.floor((currentTime - tracking.lastSeen) / 1000);
            
            const entryDiv = document.createElement('div');
            entryDiv.className = 'code-entry';
            
            const infoDiv = document.createElement('div');
            infoDiv.className = 'code-info';
            
            const nameDiv = document.createElement('div');
            nameDiv.className = 'code-name';
            if (tracking.matchedQR) {
                nameDiv.style.color = tracking.matchedQR.color;
                nameDiv.textContent = tracking.matchedQR.name;
            } else {
                nameDiv.textContent = 'Unknown QR Code';
            }
            
            const textDiv = document.createElement('div');
            textDiv.className = 'code-text';
            textDiv.textContent = tracking.data.length > 30 ? 
                tracking.data.substring(0, 30) + '...' : tracking.data;
            
            infoDiv.appendChild(nameDiv);
            infoDiv.appendChild(textDiv);
            
            const timingDiv = document.createElement('div');
            timingDiv.className = 'code-timing';
            
            if (tracking.isVisible) {
                timingDiv.textContent = '0';
                timingDiv.className += ' visible-now';
            } else {
                timingDiv.textContent = timeSinceLastSeen + 's';
                timingDiv.className += ' recently-seen';
            }
            
            entryDiv.appendChild(infoDiv);
            entryDiv.appendChild(timingDiv);
            this.codesList.appendChild(entryDiv);
        }
        
        // Update result display with current visible codes
        const visibleCodes = recentCodes.filter(t => t.isVisible);
        if (visibleCodes.length > 0) {
            const matchedCount = visibleCodes.filter(t => t.matchedQR).length;
            this.result.innerHTML = `
                <strong>🔍 ${visibleCodes.length} QR Code${visibleCodes.length > 1 ? 's' : ''} Detected</strong><br>
                <small>${matchedCount} matched in database</small>
            `;
            this.result.className = matchedCount > 0 ? 'result match-found' : 'result';
        } else {
            this.result.innerHTML = '';
            this.result.className = 'result';
        }
    }
    
    startTimingUpdates() {
        // Update timing display every second
        setInterval(() => {
            if (this.trackedCodes.size > 0) {
                this.updateCodesDisplay();
            }
        }, 1000);
    }
    
    clearAllOverlays() {
        this.overlay.innerHTML = '';
        this.activeOverlays.clear();
    }
    
    playSound(type) {
        // Create audio context for sound feedback
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            if (type === 'success') {
                oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
                oscillator.frequency.setValueAtTime(1000, audioContext.currentTime + 0.1);
            }
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
        } catch (error) {
            // Audio not supported or blocked
            console.log('Audio feedback not available');
        }
    }
}

// Initialize the QR Scanner when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new QRScanner();
});

// Handle orientation changes on mobile
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        location.reload();
    }, 500);
}); 