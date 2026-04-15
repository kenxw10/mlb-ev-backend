const {
  americanToImpliedProbability,
  probabilityToAmerican,
  expectedValue,
  roundNumber
} = require("../utils/oddsUtils");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

function getRunsPerGame(hittingStats) {
  const runs = safeNumber(hittingStats?.runs);
  const gamesPlayed = safeNumber(hittingStats?.gamesPlayed);

  if (!runs || !gamesPlayed) {
    return null;
  }

  return runs / gamesPlayed;
}

function getKMinusBBRateLike(starterStats) {
  const strikeOuts = safeNumber(starterStats?.strikeOuts);
  const walks = safeNumber(starterStats?.baseOnBalls);
  const inningsPitched = safeNumber(starterStats?.inningsPitched);

  if (strikeOuts === null || walks === null || inningsPitched === null || inningsPitched <= 0) {
    return null;
  }

  return (strikeOuts - walks) / inningsPitched;
}

function scoreOffense(hittingStats) {
  const ops = safeNumber(hittingStats?.ops);
  const runsPerGame = getRunsPerGame(hittingStats);

  let score = 0;

  if (ops !== null) {
    score += clamp((ops - 0.720) / 0.120, -1.2, 1.2) * 0.55;
  }

  if (runsPerGame !== null) {
    score += clamp((runsPerGame - 4.50) / 1.20, -1.2, 1.2) * 0.45;
  }

  return score;
}

function scoreTeamPitching(pitchingStats) {
  const era = safeNumber(pitchingStats?.era);
  const whip = safeNumber(pitchingStats?.whip);

  let score = 0;

  if (era !== null) {
    score += clamp((4.20 - era) / 1.20, -1.2, 1.2) * 0.6;
  }

  if (whip !== null) {
    score += clamp((1.30 - whip) / 0.18, -1.2, 1.2) * 0.4;
  }

  return score;
}

function scoreStartingPitcher(starterStats) {
  if (!starterStats) {
    return 0;
  }

  const era = safeNumber(starterStats?.era);
  const whip = safeNumber(starterStats?.whip);
  const kMinusBBPerInning = getKMinusBBRateLike(starterStats);

  let score = 0;

  if (era !== null) {
    score += clamp((4.00 - era) / 1.30, -1.5, 1.5) * 0.45;
  }

  if (whip !== null) {
    score += clamp((1.25 - whip) / 0.20, -1.5, 1.5) * 0.30;
  }

  if (kMinusBBPerInning !== null) {
    score += clamp((kMinusBBPerInning - 0.55) / 0.35, -1.5, 1.5) * 0.25;
  }

  return score;
}

function scoreTeam(team) {
  const offenseScore = scoreOffense(team?.teamSeasonStats?.hitting);
  const bullpenAndStaffScore = scoreTeamPitching(team?.teamSeasonStats?.pitching);
  const starterScore = scoreStartingPitcher(team?.probablePitcher?.seasonStats);

  return {
    offenseScore,
    bullpenAndStaffScore,
    starterScore,
    totalScore: offenseScore + bullpenAndStaffScore + starterScore
  };
}

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

function buildReasoning(awayTeam, homeTeam, awayScoreCard, homeScoreCard) {
  const offenseEdge =
    awayScoreCard.offenseScore - homeScoreCard.offenseScore;
  const teamPitchingEdge =
    awayScoreCard.bullpenAndStaffScore - homeScoreCard.bullpenAndStaffScore;
  const starterEdge =
    awayScoreCard.starterScore - homeScoreCard.starterScore;

  return {
    offenseEdge: roundNumber(offenseEdge, 3),
    teamPitchingEdge: roundNumber(teamPitchingEdge, 3),
    starterEdge: roundNumber(starterEdge, 3),
    awayStarter: awayTeam?.probablePitcher?.fullName || null,
    homeStarter: homeTeam?.probablePitcher?.fullName || null
  };
}

function evaluateMoneylineCandidate(side, teamName, winProbability, bestPrice, reasoning) {
  if (!bestPrice) {
    return null;
  }

  const impliedProbability = americanToImpliedProbability(bestPrice.price);
  const ev = expectedValue(winProbability, bestPrice.price);
  const edge = winProbability - impliedProbability;

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

function evaluateGameMoneyline(game) {
  if (!game?.oddsAvailable || !game?.odds) {
    return null;
  }

  const awayScoreCard = scoreTeam(game.awayTeam);
  const homeScoreCard = scoreTeam(game.homeTeam);

  const homeFieldAdjustment = 0.12;
  const scoreDiff =
    awayScoreCard.totalScore - (homeScoreCard.totalScore + homeFieldAdjustment);

  const awayWinProbability = clamp(logistic(scoreDiff * 1.15), 0.05, 0.95);
  const homeWinProbability = 1 - awayWinProbability;

  const awayBestPrice = getBestMoneylinePriceForTeam(
    game.odds,
    game.awayTeam?.name
  );

  const homeBestPrice = getBestMoneylinePriceForTeam(
    game.odds,
    game.homeTeam?.name
  );

  const reasoning = buildReasoning(
    game.awayTeam,
    game.homeTeam,
    awayScoreCard,
    homeScoreCard
  );

  const awayCandidate = evaluateMoneylineCandidate(
    "away",
    game.awayTeam?.name,
    awayWinProbability,
    awayBestPrice,
    reasoning
  );

  const homeCandidate = evaluateMoneylineCandidate(
    "home",
    game.homeTeam?.name,
    homeWinProbability,
    homeBestPrice,
    {
      offenseEdge: roundNumber(-reasoning.offenseEdge, 3),
      teamPitchingEdge: roundNumber(-reasoning.teamPitchingEdge, 3),
      starterEdge: roundNumber(-reasoning.starterEdge, 3),
      awayStarter: reasoning.awayStarter,
      homeStarter: reasoning.homeStarter
    }
  );

  const candidates = [awayCandidate, homeCandidate].filter(Boolean);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.expectedValue - a.expectedValue);

  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    matchup: `${game.awayTeam?.name} at ${game.homeTeam?.name}`,
    awayTeam: game.awayTeam?.name,
    homeTeam: game.homeTeam?.name,
    bestBet: candidates[0],
    alternatives: candidates.slice(1)
  };
}

function rankMoneylinePicks(gamesWithOdds) {
  const evaluatedGames = (gamesWithOdds || [])
    .map(evaluateGameMoneyline)
    .filter(Boolean);

  const positiveEvPicks = evaluatedGames
    .filter((game) => game.bestBet?.expectedValue !== null && game.bestBet.expectedValue > 0)
    .sort((a, b) => b.bestBet.expectedValue - a.bestBet.expectedValue);

  return {
    evaluatedGames,
    positiveEvPicks
  };
}

module.exports = {
  rankMoneylinePicks
};
