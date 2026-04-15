const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");
const { getPicksForDate } = require("./picksService");
const { gradeSnapshotsForDate } = require("./pickGradingService");

const LOCK_WINDOWS = {
  early: { hour: 10, minute: 45 },
  main: { hour: 14, minute: 30 },
  late: { hour: 18, minute: 0 }
};

const MIN_MINUTES_TO_START = 45;

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

function getMatchingLockWindow(date = new Date()) {
  const parts = getEasternParts(date);

  for (const [label, config] of Object.entries(LOCK_WINDOWS)) {
    if (parts.hour === config.hour && parts.minute === config.minute) {
      return label;
    }
  }

  return null;
}

function isGradeWindow(date = new Date()) {
  const parts = getEasternParts(date);
  return parts.hour === 9 && parts.minute === 0;
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
      requested_date DATE NOT NULL UNIQUE,
      status TEXT NOT NULL,
      note TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ NULL
    )
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

  const result = await query(
    `
      INSERT INTO official_grade_runs (
        id,
        requested_date,
        status
      )
      VALUES ($1, $2, 'started')
      ON CONFLICT (requested_date) DO NOTHING
      RETURNING id
    `,
    [id, requestedDate]
  );

  return {
    inserted: Boolean(result?.rows?.length),
    id
  };
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
      totalRankedPickCount: response.totalRankedPickCount || 0,
      topOverallCount: (response.topPicksOverall || []).length
    };
  } catch (error) {
    await finishOfficialLockRun(run.id, "failed", error.message || "Official lock failed.");
    throw error;
  }
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

  if (!run.inserted) {
    return {
      ok: true,
      requestedDate,
      skipped: true,
      reason: "Official grade already exists for this date."
    };
  }

  try {
    const result = await gradeSnapshotsForDate(requestedDate, {
      snapshotMode: "official"
    });

    await finishOfficialGradeRun(
      run.id,
      "completed",
      `Graded ${result.gradedCount || 0} official picks.`
    );

    return result;
  } catch (error) {
    await finishOfficialGradeRun(run.id, "failed", error.message || "Official grading failed.");
    throw error;
  }
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
    ran: !result.skipped
  };
}

module.exports = {
  LOCK_WINDOWS,
  getEasternDateString,
  getYesterdayEasternDateString,
  runOfficialLockForDateWindow,
  runOfficialGradeForDate,
  runDueOfficialLock,
  runDueOfficialGrade,
  ensureOfficialAutomationTables
};
