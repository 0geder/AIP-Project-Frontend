let clients = [null, null, null]; // 1-based index for brokers
let brokerStates = [null, null, null]; // Holds state for each broker
const maxReconnectAttempts = 5;

function randomString(length) {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < length; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}

function generateClientId(brokerIdx) {
    const clientId = "PMU_UCT_" + randomString(8) + "_" + brokerIdx;
    document.getElementById(`clientId${brokerIdx}`).value = clientId;
    logStatus(`Broker ${brokerIdx}: Generated new Client ID: ${clientId}`, "info");
}

function updateConnectionIndicator(idx, status) {
    const indicator = document.getElementById(`connection_indicator${idx}`);
    const text = document.getElementById(`connection_text${idx}`);
    indicator.className = `status-dot ${status}`;
    switch(status) {
        case 'online': text.textContent = 'Connected'; break;
        case 'connecting': text.textContent = 'Connecting...'; break;
        case 'offline': text.textContent = 'Offline'; break;
        case 'error': text.textContent = 'Error'; break;
    }
}

function logStatus(message, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const icons = {
        info: "fas fa-info-circle", success: "fas fa-check-circle", warning: "fas fa-exclamation-triangle", error: "fas fa-times-circle", data: "fas fa-database"
    };
    const colors = {
        info: "#2196F3", success: "#4CAF50", warning: "#FF9800", error: "#F44336", data: "#9C27B0"
    };
    const statusHtml = `
        <div class="log-entry ${type}">
            <i class="${icons[type]}" style="color: ${colors[type]}"></i>
            <span class="timestamp">${timestamp}</span>
            <span class="message">${message}</span>
        </div>
    `;
    const logDisplay = document.getElementById("connection_status");
    logDisplay.innerHTML += statusHtml;
    logDisplay.scrollTop = logDisplay.scrollHeight;
}

function formatPMUData(data) {
    try {
        const parsed = JSON.parse(data);
        if (parsed.voltage && parsed.current) {
            return `V: ${parsed.voltage}V, I: ${parsed.current}A, f: ${parsed.frequency || 'N/A'}Hz`;
        }
        return data;
    } catch (e) { return data; }
}
function formatDeviceStatus(data) {
    try {
        const parsed = JSON.parse(data);
        if (parsed.status) {
            const statusIcon = parsed.status === 'online' ? '🟢' : '🔴';
            return `${statusIcon} Status: ${parsed.status.toUpperCase()}`;
        }
        return data;
    } catch (e) { return data; }
}

function startConnect(idx) {
    if (typeof idx === 'number') {
        // Connect only the specified broker
        connectSingleBroker(idx);
    } else {
        // Connect all brokers, but only if their host/port are filled
        for (let i = 1; i <= 3; i++) {
            const host = document.getElementById(`host${i}`).value;
            const port = document.getElementById(`port${i}`).value;
            if (host && port) {
                connectSingleBroker(i);
            } else {
                updateConnectionIndicator(i, 'offline');
            }
        }
    }
}

function connectSingleBroker(i) {
    const host = document.getElementById(`host${i}`).value;
    const port = Number(document.getElementById(`port${i}`).value);
    const clientId = document.getElementById(`clientId${i}`).value || `PMU_UCT_${randomString(8)}_${i}`;
    const username = document.getElementById(`username${i}`).value;
    const password = document.getElementById(`password${i}`).value;
    const topic1 = document.getElementById(`topic1_${i}`).value;
    const topic2 = document.getElementById(`topic2_${i}`).value;
    brokerStates[i-1] = {
        reconnectAttempts: 0,
        topic1, topic2,
        topic1Count: 0,
        topic2Count: 0
    };
    if (!host || !port) {
        logStatus(`Broker ${i}: Missing host/port`, "error");
        updateConnectionIndicator(i, 'error');
        return;
    }
    updateConnectionIndicator(i, 'connecting');
    logStatus(`Broker ${i}: Connecting to ${host}:${port}`, "info");
    try {
        const client = new Paho.MQTT.Client(host, port, "/mqtt", clientId);
        client.onConnectionLost = (response) => onConnectionLost(i, response);
        client.onMessageArrived = (message) => onMessageArrived(i, message);
        const options = {
            onSuccess: () => onConnect(i, client, topic1, topic2),
            onFailure: (error) => onConnectFailure(i, error),
            useSSL: true,
            timeout: 15,
            keepAliveInterval: 30,
            cleanSession: true
        };
        if (username) options.userName = username;
        if (password) options.password = password;
        client.connect(options);
        clients[i-1] = client;
    } catch (error) {
        logStatus(`Broker ${i}: Connection failed: ${error.message}`, "error");
        updateConnectionIndicator(i, 'error');
    }
}

