const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");

const BET_POLICY_TRACKING_CONFIG = {
  evMinThresholds: [0, 0.02, 0.04, 0.06, 0.08, 0.1],
  edgeMinThresholds: [0, 0.02, 0.04, 0.06, 0.08, 0.1]
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

function buildThresholdLabel(value) {
  return `${Number((value * 100).toFixed(0))}%+`;
}

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeStats(rows) {
  const gradedPickCount = rows.length;
  const winRows = rows.filter((row) => row.outcome === "win");
  const lossRows = rows.filter((row) => row.outcome === "loss");
  const pushRows = rows.filter((row) => row.outcome === "push");
  const settledRows = rows.filter(
    (row) => row.outcome === "win" || row.outcome === "loss"
  );

  const totalProfitUnits = rows.reduce((sum, row) => {
    const profitUnits = toNumberOrNull(row.profit_units);
    return sum + (profitUnits ?? 0);
  }, 0);

  const avgExpectedValue = average(
    rows
      .map((row) => toNumberOrNull(row.expected_value))
      .filter((value) => value !== null)
  );

  const avgEdge = average(
    rows
      .map((row) => toNumberOrNull(row.edge))
      .filter((value) => value !== null)
  );

  const avgModelProbability = average(
    rows
      .map((row) => toNumberOrNull(row.model_probability))
      .filter((value) => value !== null)
  );

  return {
    gradedPickCount,
    winCount: winRows.length,
    lossCount: lossRows.length,
    pushCount: pushRows.length,
    winRate:
      settledRows.length > 0 ? roundNumber(winRows.length / settledRows.length, 4) : null,
    roiUnitsPerBet:
      gradedPickCount > 0 ? roundNumber(totalProfitUnits / gradedPickCount, 4) : null,
    totalProfitUnits: roundNumber(totalProfitUnits, 4),
    avgExpectedValue: roundNumber(avgExpectedValue, 4),
    avgEdge: roundNumber(avgEdge, 4),
    avgModelProbability: roundNumber(avgModelProbability, 4)
  };
}

async function ensureBetPolicyTrackingTable() {
  if (!isDatabaseEnabled()) {
    return false;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS bet_policy_tracking_stats (
      id TEXT PRIMARY KEY,
      market_type TEXT NOT NULL,
      threshold_type TEXT NOT NULL,
      threshold_label TEXT NOT NULL,
      threshold_value NUMERIC NOT NULL,
      calibrated_only BOOLEAN NOT NULL DEFAULT TRUE,
      graded_pick_count INTEGER NOT NULL,
      win_count INTEGER NOT NULL,
      loss_count INTEGER NOT NULL,
      push_count INTEGER NOT NULL,
      win_rate NUMERIC NULL,
      roi_units_per_bet NUMERIC NULL,
      total_profit_units NUMERIC NULL,
      avg_expected_value NUMERIC NULL,
      avg_edge NUMERIC NULL,
      avg_model_probability NUMERIC NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (market_type, threshold_type, threshold_label, calibrated_only)
    )
  `);

  return true;
}

async function fetchCalibratedOfficialGradedRows() {
  const result = await query(`
    SELECT
      ps.source_bucket AS market_type,
      ps.rank_within_bucket,
      ps.expected_value,
      ps.edge,
      ps.model_probability,
      ps.data_quality_score,
      g.outcome,
      g.profit_units
    FROM pick_snapshots ps
    INNER JOIN graded_pick_results g
      ON g.snapshot_id = ps.id
    WHERE COALESCE(ps.snapshot_mode, 'adhoc') = 'official'
      AND ps.source_bucket IN ('moneyline', 'runLine', 'totals')
      AND ps.raw_pick_json ? 'calibratedProbability'
      AND g.outcome IN ('win', 'loss', 'push')
    ORDER BY ps.source_bucket ASC, g.graded_at ASC
  `);

  return result?.rows || [];
}

function buildTrackingRows(rows) {
  const markets = ["moneyline", "runLine", "totals"];
  const trackingRows = [];

  for (const marketType of markets) {
    const marketRows = rows.filter((row) => row.market_type === marketType);

    for (const threshold of BET_POLICY_TRACKING_CONFIG.evMinThresholds) {
      const eligibleRows = marketRows.filter((row) => {
        const expectedValue = toNumberOrNull(row.expected_value);
        return expectedValue !== null && expectedValue >= threshold;
      });

      trackingRows.push({
        marketType,
        thresholdType: "ev_min",
        thresholdLabel: buildThresholdLabel(threshold),
        thresholdValue: threshold,
        calibratedOnly: true,
        ...computeStats(eligibleRows)
      });
    }

    for (const threshold of BET_POLICY_TRACKING_CONFIG.edgeMinThresholds) {
      const eligibleRows = marketRows.filter((row) => {
        const edge = toNumberOrNull(row.edge);
        return edge !== null && edge >= threshold;
      });

      trackingRows.push({
        marketType,
        thresholdType: "edge_min",
        thresholdLabel: buildThresholdLabel(threshold),
        thresholdValue: threshold,
        calibratedOnly: true,
        ...computeStats(eligibleRows)
      });
    }
  }

  return trackingRows;
}

async function rebuildBetPolicyTracking() {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureBetPolicyTrackingTable();

  const gradedRows = await fetchCalibratedOfficialGradedRows();
  const trackingRows = buildTrackingRows(gradedRows);

  for (const row of trackingRows) {
    await query(
      `
        INSERT INTO bet_policy_tracking_stats (
          id,
          market_type,
          threshold_type,
          threshold_label,
          threshold_value,
          calibrated_only,
          graded_pick_count,
          win_count,
          loss_count,
          push_count,
          win_rate,
          roi_units_per_bet,
          total_profit_units,
          avg_expected_value,
          avg_edge,
          avg_model_probability,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, NOW()
        )
        ON CONFLICT (market_type, threshold_type, threshold_label, calibrated_only)
        DO UPDATE SET
          threshold_value = EXCLUDED.threshold_value,
          graded_pick_count = EXCLUDED.graded_pick_count,
          win_count = EXCLUDED.win_count,
          loss_count = EXCLUDED.loss_count,
          push_count = EXCLUDED.push_count,
          win_rate = EXCLUDED.win_rate,
          roi_units_per_bet = EXCLUDED.roi_units_per_bet,
          total_profit_units = EXCLUDED.total_profit_units,
          avg_expected_value = EXCLUDED.avg_expected_value,
          avg_edge = EXCLUDED.avg_edge,
          avg_model_probability = EXCLUDED.avg_model_probability,
          updated_at = NOW()
      `,
      [
        crypto.randomUUID(),
        row.marketType,
        row.thresholdType,
        row.thresholdLabel,
        row.thresholdValue,
        row.calibratedOnly,
        row.gradedPickCount,
        row.winCount,
        row.lossCount,
        row.pushCount,
        row.winRate,
        row.roiUnitsPerBet,
        row.totalProfitUnits,
        row.avgExpectedValue,
        row.avgEdge,
        row.avgModelProbability
      ]
    );
  }

  return {
    ok: true,
    calibratedOfficialGradedRowCount: gradedRows.length,
    trackingRowCount: trackingRows.length
  };
}

async function getBetPolicyTrackingSummary(filters = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureBetPolicyTrackingTable();

  const conditions = [];
  const params = [];

  if (filters.marketType) {
    params.push(filters.marketType);
    conditions.push(`market_type = $${params.length}`);
  }

  if (filters.thresholdType) {
    params.push(filters.thresholdType);
    conditions.push(`threshold_type = $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await query(
    `
      SELECT
        market_type,
        threshold_type,
        threshold_label,
        threshold_value,
        calibrated_only,
        graded_pick_count,
        win_count,
        loss_count,
        push_count,
        win_rate,
        roi_units_per_bet,
        total_profit_units,
        avg_expected_value,
        avg_edge,
        avg_model_probability,
        updated_at
      FROM bet_policy_tracking_stats
      ${whereClause}
      ORDER BY market_type ASC, threshold_type ASC, threshold_value ASC
    `,
    params
  );

  return {
    ok: true,
    rows: result?.rows || []
  };
}

module.exports = {
  BET_POLICY_TRACKING_CONFIG,
  ensureBetPolicyTrackingTable,
  rebuildBetPolicyTracking,
  getBetPolicyTrackingSummary
};
