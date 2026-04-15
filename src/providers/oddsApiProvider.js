const axios = require("axios");

const ODDS_API_BASE_URL =
  process.env.ODDS_API_BASE_URL || "https://api.the-odds-api.com/v4";

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BOOKMAKERS =
  process.env.ODDS_API_BOOKMAKERS || "draftkings,fanduel";

async function fetchMlbOdds() {
  if (!ODDS_API_KEY) {
    throw new Error("ODDS_API_KEY is not configured.");
  }

  const url = `${ODDS_API_BASE_URL}/sports/baseball_mlb/odds`;

  const response = await axios.get(url, {
    params: {
      apiKey: ODDS_API_KEY,
      bookmakers: ODDS_API_BOOKMAKERS,
      markets: "h2h,spreads,totals",
      oddsFormat: "american"
    },
    timeout: 15000
  });

  return response.data;
}

module.exports = {
  fetchMlbOdds
};
