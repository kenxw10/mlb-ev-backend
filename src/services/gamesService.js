const {
  fetchScheduleForDate,
  fetchPitcherSeasonStats,
  fetchTeamSeasonStats
} = require("../providers/mlbStatsProvider");

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

async function mapGame(game, season, hittingStatsMap, pitchingStatsMap) {
  const awayTeam = game.teams?.away;
  const homeTeam = game.teams?.home;

  const awayProbablePitcher = await enrichProbablePitcher(
    awayTeam?.probablePitcher,
    season
  );

  const homeProbablePitcher = await enrichProbablePitcher(
    homeTeam?.probablePitcher,
    season
  );

  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    status: game.status?.detailedState || null,
    awayTeam: {
      id: awayTeam?.team?.id || null,
      name: awayTeam?.team?.name || null,
      probablePitcher: awayProbablePitcher,
      teamSeasonStats: getTeamSeasonStats(
        awayTeam?.team?.id,
        hittingStatsMap,
        pitchingStatsMap
      )
    },
    homeTeam: {
      id: homeTeam?.team?.id || null,
      name: homeTeam?.team?.name || null,
      probablePitcher: homeProbablePitcher,
      teamSeasonStats: getTeamSeasonStats(
        homeTeam?.team?.id,
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

  const games = await Promise.all(
    rawGames.map((game) =>
      mapGame(game, season, hittingStatsMap, pitchingStatsMap)
    )
  );

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
