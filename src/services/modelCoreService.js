const { roundNumber } = require("../utils/oddsUtils");

const STARTER_RECENT_FORM_VERSION = "starter-recent-form-v1";

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

function calibrateProbability(rawProbability, marketProbability, options = {}) {
  const capLow = options.capLow ?? 0.18;
  const capHigh = options.capHigh ?? 0.82;
  const modelWeight = options.modelWeight ?? 0.22;
  const neutralShrink = options.neutralShrink ?? 0.85;

  let calibrated = clamp(rawProbability, capLow, capHigh);
  calibrated = 0.5 + (calibrated - 0.5) * neutralShrink;

  if (marketProbability !== null && marketProbability !== undefined) {
    calibrated =
      marketProbability * (1 - modelWeight) + calibrated * modelWeight;
  }

  return clamp(calibrated, capLow, capHigh);
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

function scoreStartingPitcherBase(starterStats) {
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

function getRecentStarterSampleWeight(recentForm) {
  const last5 = recentForm?.last5;

  if (!last5) {
    return 0;
  }

  const inningsPitched = safeNumber(last5.inningsPitched);
  const gamesStarted =
    safeNumber(last5.gamesStarted) ?? safeNumber(last5.appearanceCount);

  if (
    inningsPitched === null ||
    inningsPitched <= 0 ||
    gamesStarted === null ||
    gamesStarted <= 0
  ) {
    return 0;
  }

  const inningsWeight = clamp(inningsPitched / 25, 0, 1);
  const startsWeight = clamp(gamesStarted / 5, 0, 1);

  return roundNumber(inningsWeight * startsWeight, 3);
}

function buildStartingPitcherScore(starterStats, recentForm) {
  const seasonScore = scoreStartingPitcherBase(starterStats);
  const last3Score = recentForm?.last3
    ? scoreStartingPitcherBase(recentForm.last3)
    : null;
  const last5Score = recentForm?.last5
    ? scoreStartingPitcherBase(recentForm.last5)
    : null;

  let recentCompositeScore = null;

  if (last3Score !== null && last5Score !== null) {
    recentCompositeScore = last5Score * 0.7 + last3Score * 0.3;
  } else if (last5Score !== null) {
    recentCompositeScore = last5Score;
  } else if (last3Score !== null) {
    recentCompositeScore = last3Score;
  }

  const recentSampleWeight = getRecentStarterSampleWeight(recentForm);
  const rawRecentAdjustment =
    recentCompositeScore === null
      ? 0
      : (recentCompositeScore - seasonScore) * 0.3 * recentSampleWeight;
  const recentAdjustment = clamp(rawRecentAdjustment, -0.25, 0.25);
  const finalScore = seasonScore + recentAdjustment;

  return {
    finalScore: roundNumber(finalScore, 3),
    seasonScore: roundNumber(seasonScore, 3),
    last3Score: last3Score === null ? null : roundNumber(last3Score, 3),
    last5Score: last5Score === null ? null : roundNumber(last5Score, 3),
    recentCompositeScore:
      recentCompositeScore === null ? null : roundNumber(recentCompositeScore, 3),
    recentSampleWeight,
    recentAdjustment: roundNumber(recentAdjustment, 3),
    recentFormVersion: STARTER_RECENT_FORM_VERSION
  };
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
  const starterScoreCard = buildStartingPitcherScore(
    team?.probablePitcher?.seasonStats,
    team?.probablePitcher?.recentForm
  );
  const starterScore = starterScoreCard.finalScore;

  return {
    offenseScore,
    bullpenAndStaffScore,
    starterScore,
    starterSeasonScore: starterScoreCard.seasonScore,
    starterLast3Score: starterScoreCard.last3Score,
    starterLast5Score: starterScoreCard.last5Score,
    starterRecentCompositeScore: starterScoreCard.recentCompositeScore,
    starterRecentSampleWeight: starterScoreCard.recentSampleWeight,
    starterRecentAdjustment: starterScoreCard.recentAdjustment,
    starterRecentFormVersion: starterScoreCard.recentFormVersion,
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
  const starterRecentAdjustmentEdge =
    (awayScoreCard.starterRecentAdjustment ?? 0) -
    (homeScoreCard.starterRecentAdjustment ?? 0);

  return {
    offenseEdge: roundNumber(offenseEdge, 3),
    teamPitchingEdge: roundNumber(teamPitchingEdge, 3),
    starterEdge: roundNumber(starterEdge, 3),
    starterRecentAdjustmentEdge: roundNumber(starterRecentAdjustmentEdge, 3),
    starterRecentFormVersion:
      awayScoreCard.starterRecentFormVersion ||
      homeScoreCard.starterRecentFormVersion ||
      null,

    awayStarter: awayTeam?.probablePitcher?.fullName || null,
    homeStarter: homeTeam?.probablePitcher?.fullName || null,

    awayStarterSeasonScore: awayScoreCard.starterSeasonScore ?? null,
    homeStarterSeasonScore: homeScoreCard.starterSeasonScore ?? null,
    awayStarterRecentScore: awayScoreCard.starterRecentCompositeScore ?? null,
    homeStarterRecentScore: homeScoreCard.starterRecentCompositeScore ?? null,
    awayStarterRecentAdjustment: awayScoreCard.starterRecentAdjustment ?? null,
    homeStarterRecentAdjustment: homeScoreCard.starterRecentAdjustment ?? null,
    awayStarterRecentSampleWeight: awayScoreCard.starterRecentSampleWeight ?? null,
    homeStarterRecentSampleWeight: homeScoreCard.starterRecentSampleWeight ?? null,

    componentSchemaVersion: "model-components-v1",
    modelWeightVersion: "hard-coded-model-weights-v1",

    componentInputs: {
      starter: {
        away: {
          id: awayTeam?.probablePitcher?.id || null,
          fullName: awayTeam?.probablePitcher?.fullName || null,
          seasonStats: awayTeam?.probablePitcher?.seasonStats || null,
          recentForm: awayTeam?.probablePitcher?.recentForm || null
        },
        home: {
          id: homeTeam?.probablePitcher?.id || null,
          fullName: homeTeam?.probablePitcher?.fullName || null,
          seasonStats: homeTeam?.probablePitcher?.seasonStats || null,
          recentForm: homeTeam?.probablePitcher?.recentForm || null
        }
      },
      teamSeason: {
        away: awayTeam?.teamSeasonStats || null,
        home: homeTeam?.teamSeasonStats || null
      },
      futureComponents: {
        teamRecentForm: null,
        bullpenRecentForm: null,
        handednessSplits: null,
        weather: null,
        lineup: null,
        injuries: null
      }
    },

    componentScores: {
      away: awayScoreCard,
      home: homeScoreCard,
      edges: {
        offenseEdge: roundNumber(offenseEdge, 3),
        teamPitchingEdge: roundNumber(teamPitchingEdge, 3),
        starterEdge: roundNumber(starterEdge, 3),
        starterRecentAdjustmentEdge: roundNumber(starterRecentAdjustmentEdge, 3)
      }
    },

    dataQuality
  };
}
function flipReasoning(reasoning) {
  return {
    offenseEdge: roundNumber(-(reasoning?.offenseEdge ?? 0), 3),
    teamPitchingEdge: roundNumber(-(reasoning?.teamPitchingEdge ?? 0), 3),
    starterEdge: roundNumber(-(reasoning?.starterEdge ?? 0), 3),
    starterRecentAdjustmentEdge: roundNumber(
      -(reasoning?.starterRecentAdjustmentEdge ?? 0),
      3
    ),
    starterRecentFormVersion: reasoning?.starterRecentFormVersion || null,

    awayStarter: reasoning?.awayStarter || null,
    homeStarter: reasoning?.homeStarter || null,

    awayStarterSeasonScore: reasoning?.awayStarterSeasonScore ?? null,
    homeStarterSeasonScore: reasoning?.homeStarterSeasonScore ?? null,
    awayStarterRecentScore: reasoning?.awayStarterRecentScore ?? null,
    homeStarterRecentScore: reasoning?.homeStarterRecentScore ?? null,
    awayStarterRecentAdjustment: reasoning?.awayStarterRecentAdjustment ?? null,
    homeStarterRecentAdjustment: reasoning?.homeStarterRecentAdjustment ?? null,
    awayStarterRecentSampleWeight: reasoning?.awayStarterRecentSampleWeight ?? null,
    homeStarterRecentSampleWeight: reasoning?.homeStarterRecentSampleWeight ?? null,

    componentSchemaVersion: reasoning?.componentSchemaVersion || null,
    modelWeightVersion: reasoning?.modelWeightVersion || null,
    componentInputs: reasoning?.componentInputs || null,
    componentScores: reasoning?.componentScores || null,

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

function getGameActionability(game) {
  const status = String(game?.status || "").toLowerCase();

  if (status.includes("final") || status.includes("postponed") || status.includes("cancelled")) {
    return {
      actionable: false,
      reason: "Game status is no longer actionable."
    };
  }

  if (
    status.includes("in progress") ||
    status.includes("manager challenge") ||
    status.includes("review") ||
    status.includes("delayed") ||
    status.includes("warmup") ||
    status.includes("live")
  ) {
    return {
      actionable: false,
      reason: "Game is already live."
    };
  }

  const scheduledStartMs = game?.gameDate ? new Date(game.gameDate).getTime() : null;

  if (
    scheduledStartMs !== null &&
    !Number.isNaN(scheduledStartMs) &&
    scheduledStartMs <= Date.now()
  ) {
    return {
      actionable: false,
      reason: "Scheduled start time has already passed."
    };
  }

  return {
    actionable: true,
    reason: null
  };
}

module.exports = {
  clamp,
  safeNumber,
  parseInningsPitched,
  logistic,
  calibrateProbability,
  buildDataQuality,
  scoreTeam,
  buildMatchupReasoning,
  flipReasoning,
  getConfidenceTier,
  getGameActionability
};




