const {
  fetchScheduleForDate,
  fetchPitcherSeasonStats,
  fetchPitcherGameLogStats,
  fetchTeamSeasonStats
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
    awayTeam: {
      ...awayIdentity,
      probablePitcher: awayProbablePitcher,
      teamSeasonStats: getTeamSeasonStats(
        awayIdentity.id,
        hittingStatsMap,
        pitchingStatsMap
      )
    },
    homeTeam: {
      ...homeIdentity,
      probablePitcher: homeProbablePitcher,
      teamSeasonStats: getTeamSeasonStats(
        homeIdentity.id,
        hittingStatsMap,
        pitchingStatsMap
      )
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







