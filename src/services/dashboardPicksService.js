const { query, isDatabaseEnabled } = require("../config/db");
const { getDashboardSlate } = require("./dashboardSlateService");
const { getPicksForDate } = require("./picksService");

const OFFICIAL_MARKET_BUCKETS = ["moneyline", "runLine"];

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
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

function parseRawJson(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  return value;
}

function buildSlateMap(slateResponse) {
  const map = new Map();

  for (const game of slateResponse?.games || []) {
    if (game?.gamePk) {
      map.set(Number(game.gamePk), game);
    }
  }

  return map;
}

function buildRankedPicksFromLiveResponse(picksResponse) {
  return [
    ...(picksResponse?.byMarket?.moneyline?.rankedPicks || []),
    ...(picksResponse?.byMarket?.runLine?.rankedPicks || [])
  ].sort((a, b) => {
    const aUnits = toNumberOrNull(a?.recommendedUnits) || 0;
    const bUnits = toNumberOrNull(b?.recommendedUnits) || 0;

    if (bUnits !== aUnits) {
      return bUnits - aUnits;
    }

    const aEv = toNumberOrNull(a?.expectedValue) ?? -999;
    const bEv = toNumberOrNull(b?.expectedValue) ?? -999;

    if (bEv !== aEv) {
      return bEv - aEv;
    }

    const aEdge = toNumberOrNull(a?.edge) ?? -999;
    const bEdge = toNumberOrNull(b?.edge) ?? -999;

    return bEdge - aEdge;
  });
}

function getDoubleheaderFields(slateGame, rawPick = {}) {
  const gameNumber = slateGame?.gameNumber ?? rawPick?.gameNumber ?? null;
  const seriesGameNumber =
    slateGame?.seriesGameNumber ?? rawPick?.seriesGameNumber ?? null;
  const doubleHeader = slateGame?.doubleHeader ?? rawPick?.doubleHeader ?? null;
  const doubleheaderLabel =
    slateGame?.doubleheaderLabel ?? rawPick?.doubleheaderLabel ?? null;

  return {
    gameNumber,
    seriesGameNumber,
    doubleHeader,
    isDoubleheader: Boolean(
      slateGame?.isDoubleheader ||
        rawPick?.isDoubleheader ||
        doubleheaderLabel
    ),
    doubleheaderLabel
  };
}

function normalizeOfficialPickRow(row, slateGame) {
  const rawPick = parseRawJson(row.raw_pick_json);
  const rawGrade = parseRawJson(row.raw_grade_json);
  const gamePk = toNumberOrNull(row.game_pk);

  const flatProfitUnits = toNumberOrNull(row.profit_units);
  const recommendedUnits = toNumberOrNull(row.recommended_units) || 0;
  const recommendedProfitUnits =
    flatProfitUnits === null || recommendedUnits <= 0
      ? null
      : Number((flatProfitUnits * recommendedUnits).toFixed(4));

  return {
    snapshotId: row.snapshot_id,
    batchId: row.batch_id,
    requestedDate: formatDateValue(row.requested_date),
    savedAt: row.saved_at,
    generatedAt: row.generated_at,
    snapshotMode: row.snapshot_mode,
    officialLockWindow: row.official_lock_window,
    officialRunId: row.official_run_id,
    sourceBucket: row.source_bucket,
    rankWithinBucket: toNumberOrNull(row.rank_within_bucket),

    gamePk,
    matchup: row.matchup || slateGame?.matchup || null,
    scheduledEasternDate:
      formatDateValue(row.scheduled_eastern_date) ||
      slateGame?.scheduledEasternDate ||
      null,
    scheduledEasternTime:
      row.scheduled_eastern_time ||
      slateGame?.scheduledEasternTime ||
      null,
    status: slateGame?.status || null,
    venueName: slateGame?.venueName || null,
    awayTeam: slateGame?.awayTeam || null,
    homeTeam: slateGame?.homeTeam || null,
    probablePitchers: slateGame?.probablePitchers || null,
    frontendLabels: slateGame?.frontendLabels || null,

    marketType: row.market_type,
    selection: row.selection,
    side: row.side,
    line: toNumberOrNull(row.line),
    sportsbook: row.sportsbook,
    price: toNumberOrNull(row.price),
    priceDisplay: rawPick?.priceDisplay || null,
    minimumAcceptableOdds: toNumberOrNull(rawPick?.minimumAcceptableOdds),
    minimumAcceptableOddsDisplay: rawPick?.minimumAcceptableOddsDisplay || null,
    bettingEdgeStatus: rawPick?.bettingEdgeStatus || null,
    bettingEdgeReason: rawPick?.bettingEdgeReason || null,
    minimumAcceptableOddsBasis: rawPick?.minimumAcceptableOddsBasis || null,

    modelProbability: toNumberOrNull(row.model_probability),
    rawModelProbability: toNumberOrNull(
      rawPick?.rawModelProbability ??
        rawPick?.rawProbability ??
        rawPick?.modelProbability ??
        row.model_probability
    ),
    calibratedProbability: toNumberOrNull(
      rawPick?.calibratedProbability ??
        rawPick?.calibratedModelProbability ??
        rawPick?.modelProbability ??
        row.model_probability
    ),
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
    gradedAt: row.graded_at,
    awayScore: toNumberOrNull(row.away_score),
    homeScore: toNumberOrNull(row.home_score),
    flatProfitUnits,
    recommendedProfitUnits,

    summaryReason: row.summary_reason,
    pickDisplay: row.pick_display,
    reasoning: rawPick?.reasoning || null,
    rawPick,
    rawGrade
  };
}

