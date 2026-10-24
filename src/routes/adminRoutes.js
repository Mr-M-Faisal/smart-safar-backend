const express = require('express');
const router = express.Router();
const {
  getFleetOverview,
  getBookingsAnalytics,
  getOccupancyByRoute,
  getReportsSummary,
  getShifts,
  getOperatingConsistency,
  getAdminBookings,
  cancelAdminBookingAction,
  getCommuters,
  updateCommuter,
} = require('../controllers/adminController');
const { protect, authorize } = require('../middleware/auth');
const { getDrivers, createDriver, updateDriver, deleteDriver, resetDriverPassword, setDriverStatus } = require('../controllers/adminDriverController');
const { getAdminRoutesWithDetails } = require('../controllers/aggregateController');

// Every route here is admin-only — this whole file is the dashboard's data layer
router.use(protect, authorize('admin'));

router.get('/proxy-diagnostic', (req, res) => {
  if (process.env.ENABLE_PROXY_DIAGNOSTIC !== 'true') return res.status(404).json({ message: 'Not found' });
  res.json({ ip: req.ip, ips: req.ips, xForwardedFor: req.get('x-forwarded-for') || null });
});

router.get('/overview', getFleetOverview);
router.get('/routes-with-details', getAdminRoutesWithDetails);
router.get('/analytics/bookings', getBookingsAnalytics);
router.get('/analytics/occupancy', getOccupancyByRoute);
router.get('/analytics/reports', getReportsSummary);
router.get('/shifts', getShifts);
router.get('/operating-consistency', getOperatingConsistency);
router.get('/bookings', getAdminBookings);
router.patch('/bookings/:id/cancel', cancelAdminBookingAction);
router.get('/users', getCommuters);
router.put('/users/:id', updateCommuter);

router.get('/drivers', getDrivers);
router.post('/drivers', createDriver);
router.put('/drivers/:id', updateDriver);
router.patch('/drivers/:id/password', resetDriverPassword);
router.patch('/drivers/:id/status', setDriverStatus);
router.delete('/drivers/:id', deleteDriver);

module.exports = router;
