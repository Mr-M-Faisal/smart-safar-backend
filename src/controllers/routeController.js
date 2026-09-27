const Route = require("../models/Route");

const createRoute = async (req, res) => {
  try {
    const { routeName, startPoint, endPoint, description } = req.body;
    if (!routeName || !startPoint || !endPoint) {
      return res
        .status(400)
        .json({
          message: " Route name, start point, and end point are required.",
        });
    }
    const newRoute = await Route.create({
      routeName,
      startPoint,
      endPoint,
      description,
    });

    res.status(201).json(newRoute);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
const getRoutes = async (req, res) => {
  try {
    const routes = await Route.find({ isActive: true }).sort({ createdAt: -1 });
    res.status(200).json(routes);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

const getRouteById = async (req, res) => {
  try {
    const route = await Route.findById(req.params.id);
    if (!route) {
      return res.status(404).json({ message: "Route not found" });
    }
    res.status(200).json(route);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

const updateRoute = async (req, res) => {
  try {
    const updatedRoute = await Route.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!updatedRoute) {
      return res.status(404).json({ message: "Route not found" });
    }
    res.status(200).json(updatedRoute);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};
const deleteRoute = async (req, res) => {
  try {
    const route = await Route.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true },
    );
    if (!route) {
      return res.status(404).json({ message: "Route not found" });
    }
    res.status(200).json({ message: "Route deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  createRoute,
  getRoutes,
  getRouteById,
  updateRoute,
  deleteRoute,
};
