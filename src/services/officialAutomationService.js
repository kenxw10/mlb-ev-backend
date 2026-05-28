const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");
const { getPicksForDate } = require("./picksService");
const { gradeSnapshotsForDate } = require("./pickGradingService");
const { maybeAutoFitEligibleMarkets } = require("./calibrationService");
const { rebuildBetPolicyTracking } = require("./betPolicyTrackingService");
const { captureClvForDate } = require("./clvTrackingService");

const LOCK_WINDOWS = {
  daily: { hour: 9, minute: 0 }
};

const MIN_MINUTES_TO_START = 45;
const EXECUTION_WINDOW_MINUTES = 14;

const CLV_CAPTURE_WINDOWS = {
  midday: { hour: 12, minute: 0 },
  afternoon: { hour: 15, minute: 0 },
  evening: { hour: 18, minute: 0 },
  late: { hour: 21, minute: 0 }
};

function getEasternParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year").value),
    month: Number(parts.find((part) => part.type === "month").value),
    day: Number(parts.find((part) => part.type === "day").value),
    hour: Number(parts.find((part) => part.type === "hour").value),
    minute: Number(parts.find((part) => part.type === "minute").value)
  };
}

function getEasternDateString(date = new Date()) {
  const parts = getEasternParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getYesterdayEasternDateString(date = new Date()) {
  const today = getEasternDateString(date);
  const utcDate = new Date(`${today}T00:00:00Z`);
  utcDate.setUTCDate(utcDate.getUTCDate() - 1);
  return utcDate.toISOString().slice(0, 10);
}

function easternMinutesOfDay(date = new Date()) {
  const parts = getEasternParts(date);
  return parts.hour * 60 + parts.minute;
}

function isWithinWindow(nowMinutes, targetHour, targetMinute) {
  const targetMinutes = targetHour * 60 + targetMinute;
  return nowMinutes >= targetMinutes && nowMinutes <= targetMinutes + EXECUTION_WINDOW_MINUTES;
}

function getMatchingLockWindow(date = new Date()) {
  const nowMinutes = easternMinutesOfDay(date);

  for (const [label, config] of Object.entries(LOCK_WINDOWS)) {
    if (isWithinWindow(nowMinutes, config.hour, config.minute)) {
      return label;
    }
  }

  return null;
}

function getMatchingClvCaptureWindow(date = new Date()) {
  const nowMinutes = easternMinutesOfDay(date);

  for (const [label, config] of Object.entries(CLV_CAPTURE_WINDOWS)) {
    if (isWithinWindow(nowMinutes, config.hour, config.minute)) {
      return label;
    }
  }

  return null;
}

function isGradeWindow(date = new Date()) {
  const nowMinutes = easternMinutesOfDay(date);
  return isWithinWindow(nowMinutes, 9, 0);
}

async function ensureOfficialAutomationTables() {
  if (!isDatabaseEnabled()) {
    return false;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS official_lock_runs (
      id TEXT PRIMARY KEY,
      requested_date DATE NOT NULL,
      lock_window TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ NULL,
      UNIQUE (requested_date, lock_window)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS official_grade_runs (
      id TEXT PRIMARY KEY,
      requested_date DATE NOT NULL,
      status TEXT NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ NULL
    )
  `);

  await query(`
    ALTER TABLE official_grade_runs
    DROP CONSTRAINT IF EXISTS official_grade_runs_requested_date_key
  `);

  return true;
}

async function startOfficialLockRun(requestedDate, lockWindow) {
  const id = crypto.randomUUID();

  const result = await query(
    `
      INSERT INTO official_lock_runs (
        id,
        requested_date,
        lock_window,
        status
      )
      VALUES ($1, $2, $3, 'started')
      ON CONFLICT (requested_date, lock_window) DO NOTHING
      RETURNING id
    `,
    [id, requestedDate, lockWindow]
  );

  return {
    inserted: Boolean(result?.rows?.length),
    id
  };
}

async function finishOfficialLockRun(id, status, note = null) {
  await query(
    `
      UPDATE official_lock_runs
      SET status = $2,
          note = $3,
          completed_at = NOW()
      WHERE id = $1
    `,
    [id, status, note]
  );
}

async function startOfficialGradeRun(requestedDate) {
  const id = crypto.randomUUID();

  await query(
    `
      INSERT INTO official_grade_runs (
        id,
        requested_date,
        status
      )
      VALUES ($1, $2, 'started')
    `,
    [id, requestedDate]
  );

  return { id };
}

async function finishOfficialGradeRun(id, status, note = null) {
  await query(
    `
      UPDATE official_grade_runs
      SET status = $2,
          note = $3,
          completed_at = NOW()
      WHERE id = $1
    `,
    [id, status, note]
  );
}

async function runOfficialLockForDateWindow(requestedDate, lockWindow) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  if (!LOCK_WINDOWS[lockWindow]) {
    return {
      ok: false,
      error: "Invalid lock window."
    };
  }

  await ensureOfficialAutomationTables();

  const run = await startOfficialLockRun(requestedDate, lockWindow);

  if (!run.inserted) {
    return {
      ok: true,
      requestedDate,
      lockWindow,
      skipped: true,
      reason: "Official lock already exists for this date and window."
    };
  }

  try {
    const response = await getPicksForDate(requestedDate, {
      persistSnapshots: true,
      snapshotMode: "official",
      officialLockWindow: lockWindow,
      officialRunId: run.id,
      minMinutesToStart: MIN_MINUTES_TO_START
    });

    await finishOfficialLockRun(
      run.id,
      "completed",
      `Saved ${response.totalRankedPickCount || 0} ranked official picks.`
    );

    return {
      ok: true,
      requestedDate,
      lockWindow,
      skipped: false,
      totalRankedPickCount: response.totalRankedPickCount || 0
    };
  } catch (error) {
    await finishOfficialLockRun(run.id, "failed", error.message || "Official lock failed.");
    throw error;
  }
}

async function forceRunOfficialLockForDateWindow(requestedDate, lockWindow, options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  if (!LOCK_WINDOWS[lockWindow]) {
    return {
      ok: false,
      error: "Invalid lock window."
    };
  }

  await ensureOfficialAutomationTables();

  const snapshotResult = await query(
    `
      SELECT
        COUNT(*)::int AS snapshot_count,
        COUNT(g.snapshot_id)::int AS graded_count
      FROM pick_snapshots ps
      LEFT JOIN graded_pick_results g
        ON g.snapshot_id = ps.id
      WHERE ps.requested_date = $1::date
        AND ps.snapshot_mode = 'official'
        AND ps.official_lock_window = $2
    `,
    [requestedDate, lockWindow]
  );

  const snapshotInfo = snapshotResult.rows?.[0] || {
    snapshot_count: 0,
    graded_count: 0
  };

  if (Number(snapshotInfo.graded_count || 0) > 0) {
    return {
      ok: false,
      requestedDate,
      lockWindow,
      skipped: true,
      reason: "Refusing forced official lock because graded official snapshots already exist.",
      snapshotInfo
    };
  }

  let deletedSnapshots = [];

  if (Number(snapshotInfo.snapshot_count || 0) > 0) {
    const allowSnapshotDelete = options.allowSnapshotDelete === true;

    if (!allowSnapshotDelete) {
      return {
        ok: false,
        requestedDate,
        lockWindow,
        skipped: true,
        reason: "Official snapshots already exist. Pass allowSnapshotDelete=true to replace ungraded snapshots.",
        snapshotInfo
      };
    }

    const deletedSnapshotResult = await query(
      `
        DELETE FROM pick_snapshots
        WHERE requested_date = $1::date
          AND snapshot_mode = 'official'
          AND official_lock_window = $2
        RETURNING id, matchup, market_type, selection
      `,
      [requestedDate, lockWindow]
    );

    deletedSnapshots = deletedSnapshotResult.rows || [];
  }

  const deletedRunResult = await query(
    `
      DELETE FROM official_lock_runs
      WHERE requested_date = $1::date
        AND lock_window = $2
      RETURNING id, requested_date, lock_window, status, note
    `,
    [requestedDate, lockWindow]
  );

  const rerunResult = await runOfficialLockForDateWindow(requestedDate, lockWindow);

  return {
    ...rerunResult,
    forced: true,
    forceReason: options.reason || null,
    before: {
      snapshotInfo,
      deletedLockRuns: deletedRunResult.rows || [],
      deletedSnapshots
    }
  };
}
async function runOfficialGradeForDate(requestedDate) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureOfficialAutomationTables();

  const run = await startOfficialGradeRun(requestedDate);

  try {
    const result = await gradeSnapshotsForDate(requestedDate, {
      snapshotMode: "official"
    });

    const autoCalibration = await maybeAutoFitEligibleMarkets();
    const betPolicyTracking = await rebuildBetPolicyTracking();

    await finishOfficialGradeRun(
      run.id,
      "completed",
      `Graded ${result.gradedCount || 0} official picks. Pending ${result.pendingCount || 0}.`
    );

    return {
      ...result,
      autoCalibration,
      betPolicyTracking
    };
  } catch (error) {
    await finishOfficialGradeRun(run.id, "failed", error.message || "Official grading failed.");
    throw error;
  }
}

async function hasCompletedOfficialLockForDate(requestedDate) {
  await ensureOfficialAutomationTables();

  const result = await query(
    `
      SELECT 1
      FROM official_lock_runs
      WHERE requested_date = $1::date
        AND status = 'completed'
      LIMIT 1
    `,
    [requestedDate]
  );

  return Boolean(result?.rows?.length);
}

async function runDueOfficialLock(now = new Date()) {
  const lockWindow = getMatchingLockWindow(now);

  if (!lockWindow) {
    return {
      ok: true,
      ran: false,
      reason: "No official lock window is due right now."
    };
  }

  const requestedDate = getEasternDateString(now);
  const result = await runOfficialLockForDateWindow(requestedDate, lockWindow);

  return {
    ...result,
    ran: !result.skipped
  };
}

async function runDueOfficialGrade(now = new Date()) {
  if (!isGradeWindow(now)) {
    return {
      ok: true,
      ran: false,
      reason: "No official grading window is due right now."
    };
  }

  const requestedDate = getYesterdayEasternDateString(now);
  const result = await runOfficialGradeForDate(requestedDate);

  return {
    ...result,
    ran: true
  };
}

async function runDueClvCapture(now = new Date()) {
  const requestedDate = getEasternDateString(now);
  const hasOfficialLock = await hasCompletedOfficialLockForDate(requestedDate);

  if (!hasOfficialLock) {
    return {
      ok: true,
      ran: false,
      requestedDate,
      reason: "No completed official lock exists for this date."
    };
  }

  const result = await captureClvForDate(requestedDate, {
    captureType: "closing_proxy",
    now
  });

  return {
    ...result,
    ran: result.ok !== false
  };
}

module.exports = {
  LOCK_WINDOWS,
  CLV_CAPTURE_WINDOWS,
  getEasternDateString,
  getYesterdayEasternDateString,
  runOfficialLockForDateWindow,
  forceRunOfficialLockForDateWindow,
  runOfficialGradeForDate,
  runDueOfficialLock,
  runDueOfficialGrade,
  runDueClvCapture,
  ensureOfficialAutomationTables
};




