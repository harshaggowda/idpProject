const express = require('express');
const router = express.Router();
const Ticket = require('../models/Ticket');
const Event = require('../models/Event');

// GET all tickets
router.get('/', async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ created_at: -1 });
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const totalPotholes = await Event.countDocuments({ type: 'pothole' });
    const totalHumps = await Event.countDocuments({ type: 'hump' });
    const activeTickets = await Ticket.countDocuments({ status: { $ne: 'resolved' } });
    const resolvedTickets = await Ticket.countDocuments({ status: 'resolved' });

    res.json({
      totalPotholes,
      totalHumps,
      activeTickets,
      resolvedTickets
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT update ticket status
router.put('/:id', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    ticket.status = status;
    ticket.updated_at = new Date();
    await ticket.save();

    res.json(ticket);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
