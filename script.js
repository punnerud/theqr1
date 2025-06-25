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
        
        this.stream = null;
        this.animationId = null;
        this.qrData = null;
        this.lastScannedCode = null;
        this.lastScannedTime = 0;
        
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
        this.clearOverlay();
        
        this.startBtn.style.display = 'inline-block';
        this.stopBtn.style.display = 'none';
        this.status.textContent = 'Scanner stopped';
        this.result.textContent = '';
        this.result.className = 'result';
    }
    
    startQRDetection() {
        const detect = () => {
            if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
                this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
                const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
                
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                
                if (code) {
                    this.handleQRCode(code);
                } else {
                    this.clearOverlay();
                }
            }
            
            this.animationId = requestAnimationFrame(detect);
        };
        
        detect();
    }
    
    handleQRCode(code) {
        const currentTime = Date.now();
        
        // Prevent duplicate scans within 2 seconds
        if (this.lastScannedCode === code.data && currentTime - this.lastScannedTime < 2000) {
            return;
        }
        
        this.lastScannedCode = code.data;
        this.lastScannedTime = currentTime;
        
        // Check if QR code matches any in our data
        const matchedQR = this.qrData.qrCodes.find(qr => qr.text === code.data);
        
        if (matchedQR) {
            this.showMatchedQR(code, matchedQR);
        } else {
            this.showUnknownQR(code);
        }
    }
    
    showMatchedQR(code, matchedQR) {
        // Clear previous overlays
        this.clearOverlay();
        
        // Create overlay box
        const overlayBox = document.createElement('div');
        overlayBox.className = 'qr-overlay-box';
        overlayBox.style.borderColor = matchedQR.color;
        overlayBox.style.backgroundColor = matchedQR.color + '20'; // Add transparency
        
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
        
        // Update result display
        this.result.innerHTML = `
            <strong>✅ Match Found!</strong><br>
            <span style="color: ${matchedQR.color};">${matchedQR.name}</span><br>
            <small>${code.data}</small>
        `;
        this.result.className = 'result match-found';
        
        // Play success sound (if available)
        this.playSound('success');
    }
    
    showUnknownQR(code) {
        // Clear previous overlays
        this.clearOverlay();
        
        // Create basic overlay box
        const overlayBox = document.createElement('div');
        overlayBox.className = 'qr-overlay-box';
        overlayBox.style.borderColor = '#ffffff';
        overlayBox.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        
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
        
        // Update result display
        this.result.innerHTML = `
            <strong>QR Code Detected</strong><br>
            <small>${code.data}</small><br>
            <em>Not in database</em>
        `;
        this.result.className = 'result';
    }
    
    clearOverlay() {
        this.overlay.innerHTML = '';
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