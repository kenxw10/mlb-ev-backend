const { query, isDatabaseEnabled } = require("../config/db");
const {
  LOCK_WINDOWS,
  getEasternDateString,
  getYesterdayEasternDateString,
  ensureOfficialAutomationTables
} = require("./officialAutomationService");
const { getDashboardSlate } = require("./dashboardSlateService");
const { STAKE_RECOMMENDATION_VERSION } = require("./stakeRecommendationService");

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
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

function normalizeRun(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    requestedDate: formatDateValue(row.requested_date),
    lockWindow: row.lock_window || null,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

function normalizeMarketCounts(rows) {
  const base = {
    moneyline: {
      marketType: "moneyline",
      officialPickCount: 0,
      gradedCount: 0,
      pendingCount: 0
    },
    runLine: {
      marketType: "runLine",
      officialPickCount: 0,
      gradedCount: 0,
      pendingCount: 0
    },
    totals: {
      marketType: "totals",
      officialPickCount: 0,
      gradedCount: 0,
      pendingCount: 0
    }
  };

  for (const row of rows || []) {
    const marketType = row.market_type;

    if (!base[marketType]) {
      continue;
    }

    base[marketType] = {
      marketType,
      officialPickCount: toNumberOrNull(row.official_pick_count) || 0,
      gradedCount: toNumberOrNull(row.graded_count) || 0,
      pendingCount: toNumberOrNull(row.pending_count) || 0
    };
  }

  return base;
}

function buildWarnings({
  date,
  slateGameCount,
  todayLockRun,
  officialPickCount,
  pendingCount,
  failedLockRun,
  latestGradeRun
}) {
  const warnings = [];

  if (slateGameCount === 0) {
    warnings.push({
      code: "NO_SLATE_GAMES",
      severity: "info",
      message: `No MLB games were found for ${date}.`
    });
  }

  if (!todayLockRun) {
    warnings.push({
      code: "NO_OFFICIAL_LOCK_FOUND",
      severity: "warning",
      message: `No official 9 AM ET lock run was found for ${date}.`
    });
  }

  if (todayLockRun?.status === "failed" || failedLockRun?.requestedDate === date) {
    warnings.push({
      code: "OFFICIAL_LOCK_FAILED",
      severity: "error",
      message: "The official lock run failed. Check Railway logs and admin lock status."
    });
  }

  if (todayLockRun?.status === "completed" && officialPickCount === 0) {
    warnings.push({
      code: "OFFICIAL_LOCK_ZERO_PICKS",
      severity: "info",
      message:
        "The official lock completed but saved zero official picks. This can happen when no picks clear model filters."
    });
  }

  if (officialPickCount > 0 && pendingCount > 0) {
    warnings.push({
      code: "OFFICIAL_PICKS_PENDING_GRADING",
      severity: "info",
      message: `${pendingCount} official picks for ${date} are still pending grading.`
    });
  }

  if (!latestGradeRun) {
    warnings.push({
      code: "NO_GRADE_RUN_FOUND",
      severity: "info",
      message: "No official grading run has been recorded yet."
    });
  }

  return warnings;
}

async function getDashboardStatus(options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureOfficialAutomationTables();

  const date = options.date || getEasternDateString();
  const yesterdayEasternDate = getYesterdayEasternDateString();

  const [
    slateResponse,
    todayLockResult,
    latestLockResult,
    failedLockResult,
    latestGradeResult,
    yesterdayGradeResult,
    officialCountResult
  ] = await Promise.all([
    getDashboardSlate(date),
    query(
      `
        SELECT
          id,
          requested_date,
          lock_window,
          status,
          note,
          created_at,
          completed_at
        FROM official_lock_runs
        WHERE requested_date = $1::date
          AND lock_window = 'daily'
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [date]
    ),
    query(`
      SELECT
        id,
        requested_date,
        lock_window,
        status,
        note,
        created_at,
        completed_at
      FROM official_lock_runs
      ORDER BY created_at DESC
      LIMIT 1
    `),
    query(
      `
        SELECT
          id,
          requested_date,
          lock_window,
          status,
          note,
          created_at,
          completed_at
        FROM official_lock_runs
        WHERE status = 'failed'
        ORDER BY created_at DESC
        LIMIT 1
      `
    ),
    query(`
      SELECT
        id,
        requested_date,
        NULL::text AS lock_window,
        status,
        note,
        created_at,
        completed_at
      FROM official_grade_runs
      ORDER BY created_at DESC
      LIMIT 1
    `),
    query(
      `
        SELECT
          id,
          requested_date,
          NULL::text AS lock_window,
          status,
          note,
          created_at,
          completed_at
        FROM official_grade_runs
        WHERE requested_date = $1::date
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [yesterdayEasternDate]
    ),
    query(
      `
        SELECT
          ps.market_type,
          COUNT(*)::int AS official_pick_count,
          COUNT(g.snapshot_id)::int AS graded_count,
          COUNT(*) FILTER (WHERE g.snapshot_id IS NULL)::int AS pending_count
        FROM pick_snapshots ps
        LEFT JOIN graded_pick_results g
          ON g.snapshot_id = ps.id
        WHERE ps.snapshot_mode = 'official'
          AND ps.requested_date = $1::date
          AND ps.source_bucket = ANY($2::text[])
        GROUP BY ps.market_type
      `,
      [date, ["moneyline", "runLine", "totals"]]
    )
  ]);

  const todayLockRun = normalizeRun(todayLockResult?.rows?.[0] || null);
  const latestLockRun = normalizeRun(latestLockResult?.rows?.[0] || null);
  const failedLockRun = normalizeRun(failedLockResult?.rows?.[0] || null);
  const latestGradeRun = normalizeRun(latestGradeResult?.rows?.[0] || null);
  const yesterdayGradeRun = normalizeRun(yesterdayGradeResult?.rows?.[0] || null);

  const marketCounts = normalizeMarketCounts(officialCountResult?.rows || []);
  const officialPickCount =
    marketCounts.moneyline.officialPickCount +
    marketCounts.runLine.officialPickCount +
    marketCounts.totals.officialPickCount;

  const gradedCount =
    marketCounts.moneyline.gradedCount +
    marketCounts.runLine.gradedCount +
    marketCounts.totals.gradedCount;

  const pendingCount =
    marketCounts.moneyline.pendingCount +
    marketCounts.runLine.pendingCount +
    marketCounts.totals.pendingCount;

  const warnings = buildWarnings({
    date,
    slateGameCount: slateResponse.gameCount || 0,
    todayLockRun,
    officialPickCount,
    pendingCount,
    failedLockRun,
    latestGradeRun
  });

  return {
    ok: true,
    date,
    generatedAt: new Date().toISOString(),
    timezone: "America/New_York",
    backend: {
      service: "mlb-ev-backend",
      status: "ok"
    },
    automation: {
      lockWindows: LOCK_WINDOWS,
      officialLock: {
        targetDate: date,
        todayRun: todayLockRun,
        latestRun: latestLockRun,
        latestFailedRun: failedLockRun
      },
      officialGrade: {
        expectedPreviousDate: yesterdayEasternDate,
        expectedPreviousDateRun: yesterdayGradeRun,
        latestRun: latestGradeRun
      }
    },
    dataFreshness: {
      slateGeneratedAt: slateResponse.generatedAt,
      dashboardStatusGeneratedAt: new Date().toISOString()
    },
    slate: {
      date,
      gameCount: slateResponse.gameCount || 0
    },
    officialPicks: {
      date,
      officialPickCount,
      gradedCount,
      pendingCount,
      byMarket: marketCounts
    },
    versions: {
      modelVersion: process.env.MLB_MODEL_VERSION || "mlb-model-v1",
      calibrationLayer: "market_platt_v1",
      stakeRecommendationVersion: STAKE_RECOMMENDATION_VERSION,
      oddsBooks: process.env.ODDS_API_BOOKMAKERS || "draftkings,fanduel"
    },
    warnings
  };
}

module.exports = {
  getDashboardStatus
};