function onConnect(idx, client, topic1, topic2) {
    updateConnectionIndicator(idx, 'online');
    brokerStates[idx-1].reconnectAttempts = 0;
    logStatus(`Broker ${idx}: Connected`, "success");
    // Update topic display names
    document.getElementById(`topic1_${idx}_name`).textContent = topic1 || "PMU Topic";
    document.getElementById(`topic2_${idx}_name`).textContent = topic2 || "Status Topic";
    if (topic1) {
        client.subscribe(topic1, {
            onSuccess: () => logStatus(`Broker ${idx}: Subscribed to ${topic1}`, "success"),
            onFailure: (err) => logStatus(`Broker ${idx}: Failed to subscribe to ${topic1}: ${err.errorMessage}`, "error")
        });
    }
    if (topic2) {
        client.subscribe(topic2, {
            onSuccess: () => logStatus(`Broker ${idx}: Subscribed to ${topic2}`, "success"),
            onFailure: (err) => logStatus(`Broker ${idx}: Failed to subscribe to ${topic2}: ${err.errorMessage}`, "error")
        });
    }
    // Hide no-data
    document.getElementById(`topic1_${idx}_messages`).querySelector('.no-data').style.display = 'none';
    document.getElementById(`topic2_${idx}_messages`).querySelector('.no-data').style.display = 'none';
}

function onConnectFailure(idx, error) {
    updateConnectionIndicator(idx, 'error');
    logStatus(`Broker ${idx}: Connection failed - ${error.errorMessage}`, "error");
    if (brokerStates[idx-1].reconnectAttempts < maxReconnectAttempts) {
        brokerStates[idx-1].reconnectAttempts++;
        logStatus(`Broker ${idx}: Attempting reconnection ${brokerStates[idx-1].reconnectAttempts}/${maxReconnectAttempts} in 5s...`, "warning");
        setTimeout(() => {
            if (!clients[idx-1] || !clients[idx-1].isConnected()) {
                startConnect();
            }
        }, 5000);
    }
}

function onConnectionLost(idx, response) {
    updateConnectionIndicator(idx, 'offline');
    logStatus(`Broker ${idx}: Connection lost - ${response.errorMessage || "unknown"}`, "warning");
    // Show no-data
    document.getElementById(`topic1_${idx}_messages`).querySelector('.no-data').style.display = 'block';
    document.getElementById(`topic2_${idx}_messages`).querySelector('.no-data').style.display = 'block';
}

function onMessageArrived(idx, message) {
    const topic = message.destinationName;
    const payload = message.payloadString;
    let formattedMessage = payload;
    if (topic === brokerStates[idx-1].topic1) {
        formattedMessage = formatPMUData(payload);
        brokerStates[idx-1].topic1Count++;
        document.getElementById(`topic1_${idx}_count`).textContent = brokerStates[idx-1].topic1Count;
        const display = document.getElementById(`topic1_${idx}_messages`);
        display.innerHTML += `<div class='message-item pmu-message'><div class='message-header'><span class='message-time'>${new Date().toLocaleTimeString()}</span><span class='message-topic'>${topic}</span></div><div class='message-content'>${formattedMessage}</div></div>`;
        display.scrollTop = display.scrollHeight;
    } else if (topic === brokerStates[idx-1].topic2) {
        formattedMessage = formatDeviceStatus(payload);
        brokerStates[idx-1].topic2Count++;
        document.getElementById(`topic2_${idx}_count`).textContent = brokerStates[idx-1].topic2Count;
        const display = document.getElementById(`topic2_${idx}_messages`);
        display.innerHTML += `<div class='message-item status-message'><div class='message-header'><span class='message-time'>${new Date().toLocaleTimeString()}</span><span class='message-topic'>${topic}</span></div><div class='message-content'>${formattedMessage}</div></div>`;
        display.scrollTop = display.scrollHeight;
    } else {
        logStatus(`Broker ${idx}: Message on unknown topic ${topic}: ${payload}`, "data");
    }
}

