const { getGamesForDate } = require("./gamesService");
const { fetchMlbOdds } = require("../providers/oddsApiProvider");
const { rankMoneylinePicks } = require("./moneylineModelService");
const { rankRunLinePicks } = require("./runLineModelService");
const { rankTotalsPicks } = require("./totalsModelService");
const { formatPicksResponse } = require("./picksFormatterService");
const { persistServedPickSnapshot } = require("./pickSnapshotService");
const {
  buildMatchupKey,
  getEasternDateFromIso
} = require("../utils/teamUtils");

const ALLOWED_BOOKMAKERS = new Set(
  (process.env.ODDS_API_BOOKMAKERS || "draftkings,fanduel")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

function mapMarketFromBookmakers(bookmakers, marketKey) {
  return (bookmakers || [])
    .filter((bookmaker) =>
      ALLOWED_BOOKMAKERS.has(String(bookmaker.key || "").toLowerCase())
    )
    .flatMap((bookmaker) => {
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
      scheduledEasternDate: game.scheduledEasternDate,
      scheduledEasternTime: game.scheduledEasternTime,
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

  const response = formatPicksResponse({
    date,
    gameCount: gamesWithOdds.length,
    oddsMatchedCount,
    moneylineResults,
    runLineResults,
    totalsResults
  });

  try {
    await persistServedPickSnapshot(response);
  } catch (error) {
    console.error("Failed to persist pick snapshots:", error);
  }

  return response;
}

module.exports = {
  getPicksForDate
};
