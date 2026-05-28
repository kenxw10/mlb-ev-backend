const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");

const COMPONENT_SCHEMA_VERSION = "model-components-v1";
const TRACKING_SCHEMA_VERSION = "model-component-tracking-v1";
const MODEL_WEIGHT_VERSION = "hard-coded-model-weights-v1";

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeText(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value);
}

function getReasoning(pick) {
  return pick?.reasoning || {};
}

function buildModelComponentPayload({
  pickSnapshotId,
  batchId,
  response,
  row,
  pick,
  snapshotMode,
  officialLockWindow,
  officialRunId
}) {
  const reasoning = getReasoning(pick);

  return {
    trackingSchemaVersion: TRACKING_SCHEMA_VERSION,
    componentSchemaVersion:
      reasoning?.componentSchemaVersion ||
      pick?.componentSchemaVersion ||
      COMPONENT_SCHEMA_VERSION,
    modelWeightVersion:
      reasoning?.modelWeightVersion ||
      pick?.modelWeightVersion ||
      MODEL_WEIGHT_VERSION,

    context: {
      pickSnapshotId,
      batchId,
      requestedDate: response?.date || null,
      generatedAt: response?.generatedAt || null,
      slateTimezone: response?.slateTimezone || null,
      sourceBucket: row?.sourceBucket || null,
      snapshotMode: snapshotMode || null,
      officialLockWindow: officialLockWindow || null,
      officialRunId: officialRunId || null,
      rankOverall: row?.rankOverall ?? null,
      rankWithinBucket: row?.rankWithinBucket ?? null
    },

    pick: {
      marketType: pick?.marketType || null,
      matchup: pick?.matchup || null,
      gamePk: pick?.gamePk || null,
      scheduledEasternDate: pick?.scheduledEasternDate || null,
      scheduledEasternTime: pick?.scheduledEasternTime || null,
      sportsbook: pick?.sportsbook || null,
      selection: pick?.selection || pick?.team || null,
      side: pick?.side || null,
      line: pick?.line ?? null,
      price: pick?.price ?? null,
      modelProbability: pick?.modelProbability ?? null,
      impliedProbability: pick?.impliedProbability ?? null,
      fairOdds: pick?.fairOdds ?? null,
      edge: pick?.edge ?? null,
      expectedValue: pick?.expectedValue ?? null,
      confidence: pick?.confidence || null,
      dataQualityScore: pick?.dataQualityScore ?? null,
      isActionable: pick?.isActionable ?? null,
      recommendedUnits: pick?.recommendedUnits ?? null,
      stakingTier: pick?.stakingTier || null,
      stakeRecommendationVersion: pick?.stakeRecommendationVersion || null,
      betEligible: pick?.betEligible ?? null,
      betEligibilityReason: pick?.betEligibilityReason || null
    },

    versions: {
      starterRecentFormVersion: reasoning?.starterRecentFormVersion || null,
      calibrationVersion:
        pick?.calibrationVersion ||
        pick?.calibrationProfileVersion ||
        pick?.calibration?.profileVersion ||
        null,
      stakeRecommendationVersion: pick?.stakeRecommendationVersion || null,
      modelWeightVersion:
        reasoning?.modelWeightVersion ||
        pick?.modelWeightVersion ||
        MODEL_WEIGHT_VERSION
    },

    componentEdges: {
      offenseEdge: reasoning?.offenseEdge ?? null,
      teamPitchingEdge: reasoning?.teamPitchingEdge ?? null,
      starterEdge: reasoning?.starterEdge ?? null,
      starterRecentAdjustmentEdge: reasoning?.starterRecentAdjustmentEdge ?? null
    },

    componentScores: {
      fromReasoning: reasoning?.componentScores || null,
      starter: {
        awaySeasonScore: reasoning?.awayStarterSeasonScore ?? null,
        homeSeasonScore: reasoning?.homeStarterSeasonScore ?? null,
        awayRecentScore: reasoning?.awayStarterRecentScore ?? null,
        homeRecentScore: reasoning?.homeStarterRecentScore ?? null,
        awayRecentAdjustment: reasoning?.awayStarterRecentAdjustment ?? null,
        homeRecentAdjustment: reasoning?.homeStarterRecentAdjustment ?? null,
        awayRecentSampleWeight: reasoning?.awayStarterRecentSampleWeight ?? null,
        homeRecentSampleWeight: reasoning?.homeStarterRecentSampleWeight ?? null
      }
    },

    componentInputs: {
      fromReasoning: reasoning?.componentInputs || null,
      fromPick: pick?.modelComponents || pick?.componentInputs || null
    },

    dataQuality: pick?.dataQuality || reasoning?.dataQuality || null,
    reasoning,
    rawPick: pick
  };
}