function normalizeLivePick(pick, slateGame, rankOverall) {
  return {
    rankOverall,
    liveOnly: true,
    officialTracked: false,
    source: "live_on_demand",

    gamePk: toNumberOrNull(pick?.gamePk),
    matchup: pick?.matchup || slateGame?.matchup || null,
    scheduledEasternDate:
      pick?.scheduledEasternDate ||
      slateGame?.scheduledEasternDate ||
      null,
    scheduledEasternTime:
      pick?.scheduledEasternTime ||
      slateGame?.scheduledEasternTime ||
      null,
    status: slateGame?.status || null,
    venueName: slateGame?.venueName || null,
    awayTeam: slateGame?.awayTeam || null,
    homeTeam: slateGame?.homeTeam || null,
    probablePitchers: slateGame?.probablePitchers || null,
    frontendLabels: slateGame?.frontendLabels || null,

    marketType: pick?.marketType || null,
    selection: pick?.selection || null,
    side: pick?.side || null,
    line: toNumberOrNull(pick?.line),
    sportsbook: pick?.sportsbook || null,
    price: toNumberOrNull(pick?.price),
    priceDisplay: pick?.priceDisplay || null,
    minimumAcceptableOdds: toNumberOrNull(pick?.minimumAcceptableOdds),
    minimumAcceptableOddsDisplay: pick?.minimumAcceptableOddsDisplay || null,
    bettingEdgeStatus: pick?.bettingEdgeStatus || null,
    bettingEdgeReason: pick?.bettingEdgeReason || null,
    minimumAcceptableOddsBasis: pick?.minimumAcceptableOddsBasis || null,

    modelProbability: toNumberOrNull(pick?.modelProbability),
    rawModelProbability: toNumberOrNull(
      pick?.rawModelProbability ??
        pick?.rawProbability ??
        pick?.modelProbability
    ),
    calibratedProbability: toNumberOrNull(
      pick?.calibratedProbability ??
        pick?.calibratedModelProbability ??
        pick?.modelProbability
    ),
    impliedProbability: toNumberOrNull(pick?.impliedProbability),
    fairOdds: toNumberOrNull(pick?.fairOdds),
    edge: toNumberOrNull(pick?.edge),
    expectedValue: toNumberOrNull(pick?.expectedValue),
    confidence: pick?.confidence || null,
    dataQualityScore: toNumberOrNull(pick?.dataQualityScore),

    betEligible: pick?.betEligible ?? null,
    recommendedUnits: toNumberOrNull(pick?.recommendedUnits) || 0,
    stakingTier: pick?.stakingTier || null,
    stakeRecommendationVersion: pick?.stakeRecommendationVersion || null,
    betEligibilityReason: pick?.betEligibilityReason || null,

    result: "not_tracked",
    flatProfitUnits: null,
    recommendedProfitUnits: null,

    summaryReason: pick?.summaryReason || null,
    pickDisplay: pick?.pickDisplay || null,
    reasoning: pick?.reasoning || null,
    rawPick: pick
  };
}

