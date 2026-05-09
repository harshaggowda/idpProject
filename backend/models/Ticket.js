const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  location_center: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true }
  },
  issue_type: { type: String, enum: ['pothole', 'hump'], required: true },
  number_of_reports: { type: Number, default: 1 },
  status: { type: String, enum: ['pending', 'in_progress', 'resolved'], default: 'pending' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Ticket', ticketSchema);