function classifyMetricPath(path) {
  const lower = path.toLowerCase();

  let side = null;
  if (lower.includes(".away") || lower.includes("awaystarter")) side = "away";
  if (lower.includes(".home") || lower.includes("homestarter")) side = "home";

  let component = null;
  if (lower.includes("starter") || lower.includes("pitcher")) component = "starter";
  else if (lower.includes("offense") || lower.includes("hitting")) component = "offense";
  else if (lower.includes("teampitching") || lower.includes("bullpen") || lower.includes("pitching")) component = "teamPitching";
  else if (lower.includes("dataquality") || lower.includes("reliability")) component = "dataQuality";
  else if (lower.includes("calibration")) component = "calibration";
  else if (lower.includes("stake")) component = "staking";

  let interval = null;
  const intervalMatch = lower.match(/last(?:3|5|7|10|14|15|30)/);
  if (intervalMatch) {
    interval = intervalMatch[0];
  }

  const group = path.split(".")[0] || null;

  return {
    metricGroup: group,
    metricSide: side,
    metricComponent: component,
    metricInterval: interval
  };
}

function flattenMetrics(value, path = "", output = []) {
  if (value === null || value === undefined) {
    return output;
  }

  if (path === "rawPick") {
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenMetrics(item, `${path}[${index}]`, output);
    });
    return output;
  }

  if (typeof value === "object") {
    for (const [key, childValue] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      flattenMetrics(childValue, nextPath, output);
    }
    return output;
  }

  const meta = classifyMetricPath(path);
  const numericValue = typeof value === "number" ? value : toNumberOrNull(value);
  const booleanValue = typeof value === "boolean" ? value : null;
  const textValue =
    numericValue === null && booleanValue === null ? normalizeText(value) : null;

  output.push({
    metricPath: path,
    ...meta,
    numericValue,
    textValue,
    booleanValue,
    jsonValue: value
  });

  return output;
}

