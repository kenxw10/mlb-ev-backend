const { roundNumber } = require("../utils/oddsUtils");

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

function buildMatchupReasoning(
  awayTeam,
  homeTeam,
  awayScoreCard,
  homeScoreCard,
  dataQuality
) {
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

function flipReasoning(reasoning) {
  return {
    offenseEdge: roundNumber(-(reasoning?.offenseEdge ?? 0), 3),
    teamPitchingEdge: roundNumber(-(reasoning?.teamPitchingEdge ?? 0), 3),
    starterEdge: roundNumber(-(reasoning?.starterEdge ?? 0), 3),
    awayStarter: reasoning?.awayStarter || null,
    homeStarter: reasoning?.homeStarter || null,
    dataQuality: reasoning?.dataQuality || null
  };
}

function getConfidenceTier(candidate, dataQuality, thresholds = {}) {
  const edge = candidate?.edge ?? 0;
  const ev = candidate?.expectedValue ?? 0;
  const quality = dataQuality?.total ?? 0;

  const highEdge = thresholds.highEdge ?? 0.04;
  const highEv = thresholds.highEv ?? 0.04;
  const highQuality = thresholds.highQuality ?? 0.85;

  const mediumEdge = thresholds.mediumEdge ?? 0.025;
  const mediumEv = thresholds.mediumEv ?? 0.025;
  const mediumQuality = thresholds.mediumQuality ?? 0.7;

  if (edge >= highEdge && ev >= highEv && quality >= highQuality) {
    return "high";
  }

  if (edge >= mediumEdge && ev >= mediumEv && quality >= mediumQuality) {
    return "medium";
  }

  return "low";
}

module.exports = {
  clamp,
  safeNumber,
  parseInningsPitched,
  logistic,
  buildDataQuality,
  scoreTeam,
  buildMatchupReasoning,
  flipReasoning,
  getConfidenceTier
};
