const express = require("express");
const { isValidDateString } = require("../utils/dateUtils");
const {
  gradeSnapshotsForDate,
  gradeSnapshotsForDateRange,
  getSnapshotCoverageSummary
} = require("../services/pickGradingService");
const { getCalibrationSummary } = require("../services/calibrationSummaryService");
const {
  MARKET_CALIBRATION_CONFIG,
  fitCalibrationProfileForMarket,
  getCalibrationProfilesSummary
} = require("../services/calibrationService");
const {
  getBetPolicyTrackingSummary,
  rebuildBetPolicyTracking
} = require("../services/betPolicyTrackingService");
const {
  LOCK_WINDOWS,
  getEasternDateString,
  getYesterdayEasternDateString,
  runOfficialLockForDateWindow,
  forceRunOfficialLockForDateWindow,
  runOfficialGradeForDate
} = require("../services/officialAutomationService");

const {
  getBetExecutionRecordsForDate,
  upsertBetExecutionRecord
} = require("../services/betExecutionService");

const {
  getClvTrackingForDate,
  captureClvForDate
} = require("../services/clvTrackingService");

const { runDueClvCapture } = require("../services/officialAutomationService");

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

router.get("/grade-range", async (req, res) => {
  try {
    const startDate =
      typeof req.query.startDate === "string" ? req.query.startDate.trim() : "";
    const endDate =
      typeof req.query.endDate === "string" ? req.query.endDate.trim() : "";

    if (!startDate || !endDate || !isValidDateString(startDate) || !isValidDateString(endDate)) {
      return res.status(400).json({
        ok: false,
        error: "Valid startDate and endDate query parameters are required in YYYY-MM-DD format."
      });
    }

    if (startDate > endDate) {
      return res.status(400).json({
        ok: false,
        error: "startDate must be less than or equal to endDate."
      });
    }

    const result = await gradeSnapshotsForDateRange(startDate, endDate);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to grade date range."
    });
  }
});

router.get("/snapshot-coverage", async (req, res) => {
  try {
    const result = await getSnapshotCoverageSummary();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to summarize snapshot coverage."
    });
  }
});

router.get("/calibration-summary", async (req, res) => {
  try {
    const result = await getCalibrationSummary();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to build calibration summary."
    });
  }
});

router.get("/calibration-profiles", async (req, res) => {
  try {
    const result = await getCalibrationProfilesSummary();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load calibration profiles."
    });
  }
});

router.get("/recalibrate-market", async (req, res) => {
  try {
    const marketType =
      typeof req.query.marketType === "string" ? req.query.marketType.trim() : "";
    const force =
      typeof req.query.force === "string" && req.query.force.trim().toLowerCase() === "true";

    if (!MARKET_CALIBRATION_CONFIG[marketType]) {
      return res.status(400).json({
        ok: false,
        error: "Valid marketType query parameter is required: moneyline, runLine, or totals."
      });
    }

    const result = await fitCalibrationProfileForMarket(marketType, { force });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to recalibrate market."
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

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load bet policy tracking."
    });
  }
});

router.get("/rebuild-bet-policy-tracking", async (req, res) => {
  try {
    const result = await rebuildBetPolicyTracking();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to rebuild bet policy tracking."
    });
  }
});

router.get("/official-lock", async (req, res) => {
  try {
    const requestedDate =
      typeof req.query.date === "string" && req.query.date.trim()
        ? req.query.date.trim()
        : getEasternDateString();

    const lockWindow =
      typeof req.query.window === "string" && req.query.window.trim()
        ? req.query.window.trim()
        : "daily";

    if (!isValidDateString(requestedDate)) {
      return res.status(400).json({
        ok: false,
        error: "Valid date query parameter is required in YYYY-MM-DD format."
      });
    }

    if (!LOCK_WINDOWS[lockWindow]) {
      return res.status(400).json({
        ok: false,
        error: "Valid window query parameter is required: daily."
      });
    }

    const result = await runOfficialLockForDateWindow(requestedDate, lockWindow);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to run official lock."
    });
  }
});

