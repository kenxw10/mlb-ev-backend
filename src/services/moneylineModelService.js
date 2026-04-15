const {
  americanToImpliedProbability,
  probabilityToAmerican,
  expectedValue,
  roundNumber
} = require("../utils/oddsUtils");

const MIN_EDGE = 0.015;
const MIN_EXPECTED_VALUE = 0.015;
const MIN_DATA_QUALITY = 0.6;

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

function parseInningsPitched(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const raw = String(value).trim();

  if (!raw.includes(".")) {
    return safeNumber(raw);
  }

  const [wholePart, decimalPart] = raw.split(".");
  const whole = safeNumber(wholePart);

  if (whole === null) {
    return null;
  }

  if (decimalPart === "1") {
    return whole + 1 / 3;
  }

  if (decimalPart === "2") {
    return whole + 2 / 3;
  }

  if (decimalPart === "0" || decimalPart === "") {
    return whole;
  }

  return safeNumber(raw);
}

function logistic(x) {
  return 1 / (1 + Math.exp(-x));
}

function getRunsPerGame(hittingStats) {
  const runs = safeNumber(hittingStats?.runs);
  const gamesPlayed = safeNumber(hittingStats?.gamesPlayed);

  if (runs === null || gamesPlayed === null || gamesPlayed <= 0) {
    return null;
  }

  return runs / gamesPlayed;
}

function getInningsPerStart(starterStats) {
  const inningsPitched = parseInningsPitched(starterStats?.inningsPitched);
  const gamesStarted = safeNumber(starterStats?.gamesStarted);

  if (inningsPitched === null || gamesStarted === null || gamesStarted <= 0) {
    return null;
  }

  return inningsPitched / gamesStarted;
}

function getKMinusBBRateLike(starterStats) {
  const strikeOuts = safeNumber(starterStats?.strikeOuts);
  const walks = safeNumber(starterStats?.baseOnBalls);
  const inningsPitched = parseInningsPitched(starterStats?.inningsPitched);

  if (
    strikeOuts === null ||
    walks === null ||
    inningsPitched === null ||
    inningsPitched <= 0
  ) {
    return null;
  }

  return (strikeOuts - walks) / inningsPitched;
}

function getTeamPitchingKMinusBBRate(pitchingStats) {
  const strikeOuts = safeNumber(pitchingStats?.strikeOuts);
  const walks = safeNumber(pitchingStats?.baseOnBalls);
  const inningsPitched = parseInningsPitched(pitchingStats?.inningsPitched);

  if (
    strikeOuts === null ||
    walks === null ||
    inningsPitched === null ||
    inningsPitched <= 0
  ) {
    return null;
  }

  return (strikeOuts - walks) / inningsPitched;
}

function scoreOffense(hittingStats) {
  const ops = safeNumber(hittingStats?.ops);
  const obp = safeNumber(hittingStats?.obp);
  const runsPerGame = getRunsPerGame(hittingStats);

  let score = 0;

  if (ops !== null) {
    score += clamp((ops - 0.720) / 0.100, -1.25, 1.25) * 0.45;
  }

  if (obp !== null) {
    score += clamp((obp - 0.315) / 0.030, -1.25, 1.25) * 0.20;
  }

  if (runsPerGame !== null) {
    score += clamp((runsPerGame - 4.50) / 1.00, -1.25, 1.25) * 0.35;
  }

  return score;
}

