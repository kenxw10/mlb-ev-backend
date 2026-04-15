const {
  americanToImpliedProbability,
  probabilityToAmerican,
  expectedValue,
  roundNumber
} = require("../utils/oddsUtils");
const {
  clamp,
  logistic,
  calibrateProbability,
  buildDataQuality,
  scoreTeam,
  buildMatchupReasoning,
  getConfidenceTier,
  getGameActionability
} = require("./modelCoreService");

const MIN_EDGE = 0.02;
const MIN_EXPECTED_VALUE = 0.015;
const MIN_DATA_QUALITY = 0.6;
const TOTAL_SIGMOID_SCALE = 0.45;

function average(numbers) {
  if (!numbers || numbers.length === 0) {
    return null;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
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

function candidatePlaceholder(edge, expectedValueValue) {
  return {
    edge: roundNumber(edge, 4),
    expectedValue: roundNumber(expectedValueValue, 4)
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

function getProjectedTeamRuns(teamScoreCard, opponentScoreCard, isHomeTeam) {
  const baselineRuns = 4.15;
  const homeAdjustment = isHomeTeam ? 0.10 : -0.03;

  const projectedRuns =
    baselineRuns +
    teamScoreCard.offenseScore * 0.55 -
    opponentScoreCard.bullpenAndStaffScore * 0.25 -
    opponentScoreCard.starterScore * 0.20 +
    homeAdjustment;

  return clamp(projectedRuns, 2.8, 6.5);
}

function buildTotalsLinePairs(odds) {
  return (odds?.totals || []).flatMap((market) => {
    const overOutcome = (market.outcomes || []).find(
      (outcome) => String(outcome.name || "").toLowerCase() === "over"
    );

    const underOutcome = (market.outcomes || []).find(
      (outcome) => String(outcome.name || "").toLowerCase() === "under"
    );

    const point = overOutcome?.point ?? underOutcome?.point ?? null;

    if (
      !overOutcome ||
      !underOutcome ||
      overOutcome.price === null ||
      overOutcome.price === undefined ||
      underOutcome.price === null ||
      underOutcome.price === undefined ||
      point === null ||
      point === undefined
    ) {
      return [];
    }

    return [
      {
        bookmakerKey: market.bookmakerKey,
        bookmakerTitle: market.bookmakerTitle,
        lastUpdate: market.lastUpdate,
        point,
        overPrice: overOutcome.price,
        underPrice: underOutcome.price
      }
    ];
  });
}

function getAverageTotalsImpliedProbability(odds, side, point) {
  const sideName = String(side || "").toLowerCase();

  const probabilities = (odds?.totals || []).flatMap((market) =>
    (market.outcomes || [])
      .filter(
        (outcome) =>
          String(outcome.name || "").toLowerCase() === sideName &&
          Number(outcome.point) === Number(point)
      )
      .map((outcome) => americanToImpliedProbability(outcome.price))
      .filter((value) => value !== null)
  );

  return average(probabilities);
}

function buildTotalsReasoning(
  awayTeam,
  homeTeam,
  awayScoreCard,
  homeScoreCard,
  dataQuality,
  projectedAwayRuns,
  projectedHomeRuns
) {
  const matchupReasoning = buildMatchupReasoning(
    awayTeam,
    homeTeam,
    awayScoreCard,
    homeScoreCard,
    dataQuality
  );

  return {
    ...matchupReasoning,
    projectedAwayRuns: roundNumber(projectedAwayRuns, 3),
    projectedHomeRuns: roundNumber(projectedHomeRuns, 3),
    projectedTotalRuns: roundNumber(projectedAwayRuns + projectedHomeRuns, 3)
  };
}

function evaluateTotalCandidate(
  side,
  linePair,
  projectedTotalRuns,
  baseReasoning,
  dataQuality,
  marketBaselineProbability
) {
  if (!linePair) {
    return null;
  }

  const rawOverProbability = clamp(
    logistic((projectedTotalRuns - Number(linePair.point)) * TOTAL_SIGMOID_SCALE),
    0.20,
    0.80
  );

  const rawProbability = side === "over" ? rawOverProbability : 1 - rawOverProbability;

  const modelProbability = calibrateProbability(
    rawProbability,
    marketBaselineProbability,
    {
      modelWeight: 0.18,
      neutralShrink: 0.82,
      capLow: 0.28,
      capHigh: 0.72
    }
  );

  const price = side === "over" ? linePair.overPrice : linePair.underPrice;
  const impliedProbability = americanToImpliedProbability(price);
  const ev = expectedValue(modelProbability, price);
  const edge =
    impliedProbability === null ? null : modelProbability - impliedProbability;

  return {
    side,
    sportsbook: linePair.bookmakerTitle,
    point: linePair.point,
    price,
    impliedProbability: roundNumber(impliedProbability, 4),
    modelProbability: roundNumber(modelProbability, 4),
    fairOdds: probabilityToAmerican(modelProbability),
    edge: roundNumber(edge, 4),
    expectedValue: roundNumber(ev, 4),
    confidence: getConfidenceTier(candidatePlaceholder(edge, ev), dataQuality, {
      highEdge: 0.04,
      highEv: 0.04,
      highQuality: 0.85,
      mediumEdge: 0.025,
      mediumEv: 0.02,
      mediumQuality: 0.7
    }),
    reasoning: {
      ...baseReasoning,
      totalsLine: linePair.point
    }
  };
}

function evaluateGameTotals(game) {
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

  const projectedAwayRuns = getProjectedTeamRuns(
    awayScoreCard,
    homeScoreCard,
    false
  );

  const projectedHomeRuns = getProjectedTeamRuns(
    homeScoreCard,
    awayScoreCard,
    true
  );

  const projectedTotalRuns = projectedAwayRuns + projectedHomeRuns;

  const baseReasoning = buildTotalsReasoning(
    game.awayTeam,
    game.homeTeam,
    awayScoreCard,
    homeScoreCard,
    dataQuality,
    projectedAwayRuns,
    projectedHomeRuns
  );

  const linePairs = buildTotalsLinePairs(game.odds);

  const candidates = linePairs.flatMap((linePair) => [
    evaluateTotalCandidate(
      "over",
      linePair,
      projectedTotalRuns,
      baseReasoning,
      dataQuality,
      getAverageTotalsImpliedProbability(game.odds, "over", linePair.point)
    ),
    evaluateTotalCandidate(
      "under",
      linePair,
      projectedTotalRuns,
      baseReasoning,
      dataQuality,
      getAverageTotalsImpliedProbability(game.odds, "under", linePair.point)
    )
  ]);

  const filteredCandidates = candidates.filter((candidate) =>
    passesCandidateFilters(candidate, dataQuality)
  );

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
    projectedAwayRuns: roundNumber(projectedAwayRuns, 3),
    projectedHomeRuns: roundNumber(projectedHomeRuns, 3),
    projectedTotalRuns: roundNumber(projectedTotalRuns, 3),
    bestBet: filteredCandidates[0],
    alternatives: filteredCandidates.slice(1)
  };
}

function rankTotalsPicks(gamesWithOdds) {
  const evaluatedGames = (gamesWithOdds || [])
    .map(evaluateGameTotals)
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
  rankTotalsPicks
};
