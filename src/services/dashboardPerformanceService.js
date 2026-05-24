const { query, isDatabaseEnabled } = require("../config/db");

const DASHBOARD_HISTORY_START_DATE =
  process.env.DASHBOARD_HISTORY_START_DATE || "2026-05-24";

const OFFICIAL_MARKET_BUCKETS = ["moneyline", "runLine", "totals"];

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

function normalizeLimit(value) {
  const parsed = Number(value);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return 250;
  }

  return Math.min(Math.floor(parsed), 1000);
}

function normalizeOffset(value) {
  const parsed = Number(value);

  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function buildEmptyMetrics(label) {
  return {
    label,
    gradedPickCount: 0,
    recommendedBetCount: 0,
    winCount: 0,
    lossCount: 0,
    pushCount: 0,
    record: "0-0-0",
    winRate: null,
    winRatePercent: null,
    totalUnitsStaked: 0,
    totalProfitUnits: 0,
    roiPerUnitStaked: null,
    roiPercent: null,
    avgProfitUnitsPerPick: null
  };
}

function finalizeMetrics(metrics) {
  const decisionCount = metrics.winCount + metrics.lossCount;

  metrics.record = `${metrics.winCount}-${metrics.lossCount}-${metrics.pushCount}`;
  metrics.winRate =
    decisionCount > 0 ? roundNumber(metrics.winCount / decisionCount, 4) : null;
  metrics.winRatePercent =
    metrics.winRate !== null ? roundNumber(metrics.winRate * 100, 2) : null;

  metrics.totalUnitsStaked = roundNumber(metrics.totalUnitsStaked, 4) || 0;
  metrics.totalProfitUnits = roundNumber(metrics.totalProfitUnits, 4) || 0;

  metrics.roiPerUnitStaked =
    metrics.totalUnitsStaked > 0
      ? roundNumber(metrics.totalProfitUnits / metrics.totalUnitsStaked, 4)
      : null;

  metrics.roiPercent =
    metrics.roiPerUnitStaked !== null
      ? roundNumber(metrics.roiPerUnitStaked * 100, 2)
      : null;

  metrics.avgProfitUnitsPerPick =
    metrics.gradedPickCount > 0
      ? roundNumber(metrics.totalProfitUnits / metrics.gradedPickCount, 4)
      : null;

  return metrics;
}

function addOutcome(metrics, outcome) {
  if (outcome === "win") {
    metrics.winCount += 1;
  } else if (outcome === "loss") {
    metrics.lossCount += 1;
  } else if (outcome === "push") {
    metrics.pushCount += 1;
  }
}

function applyFlatUnitResult(metrics, row) {
  const outcome = row.outcome;
  const profitUnits = toNumberOrNull(row.profit_units);

  if (!outcome || profitUnits === null) {
    return;
  }

  metrics.gradedPickCount += 1;
  metrics.totalUnitsStaked += 1;
  metrics.totalProfitUnits += profitUnits;

  addOutcome(metrics, outcome);
}

function applyRecommendedUnitResult(metrics, row) {
  const outcome = row.outcome;
  const flatProfitUnits = toNumberOrNull(row.profit_units);
  const recommendedUnits = toNumberOrNull(row.recommended_units) || 0;

  if (!outcome || flatProfitUnits === null || recommendedUnits <= 0) {
    return;
  }

  metrics.gradedPickCount += 1;
  metrics.recommendedBetCount += 1;
  metrics.totalUnitsStaked += recommendedUnits;
  metrics.totalProfitUnits += flatProfitUnits * recommendedUnits;

  addOutcome(metrics, outcome);
}

function buildMetricsBundle(label) {
  return {
    overall: buildEmptyMetrics(label),
    byMarket: {
      moneyline: buildEmptyMetrics("moneyline"),
      runLine: buildEmptyMetrics("runLine"),
      totals: buildEmptyMetrics("totals")
    }
  };
}

function finalizeMetricsBundle(bundle) {
  finalizeMetrics(bundle.overall);

  for (const market of OFFICIAL_MARKET_BUCKETS) {
    finalizeMetrics(bundle.byMarket[market]);
  }

  return bundle;
}

function normalizeHistoryRow(row) {
  const flatProfitUnits = toNumberOrNull(row.profit_units);
  const recommendedUnits = toNumberOrNull(row.recommended_units) || 0;
  const recommendedProfitUnits =
    flatProfitUnits === null || recommendedUnits <= 0
      ? null
      : roundNumber(flatProfitUnits * recommendedUnits, 4);

  return {
    snapshotId: row.snapshot_id,
    requestedDate: formatDateValue(row.requested_date),
    savedAt: row.saved_at,
    generatedAt: row.generated_at,
    gradedAt: row.graded_at,
    marketType: row.market_type,
    matchup: row.matchup,
    scheduledEasternDate: formatDateValue(row.scheduled_eastern_date),
    scheduledEasternTime: row.scheduled_eastern_time,
    gamePk: row.game_pk,
    sportsbook: row.sportsbook,
    selection: row.selection,
    side: row.side,
    line: toNumberOrNull(row.line),
    price: toNumberOrNull(row.price),
    modelProbability: toNumberOrNull(row.model_probability),
    calibratedProbability: toNumberOrNull(row.calibrated_probability),
    impliedProbability: toNumberOrNull(row.implied_probability),
    fairOdds: toNumberOrNull(row.fair_odds),
    edge: toNumberOrNull(row.edge),
    expectedValue: toNumberOrNull(row.expected_value),
    confidence: row.confidence,
    dataQualityScore: toNumberOrNull(row.data_quality_score),
    betEligible: row.bet_eligible,
    recommendedUnits,
    stakingTier: row.staking_tier,
    stakeRecommendationVersion: row.stake_recommendation_version,
    betEligibilityReason: row.bet_eligibility_reason,
    result: row.outcome || "pending",
    awayTeam: row.away_team,
    homeTeam: row.home_team,
    awayScore: toNumberOrNull(row.away_score),
    homeScore: toNumberOrNull(row.home_score),
    flatProfitUnits,
    recommendedProfitUnits,
    summaryReason: row.summary_reason,
    pickDisplay: row.pick_display,
    rawPick: row.raw_pick_json || null,
    rawGrade: row.raw_grade_json || null
  };
}

async function getOfficialDashboardSummary(options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  const startDate = options.startDate || DASHBOARD_HISTORY_START_DATE;
  const endDate = options.endDate || null;

  const result = await query(
    `
      SELECT
        ps.id AS snapshot_id,
        ps.requested_date,
        ps.market_type,
        ps.bet_eligible,
        ps.recommended_units,
        g.outcome,
        g.profit_units
      FROM pick_snapshots ps
      JOIN graded_pick_results g
        ON g.snapshot_id = ps.id
      WHERE ps.snapshot_mode = 'official'
        AND ps.source_bucket = ANY($3::text[])
        AND ps.requested_date >= $1::date
        AND ($2::date IS NULL OR ps.requested_date <= $2::date)
      ORDER BY ps.requested_date ASC, ps.saved_at ASC
    `,
    [startDate, endDate, OFFICIAL_MARKET_BUCKETS]
  );

  const rows = result?.rows || [];
  const flatUnit = buildMetricsBundle("official_flat_1u");
  const recommendedUnits = buildMetricsBundle("recommended_units");

  for (const row of rows) {
    const marketType = row.market_type;

    applyFlatUnitResult(flatUnit.overall, row);

    if (flatUnit.byMarket[marketType]) {
      applyFlatUnitResult(flatUnit.byMarket[marketType], row);
    }

    applyRecommendedUnitResult(recommendedUnits.overall, row);

    if (recommendedUnits.byMarket[marketType]) {
      applyRecommendedUnitResult(recommendedUnits.byMarket[marketType], row);
    }
  }

  return {
    ok: true,
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    basis: {
      officialOnly: true,
      flatUnitAssumption: "1 unit on every official locked pick",
      recommendedUnitAssumption:
        "Only picks with recommendedUnits > 0 are treated as recommended-unit bets.",
      unitDefinition: "1 unit equals 5% of bankroll by user assumption."
    },
    flatUnit: finalizeMetricsBundle(flatUnit),
    recommendedUnits: finalizeMetricsBundle(recommendedUnits)
  };
}

async function getOfficialPickHistory(options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  const startDate = options.startDate || DASHBOARD_HISTORY_START_DATE;
  const endDate = options.endDate || null;
  const marketType = options.marketType || null;
  const resultFilter = options.result || null;
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);

  const result = await query(
    `
      SELECT
        COUNT(*) OVER()::int AS total_count,
        ps.id AS snapshot_id,
        ps.requested_date,
        ps.saved_at,
        ps.generated_at,
        ps.market_type,
        ps.matchup,
        ps.scheduled_eastern_date,
        ps.scheduled_eastern_time,
        ps.sportsbook,
        ps.selection,
        ps.side,
        ps.line,
        ps.price,
        ps.model_probability,
        COALESCE(
          NULLIF(ps.raw_pick_json->>'calibratedProbability', '')::numeric,
          ps.model_probability
        ) AS calibrated_probability,
        ps.implied_probability,
        ps.fair_odds,
        ps.edge,
        ps.expected_value,
        ps.confidence,
        ps.data_quality_score,
        ps.bet_eligible,
        ps.recommended_units,
        ps.staking_tier,
        ps.stake_recommendation_version,
        ps.bet_eligibility_reason,
        ps.summary_reason,
        ps.pick_display,
        ps.raw_pick_json,
        g.graded_at,
        g.game_pk,
        g.away_team,
        g.home_team,
        g.away_score,
        g.home_score,
        g.outcome,
        g.profit_units,
        g.raw_grade_json
      FROM pick_snapshots ps
      LEFT JOIN graded_pick_results g
        ON g.snapshot_id = ps.id
      WHERE ps.snapshot_mode = 'official'
        AND ps.source_bucket = ANY($7::text[])
        AND ps.requested_date >= $1::date
        AND ($2::date IS NULL OR ps.requested_date <= $2::date)
        AND ($3::text IS NULL OR ps.market_type = $3::text)
        AND ($4::text IS NULL OR COALESCE(g.outcome, 'pending') = $4::text)
      ORDER BY ps.requested_date DESC, ps.saved_at DESC, ps.rank_within_bucket ASC
      LIMIT $5
      OFFSET $6
    `,
    [
      startDate,
      endDate,
      marketType,
      resultFilter,
      limit,
      offset,
      OFFICIAL_MARKET_BUCKETS
    ]
  );

  const rows = result?.rows || [];
  const totalCount = rows.length > 0 ? rows[0].total_count : 0;

  return {
    ok: true,
    startDate,
    endDate,
    marketType,
    result: resultFilter,
    limit,
    offset,
    totalCount,
    rows: rows.map(normalizeHistoryRow)
  };
}

module.exports = {
  DASHBOARD_HISTORY_START_DATE,
  getOfficialDashboardSummary,
  getOfficialPickHistory
};
