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

async function fetchPitcherSeasonStats(personId, season) {
  if (!personId) {
    return null;
  }

  const url = `${MLB_STATS_API_BASE_URL}/people/${personId}/stats`;

  const response = await axios.get(url, {
    params: {
      stats: "season",
      group: "pitching",
      season
    },
    timeout: 15000
  });

  return response.data;
}

async function fetchTeamSeasonStats(group, season) {
  const url = `${MLB_STATS_API_BASE_URL}/teams/stats`;

  const response = await axios.get(url, {
    params: {
      stats: "season",
      group,
      season,
      sportId: 1
    },
    timeout: 15000
  });

  return response.data;
}

module.exports = {
  fetchScheduleForDate,
  fetchPitcherSeasonStats,
  fetchTeamSeasonStats
};
