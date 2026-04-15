const AppError = require("./AppError");

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function getTodayInEasternTime() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(new Date());

  const year = parts.find((part) => part.type === "year").value;
  const month = parts.find((part) => part.type === "month").value;
  const day = parts.find((part) => part.type === "day").value;

  return `${year}-${month}-${day}`;
}

function isValidDateString(dateString) {
  if (!DATE_REGEX.test(dateString)) {
    return false;
  }

  const [year, month, day] = dateString.split("-").map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));

  return (
    parsedDate.getUTCFullYear() === year &&
    parsedDate.getUTCMonth() === month - 1 &&
    parsedDate.getUTCDate() === day
  );
}

function normalizeDateParam(dateParam) {
  if (dateParam === undefined || dateParam === null || dateParam === "") {
    return getTodayInEasternTime();
  }

  if (typeof dateParam !== "string") {
    throw new AppError("Date must be a string in YYYY-MM-DD format.", 400);
  }

  const trimmedDate = dateParam.trim();

  if (!isValidDateString(trimmedDate)) {
    throw new AppError("Invalid date. Use YYYY-MM-DD format.", 400);
  }

  return trimmedDate;
}

module.exports = {
  getTodayInEasternTime,
  isValidDateString,
  normalizeDateParam
};
