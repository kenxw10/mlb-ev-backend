const { getGamesForDate } = require("./gamesService");

function buildMlbLogoUrl(teamId) {
  if (!teamId) {
    return null;
  }

  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

function normalizePitcher(probablePitcher) {
  if (!probablePitcher) {
    return {
      id: null,
      fullName: null,
      status: "TBD",
      seasonStats: null
    };
  }

  return {
    id: probablePitcher.id || null,
    fullName: probablePitcher.fullName || null,
    status: probablePitcher.fullName ? "announced" : "TBD",
    seasonStats: probablePitcher.seasonStats || null
  };
}

function normalizeTeam(team) {
  return {
    id: team?.id || null,
    name: team?.name || null,
    abbreviation: team?.abbreviation || null,
    logoUrl: buildMlbLogoUrl(team?.id || null),
    probablePitcher: normalizePitcher(team?.probablePitcher),
    teamSeasonStats: team?.teamSeasonStats || {
      hitting: null,
      pitching: null
    }
  };
}

function normalizeSlateGame(game) {
  const awayTeam = normalizeTeam(game?.awayTeam);
  const homeTeam = normalizeTeam(game?.homeTeam);

  const awayName = awayTeam.name || "Away";
  const homeName = homeTeam.name || "Home";
  const awayAbbrev = awayTeam.abbreviation || awayName;
  const homeAbbrev = homeTeam.abbreviation || homeName;

  return {
    gamePk: game?.gamePk || null,
    gameDate: game?.gameDate || null,
    scheduledEasternDate: game?.scheduledEasternDate || null,
    scheduledEasternTime: game?.scheduledEasternTime || null,
    status: game?.status || null,
    venueName: game?.venueName || null,
    matchup: `${awayName} at ${homeName}`,
    awayTeam,
    homeTeam,
    probablePitchers: {
      away: awayTeam.probablePitcher,
      home: homeTeam.probablePitcher
    },
    frontendLabels: {
      shortMatchup: `${awayAbbrev} @ ${homeAbbrev}`,
      fullMatchup: `${awayName} at ${homeName}`,
      timeLabel: game?.scheduledEasternTime
        ? `${game.scheduledEasternTime} ET`
        : null,
      venueLabel: game?.venueName || "Venue TBD",
      starterLabel:
        `${awayTeam.probablePitcher.fullName || "TBD"} vs. ` +
        `${homeTeam.probablePitcher.fullName || "TBD"}`
    }
  };
}

async function getDashboardSlate(date) {
  const gamesResponse = await getGamesForDate(date);

  const games = (gamesResponse.games || []).map(normalizeSlateGame);

  return {
    ok: true,
    date,
    season: gamesResponse.season || date.slice(0, 4),
    generatedAt: new Date().toISOString(),
    gameCount: games.length,
    games
  };
}

module.exports = {
  getDashboardSlate
};