function startDisconnect(idx) {
    if (typeof idx === 'number') {
        // Disconnect only the specified broker
        if (clients[idx-1] && clients[idx-1].isConnected()) {
            clients[idx-1].disconnect();
            updateConnectionIndicator(idx, 'offline');
            logStatus(`Broker ${idx}: Disconnected`, "warning");
        } else {
            updateConnectionIndicator(idx, 'offline');
        }
    } else {
        // Disconnect all brokers
        for (let i = 1; i <= 3; i++) {
            if (clients[i-1] && clients[i-1].isConnected()) {
                clients[i-1].disconnect();
                updateConnectionIndicator(i, 'offline');
                logStatus(`Broker ${i}: Disconnected`, "warning");
            } else {
                updateConnectionIndicator(i, 'offline');
            }
        }
    }
}

function clearTopicMessages(brokerIdx, topicNum) {
    const el = document.getElementById(`topic${topicNum}_${brokerIdx}_messages`);
    el.innerHTML = `<div class='no-data'><i class='fas fa-clock'></i> Waiting for ${topicNum === 1 ? 'PMU data' : 'device status'}...</div>`;
    document.getElementById(`topic${topicNum}_${brokerIdx}_count`).textContent = "0";
    if (brokerStates[brokerIdx-1]) {
        if (topicNum === 1) brokerStates[brokerIdx-1].topic1Count = 0;
        else brokerStates[brokerIdx-1].topic2Count = 0;
    }
}

function clearAll() {
    for (let i = 1; i <= 3; i++) {
        clearTopicMessages(i, 1);
        clearTopicMessages(i, 2);
        updateConnectionIndicator(i, 'offline');
        if (brokerStates[i-1]) {
            brokerStates[i-1].topic1Count = 0;
            brokerStates[i-1].topic2Count = 0;
        }
    }
    clearConnectionStatus();
}

function clearConnectionStatus() {
    document.getElementById("connection_status").innerHTML = '<div class="system-ready"><i class="fas fa-check-circle"></i> System ready for connection</div>';
}

function publishMessage() {
    const brokerIdx = Number(document.getElementById("publish_broker").value);
    const topic = document.getElementById("publish_topic").value;
    const msg = document.getElementById("publish_message").value;
    if (!brokerIdx || brokerIdx < 1 || brokerIdx > 3) {
        logStatus("Select a valid broker (1-3) to publish.", "error");
        return;
    }
    if (!clients[brokerIdx-1] || !clients[brokerIdx-1].isConnected()) {
        logStatus(`Broker ${brokerIdx}: Not connected. Cannot publish.`, "error");
        return;
    }
    if (!topic || !msg) {
        logStatus("Topic and message required to publish.", "error");
        return;
    }
    const message = new Paho.MQTT.Message(msg);
    message.destinationName = topic;
    clients[brokerIdx-1].send(message);
    logStatus(`Broker ${brokerIdx}: Published to ${topic}`, "success");
}

// On page load, generate default client IDs and set indicators
window.onload = function() {
    for (let i = 1; i <= 3; i++) {
        generateClientId(i);
        updateConnectionIndicator(i, 'offline');
        document.getElementById(`topic1_${i}_name`).textContent = '';
        document.getElementById(`topic2_${i}_name`).textContent = '';
    }
    clearAll();
    logStatus("Dashboard initialized. Ready to connect.", "info");
};
