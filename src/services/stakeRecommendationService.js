const STAKE_RECOMMENDATION_VERSION = "provisional-v1";

const STAKE_CONFIG = {
  moneyline: {
    enabled: true,
    minEv: 0.03,
    minEdge: 0.025,
    tiers: [
      { units: 1.0, minEv: 0.10, minEdge: 0.075, label: "max_provisional" },
      { units: 0.75, minEv: 0.07, minEdge: 0.055, label: "strong" },
      { units: 0.5, minEv: 0.05, minEdge: 0.04, label: "standard" },
      { units: 0.25, minEv: 0.03, minEdge: 0.025, label: "small" }
    ]
  },
  runLine: {
    enabled: true,
    minEv: 0.05,
    minEdge: 0.04,
    tiers: [
      { units: 1.0, minEv: 0.12, minEdge: 0.09, label: "max_provisional" },
      { units: 0.75, minEv: 0.09, minEdge: 0.07, label: "strong" },
      { units: 0.5, minEv: 0.07, minEdge: 0.055, label: "standard" },
      { units: 0.25, minEv: 0.05, minEdge: 0.04, label: "small" }
    ]
  },
  totals: {
    enabled: false,
    minEv: null,
    minEdge: null,
    tiers: []
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

function buildNoBetResult(reason) {
  return {
    betEligible: false,
    recommendedUnits: 0,
    stakingTier: "no_bet",
    stakeRecommendationVersion: STAKE_RECOMMENDATION_VERSION,
    betEligibilityReason: reason
  };
}

function buildBetResult(tier, config) {
  return {
    betEligible: true,
    recommendedUnits: tier.units,
    stakingTier: tier.label,
    stakeRecommendationVersion: STAKE_RECOMMENDATION_VERSION,
    betEligibilityReason: `Clears provisional threshold: EV >= ${(config.minEv * 100).toFixed(1)}% and edge >= ${(config.minEdge * 100).toFixed(1)}%.`
  };
}

function getStakeRecommendationForPick(pick) {
  const marketType = pick?.marketType;
  const config = STAKE_CONFIG[marketType];

  if (!config) {
    return buildNoBetResult("No staking configuration exists for this market.");
  }

  if (!config.enabled) {
    return buildNoBetResult("Provisional staking is not enabled for this market.");
  }

  const calibratedProbability = toNumberOrNull(
    pick?.calibratedProbability ?? pick?.modelProbability
  );

  if (calibratedProbability === null) {
    return buildNoBetResult("No calibrated probability is available.");
  }

  const expectedValue = toNumberOrNull(pick?.expectedValue);
  const edge = toNumberOrNull(pick?.edge);

  if (expectedValue === null || edge === null) {
    return buildNoBetResult("Missing calibrated EV or edge.");
  }

  if (expectedValue < config.minEv || edge < config.minEdge) {
    return buildNoBetResult(
      `Below provisional threshold: needs EV >= ${(config.minEv * 100).toFixed(1)}% and edge >= ${(config.minEdge * 100).toFixed(1)}%.`
    );
  }

  for (const tier of config.tiers) {
    if (expectedValue >= tier.minEv && edge >= tier.minEdge) {
      return buildBetResult(tier, config);
    }
  }

  return buildNoBetResult("No staking tier matched.");
}

function applyStakeRecommendationToPick(pick) {
  const recommendation = getStakeRecommendationForPick(pick);

  return {
    ...pick,
    betEligible: recommendation.betEligible,
    recommendedUnits: roundNumber(recommendation.recommendedUnits, 2),
    stakingTier: recommendation.stakingTier,
    stakeRecommendationVersion: recommendation.stakeRecommendationVersion,
    betEligibilityReason: recommendation.betEligibilityReason
  };
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

  const aRecommendedUnits = toNumberOrNull(a?.recommendedUnits) ?? 0;
  const bRecommendedUnits = toNumberOrNull(b?.recommendedUnits) ?? 0;

  if (bRecommendedUnits !== aRecommendedUnits) {
    return bRecommendedUnits - aRecommendedUnits;
  }

  const aQuality = toNumberOrNull(a?.dataQualityScore) ?? -999;
  const bQuality = toNumberOrNull(b?.dataQualityScore) ?? -999;

  return bQuality - aQuality;
}

function applyStakeRecommendationsToResponse(response) {
  if (!response?.byMarket) {
    return response;
  }

  const marketKeys = ["moneyline", "runLine", "totals"];

  for (const marketKey of marketKeys) {
    const marketSummary = response.byMarket?.[marketKey];

    if (!marketSummary?.rankedPicks) {
      continue;
    }

    marketSummary.rankedPicks = marketSummary.rankedPicks
      .map(applyStakeRecommendationToPick)
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
  STAKE_RECOMMENDATION_VERSION,
  STAKE_CONFIG,
  getStakeRecommendationForPick,
  applyStakeRecommendationToPick,
  applyStakeRecommendationsToResponse
};
