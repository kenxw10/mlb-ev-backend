const { getGamesForDate } = require("./gamesService");
const { fetchMlbOdds } = require("../providers/oddsApiProvider");
const { rankMoneylinePicks } = require("./moneylineModelService");
const { rankRunLinePicks } = require("./runLineModelService");
const { rankTotalsPicks } = require("./totalsModelService");
const { formatPicksResponse } = require("./picksFormatterService");
const {
  buildMatchupKey,
  getEasternDateFromIso
} = require("../utils/teamUtils");

function mapMarketFromBookmakers(bookmakers, marketKey) {
  return (bookmakers || []).flatMap((bookmaker) => {
    const market = (bookmaker.markets || []).find(
      (marketItem) => marketItem.key === marketKey
    );

    if (!market) {
      return [];
    }

    return [
      {
        bookmakerKey: bookmaker.key || null,
        bookmakerTitle: bookmaker.title || null,
        lastUpdate: bookmaker.last_update || null,
        outcomes: (market.outcomes || []).map((outcome) => ({
          name: outcome.name || null,
          price: outcome.price ?? null,
          point: outcome.point ?? null
        }))
      }
    ];
  });
}

function buildOddsMap(oddsEvents, requestedDate) {
  const oddsMap = {};

  for (const event of oddsEvents || []) {
    const eventEasternDate = getEasternDateFromIso(event.commence_time);

    if (eventEasternDate !== requestedDate) {
      continue;
    }

    const matchupKey = buildMatchupKey(event.away_team, event.home_team);

    oddsMap[matchupKey] = {
      eventId: event.id || null,
      sportKey: event.sport_key || null,
      commenceTime: event.commence_time || null,
      homeTeam: event.home_team || null,
      awayTeam: event.away_team || null,
      moneyline: mapMarketFromBookmakers(event.bookmakers, "h2h"),
      spreads: mapMarketFromBookmakers(event.bookmakers, "spreads"),
      totals: mapMarketFromBookmakers(event.bookmakers, "totals")
    };
  }

  return oddsMap;
}

async function getPicksForDate(date) {
  const [gamesResponse, oddsEvents] = await Promise.all([
    getGamesForDate(date),
    fetchMlbOdds()
  ]);

  const oddsMap = buildOddsMap(oddsEvents, date);

  const gamesWithOdds = (gamesResponse.games || []).map((game) => {
    const matchupKey = buildMatchupKey(
      game.awayTeam?.name,
      game.homeTeam?.name
    );

    const matchedOdds = oddsMap[matchupKey] || null;

    return {
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      status: game.status,
      awayTeam: game.awayTeam,
      homeTeam: game.homeTeam,
      oddsAvailable: Boolean(matchedOdds),
      odds: matchedOdds
    };
  });

  const oddsMatchedCount = gamesWithOdds.filter(
    (game) => game.oddsAvailable
  ).length;

  const moneylineResults = rankMoneylinePicks(gamesWithOdds);
  const runLineResults = rankRunLinePicks(gamesWithOdds);
  const totalsResults = rankTotalsPicks(gamesWithOdds);

  return formatPicksResponse({
    date,
    gameCount: gamesWithOdds.length,
    oddsMatchedCount,
    moneylineResults,
    runLineResults,
    totalsResults
  });
}

module.exports = {
  getPicksForDate
};
