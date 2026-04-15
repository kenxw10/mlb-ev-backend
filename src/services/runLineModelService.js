const {
  americanToImpliedProbability,
  probabilityToAmerican,
  expectedValue,
  roundNumber
} = require("../utils/oddsUtils");
const {
  clamp,
  logistic,
  buildDataQuality,
  scoreTeam,
  buildMatchupReasoning,
  flipReasoning,
  getConfidenceTier,
  getGameActionability
} = require("./modelCoreService");

const MIN_EDGE = 0.02;
const MIN_EXPECTED_VALUE = 0.02;
const MIN_DATA_QUALITY = 0.6;
const RUNS_PER_SCORE_UNIT = 1.35;
const RUN_LINE_SIGMOID_SCALE = 0.95;

function getBestRunLinePriceForTeam(odds, teamName) {
  const spreadMarkets = odds?.spreads || [];
  let best = null;

  for (const market of spreadMarkets) {
    for (const outcome of market.outcomes || []) {
      if (outcome.name !== teamName) {
        continue;
      }

      if (outcome.price === null || outcome.price === undefined) {
        continue;
      }

      if (outcome.point === null || outcome.point === undefined) {
        continue;
      }

      if (Math.abs(outcome.point) !== 1.5) {
        continue;
      }

      if (!best || outcome.price > best.price) {
        best = {
          teamName: outcome.name,
          price: outcome.price,
          point: outcome.point,
          bookmakerKey: market.bookmakerKey,
          bookmakerTitle: market.bookmakerTitle,
          lastUpdate: market.lastUpdate
        };
      }
    }
  }

  return best;
}

function candidatePlaceholder(edge, expectedValueValue) {
  return {
    edge: roundNumber(edge, 4),
    expectedValue: roundNumber(expectedValueValue, 4)
  };
}

function evaluateRunLineCandidate(
  side,
  teamName,
  projectedTeamMargin,
  bestPrice,
  baseReasoning,
  dataQuality
) {
  if (!bestPrice) {
    return null;
  }

  const coverProbability = clamp(
    logistic((projectedTeamMargin + bestPrice.point) * RUN_LINE_SIGMOID_SCALE),
    0.05,
    0.95
  );

  const impliedProbability = americanToImpliedProbability(bestPrice.price);
  const ev = expectedValue(coverProbability, bestPrice.price);
  const edge =
    impliedProbability === null ? null : coverProbability - impliedProbability;

  return {
    side,
    team: teamName,
    sportsbook: bestPrice.bookmakerTitle,
    point: bestPrice.point,
    price: bestPrice.price,
    impliedProbability: roundNumber(impliedProbability, 4),
    modelProbability: roundNumber(coverProbability, 4),
    fairOdds: probabilityToAmerican(coverProbability),
    edge: roundNumber(edge, 4),
    expectedValue: roundNumber(ev, 4),
    reasoning: {
      ...baseReasoning,
      projectedTeamRunMargin: roundNumber(projectedTeamMargin, 3),
      runLinePoint: bestPrice.point
    },
    confidence: getConfidenceTier(candidatePlaceholder(edge, ev), dataQuality, {
      highEdge: 0.05,
      highEv: 0.05,
      highQuality: 0.85,
      mediumEdge: 0.03,
      mediumEv: 0.03,
      mediumQuality: 0.7
    })
  };
}

function shouldRejectGame(game, dataQuality) {
  const actionability = getGameActionability(game);

  if (!actionability.actionable) {
    return {
      reject: true,
      reason: actionability.reason
    };
  }

  if ((dataQuality?.total ?? 0) < MIN_DATA_QUALITY) {
    return {
      reject: true,
      reason: "Data quality is too low."
    };
  }

  return {
    reject: false,
    reason: null
  };
}

function passesCandidateFilters(candidate, dataQuality) {
  if (!candidate) {
    return false;
  }

  if ((dataQuality?.total ?? 0) < MIN_DATA_QUALITY) {
    return false;
  }

  if (candidate.edge === null || candidate.expectedValue === null) {
    return false;
  }

  if (candidate.edge < MIN_EDGE || candidate.expectedValue < MIN_EXPECTED_VALUE) {
    return false;
  }

  return true;
}

function evaluateGameRunLine(game) {
  if (!game?.oddsAvailable || !game?.odds) {
    return null;
  }

  const dataQuality = buildDataQuality(game);
  const rejectionCheck = shouldRejectGame(game, dataQuality);

  if (rejectionCheck.reject) {
    return null;
  }

  const awayScoreCard = scoreTeam(game.awayTeam);
  const homeScoreCard = scoreTeam(game.homeTeam);

  const homeFieldAdjustment = 0.10;
  const scoreDiff =
    awayScoreCard.totalScore - (homeScoreCard.totalScore + homeFieldAdjustment);

  const projectedAwayRunMargin = scoreDiff * RUNS_PER_SCORE_UNIT;
  const projectedHomeRunMargin = -projectedAwayRunMargin;

  const sharedReasoning = buildMatchupReasoning(
    game.awayTeam,
    game.homeTeam,
    awayScoreCard,
    homeScoreCard,
    dataQuality
  );

  const awayBestPrice = getBestRunLinePriceForTeam(
    game.odds,
    game.awayTeam?.name
  );

  const homeBestPrice = getBestRunLinePriceForTeam(
    game.odds,
    game.homeTeam?.name
  );

  const awayCandidate = evaluateRunLineCandidate(
    "away",
    game.awayTeam?.name,
    projectedAwayRunMargin,
    awayBestPrice,
    sharedReasoning,
    dataQuality
  );

  const homeCandidate = evaluateRunLineCandidate(
    "home",
    game.homeTeam?.name,
    projectedHomeRunMargin,
    homeBestPrice,
    flipReasoning(sharedReasoning),
    dataQuality
  );

  const filteredCandidates = [awayCandidate, homeCandidate]
    .filter((candidate) => passesCandidateFilters(candidate, dataQuality));

  if (filteredCandidates.length === 0) {
    return null;
  }

  filteredCandidates.sort((a, b) => {
    if (b.expectedValue !== a.expectedValue) {
      return b.expectedValue - a.expectedValue;
    }

    return b.edge - a.edge;
  });

  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    scheduledEasternDate: game.scheduledEasternDate,
    scheduledEasternTime: game.scheduledEasternTime,
    matchup: `${game.awayTeam?.name} at ${game.homeTeam?.name}`,
    awayTeam: game.awayTeam?.name,
    homeTeam: game.homeTeam?.name,
    dataQuality,
    projectedAwayRunMargin: roundNumber(projectedAwayRunMargin, 3),
    bestBet: filteredCandidates[0],
    alternatives: filteredCandidates.slice(1)
  };
}

function rankRunLinePicks(gamesWithOdds) {
  const evaluatedGames = (gamesWithOdds || [])
    .map(evaluateGameRunLine)
    .filter(Boolean);

  const positiveEvPicks = evaluatedGames.sort((a, b) => {
    if (b.bestBet.expectedValue !== a.bestBet.expectedValue) {
      return b.bestBet.expectedValue - a.bestBet.expectedValue;
    }

    if (b.bestBet.edge !== a.bestBet.edge) {
      return b.bestBet.edge - a.bestBet.edge;
    }

    return (b.dataQuality?.total || 0) - (a.dataQuality?.total || 0);
  });

  return {
    evaluatedGames,
    positiveEvPicks
  };
}

module.exports = {
  rankRunLinePicks
};
