const express = require('express');
const mongoose = require('mongoose');
const mqtt = require('mqtt');
const cors = require('cors');

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/mqttMessages', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Message Schema
const MessageSchema = new mongoose.Schema({
  brokerId: Number,
  topic: String,
  payload: mongoose.Schema.Types.Mixed, // Stores JSON or raw string
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// MQTT Client
const mqttClient = mqtt.connect('mqtts://your-hivemq-broker:8884', {
  username: 'your-username',
  password: 'your-password',
  clientId: 'persistence-service-' + Math.random().toString(16).substr(2, 8)
});

// Subscribe to topics
mqttClient.on('connect', () => {
  console.log('Connected to MQTT broker');
  mqttClient.subscribe('+/pmu');       // Subscribe to all PMU topics
  mqttClient.subscribe('+/status');    // Subscribe to all status topics
});

// Store incoming messages
mqttClient.on('message', (topic, message) => {
  const brokerId = topic.split('/')[0]; // Extract broker ID from topic
  const payload = safeJsonParse(message.toString());
  
  new Message({
    brokerId,
    topic,
    payload
  }).save().catch(err => console.error('Error saving message:', err));
});

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return str;
  }
}

// Express API
const app = express();
app.use(cors());

app.get('/api/messages', async (req, res) => {
  const { brokerId, topic, limit = 100 } = req.query;
  const query = {};
  if (brokerId) query.brokerId = brokerId;
  if (topic) query.topic = topic;
  
  try {
    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3001, () => console.log('API server running on port 3001'));