function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function buildSortValue(pick) {
  const ev = toNumberOrNull(pick?.expectedValue) ?? -999;
  const edge = toNumberOrNull(pick?.edge) ?? -999;
  const quality = toNumberOrNull(pick?.dataQualityScore) ?? -999;

  return { ev, edge, quality };
}

function compareNormalizedPicks(a, b) {
  const aSort = buildSortValue(a);
  const bSort = buildSortValue(b);

  if (bSort.ev !== aSort.ev) {
    return bSort.ev - aSort.ev;
  }

  if (bSort.edge !== aSort.edge) {
    return bSort.edge - aSort.edge;
  }

  return bSort.quality - aSort.quality;
}

function normalizeMoneylinePick(entry) {
  const bestBet = entry?.bestBet;

  if (!bestBet) {
    return null;
  }

  return {
    gamePk: entry.gamePk ?? null,
    gameDate: entry.gameDate ?? null,
    matchup: entry.matchup ?? null,
    marketType: "moneyline",
    selection: bestBet.team ?? null,
    side: bestBet.side ?? null,
    line: null,
    sportsbook: bestBet.sportsbook ?? null,
    price: bestBet.price ?? null,
    modelProbability: bestBet.modelProbability ?? null,
    impliedProbability: bestBet.impliedProbability ?? null,
    fairOdds: bestBet.fairOdds ?? null,
    edge: bestBet.edge ?? null,
    expectedValue: bestBet.expectedValue ?? null,
    confidence: bestBet.confidence ?? null,
    dataQualityScore: entry?.dataQuality?.total ?? null,
    reasoning: bestBet.reasoning ?? null
  };
}

function normalizeRunLinePick(entry) {
  const bestBet = entry?.bestBet;

  if (!bestBet) {
    return null;
  }

  return {
    gamePk: entry.gamePk ?? null,
    gameDate: entry.gameDate ?? null,
    matchup: entry.matchup ?? null,
    marketType: "runLine",
    selection: bestBet.team ?? null,
    side: bestBet.side ?? null,
    line: bestBet.point ?? null,
    sportsbook: bestBet.sportsbook ?? null,
    price: bestBet.price ?? null,
    modelProbability: bestBet.modelProbability ?? null,
    impliedProbability: bestBet.impliedProbability ?? null,
    fairOdds: bestBet.fairOdds ?? null,
    edge: bestBet.edge ?? null,
    expectedValue: bestBet.expectedValue ?? null,
    confidence: bestBet.confidence ?? null,
    dataQualityScore: entry?.dataQuality?.total ?? null,
    reasoning: bestBet.reasoning ?? null
  };
}

function normalizeTotalsPick(entry) {
  const bestBet = entry?.bestBet;

  if (!bestBet) {
    return null;
  }

  return {
    gamePk: entry.gamePk ?? null,
    gameDate: entry.gameDate ?? null,
    matchup: entry.matchup ?? null,
    marketType: "totals",
    selection: bestBet.side ?? null,
    side: bestBet.side ?? null,
    line: bestBet.point ?? null,
    sportsbook: bestBet.sportsbook ?? null,
    price: bestBet.price ?? null,
    modelProbability: bestBet.modelProbability ?? null,
    impliedProbability: bestBet.impliedProbability ?? null,
    fairOdds: bestBet.fairOdds ?? null,
    edge: bestBet.edge ?? null,
    expectedValue: bestBet.expectedValue ?? null,
    confidence: bestBet.confidence ?? null,
    dataQualityScore: entry?.dataQuality?.total ?? null,
    reasoning: bestBet.reasoning ?? null
  };
}

function buildMarketSummary(marketType, normalizedPicks) {
  return {
    marketType,
    rankedPickCount: normalizedPicks.length,
    topPicks: normalizedPicks.slice(0, 4)
  };
}

function formatPicksResponse({
  date,
  gameCount,
  oddsMatchedCount,
  moneylineResults,
  runLineResults,
  totalsResults
}) {
  const normalizedMoneylinePicks = (moneylineResults?.positiveEvPicks || [])
    .map(normalizeMoneylinePick)
    .filter(Boolean)
    .sort(compareNormalizedPicks);

  const normalizedRunLinePicks = (runLineResults?.positiveEvPicks || [])
    .map(normalizeRunLinePick)
    .filter(Boolean)
    .sort(compareNormalizedPicks);

  const normalizedTotalsPicks = (totalsResults?.positiveEvPicks || [])
    .map(normalizeTotalsPick)
    .filter(Boolean)
    .sort(compareNormalizedPicks);

  const topPicksOverall = [
    ...normalizedMoneylinePicks,
    ...normalizedRunLinePicks,
    ...normalizedTotalsPicks
  ]
    .sort(compareNormalizedPicks)
    .slice(0, 4);

  return {
    ok: true,
    date,
    generatedAt: new Date().toISOString(),
    gameCount,
    oddsMatchedCount,
    totalRankedPickCount:
      normalizedMoneylinePicks.length +
      normalizedRunLinePicks.length +
      normalizedTotalsPicks.length,
    topPicksOverall,
    byMarket: {
      moneyline: buildMarketSummary("moneyline", normalizedMoneylinePicks),
      runLine: buildMarketSummary("runLine", normalizedRunLinePicks),
      totals: buildMarketSummary("totals", normalizedTotalsPicks)
    }
  };
}

module.exports = {
  formatPicksResponse
};
