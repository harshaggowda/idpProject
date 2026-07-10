const express = require('express');
const router = express.Router();
const Event = require('../models/Event');
const Ticket = require('../models/Ticket');

// Haversine formula to calculate distance in meters between two lat/lon points
function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// GET all events
router.get('/', async (req, res) => {
  try {
    const events = await Event.find().sort({ timestamp: -1 });
    res.json(events);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST a new event
router.post('/', async (req, res) => {
  const { latitude, longitude, type, severity } = req.body;

  try {
    let ticketId = null;

    // Humps (speed breakers) are informational only — they are shown on the
    // map as Events but never raise a maintenance ticket. Only potholes are
    // clustered into tickets.
    if (type === 'pothole') {
      // 1. Find if there are active tickets nearby (within 10 meters) of the same type
      const activeTickets = await Ticket.find({ issue_type: type, status: { $ne: 'resolved' } });

      let matchedTicket = null;
      for (let ticket of activeTickets) {
        const distance = getDistanceInMeters(latitude, longitude, ticket.location_center.latitude, ticket.location_center.longitude);
        if (distance <= 10) { // 10 meters radius
          matchedTicket = ticket;
          break;
        }
      }

      if (matchedTicket) {
        // Update existing ticket
        matchedTicket.number_of_reports += 1;
        matchedTicket.updated_at = new Date();
        // Recalculate center? For simplicity, we keep original center.
        await matchedTicket.save();
        ticketId = matchedTicket._id;
      } else {
        // Create a new ticket
        const newTicket = new Ticket({
          location_center: { latitude, longitude },
          issue_type: type,
          number_of_reports: 1
        });
        await newTicket.save();
        ticketId = newTicket._id;
      }
    }

    // 2. Create the event
    const event = new Event({
      latitude,
      longitude,
      type,
      severity,
      cluster_id: ticketId
    });

    const newEvent = await event.save();
    res.status(201).json(newEvent);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
