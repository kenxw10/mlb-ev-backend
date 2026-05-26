const { query, isDatabaseEnabled } = require("../config/db");
const { ensureBetExecutionTable } = require("./betExecutionService");

const DASHBOARD_HISTORY_START_DATE =
  process.env.DASHBOARD_HISTORY_START_DATE || "2026-05-24";

const EXECUTION_MARKETS = ["moneyline", "runLine"];

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

function formatDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function getProfitPerUnitFromAmericanOdds(price) {
  const odds = toNumberOrNull(price);

  if (odds === null || odds === 0) {
    return null;
  }

  if (odds > 0) {
    return odds / 100;
  }

  return 100 / Math.abs(odds);
}

function getActualProfitUnits(row) {
  const outcome = row?.outcome;
  const executedUnits = toNumberOrNull(row?.executed_units);
  const executedPrice = toNumberOrNull(row?.executed_price);

  if (executedUnits === null || executedUnits <= 0) {
    return null;
  }

  if (outcome === "loss") {
    return -executedUnits;
  }

  if (outcome === "push") {
    return 0;
  }

  if (outcome !== "win") {
    return null;
  }

  const profitPerUnit = getProfitPerUnitFromAmericanOdds(executedPrice);

  if (profitPerUnit === null) {
    return null;
  }

  return executedUnits * profitPerUnit;
}

function buildEmptyActualMetrics(label) {
  return {
    label,
    placedBetCount: 0,
    gradedBetCount: 0,
    pendingBetCount: 0,
    winCount: 0,
    lossCount: 0,
    pushCount: 0,
    record: "0-0-0",
    winRatePercent: null,
    totalUnitsPlaced: 0,
    gradedUnitsStaked: 0,
    totalProfitUnits: 0,
    roiPercent: null
  };
}

function applyActualResult(metrics, row) {
  const executedUnits = toNumberOrNull(row.executed_units) || 0;
  const outcome = row.outcome || "pending";
  const actualProfitUnits = getActualProfitUnits(row);

  metrics.placedBetCount += 1;
  metrics.totalUnitsPlaced += executedUnits;

  if (!["win", "loss", "push"].includes(outcome)) {
    metrics.pendingBetCount += 1;
    return;
  }

  metrics.gradedBetCount += 1;
  metrics.gradedUnitsStaked += executedUnits;

  if (outcome === "win") {
    metrics.winCount += 1;
  } else if (outcome === "loss") {
    metrics.lossCount += 1;
  } else if (outcome === "push") {
    metrics.pushCount += 1;
  }

  if (actualProfitUnits !== null) {
    metrics.totalProfitUnits += actualProfitUnits;
  }
}

function finalizeActualMetrics(metrics) {
  const decisions = metrics.winCount + metrics.lossCount;

  metrics.record = `${metrics.winCount}-${metrics.lossCount}-${metrics.pushCount}`;
  metrics.winRatePercent =
    decisions > 0 ? roundNumber((metrics.winCount / decisions) * 100, 2) : null;
  metrics.totalUnitsPlaced = roundNumber(metrics.totalUnitsPlaced, 4);
  metrics.gradedUnitsStaked = roundNumber(metrics.gradedUnitsStaked, 4);
  metrics.totalProfitUnits = roundNumber(metrics.totalProfitUnits, 4);
  metrics.roiPercent =
    metrics.gradedUnitsStaked > 0
      ? roundNumber((metrics.totalProfitUnits / metrics.gradedUnitsStaked) * 100, 2)
      : null;

  return metrics;
}

function buildActualMetricsBundle() {
  return {
    overall: buildEmptyActualMetrics("actual_betting"),
    byMarket: {
      moneyline: buildEmptyActualMetrics("moneyline"),
      runLine: buildEmptyActualMetrics("runLine")
    }
  };
}

function finalizeActualMetricsBundle(bundle) {
  finalizeActualMetrics(bundle.overall);
  finalizeActualMetrics(bundle.byMarket.moneyline);
  finalizeActualMetrics(bundle.byMarket.runLine);

  return bundle;
}

function normalizeExecutionHistoryRow(row) {
  const actualProfitUnits = getActualProfitUnits(row);

  return {
    executionId: row.execution_id,
    snapshotId: row.snapshot_id,
    requestedDate: formatDateValue(row.requested_date),
    marketType: row.market_type,
    matchup: row.matchup,
    selection: row.selection,
    side: row.side,
    line: toNumberOrNull(row.line),
    sportsbook: row.execution_sportsbook || row.snapshot_sportsbook || null,
    modelLockedPrice: toNumberOrNull(row.model_locked_price),
    minimumAcceptableOdds: toNumberOrNull(row.minimum_acceptable_odds),
    executedPrice: toNumberOrNull(row.executed_price),
    executedUnits: toNumberOrNull(row.executed_units),
    executionStatus: row.execution_status,
    decidedAt: row.decided_at,
    outcome: row.outcome || "pending",
    gradedAt: row.graded_at || null,
    actualProfitUnits:
      actualProfitUnits === null ? null : roundNumber(actualProfitUnits, 4)
  };
}

async function getDashboardExecutionPerformance(options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureBetExecutionTable();

  const startDate = options.startDate || DASHBOARD_HISTORY_START_DATE;
  const endDate = options.endDate || null;

  const result = await query(
    `
      SELECT
        er.id AS execution_id,
        er.snapshot_id,
        er.requested_date,
        er.market_type,
        er.sportsbook AS execution_sportsbook,
        er.execution_status,
        er.model_locked_price,
        er.minimum_acceptable_odds,
        er.executed_price,
        er.executed_units,
        er.decided_at,
        ps.matchup,
        ps.selection,
        ps.side,
        ps.line,
        ps.sportsbook AS snapshot_sportsbook,
        g.outcome,
        g.graded_at
      FROM bet_execution_records er
      INNER JOIN pick_snapshots ps
        ON ps.id = er.snapshot_id
      LEFT JOIN graded_pick_results g
        ON g.snapshot_id = er.snapshot_id
      WHERE er.execution_status = 'placed'
        AND ps.snapshot_mode = 'official'
        AND er.market_type = ANY($3::text[])
        AND er.requested_date >= $1::date
        AND ($2::date IS NULL OR er.requested_date <= $2::date)
      ORDER BY er.requested_date DESC, er.decided_at DESC NULLS LAST, er.created_at DESC
    `,
    [startDate, endDate, EXECUTION_MARKETS]
  );

  const rows = result?.rows || [];
  const metrics = buildActualMetricsBundle();

  for (const row of rows) {
    applyActualResult(metrics.overall, row);

    if (metrics.byMarket[row.market_type]) {
      applyActualResult(metrics.byMarket[row.market_type], row);
    }
  }

  return {
    ok: true,
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    ...finalizeActualMetricsBundle(metrics),
    history: rows.map(normalizeExecutionHistoryRow)
  };
}

module.exports = {
  getDashboardExecutionPerformance
};
