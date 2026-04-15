const {
  fetchScheduleForDate,
  fetchPitcherSeasonStats
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

async function mapGame(game, season) {
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
      probablePitcher: awayProbablePitcher
    },
    homeTeam: {
      id: homeTeam?.team?.id || null,
      name: homeTeam?.team?.name || null,
      probablePitcher: homeProbablePitcher
    }
  };
}

async function getGamesForDate(date) {
  const season = date.slice(0, 4);
  const scheduleData = await fetchScheduleForDate(date);

  const rawGames =
    scheduleData?.dates?.flatMap((scheduleDate) => scheduleDate.games || []) || [];

  const games = await Promise.all(
    rawGames.map((game) => mapGame(game, season))
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
