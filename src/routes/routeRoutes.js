const express = require('express');
const router = express.Router();

const {createRoute, getRoutes, getRouteById, updateRoute, deleteRoute} = require('../controllers/routeController');
const { protect, authorize } = require('../middleware/auth');


router.get('/', getRoutes);
router.get('/:id', getRouteById);
router.post('/',protect, authorize('admin'), createRoute);
router.put('/:id', protect, authorize('admin'), updateRoute);
router.delete('/:id', protect, authorize('admin'), deleteRoute);

module.exports = router;