function scoreTeamPitching(pitchingStats) {
  const era = safeNumber(pitchingStats?.era);
  const whip = safeNumber(pitchingStats?.whip);
  const kMinusBBPerInning = getTeamPitchingKMinusBBRate(pitchingStats);

  let score = 0;

  if (era !== null) {
    score += clamp((4.20 - era) / 1.10, -1.25, 1.25) * 0.45;
  }

  if (whip !== null) {
    score += clamp((1.30 - whip) / 0.16, -1.25, 1.25) * 0.35;
  }

  if (kMinusBBPerInning !== null) {
    score += clamp((kMinusBBPerInning - 0.36) / 0.18, -1.25, 1.25) * 0.20;
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
  const inningsPerStart = getInningsPerStart(starterStats);

  let score = 0;

  if (era !== null) {
    score += clamp((4.00 - era) / 1.20, -1.5, 1.5) * 0.40;
  }

  if (whip !== null) {
    score += clamp((1.25 - whip) / 0.18, -1.5, 1.5) * 0.25;
  }

  if (kMinusBBPerInning !== null) {
    score += clamp((kMinusBBPerInning - 0.50) / 0.30, -1.5, 1.5) * 0.20;
  }

  if (inningsPerStart !== null) {
    score += clamp((inningsPerStart - 5.3) / 1.3, -1.0, 1.0) * 0.15;
  }

  return score;
}

function getStarterReliability(starterStats) {
  if (!starterStats) {
    return 0;
  }

  const gamesStarted = safeNumber(starterStats?.gamesStarted);
  const inningsPitched = parseInningsPitched(starterStats?.inningsPitched);

  let score = 0.35;

  if (gamesStarted !== null) {
    score += clamp(gamesStarted / 6, 0, 0.35);
  }

  if (inningsPitched !== null) {
    score += clamp(inningsPitched / 40, 0, 0.30);
  }

  return clamp(score, 0, 1);
}

function getTeamStatsReliability(team) {
  const hitting = team?.teamSeasonStats?.hitting;
  const pitching = team?.teamSeasonStats?.pitching;

  const hasHitting =
    hitting &&
    (safeNumber(hitting.gamesPlayed) !== null || safeNumber(hitting.ops) !== null);

  const hasPitching =
    pitching &&
    (safeNumber(pitching.gamesPlayed) !== null || safeNumber(pitching.era) !== null);

  if (hasHitting && hasPitching) {
    return 1;
  }

  if (hasHitting || hasPitching) {
    return 0.6;
  }

  return 0;
}

function buildDataQuality(game) {
  const awayStarterReliability = getStarterReliability(
    game?.awayTeam?.probablePitcher?.seasonStats
  );
  const homeStarterReliability = getStarterReliability(
    game?.homeTeam?.probablePitcher?.seasonStats
  );
  const awayTeamReliability = getTeamStatsReliability(game?.awayTeam);
  const homeTeamReliability = getTeamStatsReliability(game?.homeTeam);

  const total =
    awayStarterReliability * 0.25 +
    homeStarterReliability * 0.25 +
    awayTeamReliability * 0.25 +
    homeTeamReliability * 0.25;

  return {
    awayStarterReliability: roundNumber(awayStarterReliability, 3),
    homeStarterReliability: roundNumber(homeStarterReliability, 3),
    awayTeamReliability: roundNumber(awayTeamReliability, 3),
    homeTeamReliability: roundNumber(homeTeamReliability, 3),
    total: roundNumber(total, 3)
  };
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

function getConfidenceTier(candidate, dataQuality) {
  const edge = candidate?.edge ?? 0;
  const ev = candidate?.expectedValue ?? 0;
  const quality = dataQuality?.total ?? 0;

  if (edge >= 0.04 && ev >= 0.04 && quality >= 0.85) {
    return "high";
  }

  if (edge >= 0.025 && ev >= 0.025 && quality >= 0.7) {
    return "medium";
  }

  return "low";
}

function buildReasoning(awayTeam, homeTeam, awayScoreCard, homeScoreCard, dataQuality) {
  const offenseEdge = awayScoreCard.offenseScore - homeScoreCard.offenseScore;
  const teamPitchingEdge =
    awayScoreCard.bullpenAndStaffScore - homeScoreCard.bullpenAndStaffScore;
  const starterEdge = awayScoreCard.starterScore - homeScoreCard.starterScore;

  return {
    offenseEdge: roundNumber(offenseEdge, 3),
    teamPitchingEdge: roundNumber(teamPitchingEdge, 3),
    starterEdge: roundNumber(starterEdge, 3),
    awayStarter: awayTeam?.probablePitcher?.fullName || null,
    homeStarter: homeTeam?.probablePitcher?.fullName || null,
    dataQuality
  };
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
  const status = String(game?.status || "").toLowerCase();

  if (status.includes("final") || status.includes("postponed") || status.includes("cancelled")) {
    return {
      reject: true,
      reason: "Game status is no longer actionable."
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

  const sharedReasoning = buildReasoning(
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
    {
      offenseEdge: roundNumber(-(sharedReasoning.offenseEdge ?? 0), 3),
      teamPitchingEdge: roundNumber(-(sharedReasoning.teamPitchingEdge ?? 0), 3),
      starterEdge: roundNumber(-(sharedReasoning.starterEdge ?? 0), 3),
      awayStarter: sharedReasoning.awayStarter,
      homeStarter: sharedReasoning.homeStarter,
      dataQuality: sharedReasoning.dataQuality
    }
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
