require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function connectDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");
    return client.db("pmu_monitoring");
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

// API Endpoints
app.get('/api/pmu-data', async (req, res) => {
  try {
    const db = await connectDB();
    const collection = db.collection("pmu_readings");
    
    // Get latest 100 records, sorted by timestamp
    const data = await collection.find()
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();
    
    res.json(data);
  } catch (err) {
    console.error("Error fetching PMU data:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

app.get('/api/device-status', async (req, res) => {
  try {
    const db = await connectDB();
    const collection = db.collection("device_status");
    
    // Get latest 100 status updates
    const data = await collection.find()
      .sort({ timestamp: -1 })
      .limit(100)
      .toArray();
    
    res.json(data);
  } catch (err) {
    console.error("Error fetching device status:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

app.listen(port, () => {
  console.log(`API server running on port ${port}`);
}); 