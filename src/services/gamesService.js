const {
  fetchScheduleForDate,
  fetchGameBoxscore,
  fetchPitcherSeasonStats,
  fetchPitcherGameLogStats,
  fetchTeamSeasonStats,
  fetchTeamGameLogStats,
  fetchTeamStatSplits
} = require("../providers/mlbStatsProvider");
const {
  getEasternDateFromIso,
  getEasternTimeFromIso
} = require("../utils/teamUtils");

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseBaseballInnings(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const raw = String(value).trim();

  if (!raw.includes(".")) {
    return toNumberOrNull(raw);
  }

  const [wholePart, decimalPart] = raw.split(".");
  const whole = toNumberOrNull(wholePart);

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

  return toNumberOrNull(raw);
}

function roundStat(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  return Number(Number(value).toFixed(digits));
}

function getPitcherLogDate(split) {
  return (
    split?.date ||
    split?.game?.gameDate ||
    split?.game?.officialDate ||
    split?.game?.gamePk ||
    null
  );
}

function getPitcherLogDateOnly(split) {
  const raw = getPitcherLogDate(split);

  if (!raw) {
    return null;
  }

  const rawText = String(raw);

  if (/^\d{4}-\d{2}-\d{2}/.test(rawText)) {
    return rawText.slice(0, 10);
  }

  const parsed = new Date(rawText);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function getPitcherGameLogSplits(statsResponse, cutoffDate = null) {
  const splits = statsResponse?.stats?.[0]?.splits || [];
  const cutoffDateOnly = cutoffDate ? String(cutoffDate).slice(0, 10) : null;

  return splits
    .filter((split) => {
      const innings = parseBaseballInnings(split?.stat?.inningsPitched);
      const gamesStarted = toNumberOrNull(split?.stat?.gamesStarted);
      const logDateOnly = getPitcherLogDateOnly(split);

      if (innings === null || innings <= 0) {
        return false;
      }

      if (gamesStarted !== null && gamesStarted <= 0) {
        return false;
      }

      if (cutoffDateOnly && logDateOnly && logDateOnly >= cutoffDateOnly) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      const dateA = new Date(getPitcherLogDate(a) || 0).getTime();
      const dateB = new Date(getPitcherLogDate(b) || 0).getTime();
      return dateB - dateA;
    });
}
function aggregatePitcherGameLogSplits(splits, limit) {
  const selected = splits.slice(0, limit);

  if (selected.length === 0) {
    return null;
  }

  let inningsPitched = 0;
  let strikeOuts = 0;
  let baseOnBalls = 0;
  let hits = 0;
  let homeRuns = 0;
  let earnedRuns = 0;
  let runs = 0;
  let gamesStarted = 0;

  for (const split of selected) {
    const stat = split?.stat || {};

    inningsPitched += parseBaseballInnings(stat.inningsPitched) || 0;
    strikeOuts += toNumberOrNull(stat.strikeOuts) || 0;
    baseOnBalls += toNumberOrNull(stat.baseOnBalls) || 0;
    hits += toNumberOrNull(stat.hits) || 0;
    homeRuns += toNumberOrNull(stat.homeRuns) || 0;
    earnedRuns += toNumberOrNull(stat.earnedRuns) || 0;
    runs += toNumberOrNull(stat.runs) || 0;
    gamesStarted += toNumberOrNull(stat.gamesStarted) || 0;
  }

  const appearanceCount = selected.length;
  const denominatorStarts = gamesStarted > 0 ? gamesStarted : appearanceCount;

  return {
    appearanceCount,
    gamesStarted,
    inningsPitched: roundStat(inningsPitched, 2),
    inningsPerAppearance: roundStat(inningsPitched / appearanceCount, 3),
    inningsPerStart: roundStat(inningsPitched / denominatorStarts, 3),
    era: inningsPitched > 0 ? roundStat((earnedRuns * 9) / inningsPitched, 3) : null,
    whip: inningsPitched > 0 ? roundStat((hits + baseOnBalls) / inningsPitched, 3) : null,
    strikeOuts,
    baseOnBalls,
    hits,
    homeRuns,
    runs,
    earnedRuns,
    kMinusBBPerInning:
      inningsPitched > 0 ? roundStat((strikeOuts - baseOnBalls) / inningsPitched, 3) : null,
    sample: {
      requestedGames: limit,
      usedGames: appearanceCount,
      firstDate: getPitcherLogDate(selected[selected.length - 1]),
      lastDate: getPitcherLogDate(selected[0])
    }
  };
}

function mapPitcherRecentForm(statsResponse, cutoffDate = null) {
  const splits = getPitcherGameLogSplits(statsResponse, cutoffDate);

  return {
    source: "mlb_stats_gameLog",
    cutoffDate: cutoffDate || null,
    basis: "starts_before_game_date",
    last3: aggregatePitcherGameLogSplits(splits, 3),
    last5: aggregatePitcherGameLogSplits(splits, 5)
  };
}

function getTeamGameLogSplits(statsResponse, cutoffDate = null) {
  const splits = statsResponse?.stats?.[0]?.splits || [];

  return splits
    .map((split) => {
      const gameDate =
        split?.date ||
        split?.game?.gameDate ||
        split?.game?.officialDate ||
        null;

      return {
        ...split,
        normalizedDate: gameDate ? String(gameDate).slice(0, 10) : null
      };
    })
    .filter((split) => {
      if (!split.normalizedDate) {
        return false;
      }

      if (cutoffDate && split.normalizedDate >= cutoffDate) {
        return false;
      }

      return true;
    })
    .sort((a, b) => String(b.normalizedDate).localeCompare(String(a.normalizedDate)));
}

function divideOrNull(numerator, denominator, decimals = 3) {
  const n = toNumberOrNull(numerator);
  const d = toNumberOrNull(denominator);

  if (n === null || d === null || d === 0) {
    return null;
  }

  return Number((n / d).toFixed(decimals));
}

function aggregateTeamHittingGameLogSplits(splits, limit) {
  const sample = splits.slice(0, limit);

  if (sample.length === 0) {
    return {
      gameCount: 0,
      lastDate: null,
      runs: null,
      runsPerGame: null,
      hits: null,
      hitsPerGame: null,
      homeRuns: null,
      homeRunsPerGame: null,
      walks: null,
      walksPerGame: null,
      strikeouts: null,
      strikeoutsPerGame: null,
      atBats: null,
      plateAppearances: null,
      battingAverage: null,
      onBasePercentage: null,
      sluggingPercentage: null,
      ops: null
    };
  }

  let runs = 0;
  let hits = 0;
  let doubles = 0;
  let triples = 0;
  let homeRuns = 0;
  let walks = 0;
  let strikeouts = 0;
  let atBats = 0;
  let plateAppearances = 0;
  let hitByPitch = 0;
  let sacrificeFlies = 0;
  let totalBases = 0;

  for (const split of sample) {
    const stat = split.stat || {};

    const statRuns = toNumberOrNull(stat.runs) || 0;
    const statHits = toNumberOrNull(stat.hits) || 0;
    const statDoubles = toNumberOrNull(stat.doubles) || 0;
    const statTriples = toNumberOrNull(stat.triples) || 0;
    const statHomeRuns = toNumberOrNull(stat.homeRuns) || 0;
    const statWalks = toNumberOrNull(stat.baseOnBalls ?? stat.walks) || 0;
    const statStrikeouts = toNumberOrNull(stat.strikeOuts ?? stat.strikeouts) || 0;
    const statAtBats = toNumberOrNull(stat.atBats) || 0;
    const statPlateAppearances = toNumberOrNull(stat.plateAppearances) || 0;
    const statHitByPitch = toNumberOrNull(stat.hitByPitch) || 0;
    const statSacrificeFlies = toNumberOrNull(stat.sacFlies ?? stat.sacrificeFlies) || 0;

    const statTotalBases =
      toNumberOrNull(stat.totalBases) ??
      Math.max(statHits - statDoubles - statTriples - statHomeRuns, 0) +
        statDoubles * 2 +
        statTriples * 3 +
        statHomeRuns * 4;

    runs += statRuns;
    hits += statHits;
    doubles += statDoubles;
    triples += statTriples;
    homeRuns += statHomeRuns;
    walks += statWalks;
    strikeouts += statStrikeouts;
    atBats += statAtBats;
    plateAppearances += statPlateAppearances;
    hitByPitch += statHitByPitch;
    sacrificeFlies += statSacrificeFlies;
    totalBases += statTotalBases;
  }

  const obpDenominator = atBats + walks + hitByPitch + sacrificeFlies;
  const obp = divideOrNull(hits + walks + hitByPitch, obpDenominator, 3);
  const slg = divideOrNull(totalBases, atBats, 3);

  return {
    gameCount: sample.length,
    lastDate: sample[0]?.normalizedDate || null,
    runs,
    runsPerGame: divideOrNull(runs, sample.length, 3),
    hits,
    hitsPerGame: divideOrNull(hits, sample.length, 3),
    homeRuns,
    homeRunsPerGame: divideOrNull(homeRuns, sample.length, 3),
    walks,
    walksPerGame: divideOrNull(walks, sample.length, 3),
    strikeouts,
    strikeoutsPerGame: divideOrNull(strikeouts, sample.length, 3),
    atBats,
    plateAppearances,
    battingAverage: divideOrNull(hits, atBats, 3),
    onBasePercentage: obp,
    sluggingPercentage: slg,
    ops: obp !== null && slg !== null ? Number((obp + slg).toFixed(3)) : null
  };
}

function mapTeamRecentHittingForm(statsResponse, cutoffDate = null) {
  const splits = getTeamGameLogSplits(statsResponse, cutoffDate);

  return {
    source: "mlb_stats_team_gameLog",
    cutoffDate: cutoffDate || null,
    basis: "team_hitting_games_before_game_date",
    last7: aggregateTeamHittingGameLogSplits(splits, 7),
    last14: aggregateTeamHittingGameLogSplits(splits, 14)
  };
}
function aggregateTeamPitchingGameLogSplits(splits, limit) {
  const sample = splits.slice(0, limit);

  if (sample.length === 0) {
    return {
      gameCount: 0,
      lastDate: null,
      inningsPitched: null,
      inningsPerGame: null,
      runs: null,
      runsPerGame: null,
      earnedRuns: null,
      era: null,
      hits: null,
      hitsPerGame: null,
      homeRuns: null,
      homeRunsPerGame: null,
      walks: null,
      walksPerGame: null,
      strikeouts: null,
      strikeoutsPerGame: null,
      kMinusBBPerInning: null,
      whip: null,
      battersFaced: null,
      pitches: null,
      pitchesPerGame: null,
      saves: null,
      holds: null,
      blownSaves: null,
      saveOpportunities: null,
      saveConversionRate: null,
      gamesFinished: null
    };
  }

  let inningsPitched = 0;
  let runs = 0;
  let earnedRuns = 0;
  let hits = 0;
  let homeRuns = 0;
  let walks = 0;
  let strikeouts = 0;
  let battersFaced = 0;
  let pitches = 0;
  let saves = 0;
  let holds = 0;
  let blownSaves = 0;
  let saveOpportunities = 0;
  let gamesFinished = 0;

  for (const split of sample) {
    const stat = split.stat || {};
    const innings = parseBaseballInnings(stat.inningsPitched);

    if (innings !== null) inningsPitched += innings;

    runs += toNumberOrNull(stat.runs) || 0;
    earnedRuns += toNumberOrNull(stat.earnedRuns) || 0;
    hits += toNumberOrNull(stat.hits) || 0;
    homeRuns += toNumberOrNull(stat.homeRuns) || 0;
    walks += toNumberOrNull(stat.baseOnBalls) || 0;
    strikeouts += toNumberOrNull(stat.strikeOuts) || 0;
    battersFaced += toNumberOrNull(stat.battersFaced) || 0;
    pitches += toNumberOrNull(stat.numberOfPitches) || 0;
    saves += toNumberOrNull(stat.saves) || 0;
    holds += toNumberOrNull(stat.holds) || 0;
    blownSaves += toNumberOrNull(stat.blownSaves) || 0;
    saveOpportunities += toNumberOrNull(stat.saveOpportunities) || 0;
    gamesFinished += toNumberOrNull(stat.gamesFinished) || 0;
  }

  return {
    gameCount: sample.length,
    lastDate: sample[0]?.date || sample[0]?.game?.gameDate || null,
    inningsPitched: roundStat(inningsPitched, 2),
    inningsPerGame: divideOrNull(inningsPitched, sample.length, 3),
    runs,
    runsPerGame: divideOrNull(runs, sample.length, 3),
    earnedRuns,
    era: inningsPitched > 0 ? roundStat((earnedRuns * 9) / inningsPitched, 3) : null,
    hits,
    hitsPerGame: divideOrNull(hits, sample.length, 3),
    homeRuns,
    homeRunsPerGame: divideOrNull(homeRuns, sample.length, 3),
    walks,
    walksPerGame: divideOrNull(walks, sample.length, 3),
    strikeouts,
    strikeoutsPerGame: divideOrNull(strikeouts, sample.length, 3),
    kMinusBBPerInning: divideOrNull(strikeouts - walks, inningsPitched, 3),
    whip: inningsPitched > 0 ? roundStat((walks + hits) / inningsPitched, 3) : null,
    battersFaced,
    pitches,
    pitchesPerGame: divideOrNull(pitches, sample.length, 3),
    saves,
    holds,
    blownSaves,
    saveOpportunities,
    saveConversionRate: divideOrNull(saves, saveOpportunities, 3),
    gamesFinished
  };
}

function mapTeamRecentPitchingForm(statsResponse, cutoffDate = null) {
  const splits = getTeamGameLogSplits(statsResponse, cutoffDate);

  return {
    source: "mlb_stats_team_gameLog",
    cutoffDate: cutoffDate || null,
    basis: "team_pitching_games_before_game_date_staff_bullpen_proxy",
    last7: aggregateTeamPitchingGameLogSplits(splits, 7),
    last14: aggregateTeamPitchingGameLogSplits(splits, 14)
  };
}

function mapHandednessSplitStat(stat = {}, group = "hitting") {
  const base = {
    gamesPlayed: stat.gamesPlayed ?? null,
    atBats: stat.atBats ?? null,
    plateAppearances: stat.plateAppearances ?? null,
    hits: stat.hits ?? null,
    doubles: stat.doubles ?? null,
    triples: stat.triples ?? null,
    homeRuns: stat.homeRuns ?? null,
    walks: stat.baseOnBalls ?? null,
    strikeouts: stat.strikeOuts ?? null,
    avg: stat.avg ?? null,
    obp: stat.obp ?? null,
    slg: stat.slg ?? null,
    ops: stat.ops ?? null,
    totalBases: stat.totalBases ?? null,
    numberOfPitches: stat.numberOfPitches ?? null
  };

  if (group !== "pitching") {
    return base;
  }

  const inningsPitched = parseBaseballInnings(stat.inningsPitched);

  return {
    ...base,
    inningsPitched: inningsPitched !== null ? roundStat(inningsPitched, 2) : null,
    battersFaced: stat.battersFaced ?? null,
    whip: stat.whip ?? null,
    strikeoutWalkRatio: stat.strikeoutWalkRatio ?? null,
    strikeoutsPer9Inn: stat.strikeoutsPer9Inn ?? null,
    walksPer9Inn: stat.walksPer9Inn ?? null,
    hitsPer9Inn: stat.hitsPer9Inn ?? null,
    homeRunsPer9: stat.homeRunsPer9 ?? null
  };
}

function mapTeamHandednessSplitForm(statsResponse, group = "hitting") {
  const splits = statsResponse?.stats?.[0]?.splits || [];
  const output = {
    source: "mlb_stats_statSplits",
    basis: group === "pitching" ? "team_pitching_vs_batter_handedness" : "team_hitting_vs_pitcher_handedness",
    vsLeft: null,
    vsRight: null
  };

  for (const split of splits) {
    const code = split?.split?.code || null;
    const mapped = {
      code,
      description: split?.split?.description || null,
      team: split?.team?.name || null,
      stats: mapHandednessSplitStat(split?.stat || {}, group)
    };

    if (code === "vl") {
      output.vsLeft = mapped;
    }

    if (code === "vr") {
      output.vsRight = mapped;
    }
  }

  return output;
}

function mapPitcherStats(statsResponse) {
  const split = statsResponse?.stats?.[0]?.splits?.[0];

  if (!split) {
    return null;
  }

  const stat = split.stat || {};

  return {
    wins: stat.wins ?? null,
    losses: stat.losses ?? null,
    era: stat.era ?? null,
    whip: stat.whip ?? null,
    inningsPitched: stat.inningsPitched ?? null,
    strikeOuts: stat.strikeOuts ?? null,
    baseOnBalls: stat.baseOnBalls ?? null,
    hits: stat.hits ?? null,
    homeRuns: stat.homeRuns ?? null,
    gamesStarted: stat.gamesStarted ?? null
  };
}

function mapTeamHittingStats(stat = {}) {
  return {
    gamesPlayed: stat.gamesPlayed ?? null,
    runs: stat.runs ?? null,
    hits: stat.hits ?? null,
    homeRuns: stat.homeRuns ?? null,
    strikeOuts: stat.strikeOuts ?? null,
    baseOnBalls: stat.baseOnBalls ?? null,
    avg: stat.avg ?? null,
    obp: stat.obp ?? null,
    slg: stat.slg ?? null,
    ops: stat.ops ?? null,
    stolenBases: stat.stolenBases ?? null,
    babip: stat.babip ?? null
  };
}

function mapTeamPitchingStats(stat = {}) {
  return {
    gamesPlayed: stat.gamesPlayed ?? null,
    wins: stat.wins ?? null,
    losses: stat.losses ?? null,
    era: stat.era ?? null,
    whip: stat.whip ?? null,
    inningsPitched: stat.inningsPitched ?? null,
    strikeOuts: stat.strikeOuts ?? null,
    baseOnBalls: stat.baseOnBalls ?? null,
    hits: stat.hits ?? null,
    homeRuns: stat.homeRuns ?? null,
    runs: stat.runs ?? null,
    earnedRuns: stat.earnedRuns ?? null,
    saves: stat.saves ?? null,
    blownSaves: stat.blownSaves ?? null
  };
}

function buildTeamStatsMap(statsResponse, mapper) {
  const splits = statsResponse?.stats?.[0]?.splits || [];
  const statsMap = {};

  for (const split of splits) {
    const teamId = split?.team?.id;

    if (!teamId) {
      continue;
    }

    statsMap[teamId] = mapper(split.stat || {});
  }

  return statsMap;
}

async function enrichProbablePitcher(probablePitcher, season, gameDate = null) {
  if (!probablePitcher?.id) {
    return {
      id: null,
      fullName: null,
      seasonStats: null,
      recentForm: null
    };
  }

  const scheduledEasternDate = gameDate ? getEasternDateFromIso(gameDate) : null;

  let seasonStats = null;
  let recentForm = null;

  try {
    const statsResponse = await fetchPitcherSeasonStats(probablePitcher.id, season);
    seasonStats = mapPitcherStats(statsResponse);
  } catch (error) {
    seasonStats = null;
  }

  if (typeof fetchPitcherGameLogStats === "function") {
    try {
      const recentFormResponse = await fetchPitcherGameLogStats(probablePitcher.id, season);
      recentForm = mapPitcherRecentForm(recentFormResponse, scheduledEasternDate);
    } catch (error) {
      recentForm = null;
    }
  }

  return {
    id: probablePitcher.id,
    fullName: probablePitcher.fullName || null,
    seasonStats,
    recentForm
  };
}
function getTeamSeasonStats(teamId, hittingStatsMap, pitchingStatsMap) {
  if (!teamId) {
    return {
      hitting: null,
      pitching: null
    };
  }

  return {
    hitting: hittingStatsMap[teamId] || null,
    pitching: pitchingStatsMap[teamId] || null
  };
}


async function getTeamRecentForm(teamId, season, cutoffDate = null) {
  if (!teamId || typeof fetchTeamGameLogStats !== "function") {
    return {
      hitting: null,
      pitching: null
    };
  }

  try {
    const [hittingResponse, pitchingResponse] = await Promise.all([
      fetchTeamGameLogStats(teamId, "hitting", season),
      fetchTeamGameLogStats(teamId, "pitching", season)
    ]);

    return {
      hitting: mapTeamRecentHittingForm(hittingResponse, cutoffDate),
      pitching: mapTeamRecentPitchingForm(pitchingResponse, cutoffDate)
    };
  } catch (error) {
    return {
      hitting: null,
      pitching: null
    };
  }
}

async function getTeamHandednessSplits(teamId, season) {
  if (!teamId || typeof fetchTeamStatSplits !== "function") {
    return {
      hitting: null,
      pitching: null
    };
  }

  try {
    const [hittingResponse, pitchingResponse] = await Promise.all([
      fetchTeamStatSplits(teamId, "hitting", season, "vl,vr"),
      fetchTeamStatSplits(teamId, "pitching", season, "vl,vr")
    ]);

    return {
      hitting: mapTeamHandednessSplitForm(hittingResponse, "hitting"),
      pitching: mapTeamHandednessSplitForm(pitchingResponse, "pitching")
    };
  } catch (error) {
    return {
      hitting: null,
      pitching: null
    };
  }
}

function mapTeamIdentity(teamWrapper) {
  const team = teamWrapper?.team || {};

  return {
    id: team.id || null,
    name: team.name || null,
    abbreviation: team.abbreviation || team.teamCode || team.fileCode || null
  };
}

function toIntegerOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function getRawDoubleheaderMetadata(game) {
  const gameNumber = toIntegerOrNull(game?.gameNumber);
  const seriesGameNumber = toIntegerOrNull(game?.seriesGameNumber);
  const doubleHeader = game?.doubleHeader || null;
  const isExplicitDoubleheader =
    Boolean(doubleHeader) && String(doubleHeader).toUpperCase() !== "N";

  return {
    gameNumber,
    seriesGameNumber,
    doubleHeader,
    isDoubleheader: isExplicitDoubleheader,
    doubleheaderLabel:
      isExplicitDoubleheader && gameNumber ? `Game ${gameNumber}` : null
  };
}

function applyDoubleheaderFallbacks(games) {
  const groups = new Map();

  for (const game of games) {
    const awayId = game?.awayTeam?.id || "away";
    const homeId = game?.homeTeam?.id || "home";
    const date = game?.scheduledEasternDate || "date";
    const key = `${date}|${awayId}|${homeId}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(game);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) {
      continue;
    }

    group.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));

    group.forEach((game, index) => {
      const fallbackGameNumber = game.gameNumber || index + 1;

      game.gameNumber = fallbackGameNumber;
      game.seriesGameNumber = game.seriesGameNumber || fallbackGameNumber;
      game.doubleHeader = game.doubleHeader || "Y";
      game.isDoubleheader = true;
      game.doubleheaderLabel = game.doubleheaderLabel || `Game ${fallbackGameNumber}`;
    });
  }

  return games;
}

function normalizeBattingOrder(value) {
  const parsed = toNumberOrNull(value);

  if (parsed === null) {
    return null;
  }

  return Math.floor(parsed / 100);
}

function mapLineupPlayer(entry) {
  if (!entry?.battingOrder) {
    return null;
  }

  return {
    id: entry?.person?.id || null,
    fullName: entry?.person?.fullName || null,
    battingOrder: entry.battingOrder || null,
    lineupSpot: normalizeBattingOrder(entry.battingOrder),
    position: entry?.position?.abbreviation || null,
    statusCode: entry?.status?.code || null,
    statusDescription: entry?.status?.description || null,
    isSubstitute: entry?.gameStatus?.isSubstitute === true,
    isOnBench: entry?.gameStatus?.isOnBench === true,
    allPositions: (entry?.allPositions || [])
      .map((position) => position?.abbreviation)
      .filter(Boolean)
  };
}

function mapTeamLineupFromBoxscore(teamBoxscore) {
  const players = Object.values(teamBoxscore?.players || {});
  const battingOrderPlayers = players
    .map(mapLineupPlayer)
    .filter(Boolean)
    .sort((a, b) => String(a.battingOrder).localeCompare(String(b.battingOrder)));

  const starters = battingOrderPlayers.filter((player) => !player.isSubstitute);
  const substitutes = battingOrderPlayers.filter((player) => player.isSubstitute);

  return {
    source: "mlb_boxscore",
    sourceStatus: battingOrderPlayers.length > 0 ? "available" : "not_available",
    teamName: teamBoxscore?.team?.name || null,
    lineupConfirmed: starters.length >= 9,
    starterCount: starters.length,
    substituteCount: substitutes.length,
    battingOrderCount: battingOrderPlayers.length,
    starters,
    substitutes,
    injuries: {
      source: null,
      sourceStatus: "missing_injury_source",
      injuryAvailable: false,
      players: []
    }
  };
}

function buildLineupInjuryContext(boxscore) {
  return {
    source: "mlb_boxscore",
    injurySourceStatus: "missing_injury_source",
    away: mapTeamLineupFromBoxscore(boxscore?.teams?.away),
    home: mapTeamLineupFromBoxscore(boxscore?.teams?.home)
  };
}
function buildRunEnvironmentContext(game) {
  return {
    source: "mlb_schedule",
    sourceStatus: "missing_weather_source",
    weatherAvailable: false,
    basis: "venue_and_schedule_metadata_only_no_forecast",
    venueId: game?.venue?.id || null,
    venueName: game?.venue?.name || null,
    gameDate: game?.gameDate || null,
    scheduledEasternDate: game?.gameDate ? getEasternDateFromIso(game.gameDate) : null,
    scheduledEasternTime: game?.gameDate ? getEasternTimeFromIso(game.gameDate) : null,
    roofType: null,
    temperatureF: null,
    windSpeedMph: null,
    windDirection: null,
    precipitationProbability: null,
    humidity: null,
    runEnvironmentAdjustment: 0
  };
}

async function mapGame(game, season, hittingStatsMap, pitchingStatsMap) {
  const awayTeam = game.teams?.away;
  const homeTeam = game.teams?.home;
  const awayIdentity = mapTeamIdentity(awayTeam);
  const homeIdentity = mapTeamIdentity(homeTeam);

  const awayProbablePitcher = await enrichProbablePitcher(
    awayTeam?.probablePitcher,
    season,
    game.gameDate
  );

  const homeProbablePitcher = await enrichProbablePitcher(
    homeTeam?.probablePitcher,
    season,
    game.gameDate
  );

  const doubleheaderMetadata = getRawDoubleheaderMetadata(game);
  const teamRecentFormCutoffDate = game?.gameDate ? getEasternDateFromIso(game.gameDate) : null;
  const [
    awayTeamRecentForm,
    homeTeamRecentForm,
    awayTeamHandednessSplits,
    homeTeamHandednessSplits
  ] = await Promise.all([
    getTeamRecentForm(awayIdentity.id, season, teamRecentFormCutoffDate),
    getTeamRecentForm(homeIdentity.id, season, teamRecentFormCutoffDate),
    getTeamHandednessSplits(awayIdentity.id, season),
    getTeamHandednessSplits(homeIdentity.id, season)
  ]);

  let lineupInjuryContext = {
    source: "mlb_boxscore",
    sourceStatus: "not_requested",
    injurySourceStatus: "missing_injury_source",
    away: null,
    home: null
  };

  try {
    const boxscore = await fetchGameBoxscore(game.gamePk);
    lineupInjuryContext = buildLineupInjuryContext(boxscore);
  } catch (error) {
    lineupInjuryContext = {
      source: "mlb_boxscore",
      sourceStatus: "error",
      error: error.message || null,
      injurySourceStatus: "missing_injury_source",
      away: null,
      home: null
    };
  }

  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    scheduledEasternDate: getEasternDateFromIso(game.gameDate),
    scheduledEasternTime: getEasternTimeFromIso(game.gameDate),
    gameNumber: doubleheaderMetadata.gameNumber,
    seriesGameNumber: doubleheaderMetadata.seriesGameNumber,
    doubleHeader: doubleheaderMetadata.doubleHeader,
    isDoubleheader: doubleheaderMetadata.isDoubleheader,
    doubleheaderLabel: doubleheaderMetadata.doubleheaderLabel,
    status: game.status?.detailedState || null,
    venueName: game.venue?.name || null,
    runEnvironment: buildRunEnvironmentContext(game),
    lineupInjuries: lineupInjuryContext,
    awayTeam: {
      ...awayIdentity,
      probablePitcher: awayProbablePitcher,
      teamSeasonStats: getTeamSeasonStats(
        awayIdentity.id,
        hittingStatsMap,
        pitchingStatsMap
      ),
      teamRecentForm: awayTeamRecentForm,
      teamHandednessSplits: awayTeamHandednessSplits
    },
    homeTeam: {
      ...homeIdentity,
      probablePitcher: homeProbablePitcher,
      teamSeasonStats: getTeamSeasonStats(
        homeIdentity.id,
        hittingStatsMap,
        pitchingStatsMap
      ),
      teamRecentForm: homeTeamRecentForm,
      teamHandednessSplits: homeTeamHandednessSplits
    }
  };
}

async function getGamesForDate(date) {
  const season = date.slice(0, 4);

  const [scheduleData, hittingStatsResponse, pitchingStatsResponse] =
    await Promise.all([
      fetchScheduleForDate(date),
      fetchTeamSeasonStats("hitting", season),
      fetchTeamSeasonStats("pitching", season)
    ]);

  const hittingStatsMap = buildTeamStatsMap(
    hittingStatsResponse,
    mapTeamHittingStats
  );

  const pitchingStatsMap = buildTeamStatsMap(
    pitchingStatsResponse,
    mapTeamPitchingStats
  );

  const rawGames =
    scheduleData?.dates?.flatMap((scheduleDate) => scheduleDate.games || []) || [];

  const easternDateFilteredGames = rawGames.filter(
    (game) => getEasternDateFromIso(game.gameDate) === date
  );

  const games = await Promise.all(
    easternDateFilteredGames.map((game) =>
      mapGame(game, season, hittingStatsMap, pitchingStatsMap)
    )
  );

  games.sort((a, b) => new Date(a.gameDate) - new Date(b.gameDate));
  applyDoubleheaderFallbacks(games);

  return {
    ok: true,
    date,
    season,
    gameCount: games.length,
    games
  };
}

module.exports = {
  getGamesForDate
};







