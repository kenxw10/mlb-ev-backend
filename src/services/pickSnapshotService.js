const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");

async function ensurePickSnapshotTable() {
  if (!isDatabaseEnabled()) {
    return false;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS pick_snapshots (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      requested_date DATE NOT NULL,
      generated_at TIMESTAMPTZ NULL,
      slate_timezone TEXT NULL,
      source_bucket TEXT NULL,
      snapshot_mode TEXT NULL,
      official_lock_window TEXT NULL,
      official_run_id TEXT NULL,
      rank_overall INTEGER NULL,
      rank_within_bucket INTEGER NULL,
      market_type TEXT NOT NULL,
      matchup TEXT NULL,
      scheduled_eastern_date DATE NULL,
      scheduled_eastern_time TEXT NULL,
      sportsbook TEXT NULL,
      selection TEXT NULL,
      side TEXT NULL,
      line NUMERIC NULL,
      price INTEGER NULL,
      model_probability NUMERIC NULL,
      implied_probability NUMERIC NULL,
      fair_odds INTEGER NULL,
      edge NUMERIC NULL,
      expected_value NUMERIC NULL,
      confidence TEXT NULL,
      data_quality_score NUMERIC NULL,
      is_actionable BOOLEAN NULL,
      summary_reason TEXT NULL,
      pick_display TEXT NULL,
      raw_pick_json JSONB NOT NULL
    )
  `);

  await query(`ALTER TABLE pick_snapshots ADD COLUMN IF NOT EXISTS source_bucket TEXT NULL`);
  await query(`ALTER TABLE pick_snapshots ADD COLUMN IF NOT EXISTS snapshot_mode TEXT NULL`);
  await query(`ALTER TABLE pick_snapshots ADD COLUMN IF NOT EXISTS official_lock_window TEXT NULL`);
  await query(`ALTER TABLE pick_snapshots ADD COLUMN IF NOT EXISTS official_run_id TEXT NULL`);
  await query(`ALTER TABLE pick_snapshots ADD COLUMN IF NOT EXISTS rank_within_bucket INTEGER NULL`);

  return true;
}

function buildSnapshotRows(response, snapshotMode = "adhoc") {
  const rows = [];
  const byMarket = response?.byMarket || {};
  const marketBuckets = ["moneyline", "runLine", "totals"];

  if (snapshotMode !== "official") {
    const overallPicks = response?.topPicksOverall || [];
    for (let index = 0; index < overallPicks.length; index += 1) {
      rows.push({
        sourceBucket: "topPicksOverall",
        rankOverall: index + 1,
        rankWithinBucket: index + 1,
        pick: overallPicks[index]
      });
    }
  }

  for (const marketName of marketBuckets) {
    const picks = byMarket?.[marketName]?.topPicks || [];

    for (let index = 0; index < picks.length; index += 1) {
      rows.push({
        sourceBucket: marketName,
        rankOverall: null,
        rankWithinBucket: index + 1,
        pick: picks[index]
      });
    }
  }

  return rows;
}

async function persistServedPickSnapshot(response, options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      saved: false,
      reason: "DATABASE_URL not configured"
    };
  }

  const snapshotMode = options.snapshotMode || "adhoc";
  const officialLockWindow = options.officialLockWindow || null;
  const officialRunId = options.officialRunId || null;

  const rows = buildSnapshotRows(response, snapshotMode);

  if (rows.length === 0) {
    return {
      saved: true,
      count: 0
    };
  }

  const batchId = crypto.randomUUID();

  for (const row of rows) {
    const pick = row.pick || {};

    await query(
      `
        INSERT INTO pick_snapshots (
          id,
          batch_id,
          requested_date,
          generated_at,
          slate_timezone,
          source_bucket,
          snapshot_mode,
          official_lock_window,
          official_run_id,
          rank_overall,
          rank_within_bucket,
          market_type,
          matchup,
          scheduled_eastern_date,
          scheduled_eastern_time,
          sportsbook,
          selection,
          side,
          line,
          price,
          model_probability,
          implied_probability,
          fair_odds,
          edge,
          expected_value,
          confidence,
          data_quality_score,
          is_actionable,
          summary_reason,
          pick_display,
          raw_pick_json
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31::jsonb
        )
      `,
      [
        crypto.randomUUID(),
        batchId,
        response?.date || null,
        response?.generatedAt || null,
        response?.slateTimezone || null,
        row.sourceBucket,
        snapshotMode,
        officialLockWindow,
        officialRunId,
        row.rankOverall,
        row.rankWithinBucket,
        pick?.marketType || null,
        pick?.matchup || null,
        pick?.scheduledEasternDate || null,
        pick?.scheduledEasternTime || null,
        pick?.sportsbook || null,
        pick?.selection || null,
        pick?.side || null,
        pick?.line ?? null,
        pick?.price ?? null,
        pick?.modelProbability ?? null,
        pick?.impliedProbability ?? null,
        pick?.fairOdds ?? null,
        pick?.edge ?? null,
        pick?.expectedValue ?? null,
        pick?.confidence || null,
        pick?.dataQualityScore ?? null,
        pick?.isActionable ?? null,
        pick?.summaryReason || null,
        pick?.pickDisplay || null,
        JSON.stringify(pick)
      ]
    );
  }

  return {
    saved: true,
    count: rows.length,
    batchId
  };
}

module.exports = {
  ensurePickSnapshotTable,
  persistServedPickSnapshot
};
