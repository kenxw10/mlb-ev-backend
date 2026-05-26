const { query, isDatabaseEnabled } = require("../config/db");
const { DASHBOARD_HISTORY_START_DATE } = require("./dashboardPerformanceService");

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function roundNumber(value, decimals = 4) {
  const numericValue = toNumberOrNull(value);

  if (numericValue === null) {
    return 0;
  }

  return Number(numericValue.toFixed(decimals));
}

function formatDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function isValidMonth(value) {
  return /^\d{4}-\d{2}$/.test(value || "");
}

function getMonthBounds(month) {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(end.getUTCDate() - 1);

  return {
    monthStart: start.toISOString().slice(0, 10),
    monthEnd: end.toISOString().slice(0, 10)
  };
}

function buildMonthDays(month) {
  const { monthStart, monthEnd } = getMonthBounds(month);
  const days = [];
  const current = new Date(`${monthStart}T00:00:00Z`);
  const end = new Date(`${monthEnd}T00:00:00Z`);

  while (current <= end) {
    const date = current.toISOString().slice(0, 10);

    days.push({
      date,
      dayOfMonth: current.getUTCDate(),
      weekdayIndex: current.getUTCDay(),
      officialPickCount: 0,
      gradedPickCount: 0,
      pendingPickCount: 0,
      winCount: 0,
      lossCount: 0,
      pushCount: 0,
      record: "0-0-0",
      flatProfitUnits: 0,
      recommendedProfitUnits: 0,
      recommendedUnitsStaked: 0
    });

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}

function normalizeCalendarRow(row) {
  const winCount = toNumberOrNull(row.win_count) || 0;
  const lossCount = toNumberOrNull(row.loss_count) || 0;
  const pushCount = toNumberOrNull(row.push_count) || 0;

  return {
    date: formatDateValue(row.requested_date),
    officialPickCount: toNumberOrNull(row.official_pick_count) || 0,
    gradedPickCount: toNumberOrNull(row.graded_pick_count) || 0,
    pendingPickCount: toNumberOrNull(row.pending_pick_count) || 0,
    winCount,
    lossCount,
    pushCount,
    record: `${winCount}-${lossCount}-${pushCount}`,
    flatProfitUnits: roundNumber(row.flat_profit_units, 4),
    recommendedProfitUnits: roundNumber(row.recommended_profit_units, 4),
    recommendedUnitsStaked: roundNumber(row.recommended_units_staked, 4)
  };
}

function mergeRowsIntoDays(days, rows) {
  const dayMap = new Map(days.map((day) => [day.date, day]));

  for (const row of rows) {
    const normalized = normalizeCalendarRow(row);
    const existing = dayMap.get(normalized.date);

    if (!existing) {
      continue;
    }

    Object.assign(existing, normalized);
  }

  return days;
}

function summarizeDays(days) {
  return days.reduce(
    (summary, day) => {
      summary.officialPickCount += day.officialPickCount;
      summary.gradedPickCount += day.gradedPickCount;
      summary.pendingPickCount += day.pendingPickCount;
      summary.winCount += day.winCount;
      summary.lossCount += day.lossCount;
      summary.pushCount += day.pushCount;
      summary.flatProfitUnits += day.flatProfitUnits;
      summary.recommendedProfitUnits += day.recommendedProfitUnits;
      summary.recommendedUnitsStaked += day.recommendedUnitsStaked;

      return summary;
    },
    {
      officialPickCount: 0,
      gradedPickCount: 0,
      pendingPickCount: 0,
      winCount: 0,
      lossCount: 0,
      pushCount: 0,
      record: "0-0-0",
      flatProfitUnits: 0,
      recommendedProfitUnits: 0,
      recommendedUnitsStaked: 0
    }
  );
}

async function getDashboardMonthlyCalendar(options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  const month = options.month;

  if (!isValidMonth(month)) {
    return {
      ok: false,
      error: "Valid month query parameter is required in YYYY-MM format."
    };
  }

  const { monthStart, monthEnd } = getMonthBounds(month);
  const startDate =
    DASHBOARD_HISTORY_START_DATE > monthStart
      ? DASHBOARD_HISTORY_START_DATE
      : monthStart;

  const days = buildMonthDays(month);

  const result = await query(
    `
      SELECT
        ps.requested_date,
        COUNT(*)::int AS official_pick_count,
        COUNT(g.snapshot_id)::int AS graded_pick_count,
        COUNT(*) FILTER (WHERE g.snapshot_id IS NULL)::int AS pending_pick_count,
        COUNT(*) FILTER (WHERE g.outcome = 'win')::int AS win_count,
        COUNT(*) FILTER (WHERE g.outcome = 'loss')::int AS loss_count,
        COUNT(*) FILTER (WHERE g.outcome = 'push')::int AS push_count,
        COALESCE(SUM(g.profit_units), 0)::numeric AS flat_profit_units,
        COALESCE(
          SUM(
            CASE
              WHEN ps.recommended_units IS NOT NULL
                AND ps.recommended_units > 0
                AND g.profit_units IS NOT NULL
              THEN ps.recommended_units * g.profit_units
              ELSE 0
            END
          ),
          0
        )::numeric AS recommended_profit_units,
        COALESCE(
          SUM(
            CASE
              WHEN ps.recommended_units IS NOT NULL
                AND ps.recommended_units > 0
                AND g.snapshot_id IS NOT NULL
              THEN ps.recommended_units
              ELSE 0
            END
          ),
          0
        )::numeric AS recommended_units_staked
      FROM pick_snapshots ps
      LEFT JOIN graded_pick_results g
        ON g.snapshot_id = ps.id
      WHERE ps.snapshot_mode = 'official'
        AND ps.source_bucket = ANY($3::text[])
        AND ps.requested_date >= $1::date
        AND ps.requested_date <= $2::date
      GROUP BY ps.requested_date
      ORDER BY ps.requested_date ASC
    `,
    [startDate, monthEnd, ["moneyline", "runLine"]]
  );

  const mergedDays = mergeRowsIntoDays(days, result?.rows || []);
  const monthSummary = summarizeDays(mergedDays);
  monthSummary.record = `${monthSummary.winCount}-${monthSummary.lossCount}-${monthSummary.pushCount}`;
  monthSummary.flatProfitUnits = roundNumber(monthSummary.flatProfitUnits, 4);
  monthSummary.recommendedProfitUnits = roundNumber(monthSummary.recommendedProfitUnits, 4);
  monthSummary.recommendedUnitsStaked = roundNumber(monthSummary.recommendedUnitsStaked, 4);

  return {
    ok: true,
    month,
    monthStart,
    monthEnd,
    dashboardHistoryStartDate: DASHBOARD_HISTORY_START_DATE,
    generatedAt: new Date().toISOString(),
    basis: {
      officialOnly: true,
      flatUnitAssumption: "1 unit on every official locked pick",
      recommendedUnitAssumption:
        "Recommended-unit profit uses the backend recommendedUnits field for each official pick."
    },
    summary: monthSummary,
    days: mergedDays
  };
}

module.exports = {
  getDashboardMonthlyCalendar
};

