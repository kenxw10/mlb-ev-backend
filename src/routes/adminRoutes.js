const express = require("express");
const { isValidDateString } = require("../utils/dateUtils");
const { gradeSnapshotsForDate } = require("../services/pickGradingService");

const router = express.Router();

router.get("/grade-results", async (req, res) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date.trim() : "";

    if (!date || !isValidDateString(date)) {
      return res.status(400).json({
        ok: false,
        error: "Valid date query parameter is required in YYYY-MM-DD format."
      });
    }

    const result = await gradeSnapshotsForDate(date);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to grade results."
    });
  }
});

module.exports = router;
