const { query, isDatabaseEnabled } = require("../config/db");
const {
  MARKET_CALIBRATION_CONFIG,
  ensureCalibrationTables
} = require("./calibrationService");

const MARKET_ORDER = ["moneyline", "runLine", "totals"];

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function roundNumber(value, decimals = 4) {
  const numericValue = toNumberOrNull(value);

  if (numericValue === null) {
    return null;
  }

  return Number(numericValue.toFixed(decimals));
}

function buildEmptyCountRow(marketType) {
  return {
    market_type: marketType,
    training_graded_pick_count: 0,
    official_graded_pick_count: 0,
    push_count: 0,
    last_graded_at: null
  };
}

function normalizeProfile(row) {
  if (!row) {
    return null;
  }

  return {
    marketType: row.market_type,
    method: row.method,
    status: row.status,
    minSampleRequired: toNumberOrNull(row.min_sample_required),
    retrainInterval: toNumberOrNull(row.retrain_interval),
    sampleCountUsed: toNumberOrNull(row.sample_count_used),
    trainedThroughGradedRowCount: toNumberOrNull(row.trained_through_graded_row_count),
    intercept: roundNumber(row.intercept, 6),
    slope: roundNumber(row.slope, 6),
    brierScoreBefore: roundNumber(row.brier_score_before, 4),
    brierScoreAfter: roundNumber(row.brier_score_after, 4),
    logLossBefore: roundNumber(row.log_loss_before, 4),
    logLossAfter: roundNumber(row.log_loss_after, 4),
    activatedAt: row.activated_at,
    updatedAt: row.updated_at
  };
}

function buildMarketCalibrationStatus(marketType, profileRow, countRow) {
  const config = MARKET_CALIBRATION_CONFIG[marketType] || null;
  const profile = normalizeProfile(profileRow);
  const counts = countRow || buildEmptyCountRow(marketType);

  const trainingGradedPickCount =
    toNumberOrNull(counts.training_graded_pick_count) || 0;

  const officialGradedPickCount =
    toNumberOrNull(counts.official_graded_pick_count) || 0;

  const pushCount = toNumberOrNull(counts.push_count) || 0;

  if (!config) {
    return {
      marketType,
      calibrationEnabled: false,
      frontendStatus: "missing_config",
      frontendStatusLabel: "No calibration config",
      trainingGradedPickCount,
      officialGradedPickCount,
      pushCount,
      lastGradedAt: counts.last_graded_at,
      profile: null,
      nextCalibration: null
    };
  }

  if (!config.enabled) {
    return {
      marketType,
      calibrationEnabled: false,
      frontendStatus: "disabled",
      frontendStatusLabel: "Calibration disabled",
      trainingGradedPickCount,
      officialGradedPickCount,
      pushCount,
      lastGradedAt: counts.last_graded_at,
      profile,
      nextCalibration: {
        basis: "disabled",
        targetTrainingGradedPickCount: null,
        picksRemaining: null,
        message: "Calibration is intentionally disabled for this market."
      }
    };
  }

  if (!profile) {
    const target = config.minSampleRequired;
    const remaining = Math.max(0, target - trainingGradedPickCount);

    return {
      marketType,
      calibrationEnabled: true,
      frontendStatus:
        remaining === 0 ? "eligible_initial_fit" : "waiting_for_initial_sample",
      frontendStatusLabel:
        remaining === 0
          ? "Eligible for initial calibration"
          : "Waiting for initial calibration sample",
      trainingGradedPickCount,
      officialGradedPickCount,
      pushCount,
      lastGradedAt: counts.last_graded_at,
      profile: null,
      nextCalibration: {
        basis: "initial_fit",
        targetTrainingGradedPickCount: target,
        picksRemaining: remaining,
        message:
          remaining === 0
            ? "Initial calibration can be fit now."
            : `${remaining} training-eligible graded picks until initial calibration.`
      }
    };
  }

  const trainedThrough =
    toNumberOrNull(profile.trainedThroughGradedRowCount) || 0;
  const target = trainedThrough + config.retrainInterval;
  const remaining = Math.max(0, target - trainingGradedPickCount);

  return {
    marketType,
    calibrationEnabled: true,
    frontendStatus: remaining === 0 ? "eligible_retrain" : "active",
    frontendStatusLabel:
      remaining === 0 ? "Eligible for recalibration" : "Active",
    trainingGradedPickCount,
    officialGradedPickCount,
    pushCount,
    lastGradedAt: counts.last_graded_at,
    profile,
    nextCalibration: {
      basis: "retrain_interval",
      targetTrainingGradedPickCount: target,
      trainedThroughGradedRowCount: trainedThrough,
      retrainInterval: config.retrainInterval,
      picksRemaining: remaining,
      message:
        remaining === 0
          ? "Recalibration can be fit now."
          : `${remaining} training-eligible graded picks until next recalibration.`
    }
  };
}

async function getDashboardCalibrationStatus() {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureCalibrationTables();

  const [profileResult, countResult] = await Promise.all([
    query(`
      SELECT
        market_type,
        method,
        status,
        min_sample_required,
        retrain_interval,
        sample_count_used,
        trained_through_graded_row_count,
        intercept,
        slope,
        brier_score_before,
        brier_score_after,
        log_loss_before,
        log_loss_after,
        activated_at,
        updated_at
      FROM market_calibration_profiles
      ORDER BY market_type ASC
    `),
    query(`
      SELECT
        ps.market_type,
        COUNT(*) FILTER (WHERE g.outcome IN ('win', 'loss'))::int
          AS training_graded_pick_count,
        COUNT(*)::int AS official_graded_pick_count,
        COUNT(*) FILTER (WHERE g.outcome = 'push')::int AS push_count,
        MAX(g.graded_at) AS last_graded_at
      FROM pick_snapshots ps
      INNER JOIN graded_pick_results g
        ON g.snapshot_id = ps.id
      WHERE ps.snapshot_mode = 'official'
        AND ps.source_bucket = ANY($1::text[])
      GROUP BY ps.market_type
    `, [MARKET_ORDER])
  ]);

  const profileMap = {};
  for (const row of profileResult?.rows || []) {
    profileMap[row.market_type] = row;
  }

  const countMap = {};
  for (const row of countResult?.rows || []) {
    countMap[row.market_type] = row;
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    explanation:
      "Calibration retraining is based on training-eligible graded picks, meaning official graded picks with win/loss outcomes. Pushes are shown but do not count toward calibration sample size.",
    markets: MARKET_ORDER.map((marketType) =>
      buildMarketCalibrationStatus(
        marketType,
        profileMap[marketType] || null,
        countMap[marketType] || buildEmptyCountRow(marketType)
      )
    )
  };
}

module.exports = {
  getDashboardCalibrationStatus
};
