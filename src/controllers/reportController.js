const Report = require('../models/Report');
const { sendApiError } = require('../utils/apiError');

// @route   POST /api/reports
const createReport = async (req, res) => {
  try {
    const { bus, reportType, description } = req.body;
    const userId = req.user._id;

    if (!bus || !reportType || !description) {
      return res.status(400).json({ message: 'bus, reportType, and description are required' });
    }
    if (!['condition', 'safety'].includes(reportType)) {
      return res.status(400).json({ message: 'reportType must be "condition" or "safety"' });
    }

    const report = await Report.create({ user: userId, bus, reportType, description });
    res.status(201).json(report);
  } catch (err) {
    sendApiError(res, err, 'Could not create report.');
  }
};

// @route   GET /api/reports
const getReports = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.reportType) filter.reportType = req.query.reportType;

    const reports = await Report.find(filter)
      .populate('user', 'name email')
      .populate('bus', 'busNumber')
      .sort({ createdAt: -1 });

    res.status(200).json(reports);
  } catch (err) {
    sendApiError(res, err, 'Could not load reports.');
  }
};

// @route   PATCH /api/reports/:id/status
const updateReportStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!['open', 'reviewed', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    const report = await Report.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    res.status(200).json(report);
  } catch (err) {
    sendApiError(res, err, 'Could not update report status.');
  }
};

module.exports = { createReport, getReports, updateReportStatus };
