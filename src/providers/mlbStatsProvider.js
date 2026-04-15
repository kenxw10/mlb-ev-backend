const axios = require("axios");

const MLB_STATS_API_BASE_URL =
  process.env.MLB_STATS_API_BASE_URL || "https://statsapi.mlb.com/api/v1";

async function fetchScheduleForDate(date) {
  const url = `${MLB_STATS_API_BASE_URL}/schedule`;

  const response = await axios.get(url, {
    params: {
      sportId: 1,
      date,
      hydrate: "probablePitcher(note)"
    },
    timeout: 15000
  });

  return response.data;
}

module.exports = {
  fetchScheduleForDate
};
