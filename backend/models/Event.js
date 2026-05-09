const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  type: { type: String, enum: ['pothole', 'hump'], required: true },
  severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  timestamp: { type: Date, default: Date.now },
  cluster_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null }
});

module.exports = mongoose.model('Event', eventSchema);
