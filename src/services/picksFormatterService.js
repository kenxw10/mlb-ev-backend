function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toPercentOrNull(value, decimals = 2) {
  const numericValue = toNumberOrNull(value);

  if (numericValue === null) {
    return null;
  }

  return Number((numericValue * 100).toFixed(decimals));
}

function formatAmericanOdds(price) {
  const numericPrice = toNumberOrNull(price);

  if (numericPrice === null) {
    return null;
  }

  return numericPrice > 0 ? `+${numericPrice}` : `${numericPrice}`;
}

function formatLine(line) {
  const numericLine = toNumberOrNull(line);

  if (numericLine === null) {
    return null;
  }

  return numericLine > 0 ? `+${numericLine}` : `${numericLine}`;
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

function buildFactorList(reasoning) {
  const starterEdge = toNumberOrNull(reasoning?.starterEdge) ?? 0;
  const teamPitchingEdge = toNumberOrNull(reasoning?.teamPitchingEdge) ?? 0;
  const offenseEdge = toNumberOrNull(reasoning?.offenseEdge) ?? 0;

  const factors = [];

  if (starterEdge >= 0.12) {
    factors.push("starting pitcher edge");
  }

  if (teamPitchingEdge >= 0.12) {
    factors.push("team pitching edge");
  }

  if (offenseEdge >= 0.12) {
    factors.push("offensive edge");
  }

  if (factors.length > 0) {
    return factors.slice(0, 2);
  }

  const sortedFallbackFactors = [
    { label: "starting pitcher edge", value: starterEdge },
    { label: "team pitching edge", value: teamPitchingEdge },
    { label: "offensive edge", value: offenseEdge }
  ]
    .sort((a, b) => b.value - a.value)
    .filter((item) => item.value > 0);

  return sortedFallbackFactors.slice(0, 2).map((item) => item.label);
}

function joinFactors(factors) {
  if (!factors || factors.length === 0) {
    return null;
  }

  if (factors.length === 1) {
    return factors[0];
  }

  return `${factors[0]} and ${factors[1]}`;
}

function buildSideSummaryReason(selection, marketType, line, reasoning) {
  const factorText = joinFactors(buildFactorList(reasoning));
  const projectedMargin = toNumberOrNull(reasoning?.projectedTeamRunMargin);

  if (marketType === "runLine") {
    if (factorText && projectedMargin !== null) {
      return `${selection} grades well because of a ${factorText}. Model projects about ${Math.abs(projectedMargin).toFixed(2)} runs of margin.`;
    }

    if (factorText) {
      return `${selection} grades well because of a ${factorText}.`;
    }

    if (projectedMargin !== null) {
      return `${selection} grades well and the model projects about ${Math.abs(projectedMargin).toFixed(2)} runs of margin.`;
    }

    return `${selection} grades well on the run line.`;
  }

  if (factorText) {
    return `${selection} projects well because of a ${factorText}.`;
  }

  return `${selection} projects well on the moneyline.`;
}

function buildTotalsSummaryReason(side, line, reasoning) {
  const projectedTotalRuns = toNumberOrNull(reasoning?.projectedTotalRuns);
  const totalsLine = toNumberOrNull(line);

  if (projectedTotalRuns === null || totalsLine === null) {
    return side === "over"
      ? "The model projects the total above the market line."
      : "The model projects the total below the market line.";
  }

  const difference = Math.abs(projectedTotalRuns - totalsLine).toFixed(2);

  if (side === "over") {
    return `Projected total of ${projectedTotalRuns.toFixed(2)} runs sits ${difference} runs above the market total of ${totalsLine}.`;
  }

  return `Projected total of ${projectedTotalRuns.toFixed(2)} runs sits ${difference} runs below the market total of ${totalsLine}.`;
}

function buildPickDisplay(marketType, selection, side, line, price, sportsbook) {
  const priceDisplay = formatAmericanOdds(price);
  const lineDisplay = formatLine(line);

  if (marketType === "moneyline") {
    return `${selection} ML (${priceDisplay}) — ${sportsbook}`;
  }

  if (marketType === "runLine") {
    return `${selection} ${lineDisplay} (${priceDisplay}) — ${sportsbook}`;
  }

  const sideLabel = side === "over" ? "Over" : "Under";
  return `${sideLabel} ${lineDisplay} (${priceDisplay}) — ${sportsbook}`;
}

function normalizeMoneylinePick(entry) {
  const bestBet = entry?.bestBet;

  if (!bestBet) {
    return null;
  }

  return {
    gamePk: entry.gamePk ?? null,
    gameDate: entry.gameDate ?? null,
    scheduledEasternDate: entry.scheduledEasternDate ?? null,
    scheduledEasternTime: entry.scheduledEasternTime ?? null,
    slateTimezone: "America/New_York",
    matchup: entry.matchup ?? null,
    marketType: "moneyline",
    selection: bestBet.team ?? null,
    side: bestBet.side ?? null,
    line: null,
    sportsbook: bestBet.sportsbook ?? null,
    price: bestBet.price ?? null,
    priceDisplay: formatAmericanOdds(bestBet.price),
    modelProbability: bestBet.modelProbability ?? null,
    modelProbabilityPercent: toPercentOrNull(bestBet.modelProbability),
    impliedProbability: bestBet.impliedProbability ?? null,
    impliedProbabilityPercent: toPercentOrNull(bestBet.impliedProbability),
    fairOdds: bestBet.fairOdds ?? null,
    edge: bestBet.edge ?? null,
    edgePercent: toPercentOrNull(bestBet.edge),
    expectedValue: bestBet.expectedValue ?? null,
    expectedValuePercent: toPercentOrNull(bestBet.expectedValue),
    confidence: bestBet.confidence ?? null,
    dataQualityScore: entry?.dataQuality?.total ?? null,
    isActionable: true,
    summaryReason: buildSideSummaryReason(
      bestBet.team,
      "moneyline",
      null,
      bestBet.reasoning
    ),
    pickDisplay: buildPickDisplay(
      "moneyline",
      bestBet.team,
      bestBet.side,
      null,
      bestBet.price,
      bestBet.sportsbook
    ),
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
    scheduledEasternDate: entry.scheduledEasternDate ?? null,
    scheduledEasternTime: entry.scheduledEasternTime ?? null,
    slateTimezone: "America/New_York",
    matchup: entry.matchup ?? null,
    marketType: "runLine",
    selection: bestBet.team ?? null,
    side: bestBet.side ?? null,
    line: bestBet.point ?? null,
    sportsbook: bestBet.sportsbook ?? null,
    price: bestBet.price ?? null,
    priceDisplay: formatAmericanOdds(bestBet.price),
    modelProbability: bestBet.modelProbability ?? null,
    modelProbabilityPercent: toPercentOrNull(bestBet.modelProbability),
    impliedProbability: bestBet.impliedProbability ?? null,
    impliedProbabilityPercent: toPercentOrNull(bestBet.impliedProbability),
    fairOdds: bestBet.fairOdds ?? null,
    edge: bestBet.edge ?? null,
    edgePercent: toPercentOrNull(bestBet.edge),
    expectedValue: bestBet.expectedValue ?? null,
    expectedValuePercent: toPercentOrNull(bestBet.expectedValue),
    confidence: bestBet.confidence ?? null,
    dataQualityScore: entry?.dataQuality?.total ?? null,
    isActionable: true,
    summaryReason: buildSideSummaryReason(
      bestBet.team,
      "runLine",
      bestBet.point,
      bestBet.reasoning
    ),
    pickDisplay: buildPickDisplay(
      "runLine",
      bestBet.team,
      bestBet.side,
      bestBet.point,
      bestBet.price,
      bestBet.sportsbook
    ),
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
    scheduledEasternDate: entry.scheduledEasternDate ?? null,
    scheduledEasternTime: entry.scheduledEasternTime ?? null,
    slateTimezone: "America/New_York",
    matchup: entry.matchup ?? null,
    marketType: "totals",
    selection: bestBet.side ?? null,
    side: bestBet.side ?? null,
    line: bestBet.point ?? null,
    sportsbook: bestBet.sportsbook ?? null,
    price: bestBet.price ?? null,
    priceDisplay: formatAmericanOdds(bestBet.price),
    modelProbability: bestBet.modelProbability ?? null,
    modelProbabilityPercent: toPercentOrNull(bestBet.modelProbability),
    impliedProbability: bestBet.impliedProbability ?? null,
    impliedProbabilityPercent: toPercentOrNull(bestBet.impliedProbability),
    fairOdds: bestBet.fairOdds ?? null,
    edge: bestBet.edge ?? null,
    edgePercent: toPercentOrNull(bestBet.edge),
    expectedValue: bestBet.expectedValue ?? null,
    expectedValuePercent: toPercentOrNull(bestBet.expectedValue),
    confidence: bestBet.confidence ?? null,
    dataQualityScore: entry?.dataQuality?.total ?? null,
    isActionable: true,
    summaryReason: buildTotalsSummaryReason(
      bestBet.side,
      bestBet.point,
      bestBet.reasoning
    ),
    pickDisplay: buildPickDisplay(
      "totals",
      bestBet.side,
      bestBet.side,
      bestBet.point,
      bestBet.price,
      bestBet.sportsbook
    ),
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
    slateTimezone: "America/New_York",
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
