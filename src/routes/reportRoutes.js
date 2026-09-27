const express = require('express');
const router = express.Router();
const {
  createReport,
  getReports,
  updateReportStatus,
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

router.post('/', protect, createReport);
router.get('/', protect, authorize('admin'), getReports);
router.patch('/:id/status', protect, authorize('admin'), updateReportStatus);

module.exports = router;