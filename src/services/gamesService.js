const { fetchScheduleForDate } = require("../providers/mlbStatsProvider");

function mapGame(game) {
  const awayTeam = game.teams?.away;
  const homeTeam = game.teams?.home;

  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    status: game.status?.detailedState || null,
    awayTeam: {
      id: awayTeam?.team?.id || null,
      name: awayTeam?.team?.name || null,
      probablePitcher: {
        id: awayTeam?.probablePitcher?.id || null,
        fullName: awayTeam?.probablePitcher?.fullName || null
      }
    },
    homeTeam: {
      id: homeTeam?.team?.id || null,
      name: homeTeam?.team?.name || null,
      probablePitcher: {
        id: homeTeam?.probablePitcher?.id || null,
        fullName: homeTeam?.probablePitcher?.fullName || null
      }
    }
  };
}

async function getGamesForDate(date) {
  const scheduleData = await fetchScheduleForDate(date);

  const games =
    scheduleData?.dates?.flatMap((scheduleDate) =>
      (scheduleDate.games || []).map(mapGame)
    ) || [];

  return {
    ok: true,
    date,
    gameCount: games.length,
    games
  };
}

module.exports = {
  getGamesForDate
};
