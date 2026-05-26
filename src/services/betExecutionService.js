const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");

const EXECUTION_STATUSES = new Set([
  "pending_decision",
  "placed",
  "skipped_price_moved",
  "skipped_manual",
  "book_unavailable",
  "void_cancelled"
]);

const FRONTEND_EXECUTION_MARKETS = ["moneyline", "runLine"];

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

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text ? text : null;
}

function parseRawJson(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return {};
    }
  }

  return value;
}

async function ensureBetExecutionTable() {
  if (!isDatabaseEnabled()) {
    return false;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS bet_execution_records (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL UNIQUE,
      requested_date DATE NOT NULL,
      market_type TEXT NOT NULL,
      sportsbook TEXT NULL,
      execution_status TEXT NOT NULL,
      model_locked_price INTEGER NULL,
      minimum_acceptable_odds INTEGER NULL,
      executed_price INTEGER NULL,
      available_price INTEGER NULL,
      executed_units NUMERIC NULL,
      skipped_reason TEXT NULL,
      notes TEXT NULL,
      decided_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw_execution_json JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_bet_execution_records_requested_date
    ON bet_execution_records (requested_date)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_bet_execution_records_snapshot_id
    ON bet_execution_records (snapshot_id)
  `);

  return true;
}

function normalizeExecutionRow(row) {
  const rawPick = parseRawJson(row.raw_pick_json);

  return {
    snapshotId: row.snapshot_id,
    executionId: row.execution_id || null,
    requestedDate: formatDateValue(row.requested_date),
    marketType: row.market_type,
    matchup: row.matchup,
    selection: row.selection,
    side: row.side,
    line: toNumberOrNull(row.line),
    sportsbook: row.execution_sportsbook || row.snapshot_sportsbook || null,
    modelLockedPrice: toNumberOrNull(row.model_locked_price ?? row.snapshot_price),
    minimumAcceptableOdds: toNumberOrNull(
      row.minimum_acceptable_odds ?? rawPick?.minimumAcceptableOdds
    ),
    executionStatus: row.execution_status || "pending_decision",
    executedPrice: toNumberOrNull(row.executed_price),
    availablePrice: toNumberOrNull(row.available_price),
    executedUnits: toNumberOrNull(row.executed_units),
    skippedReason: row.skipped_reason || null,
    notes: row.notes || null,
    decidedAt: row.decided_at || null,
    createdAt: row.execution_created_at || null,
    updatedAt: row.execution_updated_at || null
  };
}

async function getOfficialSnapshotForExecution(snapshotId) {
  const result = await query(
    `
      SELECT
        ps.id,
        ps.requested_date,
        ps.market_type,
        ps.matchup,
        ps.selection,
        ps.side,
        ps.line,
        ps.sportsbook,
        ps.price,
        ps.raw_pick_json
      FROM pick_snapshots ps
      WHERE ps.id = $1
        AND ps.snapshot_mode = 'official'
        AND ps.source_bucket = ANY($2::text[])
      LIMIT 1
    `,
    [snapshotId, FRONTEND_EXECUTION_MARKETS]
  );

  return result?.rows?.[0] || null;
}

function validateExecutionInput(input = {}) {
  const snapshotId = normalizeText(input.snapshotId || input.snapshot_id);
  const executionStatus = normalizeText(
    input.executionStatus || input.execution_status
  );

  if (!snapshotId) {
    return { ok: false, error: "snapshotId is required." };
  }

  if (!executionStatus || !EXECUTION_STATUSES.has(executionStatus)) {
    return {
      ok: false,
      error:
        "Valid executionStatus is required: pending_decision, placed, skipped_price_moved, skipped_manual, book_unavailable, void_cancelled."
    };
  }

  const executedPrice = toNumberOrNull(input.executedPrice || input.executed_price);
  const executedUnits = toNumberOrNull(input.executedUnits || input.executed_units);

  if (executionStatus === "placed" && executedPrice === null) {
    return {
      ok: false,
      error: "executedPrice is required when executionStatus is placed."
    };
  }

  if (executionStatus === "placed" && (executedUnits === null || executedUnits <= 0)) {
    return {
      ok: false,
      error: "executedUnits must be greater than 0 when executionStatus is placed."
    };
  }

  return {
    ok: true,
    snapshotId,
    executionStatus
  };
}

async function getBetExecutionRecordsForDate(date) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureBetExecutionTable();

  const result = await query(
    `
      SELECT
        ps.id AS snapshot_id,
        ps.requested_date,
        ps.market_type,
        ps.matchup,
        ps.selection,
        ps.side,
        ps.line,
        ps.sportsbook AS snapshot_sportsbook,
        ps.price AS snapshot_price,
        ps.raw_pick_json,
        er.id AS execution_id,
        er.sportsbook AS execution_sportsbook,
        er.execution_status,
        er.model_locked_price,
        er.minimum_acceptable_odds,
        er.executed_price,
        er.available_price,
        er.executed_units,
        er.skipped_reason,
        er.notes,
        er.decided_at,
        er.created_at AS execution_created_at,
        er.updated_at AS execution_updated_at
      FROM pick_snapshots ps
      LEFT JOIN bet_execution_records er
        ON er.snapshot_id = ps.id
      WHERE ps.snapshot_mode = 'official'
        AND ps.requested_date = $1::date
        AND ps.source_bucket = ANY($2::text[])
      ORDER BY ps.market_type ASC, ps.rank_within_bucket ASC, ps.saved_at ASC
    `,
    [date, FRONTEND_EXECUTION_MARKETS]
  );

  const records = (result?.rows || []).map(normalizeExecutionRow);

  return {
    ok: true,
    date,
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    records
  };
}

async function upsertBetExecutionRecord(input = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureBetExecutionTable();

  const validation = validateExecutionInput(input);

  if (!validation.ok) {
    return validation;
  }

  const snapshot = await getOfficialSnapshotForExecution(validation.snapshotId);

  if (!snapshot) {
    return {
      ok: false,
      error:
        "Official moneyline/runLine snapshot not found for snapshotId. Totals are not execution-enabled."
    };
  }

  const rawPick = parseRawJson(snapshot.raw_pick_json);
  const sportsbook = normalizeText(input.sportsbook) || snapshot.sportsbook || null;
  const modelLockedPrice = toNumberOrNull(snapshot.price);
  const minimumAcceptableOdds = toNumberOrNull(rawPick?.minimumAcceptableOdds);
  const executedPrice = toNumberOrNull(input.executedPrice || input.executed_price);
  const availablePrice = toNumberOrNull(input.availablePrice || input.available_price);
  const executedUnits = toNumberOrNull(input.executedUnits || input.executed_units);
  const skippedReason = normalizeText(input.skippedReason || input.skipped_reason);
  const notes = normalizeText(input.notes);

  const rawExecutionJson = {
    input,
    source: "manual_execution_tracking",
    recordedAt: new Date().toISOString()
  };

  const result = await query(
    `
      INSERT INTO bet_execution_records (
        id,
        snapshot_id,
        requested_date,
        market_type,
        sportsbook,
        execution_status,
        model_locked_price,
        minimum_acceptable_odds,
        executed_price,
        available_price,
        executed_units,
        skipped_reason,
        notes,
        decided_at,
        raw_execution_json
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13,
        CASE WHEN $6 = 'pending_decision' THEN NULL ELSE NOW() END,
        $14::jsonb
      )
      ON CONFLICT (snapshot_id) DO UPDATE
      SET sportsbook = EXCLUDED.sportsbook,
          execution_status = EXCLUDED.execution_status,
          model_locked_price = EXCLUDED.model_locked_price,
          minimum_acceptable_odds = EXCLUDED.minimum_acceptable_odds,
          executed_price = EXCLUDED.executed_price,
          available_price = EXCLUDED.available_price,
          executed_units = EXCLUDED.executed_units,
          skipped_reason = EXCLUDED.skipped_reason,
          notes = EXCLUDED.notes,
          decided_at = CASE
            WHEN EXCLUDED.execution_status = 'pending_decision' THEN NULL
            ELSE NOW()
          END,
          updated_at = NOW(),
          raw_execution_json = EXCLUDED.raw_execution_json
      RETURNING *
    `,
    [
      crypto.randomUUID(),
      snapshot.id,
      snapshot.requested_date,
      snapshot.market_type,
      sportsbook,
      validation.executionStatus,
      modelLockedPrice,
      minimumAcceptableOdds,
      executedPrice,
      availablePrice,
      executedUnits,
      skippedReason,
      notes,
      JSON.stringify(rawExecutionJson)
    ]
  );

  const updated = result?.rows?.[0];

  return {
    ok: true,
    snapshotId: snapshot.id,
    executionId: updated?.id || null,
    executionStatus: updated?.execution_status || validation.executionStatus,
    record: updated || null
  };
}

module.exports = {
  EXECUTION_STATUSES,
  ensureBetExecutionTable,
  getBetExecutionRecordsForDate,
  upsertBetExecutionRecord
};
