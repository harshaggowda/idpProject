const express = require('express');
const path    = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const { MongoMemoryServer } = require('mongodb-memory-server');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// ── Serve the standalone GPS tracker page ─────────────────────────
// Accessible at http://<host>:5000/gps/ from the phone's browser.
// These are the reused static files from the original GPS module.
app.use('/gps', express.static(path.join(__dirname, 'public', 'gps')));

// Redirect root to GPS tracker page (for phone access via ngrok)
app.get('/', (req, res) => res.redirect('/gps/'));

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Start In-Memory MongoDB Server for easy testing
    const mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    await mongoose.connect(mongoUri);
    console.log(`MongoDB connected (In-Memory): ${mongoUri}`);

    // Routes
    app.use('/events',  require('./routes/events'));
    app.use('/tickets', require('./routes/tickets'));
    app.use('/sensor',  require('./routes/sensorRoutes'));  // Signal Processing Engine
    app.use('/gps',     require('./routes/gpsRoutes'));     // Phone GPS Service

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`GPS tracker page: http://localhost:${PORT}/gps/`);
    });
  } catch (err) {
    console.error('Server startup error:', err);
  }
};

startServer();
