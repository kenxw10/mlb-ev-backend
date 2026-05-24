const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");
const { americanToDecimal } = require("../utils/oddsUtils");

const MARKET_CALIBRATION_CONFIG = {
  moneyline: {
    enabled: true,
    method: "platt",
    minSampleRequired: 100,
    retrainInterval: 50,
    shrinkageStrength: 2.5
  },
  runLine: {
    enabled: true,
    method: "platt",
    minSampleRequired: 70,
    retrainInterval: 50,
    shrinkageStrength: 3.0
  },
  totals: {
    enabled: false,
    method: "platt",
    minSampleRequired: 100,
    retrainInterval: 50,
    shrinkageStrength: 4.0
  }
};

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

function toPercentOrNull(value, decimals = 2) {
  const numericValue = toNumberOrNull(value);

  if (numericValue === null) {
    return null;
  }

  return Number((numericValue * 100).toFixed(decimals));
}

function clipProbability(probability, epsilon = 1e-6) {
  const numericValue = toNumberOrNull(probability);

  if (numericValue === null) {
    return null;
  }

  return Math.min(1 - epsilon, Math.max(epsilon, numericValue));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function logit(probability) {
  const clipped = clipProbability(probability);

  if (clipped === null) {
    return null;
  }

  return Math.log(clipped / (1 - clipped));
}

function probabilityToAmericanOdds(probability) {
  const clipped = clipProbability(probability);

  if (clipped === null) {
    return null;
  }

  if (clipped >= 0.5) {
    return Math.round(-(clipped / (1 - clipped)) * 100);
  }

  return Math.round(((1 - clipped) / clipped) * 100);
}

function expectedValueFromAmericanOdds(probability, price) {
  const clipped = clipProbability(probability);
  const numericPrice = toNumberOrNull(price);

  if (clipped === null || numericPrice === null) {
    return null;
  }

  const decimalOdds = americanToDecimal(numericPrice);

  if (decimalOdds === null) {
    return null;
  }

  return roundNumber(clipped * (decimalOdds - 1) - (1 - clipped), 4);
}

function parseRawPickJson(rawValue) {
  if (!rawValue) {
    return {};
  }

  if (typeof rawValue === "string") {
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return {};
    }
  }

  return rawValue;
}