async function getDashboardOfficialPicks(date) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  const [slateResponse, snapshotResult] = await Promise.all([
    getDashboardSlate(date),
    query(
      `
        SELECT
          ps.id AS snapshot_id,
          ps.batch_id,
          ps.requested_date,
          ps.saved_at,
          ps.generated_at,
          ps.snapshot_mode,
          ps.official_lock_window,
          ps.official_run_id,
          ps.source_bucket,
          ps.rank_within_bucket,
          NULLIF(ps.raw_pick_json->>'gamePk', '')::int AS game_pk,
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
          g.outcome,
          g.away_score,
          g.home_score,
          g.profit_units,
          g.raw_grade_json
        FROM pick_snapshots ps
        LEFT JOIN graded_pick_results g
          ON g.snapshot_id = ps.id
        WHERE ps.snapshot_mode = 'official'
          AND ps.requested_date = $1::date
          AND ps.source_bucket = ANY($2::text[])
        ORDER BY
          ps.market_type ASC,
          ps.rank_within_bucket ASC,
          ps.saved_at ASC
      `,
      [date, OFFICIAL_MARKET_BUCKETS]
    )
  ]);

  const slateMap = buildSlateMap(slateResponse);
  const rows = snapshotResult?.rows || [];

  const picks = rows.map((row) => {
    const gamePk = toNumberOrNull(row.game_pk);
    const slateGame = gamePk === null ? null : slateMap.get(gamePk);
    return normalizeOfficialPickRow(row, slateGame);
  });

  return {
    ok: true,
    date,
    generatedAt: new Date().toISOString(),
    basis: {
      officialOnly: true,
      source: "Persisted 9 AM ET official lock snapshots.",
      noCap: true,
      trackingNote:
        "These picks are the official tracked picks for the selected date and are not recalculated intraday."
    },
    pickCount: picks.length,
    picks,
    byMarket: {
      moneyline: picks.filter((pick) => pick.marketType === "moneyline"),
      runLine: picks.filter((pick) => pick.marketType === "runLine"),
      totals: []
    }
  };
}

async function getDashboardLivePicks(date) {
  const [slateResponse, picksResponse] = await Promise.all([
    getDashboardSlate(date),
    getPicksForDate(date, {
      persistSnapshots: false,
      snapshotMode: "live"
    })
  ]);

  const slateMap = buildSlateMap(slateResponse);
  const rankedLivePicks = buildRankedPicksFromLiveResponse(picksResponse);

  const picks = rankedLivePicks.map((pick, index) => {
    const gamePk = toNumberOrNull(pick?.gamePk);
    const slateGame = gamePk === null ? null : slateMap.get(gamePk);
    return normalizeLivePick(pick, slateGame, index + 1);
  });

  return {
    ok: true,
    date,
    generatedAt: new Date().toISOString(),
    basis: {
      officialOnly: false,
      source: "On-demand live model pull.",
      noCap: true,
      trackingNote:
        "Live picks are not official locked picks and are not included in official dashboard performance."
    },
    gameCount: picksResponse.gameCount,
    oddsMatchedCount: picksResponse.oddsMatchedCount,
    pickCount: picks.length,
    picks,
    byMarket: {
      moneyline: picks.filter((pick) => pick.marketType === "moneyline"),
      runLine: picks.filter((pick) => pick.marketType === "runLine"),
      totals: []
    },
    rawCounts: {
      moneyline: picksResponse?.byMarket?.moneyline?.rankedPickCount || 0,
      runLine: picksResponse?.byMarket?.runLine?.rankedPickCount || 0,
      totals: 0
    }
  };
}

module.exports = {
  getDashboardOfficialPicks,
  getDashboardLivePicks
};





