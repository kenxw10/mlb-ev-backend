const express = require("express");
const { getPicksForDate } = require("../services/picksService");
const { normalizeDateParam } = require("../utils/dateUtils");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const date = normalizeDateParam(req.query.date);
    const result = await getPicksForDate(date);

    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || "Failed to fetch picks"
    });
  }
});

module.exports = router;
