const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");

const COMPONENT_SCHEMA_VERSION = "model-components-v1";
const TRACKING_SCHEMA_VERSION = "model-component-tracking-v1";
const MODEL_WEIGHT_VERSION = "hard-coded-model-weights-v1";

const COMPONENT_STATUS_CATALOG = [
  {
    componentKey: "starter_recent_form",
    label: "Starter recent form",
    mode: "shadow_only",
    activeImpact: false,
    evaluationThreshold: 50,
    metricPathPatterns: ["%componentinputs.fromreasoning.starter%recentform%", "%starterrecent%"],
    notes: "Pitcher last-3 and last-5 start form is ingested and scored, but active pick impact is currently zero."
  },
  {
    componentKey: "team_recent_form",
    label: "Team recent form",
    mode: "shadow_only",
    activeImpact: false,
    evaluationThreshold: 50,
    metricPathPatterns: ["%teamrecentform%"],
    notes: "Team last-7 and last-14 hitting/offense form is ingested and tracked in shadow mode with zero active pick impact."
  },
  {
    componentKey: "bullpen_recent_form",
    label: "Bullpen recent form",
    mode: "not_started",
    activeImpact: false,
    evaluationThreshold: 75,
    metricPathPatterns: ["%bullpenrecentform%"],
    notes: "Planned shadow-tracked bullpen/team pitching recent-form and usage interval."
  },
  {
    componentKey: "handedness_splits",
    label: "Handedness splits",
    mode: "not_started",
    activeImpact: false,
    evaluationThreshold: 100,
    metricPathPatterns: ["%handedness%"],
    notes: "Planned split-based matchup context."
  },
  {
    componentKey: "weather",
    label: "Weather",
    mode: "not_started",
    activeImpact: false,
    evaluationThreshold: 100,
    metricPathPatterns: ["%weather%"],
    notes: "Planned weather and run-environment context."
  },
  {
    componentKey: "lineup_injuries",
    label: "Lineup / injuries",
    mode: "not_started",
    activeImpact: false,
    evaluationThreshold: 100,
    metricPathPatterns: ["%lineup%", "%injur%"],
    notes: "Planned lineup confirmation, scratches, and injury context."
  }
];

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
  COMPONENT_STATUS_CATALOG,

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

function buildComponentFrontendStatus(row) {
  if (row.activeImpact) {
    return {
      status: "active",
      label: "Active"
    };
  }

  if ((row.trackedPickCount || 0) <= 0) {
    return {
      status: "not_started",
      label: "Not started"
    };
  }

  if ((row.gradedPickCount || 0) >= row.evaluationThreshold) {
    return {
      status: "ready_for_evaluation",
      label: "Ready for evaluation"
    };
  }

  return {
    status: "shadow_tracking",
    label: "Shadow tracking"
  };
}

async function getModelComponentTrackingStatus() {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  const tableCheck = await query(`
    SELECT
      to_regclass('public.model_component_snapshots') AS component_snapshots_table,
      to_regclass('public.model_component_metrics') AS component_metrics_table
  `);

  const tables = tableCheck.rows?.[0] || {};
  const hasTables =
    Boolean(tables.component_snapshots_table) &&
    Boolean(tables.component_metrics_table);

  const rows = [];

  for (const component of COMPONENT_STATUS_CATALOG) {
    let trackedPickCount = 0;
    let gradedPickCount = 0;
    let lastTrackedAt = null;
    let lastGradedAt = null;

    if (hasTables) {
      const result = await query(
        `
          SELECT
            COUNT(DISTINCT mcs.pick_snapshot_id)::int AS tracked_pick_count,
            COUNT(DISTINCT CASE WHEN g.outcome IS NOT NULL THEN mcs.pick_snapshot_id END)::int AS graded_pick_count,
            MAX(mcs.captured_at) AS last_tracked_at,
            MAX(g.graded_at) AS last_graded_at
          FROM model_component_snapshots mcs
          JOIN model_component_metrics m
            ON m.component_snapshot_id = mcs.id
          LEFT JOIN graded_pick_results g
            ON g.snapshot_id = mcs.pick_snapshot_id
          WHERE mcs.snapshot_mode = 'official'
            AND lower(m.metric_path) LIKE ANY($1::text[])
        `,
        [component.metricPathPatterns]
      );

      trackedPickCount = Number(result.rows?.[0]?.tracked_pick_count || 0);
      gradedPickCount = Number(result.rows?.[0]?.graded_pick_count || 0);
      lastTrackedAt = result.rows?.[0]?.last_tracked_at || null;
      lastGradedAt = result.rows?.[0]?.last_graded_at || null;
    }

    const picksRemainingForEvaluation = Math.max(
      component.evaluationThreshold - gradedPickCount,
      0
    );
    const frontendStatus = buildComponentFrontendStatus({
      ...component,
      trackedPickCount,
      gradedPickCount
    });

    rows.push({
      componentKey: component.componentKey,
      label: component.label,
      mode: component.mode,
      activeImpact: component.activeImpact,
      trackedPickCount,
      gradedPickCount,
      evaluationThreshold: component.evaluationThreshold,
      picksRemainingForEvaluation,
      frontendStatus: frontendStatus.status,
      frontendStatusLabel: frontendStatus.label,
      lastTrackedAt,
      lastGradedAt,
      notes: component.notes
    });
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    trackingSchemaVersion: TRACKING_SCHEMA_VERSION,
    modelWeightVersion: MODEL_WEIGHT_VERSION,
    evaluationBasis:
      "Official graded picks with component metrics captured at lock time.",
    tables,
    rows,
    summary: {
      trackedComponentCount: rows.filter((row) => row.trackedPickCount > 0).length,
      readyForEvaluationCount: rows.filter(
        (row) => row.frontendStatus === "ready_for_evaluation"
      ).length,
      activeComponentCount: rows.filter((row) => row.activeImpact).length
    }
  };
}
module.exports = {
  COMPONENT_SCHEMA_VERSION,
  TRACKING_SCHEMA_VERSION,
  MODEL_WEIGHT_VERSION,
  COMPONENT_STATUS_CATALOG,
  ensureModelComponentTrackingTables,
  buildModelComponentPayload,
  flattenMetrics,
  persistModelComponentSnapshot,
  getModelComponentTrackingStatus
};

