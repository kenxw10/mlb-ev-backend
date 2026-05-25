const {
  fetchScheduleForDate,
  fetchPitcherSeasonStats,
  fetchTeamSeasonStats
} = require("../providers/mlbStatsProvider");
const {
  getEasternDateFromIso,
  getEasternTimeFromIso
} = require("../utils/teamUtils");

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

async function enrichProbablePitcher(probablePitcher, season) {
  if (!probablePitcher?.id) {
    return {
      id: null,
      fullName: null,
      seasonStats: null
    };
  }

  try {
    const statsResponse = await fetchPitcherSeasonStats(probablePitcher.id, season);

    return {
      id: probablePitcher.id,
      fullName: probablePitcher.fullName || null,
      seasonStats: mapPitcherStats(statsResponse)
    };
  } catch (error) {
    return {
      id: probablePitcher.id,
      fullName: probablePitcher.fullName || null,
      seasonStats: null
    };
  }
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
    season
  );

  const homeProbablePitcher = await enrichProbablePitcher(
    homeTeam?.probablePitcher,
    season
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

