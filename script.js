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
        
        // Enhanced tracking with visual templates
        this.trackedCodes = new Map(); // Map of code data -> tracking info with visual data
        this.activeOverlays = new Map(); // Map of code data -> overlay element
        
        // Tracking canvas for template matching
        this.trackingCanvas = document.createElement('canvas');
        this.trackingCtx = this.trackingCanvas.getContext('2d');
        
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
                this.trackingCanvas.width = this.video.videoWidth;
                this.trackingCanvas.height = this.video.videoHeight;
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
                
                // First, try to track existing QR codes using visual tracking
                this.trackExistingCodes(imageData);
                
                // Then, look for new QR codes with jsQR (less frequently to reduce jumping)
                if (Math.random() < 0.3) { // Only scan for new codes 30% of the time
                    const detectedCodes = this.findAllQRCodes(imageData);
                    this.processNewDetections(detectedCodes);
                }
                
                // Update all tracking states and displays
                this.updateAllTracking();
            }
            
            this.animationId = requestAnimationFrame(detect);
        };
        
        detect();
    }
    
    trackExistingCodes(imageData) {
        const currentTime = Date.now();
        
        for (const [codeData, tracking] of this.trackedCodes) {
            if (tracking.template && tracking.lastPosition) {
                // Try to track this QR code using template matching
                const newPosition = this.trackQRCodePosition(imageData, tracking);
                
                if (newPosition) {
                    // Successfully tracked - update position
                    tracking.lastPosition = newPosition;
                    tracking.lastSeen = currentTime;
                    tracking.isVisible = true;
                    tracking.consecutiveFailures = 0;
                    
                    // Update overlay position
                    this.updateOverlayPosition(codeData, newPosition);
                } else {
                    // Failed to track - increment failure count
                    tracking.consecutiveFailures = (tracking.consecutiveFailures || 0) + 1;
                    
                    // Keep showing for up to 3 seconds of failures (assuming 30fps = 90 frames)
                    const maxFailures = 90; // ~3 seconds at 30fps
                    if (tracking.consecutiveFailures < maxFailures) {
                        // Still within grace period - keep showing at last known position
                        tracking.isVisible = true;
                    } else {
                        // Grace period expired
                        tracking.isVisible = false;
                    }
                }
            }
        }
    }
    
    trackQRCodePosition(imageData, tracking) {
        try {
            // Simple template matching approach
            const template = tracking.template;
            const lastPos = tracking.lastPosition;
            
            // Search in a region around the last known position
            const searchRadius = 50;
            const searchLeft = Math.max(0, lastPos.left - searchRadius);
            const searchTop = Math.max(0, lastPos.top - searchRadius);
            const searchRight = Math.min(this.canvas.width - template.width, lastPos.left + searchRadius);
            const searchBottom = Math.min(this.canvas.height - template.height, lastPos.top + searchRadius);
            
            let bestMatch = null;
            let bestScore = 0.6; // Minimum correlation threshold
            
            // Step size for search (higher = faster but less accurate)
            const step = 3;
            
            for (let y = searchTop; y < searchBottom; y += step) {
                for (let x = searchLeft; x < searchRight; x += step) {
                    const score = this.calculateTemplateMatch(imageData, template, x, y);
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = { left: x, top: y, width: template.width, height: template.height };
                    }
                }
            }
            
            return bestMatch;
        } catch (error) {
            console.log('Tracking error:', error);
            return null;
        }
    }
    
    calculateTemplateMatch(imageData, template, x, y) {
        // Simplified normalized cross-correlation
        let correlation = 0;
        let templateSum = 0;
        let imageSum = 0;
        let count = 0;
        
        const width = Math.min(template.width, imageData.width - x);
        const height = Math.min(template.height, imageData.height - y);
        
        // Sample every few pixels for performance
        const sampleStep = 2;
        
        for (let ty = 0; ty < height; ty += sampleStep) {
            for (let tx = 0; tx < width; tx += sampleStep) {
                const imageIdx = ((y + ty) * imageData.width + (x + tx)) * 4;
                const templateIdx = (ty * template.width + tx) * 4;
                
                if (imageIdx >= 0 && imageIdx < imageData.data.length && 
                    templateIdx >= 0 && templateIdx < template.data.length) {
                    
                    // Convert to grayscale
                    const imageGray = (imageData.data[imageIdx] + imageData.data[imageIdx + 1] + imageData.data[imageIdx + 2]) / 3;
                    const templateGray = (template.data[templateIdx] + template.data[templateIdx + 1] + template.data[templateIdx + 2]) / 3;
                    
                    correlation += imageGray * templateGray;
                    imageSum += imageGray * imageGray;
                    templateSum += templateGray * templateGray;
                    count++;
                }
            }
        }
        
        if (count === 0 || imageSum === 0 || templateSum === 0) return 0;
        
        // Normalized cross-correlation
        return correlation / Math.sqrt(imageSum * templateSum);
    }
    
    findAllQRCodes(imageData) {
        const codes = [];
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code) {
            codes.push(code);
        }
        return codes;
    }
    
    processNewDetections(detectedCodes) {
        const currentTime = Date.now();
        
        for (const code of detectedCodes) {
            if (!this.trackedCodes.has(code.data)) {
                // New QR code detected
                const matchedQR = this.qrData.qrCodes.find(qr => qr.text === code.data);
                
                // Extract template for tracking
                const template = this.extractQRTemplate(code);
                const position = this.calculateQRPosition(code);
                
                this.trackedCodes.set(code.data, {
                    data: code.data,
                    matchedQR: matchedQR,
                    firstSeen: currentTime,
                    lastSeen: currentTime,
                    isVisible: true,
                    template: template,
                    lastPosition: position,
                    consecutiveFailures: 0,
                    minimumShowUntil: currentTime + 1000 // Show for at least 1 second
                });
                
                this.createOverlay(code.data, position);
            } else {
                // Existing QR code re-detected - update template and position
                const tracking = this.trackedCodes.get(code.data);
                tracking.lastSeen = currentTime;
                tracking.isVisible = true;
                tracking.consecutiveFailures = 0;
                
                // Update template and position
                tracking.template = this.extractQRTemplate(code);
                tracking.lastPosition = this.calculateQRPosition(code);
                
                this.updateOverlayPosition(code.data, tracking.lastPosition);
            }
        }
    }
    
    extractQRTemplate(code) {
        try {
            // Extract a small template around the QR code for tracking
            const padding = 10;
            const left = Math.max(0, code.location.topLeftCorner.x - padding);
            const top = Math.max(0, code.location.topLeftCorner.y - padding);
            const width = Math.min(this.canvas.width - left, 
                (code.location.topRightCorner.x - code.location.topLeftCorner.x) + padding * 2);
            const height = Math.min(this.canvas.height - top,
                (code.location.bottomLeftCorner.y - code.location.topLeftCorner.y) + padding * 2);
            
            const templateData = this.ctx.getImageData(left, top, width, height);
            
            return {
                data: templateData.data,
                width: width,
                height: height
            };
        } catch (error) {
            console.log('Template extraction error:', error);
            return null;
        }
    }
    
    calculateQRPosition(code) {
        return {
            left: code.location.topLeftCorner.x,
            top: code.location.topLeftCorner.y,
            width: code.location.topRightCorner.x - code.location.topLeftCorner.x,
            height: code.location.bottomLeftCorner.y - code.location.topLeftCorner.y
        };
    }
    
    updateAllTracking() {
        const currentTime = Date.now();
        
        // Clean up old tracking data and enforce minimum show time
        for (const [codeData, tracking] of this.trackedCodes) {
            // Enforce minimum show time of 1 second
            if (currentTime < tracking.minimumShowUntil) {
                tracking.isVisible = true;
            }
            
            // Remove tracking data that's been invisible for more than 10 seconds
            const timeSinceLastSeen = (currentTime - tracking.lastSeen) / 1000;
            if (!tracking.isVisible && timeSinceLastSeen > 10) {
                this.trackedCodes.delete(codeData);
                if (this.activeOverlays.has(codeData)) {
                    this.activeOverlays.get(codeData).remove();
                    this.activeOverlays.delete(codeData);
                }
            }
        }
        
        // Update the codes display
        this.updateCodesDisplay();
    }
    
    createOverlay(codeData, position) {
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
        
        this.updateOverlayPosition(codeData, position, overlayBox);
        
        this.overlay.appendChild(overlayBox);
        this.activeOverlays.set(codeData, overlayBox);
    }
    
    updateOverlayPosition(codeData, position, overlayElement = null) {
        const overlayBox = overlayElement || this.activeOverlays.get(codeData);
        if (!overlayBox) return;
        
        // Calculate position relative to video element
        const videoRect = this.video.getBoundingClientRect();
        const scaleX = videoRect.width / this.canvas.width;
        const scaleY = videoRect.height / this.canvas.height;
        
        const left = position.left * scaleX;
        const top = position.top * scaleY;
        const width = position.width * scaleX;
        const height = position.height * scaleY;
        
        overlayBox.style.left = left + 'px';
        overlayBox.style.top = top + 'px';
        overlayBox.style.width = width + 'px';
        overlayBox.style.height = height + 'px';
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