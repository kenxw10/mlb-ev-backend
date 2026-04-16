const { query, isDatabaseEnabled } = require("../config/db");

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, decimals = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

function computeMetrics(rows) {
  const bucketMap = {
    all: rows,
    rank_1: rows.filter((row) => Number(row.rank_within_bucket) === 1),
    ranks_1_2: rows.filter((row) => Number(row.rank_within_bucket) <= 2),
    ranks_1_4: rows.filter((row) => Number(row.rank_within_bucket) <= 4)
  };

  const result = {};

  for (const [bucketName, bucketRows] of Object.entries(bucketMap)) {
    const gradedPickCount = bucketRows.length;
    const winRows = bucketRows.filter((row) => row.outcome === "win");
    const lossRows = bucketRows.filter((row) => row.outcome === "loss");
    const pushRows = bucketRows.filter((row) => row.outcome === "push");
    const binaryRows = bucketRows.filter(
      (row) => row.outcome === "win" || row.outcome === "loss"
    );

    const averageModelProbability = average(
      binaryRows
        .map((row) => toNumber(row.model_probability))
        .filter((value) => value !== null)
    );

    const averageImpliedProbability = average(
      binaryRows
        .map((row) => toNumber(row.implied_probability))
        .filter((value) => value !== null)
    );

    const totalProfitUnits = bucketRows.reduce((sum, row) => {
      const value = toNumber(row.profit_units);
      return sum + (value ?? 0);
    }, 0);

    const roiUnitsPerBet =
      binaryRows.length > 0 ? totalProfitUnits / binaryRows.length : null;

    const winRate =
      binaryRows.length > 0 ? winRows.length / binaryRows.length : null;

    const brierScore =
      binaryRows.length > 0
        ? average(
            binaryRows
              .map((row) => {
                const p = toNumber(row.model_probability);
                const y = row.outcome === "win" ? 1 : 0;

                if (p === null) {
                  return null;
                }

                return (p - y) ** 2;
              })
              .filter((value) => value !== null)
          )
        : null;

    result[bucketName] = {
      gradedPickCount,
      winCount: winRows.length,
      lossCount: lossRows.length,
      pushCount: pushRows.length,
      averageModelProbability: round(averageModelProbability, 4),
      averageImpliedProbability: round(averageImpliedProbability, 4),
      winRate: round(winRate, 4),
      roiUnitsPerBet: round(roiUnitsPerBet, 4),
      totalProfitUnits: round(totalProfitUnits, 4),
      brierScore: round(brierScore, 4)
    };
  }

  return result;
}

async function getCalibrationSummary() {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  const result = await query(`
    SELECT
      ps.market_type,
      ps.rank_within_bucket,
      ps.model_probability,
      ps.implied_probability,
      ps.source_bucket,
      g.outcome,
      g.profit_units
    FROM pick_snapshots ps
    INNER JOIN graded_pick_results g
      ON g.snapshot_id = ps.id
    WHERE COALESCE(ps.snapshot_mode, 'adhoc') = 'official'
      AND ps.source_bucket IN ('moneyline', 'runLine', 'totals')
    ORDER BY ps.saved_at ASC, ps.rank_within_bucket ASC
  `);

  const rows = result?.rows || [];

  const grouped = {
    moneyline: rows.filter((row) => row.source_bucket === "moneyline"),
    runLine: rows.filter((row) => row.source_bucket === "runLine"),
    totals: rows.filter((row) => row.source_bucket === "totals")
  };

  return {
    ok: true,
    totalGradedRows: rows.length,
    summary: {
      moneyline: computeMetrics(grouped.moneyline),
      runLine: computeMetrics(grouped.runLine),
      totals: computeMetrics(grouped.totals)
    }
  };
}

module.exports = {
  getCalibrationSummary
};