async function ensureCalibrationTables() {
  if (!isDatabaseEnabled()) {
    return false;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS market_calibration_profiles (
      id TEXT PRIMARY KEY,
      market_type TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      min_sample_required INTEGER NOT NULL,
      retrain_interval INTEGER NOT NULL,
      sample_count_used INTEGER NOT NULL,
      trained_through_graded_row_count INTEGER NOT NULL,
      intercept NUMERIC NOT NULL,
      slope NUMERIC NOT NULL,
      brier_score_before NUMERIC NULL,
      brier_score_after NUMERIC NULL,
      log_loss_before NUMERIC NULL,
      log_loss_after NUMERIC NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS market_calibration_runs (
      id TEXT PRIMARY KEY,
      market_type TEXT NOT NULL,
      method TEXT NOT NULL,
      sample_count_used INTEGER NOT NULL,
      trained_through_graded_row_count INTEGER NOT NULL,
      intercept NUMERIC NOT NULL,
      slope NUMERIC NOT NULL,
      brier_score_before NUMERIC NULL,
      brier_score_after NUMERIC NULL,
      log_loss_before NUMERIC NULL,
      log_loss_after NUMERIC NULL,
      notes TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  return true;
}

async function getActiveCalibrationProfiles() {
  if (!isDatabaseEnabled()) {
    return {};
  }

  await ensureCalibrationTables();

  const result = await query(`
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
    WHERE status = 'active'
  `);

  const profiles = {};

  for (const row of result?.rows || []) {
    profiles[row.market_type] = row;
  }

  return profiles;
}

async function getCalibrationProfilesSummary() {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureCalibrationTables();

  const result = await query(`
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
  `);

  return {
    ok: true,
    profiles: result?.rows || [],
    config: MARKET_CALIBRATION_CONFIG
  };
}

async function fetchTrainingDataset(marketType) {
  const result = await query(
    `
      SELECT
        ps.id,
        ps.raw_pick_json,
        ps.model_probability,
        g.outcome
      FROM pick_snapshots ps
      INNER JOIN graded_pick_results g
        ON g.snapshot_id = ps.id
      WHERE COALESCE(ps.snapshot_mode, 'adhoc') = 'official'
        AND ps.source_bucket = $1
        AND g.outcome IN ('win', 'loss')
      ORDER BY g.graded_at ASC
    `,
    [marketType]
  );

  const dataset = [];

  for (const row of result?.rows || []) {
    const rawPick = parseRawPickJson(row.raw_pick_json);
    const rawProbability = clipProbability(
      rawPick?.rawModelProbability ??
        rawPick?.modelProbability ??
        row.model_probability
    );

    if (rawProbability === null) {
      continue;
    }

    dataset.push({
      snapshotId: row.id,
      rawProbability,
      outcome: row.outcome,
      y: row.outcome === "win" ? 1 : 0
    });
  }

  return dataset;
}

function computeBrierScore(dataset, probabilities) {
  if (!dataset.length || !probabilities.length) {
    return null;
  }

  const values = dataset.map((row, index) => {
    const probability = probabilities[index];
    return (probability - row.y) ** 2;
  });

  return roundNumber(
    values.reduce((sum, value) => sum + value, 0) / values.length,
    4
  );
}

function computeLogLoss(dataset, probabilities) {
  if (!dataset.length || !probabilities.length) {
    return null;
  }

  const values = dataset.map((row, index) => {
    const probability = clipProbability(probabilities[index]);
    return -(row.y * Math.log(probability) + (1 - row.y) * Math.log(1 - probability));
  });

  return roundNumber(
    values.reduce((sum, value) => sum + value, 0) / values.length,
    4
  );
}

function fitPlattCalibration(dataset, shrinkageStrength = 2.5) {
  if (!dataset.length) {
    return {
      intercept: 0,
      slope: 1
    };
  }

  const distinctOutcomes = new Set(dataset.map((row) => row.y));

  if (distinctOutcomes.size < 2) {
    return {
      intercept: 0,
      slope: 1
    };
  }

  let intercept = 0;
  let slope = 1;

  for (let iteration = 0; iteration < 30; iteration += 1) {
    let g0 = shrinkageStrength * intercept;
    let g1 = shrinkageStrength * (slope - 1);
    let h00 = shrinkageStrength;
    let h01 = 0;
    let h11 = shrinkageStrength;

    for (const row of dataset) {
      const x = logit(row.rawProbability);
      const z = intercept + slope * x;
      const p = clipProbability(sigmoid(z));
      const w = p * (1 - p);

      g0 += p - row.y;
      g1 += (p - row.y) * x;
      h00 += w;
      h01 += w * x;
      h11 += w * x * x;
    }

    const determinant = h00 * h11 - h01 * h01;

    if (Math.abs(determinant) < 1e-12) {
      break;
    }

    const delta0 = (g0 * h11 - g1 * h01) / determinant;
    const delta1 = (h00 * g1 - h01 * g0) / determinant;

    intercept -= delta0;
    slope -= delta1;

    if (Math.max(Math.abs(delta0), Math.abs(delta1)) < 1e-6) {
      break;
    }
  }

  intercept = Math.max(-4, Math.min(4, intercept));
  slope = Math.max(0.25, Math.min(4, slope));

  return {
    intercept: roundNumber(intercept, 6),
    slope: roundNumber(slope, 6)
  };
}

function calibrateProbability(rawProbability, profile) {
  const clipped = clipProbability(rawProbability);

  if (clipped === null) {
    return null;
  }

  if (!profile) {
    return clipped;
  }

  const intercept = toNumberOrNull(profile.intercept) ?? 0;
  const slope = toNumberOrNull(profile.slope) ?? 1;
  const calibrated = sigmoid(intercept + slope * logit(clipped));

  return roundNumber(clipProbability(calibrated), 6);
}

async function fitCalibrationProfileForMarket(marketType, options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  const config = MARKET_CALIBRATION_CONFIG[marketType];

  if (!config) {
    return {
      ok: false,
      error: "Invalid market type."
    };
  }

  if (!config.enabled && !options.force) {
    return {
      ok: true,
      marketType,
      skipped: true,
      reason: "Calibration not enabled for this market."
    };
  }

  await ensureCalibrationTables();

  const dataset = await fetchTrainingDataset(marketType);
  const sampleCountUsed = dataset.length;

  const activeProfiles = await getActiveCalibrationProfiles();
  const existingProfile = activeProfiles[marketType] || null;

  if (sampleCountUsed < config.minSampleRequired && !options.force) {
    return {
      ok: true,
      marketType,
      skipped: true,
      reason: `Not enough graded rows yet. Need ${config.minSampleRequired}.`,
      sampleCountUsed
    };
  }

  if (
    existingProfile &&
    !options.force &&
    sampleCountUsed < (Number(existingProfile.trained_through_graded_row_count) + config.retrainInterval)
  ) {
    return {
      ok: true,
      marketType,
      skipped: true,
      reason: `Retrain interval not reached yet. Need ${Number(existingProfile.trained_through_graded_row_count) + config.retrainInterval} graded rows.`,
      sampleCountUsed
    };
  }

  const fit = fitPlattCalibration(dataset, config.shrinkageStrength);

  const rawProbabilities = dataset.map((row) => row.rawProbability);
  const calibratedProbabilities = dataset.map((row) =>
    calibrateProbability(row.rawProbability, fit)
  );

  const brierScoreBefore = computeBrierScore(dataset, rawProbabilities);
  const brierScoreAfter = computeBrierScore(dataset, calibratedProbabilities);
  const logLossBefore = computeLogLoss(dataset, rawProbabilities);
  const logLossAfter = computeLogLoss(dataset, calibratedProbabilities);

  const runId = crypto.randomUUID();

  await query(
    `
      INSERT INTO market_calibration_runs (
        id,
        market_type,
        method,
        sample_count_used,
        trained_through_graded_row_count,
        intercept,
        slope,
        brier_score_before,
        brier_score_after,
        log_loss_before,
        log_loss_after,
        notes
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
    `,
    [
      runId,
      marketType,
      config.method,
      sampleCountUsed,
      sampleCountUsed,
      fit.intercept,
      fit.slope,
      brierScoreBefore,
      brierScoreAfter,
      logLossBefore,
      logLossAfter,
      options.force ? "Manual/forced fit." : "Automatic fit."
    ]
  );

  await query(
    `
      INSERT INTO market_calibration_profiles (
        id,
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
      )
      VALUES (
        $1, $2, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
      )
      ON CONFLICT (market_type)
      DO UPDATE SET
        method = EXCLUDED.method,
        status = 'active',
        min_sample_required = EXCLUDED.min_sample_required,
        retrain_interval = EXCLUDED.retrain_interval,
        sample_count_used = EXCLUDED.sample_count_used,
        trained_through_graded_row_count = EXCLUDED.trained_through_graded_row_count,
        intercept = EXCLUDED.intercept,
        slope = EXCLUDED.slope,
        brier_score_before = EXCLUDED.brier_score_before,
        brier_score_after = EXCLUDED.brier_score_after,
        log_loss_before = EXCLUDED.log_loss_before,
        log_loss_after = EXCLUDED.log_loss_after,
        activated_at = NOW(),
        updated_at = NOW()
    `,
    [
      crypto.randomUUID(),
      marketType,
      config.method,
      config.minSampleRequired,
      config.retrainInterval,
      sampleCountUsed,
      sampleCountUsed,
      fit.intercept,
      fit.slope,
      brierScoreBefore,
      brierScoreAfter,
      logLossBefore,
      logLossAfter
    ]
  );

  return {
    ok: true,
    marketType,
    skipped: false,
    sampleCountUsed,
    trainedThroughGradedRowCount: sampleCountUsed,
    intercept: fit.intercept,
    slope: fit.slope,
    brierScoreBefore,
    brierScoreAfter,
    logLossBefore,
    logLossAfter
  };
}

async function maybeAutoFitEligibleMarkets() {
  if (!isDatabaseEnabled()) {
    return [];
  }

  const markets = ["moneyline", "runLine"];
  const results = [];

  for (const marketType of markets) {
    const result = await fitCalibrationProfileForMarket(marketType);
    results.push(result);
  }

  return results;
}

function comparePicksForRanking(a, b) {
  const aEv = toNumberOrNull(a?.expectedValue) ?? -999;
  const bEv = toNumberOrNull(b?.expectedValue) ?? -999;

  if (bEv !== aEv) {
    return bEv - aEv;
  }

  const aEdge = toNumberOrNull(a?.edge) ?? -999;
  const bEdge = toNumberOrNull(b?.edge) ?? -999;

  if (bEdge !== aEdge) {
    return bEdge - aEdge;
  }

  const aQuality = toNumberOrNull(a?.dataQualityScore) ?? -999;
  const bQuality = toNumberOrNull(b?.dataQualityScore) ?? -999;

  return bQuality - aQuality;
}

function applyCalibrationToPick(pick, profile) {
  const rawProbability = clipProbability(
    pick?.rawModelProbability ?? pick?.modelProbability
  );

  if (rawProbability === null) {
    return pick;
  }

  const calibratedProbability = calibrateProbability(rawProbability, profile);

  pick.rawModelProbability = roundNumber(rawProbability, 6);
  pick.rawModelProbabilityPercent = toPercentOrNull(rawProbability);
  pick.calibratedProbability = roundNumber(calibratedProbability, 6);
  pick.calibratedProbabilityPercent = toPercentOrNull(calibratedProbability);

  pick.modelProbability = roundNumber(calibratedProbability, 6);
  pick.modelProbabilityPercent = toPercentOrNull(calibratedProbability);

  if (pick.impliedProbability !== null && pick.impliedProbability !== undefined) {
    pick.edge = roundNumber(calibratedProbability - pick.impliedProbability, 6);
    pick.edgePercent = toPercentOrNull(pick.edge);
  }

  pick.fairOdds = probabilityToAmericanOdds(calibratedProbability);
  pick.expectedValue = expectedValueFromAmericanOdds(calibratedProbability, pick.price);
  pick.expectedValuePercent = toPercentOrNull(pick.expectedValue);

  return pick;
}

function applyCalibrationToResponse(response, calibrationProfiles = {}) {
  if (!response?.byMarket) {
    return response;
  }

  const marketKeys = ["moneyline", "runLine", "totals"];

  for (const marketKey of marketKeys) {
    const marketSummary = response.byMarket?.[marketKey];

    if (!marketSummary?.rankedPicks) {
      continue;
    }

    const profile = calibrationProfiles[marketKey] || null;

    marketSummary.rankedPicks = marketSummary.rankedPicks
      .map((pick) => applyCalibrationToPick(pick, profile))
      .sort(comparePicksForRanking);

    marketSummary.rankedPickCount = marketSummary.rankedPicks.length;
    marketSummary.topPicks = marketSummary.rankedPicks.slice(0, 4);
  }

  const rankedPicksOverall = [
    ...(response.byMarket.moneyline?.rankedPicks || []),
    ...(response.byMarket.runLine?.rankedPicks || []),
    ...(response.byMarket.totals?.rankedPicks || [])
  ].sort(comparePicksForRanking);

  response.totalRankedPickCount = rankedPicksOverall.length;
  response.topPicksOverall = rankedPicksOverall.slice(0, 4);

  return response;
}

module.exports = {
  MARKET_CALIBRATION_CONFIG,
  ensureCalibrationTables,
  getActiveCalibrationProfiles,
  getCalibrationProfilesSummary,
  fitCalibrationProfileForMarket,
  maybeAutoFitEligibleMarkets,
  applyCalibrationToResponse
};