router.post("/official-lock/force", async (req, res) => {
  try {
    const requestedDate =
      typeof req.query.date === "string" && req.query.date.trim()
        ? req.query.date.trim()
        : typeof req.body?.date === "string"
          ? req.body.date.trim()
          : getEasternDateString();

    const lockWindow =
      typeof req.query.window === "string" && req.query.window.trim()
        ? req.query.window.trim()
        : typeof req.body?.window === "string"
          ? req.body.window.trim()
          : "daily";

    const allowSnapshotDelete =
      String(req.query.allowSnapshotDelete || req.body?.allowSnapshotDelete || "")
        .toLowerCase() === "true";

    const reason =
      typeof req.query.reason === "string" && req.query.reason.trim()
        ? req.query.reason.trim()
        : typeof req.body?.reason === "string"
          ? req.body.reason.trim()
          : "manual_force_official_lock";

    if (!isValidDateString(requestedDate)) {
      return res.status(400).json({
        ok: false,
        error: "Valid date query parameter is required in YYYY-MM-DD format."
      });
    }

    if (!LOCK_WINDOWS[lockWindow]) {
      return res.status(400).json({
        ok: false,
        error: "Valid window query parameter is required: daily."
      });
    }

    const result = await forceRunOfficialLockForDateWindow(requestedDate, lockWindow, {
      allowSnapshotDelete,
      reason
    });

    return res.status(result.ok === false ? 409 : 200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to force official lock."
    });
  }
});
router.get("/official-grade", async (req, res) => {
  try {
    const requestedDate =
      typeof req.query.date === "string" && req.query.date.trim()
        ? req.query.date.trim()
        : getYesterdayEasternDateString();

    if (!isValidDateString(requestedDate)) {
      return res.status(400).json({
        ok: false,
        error: "Valid date query parameter is required in YYYY-MM-DD format."
      });
    }

    const result = await runOfficialGradeForDate(requestedDate);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to run official grade."
    });
  }
});


router.get("/execution", async (req, res) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date.trim() : "";

    if (!date || !isValidDateString(date)) {
      return res.status(400).json({
        ok: false,
        error: "Valid date query parameter is required in YYYY-MM-DD format."
      });
    }

    const result = await getBetExecutionRecordsForDate(date);
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load execution records."
    });
  }
});

router.post("/execution", async (req, res) => {
  try {
    const result = await upsertBetExecutionRecord(req.body || {});
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to save execution record."
    });
  }
});


router.get("/clv", async (req, res) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date.trim() : "";

    if (!date || !isValidDateString(date)) {
      return res.status(400).json({
        ok: false,
        error: "Valid date query parameter is required in YYYY-MM-DD format."
      });
    }

    const captureType =
      typeof req.query.captureType === "string" && req.query.captureType.trim()
        ? req.query.captureType.trim()
        : undefined;

    const result = await getClvTrackingForDate(date, { captureType });
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load CLV tracking records."
    });
  }
});

router.post("/clv/capture", async (req, res) => {
  try {
    const date =
      typeof req.query.date === "string" && req.query.date.trim()
        ? req.query.date.trim()
        : typeof req.body?.date === "string"
          ? req.body.date.trim()
          : "";

    if (!date || !isValidDateString(date)) {
      return res.status(400).json({
        ok: false,
        error: "Valid date is required in YYYY-MM-DD format."
      });
    }

    const captureType =
      typeof req.query.captureType === "string" && req.query.captureType.trim()
        ? req.query.captureType.trim()
        : typeof req.body?.captureType === "string" && req.body.captureType.trim()
          ? req.body.captureType.trim()
          : undefined;

    const result = await captureClvForDate(date, { captureType });
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to capture CLV records."
    });
  }
});


router.post("/clv/capture-due", async (req, res) => {
  try {
    const result = await runDueClvCapture(new Date());
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to run due CLV capture."
    });
  }
});

module.exports = router;




