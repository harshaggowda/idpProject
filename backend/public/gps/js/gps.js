/**
 * GPS Streaming Module Frontend
 * ─────────────────────────────────────────────────────────────────
 * Reused from the original GPS module (static/js/gps.js).
 *
 * Only change from the original:
 *   API_URL updated from '/api/gps/update' → '/gps/update'
 *   to match the Express route namespace in the main project.
 *
 * Handles location tracking, network requests, and UI updates.
 * ─────────────────────────────────────────────────────────────────
 */

const CONFIG = {
    UPDATE_INTERVAL_MS: 1000,
    API_URL: '/gps/update'         // ← Updated for Express integration
};

const STATE = {
    watchId: null,
    isOnline: navigator.onLine,
    isSending: false,
    lastSuccessfulUpload: null
};

// UI Elements
const DOM = {
    lat: document.getElementById('latValue'),
    lng: document.getElementById('lngValue'),
    acc: document.getElementById('accValue'),
    time: document.getElementById('timeValue'),
    statusBadge: document.getElementById('statusBadge'),
    statusIndicator: document.getElementById('statusIndicator'),
    statusText: document.getElementById('statusText'),
    console: document.getElementById('messageConsole')
};

// --- Initialization ---

function init() {
    logMessage('Module initialized', 'info');
    setupNetworkListeners();
    requestLocationPermission();
}

// --- UI Updates ---

function logMessage(text, type = 'normal') {
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg msg-${type}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'msg-time';
    const now = new Date();
    timeSpan.textContent = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
    
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    
    msgDiv.appendChild(timeSpan);
    msgDiv.appendChild(textSpan);
    
    DOM.console.appendChild(msgDiv);
    DOM.console.scrollTop = DOM.console.scrollHeight; // Auto-scroll
}

function updateStatus(state, text) {
    DOM.statusText.textContent = text;
    DOM.statusIndicator.className = 'status-indicator'; // reset
    DOM.statusIndicator.classList.add(state);
}

function updateLocationUI(position) {
    DOM.lat.textContent = position.coords.latitude.toFixed(5);
    DOM.lng.textContent = position.coords.longitude.toFixed(5);
    DOM.acc.textContent = position.coords.accuracy.toFixed(1);
    
    const time = new Date(position.timestamp);
    DOM.time.textContent = time.toLocaleTimeString();
}

// --- Location Handling ---

function requestLocationPermission() {
    if (!('geolocation' in navigator)) {
        updateStatus('error', 'GPS Unavailable');
        logMessage('Geolocation is not supported by your browser', 'error');
        return;
    }

    logMessage('Requesting GPS permission...', 'info');
    
    // We use watchPosition to get continuous updates
    STATE.watchId = navigator.geolocation.watchPosition(
        handlePositionSuccess,
        handlePositionError,
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        }
    );
}

function handlePositionSuccess(position) {
    updateLocationUI(position);
    
    // Stream to backend
    streamLocationToBackend(position);
}

function handlePositionError(error) {
    let errorMsg = 'Unknown GPS Error';
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMsg = 'Permission Denied';
            break;
        case error.POSITION_UNAVAILABLE:
            errorMsg = 'Position Unavailable';
            break;
        case error.TIMEOUT:
            errorMsg = 'GPS Timeout';
            break;
    }
    updateStatus('error', errorMsg);
    logMessage(`GPS Error: ${errorMsg}`, 'error');
}

// --- Network & Streaming ---

function setupNetworkListeners() {
    window.addEventListener('online', () => {
        STATE.isOnline = true;
        logMessage('Internet connection restored', 'success');
        updateStatus('connected', 'Online');
    });
    
    window.addEventListener('offline', () => {
        STATE.isOnline = false;
        logMessage('Internet connection lost', 'error');
        updateStatus('error', 'Offline');
    });
}

async function streamLocationToBackend(position) {
    if (!STATE.isOnline) {
        updateStatus('error', 'Offline');
        return;
    }

    if (STATE.isSending) return; // Prevent duplicate requests
    
    STATE.isSending = true;
    updateStatus('sending', 'Sending...');

    const payload = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString()
    };

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
        }

        const data = await response.json();
        
        if (data.success) {
            STATE.lastSuccessfulUpload = new Date();
            updateStatus('connected', 'Connected');
            logMessage(`Sent: ${payload.latitude.toFixed(4)}, ${payload.longitude.toFixed(4)}`, 'success');
        } else {
            throw new Error(data.error || 'Unknown server error');
        }

    } catch (error) {
        updateStatus('error', 'Server Error');
        logMessage(`Upload failed: ${error.message}`, 'error');
    } finally {
        // Ensure minimum interval between sends, but allow state reset
        setTimeout(() => {
            STATE.isSending = false;
        }, CONFIG.UPDATE_INTERVAL_MS);
    }
}

// Start the module
document.addEventListener('DOMContentLoaded', init);
