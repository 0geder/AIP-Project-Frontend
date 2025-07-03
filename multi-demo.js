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

async function fetchHistoricalData(brokerIdx) {
  try {
    logStatus(`Broker ${brokerIdx}: Fetching historical data...`, "info");
    
    const response = await fetch(`http://localhost:3001/api/pmu-data`);
    if (!response.ok) throw new Error('Network response was not ok');
    
    const data = await response.json();
    const display = document.getElementById(`topic1_${brokerIdx}_messages`);
    
    // Clear existing messages but keep "no-data" message if empty
    display.innerHTML = display.querySelector('.no-data') ? 
      display.querySelector('.no-data').outerHTML : '';
    
    // Add historical messages
    data.forEach(item => {
      const formatted = formatPMUData(JSON.stringify(item));
      display.innerHTML += `
        <div class='message-item pmu-message'>
          <div class='message-header'>
            <span class='message-time'>${new Date(item.timestamp).toLocaleTimeString()}</span>
            <span class='message-topic'>Historical Data</span>
          </div>
          <div class='message-content'>${formatted}</div>
        </div>
      `;
    });
    
    // Update count
    const countElement = document.getElementById(`topic1_${brokerIdx}_count`);
    countElement.textContent = (parseInt(countElement.textContent) + data.length).toString();
    
    logStatus(`Broker ${brokerIdx}: Loaded ${data.length} historical records`, "success");
  } catch (error) {
    logStatus(`Broker ${brokerIdx}: Failed to load historical data - ${error.message}`, "error");
  }
}

function onConnect(idx, client, topic1, topic2) {
    updateConnectionIndicator(idx, 'online');
    brokerStates[idx-1].reconnectAttempts = 0;
    logStatus(`Broker ${idx}: Connected`, "success");
    
    // Load historical data when connecting
    fetchHistoricalData(idx);
    
    // Update topic display names
    document.getElementById(`topic1_${idx}_name`).textContent = topic1 || "PMU Topic";
    document.getElementById(`topic2_${idx}_name`).textContent = topic2 || "Status Topic";
    
    // Subscribe to topics if they exist
    const subscribeToTopic = (topic, type) => {
        if (topic) {
            client.subscribe(topic, {
                onSuccess: () => logStatus(`Broker ${idx}: Subscribed to ${topic}`, "success"),
                onFailure: (err) => logStatus(`Broker ${idx}: Failed to subscribe to ${topic}: ${err.errorMessage}`, "error")
            });
        }
    };
    
    subscribeToTopic(topic1, 'PMU Data');
    subscribeToTopic(topic2, 'Device Status');
    
    // Hide no-data messages
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
    
    // Check if this is one of our subscribed topics
    const brokerState = brokerStates[idx-1];
    let isSubscribedTopic = false;
    
    if (topic === brokerState.topic1) {
        formattedMessage = formatPMUData(payload);
        brokerState.topic1Count++;
        document.getElementById(`topic1_${idx}_count`).textContent = brokerState.topic1Count;
        const display = document.getElementById(`topic1_${idx}_messages`);
        display.innerHTML += createMessageHtml(topic, formattedMessage, 'pmu-message');
        display.scrollTop = display.scrollHeight;
        isSubscribedTopic = true;
    } 
    else if (topic === brokerState.topic2) {
        formattedMessage = formatDeviceStatus(payload);
        brokerState.topic2Count++;
        document.getElementById(`topic2_${idx}_count`).textContent = brokerState.topic2Count;
        const display = document.getElementById(`topic2_${idx}_messages`);
        display.innerHTML += createMessageHtml(topic, formattedMessage, 'status-message');
        display.scrollTop = display.scrollHeight;
        isSubscribedTopic = true;
    }
    
    // Log all received messages, not just subscribed ones
    logStatus(`Broker ${idx}: Message received from ${topic}: ${formattedMessage}`, "data");
    
    if (!isSubscribedTopic) {
        // If message is from an unsubscribed topic, log it in system logs
        logStatus(`Broker ${idx}: Message from unsubscribed topic ${topic}: ${formattedMessage}`, "warning");
    }
}

function createMessageHtml(topic, content, type) {
    return `
        <div class='message-item ${type}'>
            <div class='message-header'>
                <span class='message-time'>${new Date().toLocaleTimeString()}</span>
                <span class='message-topic'>${topic}</span>
            </div>
            <div class='message-content'>${content}</div>
        </div>
    `;
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
    const topic = document.getElementById("publish_topic").value.trim();
    const msg = document.getElementById("publish_message").value.trim();
    
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
    
    try {
        const message = new Paho.MQTT.Message(msg);
        message.destinationName = topic;
        message.qos = 1; // Ensure message delivery
        clients[brokerIdx-1].send(message);
        
        logStatus(`Broker ${brokerIdx}: Published to ${topic}`, "success");
        document.getElementById("publish_message").value = ""; // Clear message input
        
        // Auto-scroll to see the published message
        const logDisplay = document.getElementById("connection_status");
        logDisplay.scrollTop = logDisplay.scrollHeight;
        
    } catch (error) {
        logStatus(`Broker ${brokerIdx}: Publish failed - ${error.message}`, "error");
    }
}

// On page load, generate default client IDs and set indicators
window.onload = function() {
    for (let i = 1; i <= 3; i++) {
        generateClientId(i);
        updateConnectionIndicator(i, 'offline');
        
        // Set default values for Broker #1 (HiveMQ)
        if (i === 1) {
            document.getElementById(`host${i}`).value = "d3131c8a9ea94df0972f5f4e5e0622ad.s1.eu.hivemq.cloud";
            document.getElementById(`port${i}`).value = "8884";
            document.getElementById(`username${i}`).value = "PMU_UCT_Demo";
            document.getElementById(`password${i}`).value = "CivilSucks100%";
            document.getElementById(`topic1_${i}`).value = "hi";
            document.getElementById(`topic2_${i}`).value = "device/status";
        }
    }
    clearAll();
    logStatus("Dashboard initialized. Ready to connect.", "info");
    logStatus("Broker #1 pre-configured for HiveMQ (topic: 'hi')", "info");
};