const express = require("express");
const { getGamesForDate } = require("../services/gamesService");
const { normalizeDateParam } = require("../utils/dateUtils");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const date = normalizeDateParam(req.query.date);
    const result = await getGamesForDate(date);

    res.status(200).json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || "Failed to fetch games"
    });
  }
});

module.exports = router;
