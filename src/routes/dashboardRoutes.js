const express = require("express");
const {
  getOfficialDashboardSummary,
  getOfficialPickHistory
} = require("../services/dashboardPerformanceService");
const {
  getDashboardCalibrationStatus
} = require("../services/dashboardCalibrationService");
const {
  getDashboardSlate
} = require("../services/dashboardSlateService");
const {
  getDashboardOfficialPicks,
  getDashboardLivePicks
} = require("../services/dashboardPicksService");
const {
  getBetPolicyTrackingSummary
} = require("../services/betPolicyTrackingService");
const {
  getDashboardStatus
} = require("../services/dashboardStatusService");
const {
  getDashboardMonthlyCalendar
} = require("../services/dashboardCalendarService");

const router = express.Router();

router.get("/summary", async (req, res) => {
  try {
    const startDate =
      typeof req.query.startDate === "string" && req.query.startDate.trim()
        ? req.query.startDate.trim()
        : null;

    const endDate =
      typeof req.query.endDate === "string" && req.query.endDate.trim()
        ? req.query.endDate.trim()
        : null;

    const result = await getOfficialDashboardSummary({
      startDate,
      endDate
    });

    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load dashboard summary."
    });
  }
});

router.get("/history", async (req, res) => {
  try {
    const startDate =
      typeof req.query.startDate === "string" && req.query.startDate.trim()
        ? req.query.startDate.trim()
        : null;

    const endDate =
      typeof req.query.endDate === "string" && req.query.endDate.trim()
        ? req.query.endDate.trim()
        : null;

    const marketType =
      typeof req.query.marketType === "string" && req.query.marketType.trim()
        ? req.query.marketType.trim()
        : null;

    const result =
      typeof req.query.result === "string" && req.query.result.trim()
        ? req.query.result.trim()
        : null;

    const limit =
      typeof req.query.limit === "string" && req.query.limit.trim()
        ? req.query.limit.trim()
        : null;

    const offset =
      typeof req.query.offset === "string" && req.query.offset.trim()
        ? req.query.offset.trim()
        : null;

    const history = await getOfficialPickHistory({
      startDate,
      endDate,
      marketType,
      result,
      limit,
      offset
    });

    return res.status(history.ok ? 200 : 500).json(history);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load dashboard history."
    });
  }
});

router.get("/calibration", async (req, res) => {
  try {
    const result = await getDashboardCalibrationStatus();
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load dashboard calibration status."
    });
  }
});

router.get("/slate", async (req, res) => {
  try {
    const date =
      typeof req.query.date === "string" && req.query.date.trim()
        ? req.query.date.trim()
        : null;

    if (!date) {
      return res.status(400).json({
        ok: false,
        error: "date query parameter is required in YYYY-MM-DD format."
      });
    }

    const result = await getDashboardSlate(date);
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load dashboard slate."
    });
  }
});

router.get("/official-picks", async (req, res) => {
  try {
    const date =
      typeof req.query.date === "string" && req.query.date.trim()
        ? req.query.date.trim()
        : null;

    if (!date) {
      return res.status(400).json({
        ok: false,
        error: "date query parameter is required in YYYY-MM-DD format."
      });
    }

    const result = await getDashboardOfficialPicks(date);
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load dashboard official picks."
    });
  }
});

router.get("/live-picks", async (req, res) => {
  try {
    const date =
      typeof req.query.date === "string" && req.query.date.trim()
        ? req.query.date.trim()
        : null;

    if (!date) {
      return res.status(400).json({
        ok: false,
        error: "date query parameter is required in YYYY-MM-DD format."
      });
    }

    const result = await getDashboardLivePicks(date);
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load dashboard live picks."
    });
  }
});

router.get("/bet-policy-tracking", async (req, res) => {
  try {
    const marketType =
      typeof req.query.marketType === "string" && req.query.marketType.trim()
        ? req.query.marketType.trim()
        : null;

    const thresholdType =
      typeof req.query.thresholdType === "string" && req.query.thresholdType.trim()
        ? req.query.thresholdType.trim()
        : null;

    const result = await getBetPolicyTrackingSummary({
      marketType,
      thresholdType
    });

    return res.status(result.ok ? 200 : 500).json({
      ...result,
      frontendExplanation:
        "Threshold tracking is based on official graded picks with calibrated probabilities. Early rows may be empty until enough post-calibration official picks are graded."
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load dashboard bet-policy tracking."
    });
  }
});

router.get("/status", async (req, res) => {
  try {
    const date =
      typeof req.query.date === "string" && req.query.date.trim()
        ? req.query.date.trim()
        : null;

    const result = await getDashboardStatus({ date });
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load dashboard status."
    });
  }
});

router.get("/monthly-calendar", async (req, res) => {
  try {
    const month =
      typeof req.query.month === "string" && req.query.month.trim()
        ? req.query.month.trim()
        : null;

    const result = await getDashboardMonthlyCalendar({ month });
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load dashboard monthly calendar."
    });
  }
});

module.exports = router;