async function ensureModelComponentTrackingTables() {
  if (!isDatabaseEnabled()) {
    return false;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS model_component_snapshots (
      id TEXT PRIMARY KEY,
      pick_snapshot_id TEXT NOT NULL UNIQUE REFERENCES pick_snapshots(id) ON DELETE CASCADE,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      requested_date DATE NULL,
      snapshot_mode TEXT NULL,
      source_bucket TEXT NULL,
      market_type TEXT NULL,
      matchup TEXT NULL,
      selection TEXT NULL,
      side TEXT NULL,
      component_schema_version TEXT NOT NULL,
      tracking_schema_version TEXT NOT NULL,
      model_weight_version TEXT NULL,
      model_probability NUMERIC NULL,
      implied_probability NUMERIC NULL,
      edge NUMERIC NULL,
      expected_value NUMERIC NULL,
      component_payload JSONB NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS model_component_metrics (
      id TEXT PRIMARY KEY,
      component_snapshot_id TEXT NOT NULL REFERENCES model_component_snapshots(id) ON DELETE CASCADE,
      pick_snapshot_id TEXT NOT NULL REFERENCES pick_snapshots(id) ON DELETE CASCADE,
      metric_path TEXT NOT NULL,
      metric_group TEXT NULL,
      metric_side TEXT NULL,
      metric_component TEXT NULL,
      metric_interval TEXT NULL,
      numeric_value NUMERIC NULL,
      text_value TEXT NULL,
      boolean_value BOOLEAN NULL,
      json_value JSONB NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(component_snapshot_id, metric_path)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_model_component_snapshots_pick_snapshot
    ON model_component_snapshots (pick_snapshot_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_model_component_snapshots_date_market
    ON model_component_snapshots (requested_date, market_type)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_model_component_metrics_path
    ON model_component_metrics (metric_path)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_model_component_metrics_component
    ON model_component_metrics (metric_component, metric_side, metric_interval)
  `);

  return true;
}

async function persistModelComponentSnapshot({
  pickSnapshotId,
  batchId,
  response,
  row,
  pick,
  snapshotMode,
  officialLockWindow,
  officialRunId
}) {
  if (!isDatabaseEnabled() || !pickSnapshotId || !pick) {
    return {
      saved: false
    };
  }

  await ensureModelComponentTrackingTables();

  const payload = buildModelComponentPayload({
    pickSnapshotId,
    batchId,
    response,
    row,
    pick,
    snapshotMode,
    officialLockWindow,
    officialRunId
  });

  const componentSnapshotId = crypto.randomUUID();

  const result = await query(
    `
      INSERT INTO model_component_snapshots (
        id,
        pick_snapshot_id,
        requested_date,
        snapshot_mode,
        source_bucket,
        market_type,
        matchup,
        selection,
        side,
        component_schema_version,
        tracking_schema_version,
        model_weight_version,
        model_probability,
        implied_probability,
        edge,
        expected_value,
        component_payload
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, $17::jsonb
      )
      ON CONFLICT (pick_snapshot_id)
      DO UPDATE SET
        captured_at = NOW(),
        requested_date = EXCLUDED.requested_date,
        snapshot_mode = EXCLUDED.snapshot_mode,
        source_bucket = EXCLUDED.source_bucket,
        market_type = EXCLUDED.market_type,
        matchup = EXCLUDED.matchup,
        selection = EXCLUDED.selection,
        side = EXCLUDED.side,
        component_schema_version = EXCLUDED.component_schema_version,
        tracking_schema_version = EXCLUDED.tracking_schema_version,
        model_weight_version = EXCLUDED.model_weight_version,
        model_probability = EXCLUDED.model_probability,
        implied_probability = EXCLUDED.implied_probability,
        edge = EXCLUDED.edge,
        expected_value = EXCLUDED.expected_value,
        component_payload = EXCLUDED.component_payload
      RETURNING id
    `,
    [
      componentSnapshotId,
      pickSnapshotId,
      response?.date || null,
      snapshotMode || null,
      row?.sourceBucket || null,
      pick?.marketType || null,
      pick?.matchup || null,
      pick?.selection || pick?.team || null,
      pick?.side || null,
      payload.componentSchemaVersion,
      payload.trackingSchemaVersion,
      payload.modelWeightVersion,
      pick?.modelProbability ?? null,
      pick?.impliedProbability ?? null,
      pick?.edge ?? null,
      pick?.expectedValue ?? null,
      JSON.stringify(payload)
    ]
  );

  const savedComponentSnapshotId = result?.rows?.[0]?.id || componentSnapshotId;
  const metrics = flattenMetrics(payload);

  await query(
    `DELETE FROM model_component_metrics WHERE pick_snapshot_id = $1`,
    [pickSnapshotId]
  );

  for (const metric of metrics) {
    await query(
      `
        INSERT INTO model_component_metrics (
          id,
          component_snapshot_id,
          pick_snapshot_id,
          metric_path,
          metric_group,
          metric_side,
          metric_component,
          metric_interval,
          numeric_value,
          text_value,
          boolean_value,
          json_value
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12::jsonb
        )
        ON CONFLICT (component_snapshot_id, metric_path)
        DO UPDATE SET
          metric_group = EXCLUDED.metric_group,
          metric_side = EXCLUDED.metric_side,
          metric_component = EXCLUDED.metric_component,
          metric_interval = EXCLUDED.metric_interval,
          numeric_value = EXCLUDED.numeric_value,
          text_value = EXCLUDED.text_value,
          boolean_value = EXCLUDED.boolean_value,
          json_value = EXCLUDED.json_value
      `,
      [
        crypto.randomUUID(),
        savedComponentSnapshotId,
        pickSnapshotId,
        metric.metricPath,
        metric.metricGroup,
        metric.metricSide,
        metric.metricComponent,
        metric.metricInterval,
        metric.numericValue,
        metric.textValue,
        metric.booleanValue,
        JSON.stringify(metric.jsonValue)
      ]
    );
  }

  return {
    saved: true,
    componentSnapshotId: savedComponentSnapshotId,
    metricCount: metrics.length
  };
}

module.exports = {
  COMPONENT_SCHEMA_VERSION,
  TRACKING_SCHEMA_VERSION,
  MODEL_WEIGHT_VERSION,
  ensureModelComponentTrackingTables,
  buildModelComponentPayload,
  flattenMetrics,
  persistModelComponentSnapshot
};
