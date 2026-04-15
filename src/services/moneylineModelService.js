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

const MIN_EDGE = 0.015;
const MIN_EXPECTED_VALUE = 0.015;
const MIN_DATA_QUALITY = 0.6;

function getBestMoneylinePriceForTeam(odds, teamName) {
  const moneylineMarkets = odds?.moneyline || [];
  let best = null;

  for (const market of moneylineMarkets) {
    for (const outcome of market.outcomes || []) {
      if (outcome.name !== teamName) {
        continue;
      }

      if (outcome.price === null || outcome.price === undefined) {
        continue;
      }

      if (!best || outcome.price > best.price) {
        best = {
          teamName: outcome.name,
          price: outcome.price,
          bookmakerKey: market.bookmakerKey,
          bookmakerTitle: market.bookmakerTitle,
          lastUpdate: market.lastUpdate
        };
      }
    }
  }

  return best;
}

function evaluateMoneylineCandidate(side, teamName, winProbability, bestPrice, reasoning) {
  if (!bestPrice) {
    return null;
  }

  const impliedProbability = americanToImpliedProbability(bestPrice.price);
  const ev = expectedValue(winProbability, bestPrice.price);
  const edge = impliedProbability === null ? null : winProbability - impliedProbability;

  return {
    side,
    team: teamName,
    sportsbook: bestPrice.bookmakerTitle,
    price: bestPrice.price,
    impliedProbability: roundNumber(impliedProbability, 4),
    modelProbability: roundNumber(winProbability, 4),
    fairOdds: probabilityToAmerican(winProbability),
    edge: roundNumber(edge, 4),
    expectedValue: roundNumber(ev, 4),
    reasoning
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

function evaluateGameMoneyline(game) {
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

  const awayWinProbability = clamp(logistic(scoreDiff * 1.10), 0.07, 0.93);
  const homeWinProbability = 1 - awayWinProbability;

  const sharedReasoning = buildMatchupReasoning(
    game.awayTeam,
    game.homeTeam,
    awayScoreCard,
    homeScoreCard,
    dataQuality
  );

  const awayBestPrice = getBestMoneylinePriceForTeam(
    game.odds,
    game.awayTeam?.name
  );

  const homeBestPrice = getBestMoneylinePriceForTeam(
    game.odds,
    game.homeTeam?.name
  );

  const awayCandidate = evaluateMoneylineCandidate(
    "away",
    game.awayTeam?.name,
    awayWinProbability,
    awayBestPrice,
    sharedReasoning
  );

  const homeCandidate = evaluateMoneylineCandidate(
    "home",
    game.homeTeam?.name,
    homeWinProbability,
    homeBestPrice,
    flipReasoning(sharedReasoning)
  );

  const filteredCandidates = [awayCandidate, homeCandidate]
    .filter((candidate) => passesCandidateFilters(candidate, dataQuality))
    .map((candidate) => ({
      ...candidate,
      confidence: getConfidenceTier(candidate, dataQuality)
    }));

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
    bestBet: filteredCandidates[0],
    alternatives: filteredCandidates.slice(1)
  };
}

function rankMoneylinePicks(gamesWithOdds) {
  const evaluatedGames = (gamesWithOdds || [])
    .map(evaluateGameMoneyline)
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
  rankMoneylinePicks
};
