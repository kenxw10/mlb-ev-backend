function normalizeTeamName(teamName) {
  return String(teamName || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMatchupKey(awayTeamName, homeTeamName) {
  return `${normalizeTeamName(awayTeamName)}__${normalizeTeamName(homeTeamName)}`;
}

function getEasternDateFromIso(isoString) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(new Date(isoString));

  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  const day = parts.find((part) => part.type === "day").value;

  return `${year}-${month}-${day}`;
}

function getEasternTimeFromIso(isoString) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(isoString));
}

module.exports = {
  normalizeTeamName,
  buildMatchupKey,
  getEasternDateFromIso,
  getEasternTimeFromIso
};
