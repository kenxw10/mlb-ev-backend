const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");
const { fetchMlbOdds } = require("../providers/oddsApiProvider");
const { buildMatchupKey, getEasternDateFromIso } = require("../utils/teamUtils");

const CLV_MARKETS = ["moneyline", "runLine"];
const DEFAULT_CAPTURE_TYPE = "closing_proxy";

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
    return null;
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

function parseRawJson(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  return value;
}

function americanToImpliedProbability(price) {
  const odds = toNumberOrNull(price);

  if (odds === null || odds === 0) {
    return null;
  }

  if (odds > 0) {
    return 100 / (odds + 100);
  }

  return Math.abs(odds) / (Math.abs(odds) + 100);
}

function getClvStatus(impliedProbabilityMove, currentPrice) {
  if (currentPrice === null || currentPrice === undefined) {
    return "no_current_line";
  }

  const move = toNumberOrNull(impliedProbabilityMove);

  if (move === null) {
    return "unknown";
  }

  if (move >= 0.005) {
    return "beat_close";
  }

  if (move <= -0.005) {
    return "worse_than_close";
  }

  return "flat_close";
}

function buildSnapshotMatchupKey(snapshotRow) {
  const matchup = String(snapshotRow?.matchup || "");
  const parts = matchup.split(" at ");

  if (parts.length !== 2) {
    return null;
  }

  return buildMatchupKey(parts[0], parts[1]);
}

function mapMarketFromBookmakers(bookmakers, marketKey) {
  return (bookmakers || []).flatMap((bookmaker) => {
    const market = (bookmaker.markets || []).find(
      (marketItem) => marketItem.key === marketKey
    );

    if (!market) {
      return [];
    }

    return [
      {
        bookmakerKey: bookmaker.key || null,
        bookmakerTitle: bookmaker.title || null,
        lastUpdate: bookmaker.last_update || null,
        outcomes: (market.outcomes || []).map((outcome) => ({
          name: outcome.name || null,
          price: outcome.price ?? null,
          point: outcome.point ?? null
        }))
      }
    ];
  });
}

function buildOddsMap(oddsEvents, requestedDate) {
  const oddsMap = {};

  for (const event of oddsEvents || []) {
    const eventEasternDate = getEasternDateFromIso(event.commence_time);

    if (eventEasternDate !== requestedDate) {
      continue;
    }

    const matchupKey = buildMatchupKey(event.away_team, event.home_team);

    oddsMap[matchupKey] = {
      eventId: event.id || null,
      commenceTime: event.commence_time || null,
      homeTeam: event.home_team || null,
      awayTeam: event.away_team || null,
      moneyline: mapMarketFromBookmakers(event.bookmakers, "h2h"),
      spreads: mapMarketFromBookmakers(event.bookmakers, "spreads")
    };
  }

  return oddsMap;
}

function isBetterAmericanPrice(candidatePrice, currentBestPrice) {
  const candidate = toNumberOrNull(candidatePrice);
  const current = toNumberOrNull(currentBestPrice);

  if (candidate === null) {
    return false;
  }

  if (current === null) {
    return true;
  }

  return candidate > current;
}

function findCurrentBestPrice(odds, snapshotRow) {
  if (!odds) {
    return null;
  }

  const marketType = snapshotRow.market_type;
  const selection = snapshotRow.selection;
  const line = toNumberOrNull(snapshotRow.line);
  const markets = marketType === "moneyline" ? odds.moneyline : odds.spreads;

  let best = null;

  for (const market of markets || []) {
    for (const outcome of market.outcomes || []) {
      if (outcome.name !== selection) {
        continue;
      }

      if (marketType === "runLine") {
        const outcomePoint = toNumberOrNull(outcome.point);

        if (outcomePoint === null || line === null || outcomePoint !== line) {
          continue;
        }
      }

      if (isBetterAmericanPrice(outcome.price, best?.price)) {
        best = {
          sportsbook: market.bookmakerTitle,
          bookmakerKey: market.bookmakerKey,
          price: toNumberOrNull(outcome.price),
          point: toNumberOrNull(outcome.point),
          lastUpdate: market.lastUpdate
        };
      }
    }
  }

  return best;
}

async function ensureClvLineSnapshotsTable() {
  if (!isDatabaseEnabled()) {
    return false;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS clv_line_snapshots (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL,
      requested_date DATE NOT NULL,
      market_type TEXT NOT NULL,
      capture_type TEXT NOT NULL,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      game_pk INTEGER NULL,
      matchup TEXT NULL,
      selection TEXT NULL,
      side TEXT NULL,
      line NUMERIC NULL,
      locked_sportsbook TEXT NULL,
      locked_price INTEGER NULL,
      current_sportsbook TEXT NULL,
      current_price INTEGER NULL,
      current_line NUMERIC NULL,
      locked_implied_probability NUMERIC NULL,
      current_implied_probability NUMERIC NULL,
      implied_probability_move NUMERIC NULL,
      american_price_delta INTEGER NULL,
      clv_status TEXT NOT NULL,
      raw_clv_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      UNIQUE (snapshot_id, capture_type)
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_clv_line_snapshots_requested_date
    ON clv_line_snapshots (requested_date)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_clv_line_snapshots_snapshot_id
    ON clv_line_snapshots (snapshot_id)
  `);

  return true;
}

async function getOfficialSnapshotsForClv(date) {
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
      WHERE ps.snapshot_mode = 'official'
        AND ps.requested_date = $1::date
        AND ps.source_bucket = ANY($2::text[])
      ORDER BY ps.market_type ASC, ps.rank_within_bucket ASC, ps.saved_at ASC
    `,
    [date, CLV_MARKETS]
  );

  return result?.rows || [];
}

async function upsertClvSnapshot(snapshotRow, odds, captureType) {
  const rawPick = parseRawJson(snapshotRow.raw_pick_json);
  const currentBest = findCurrentBestPrice(odds, snapshotRow);
  const lockedPrice = toNumberOrNull(snapshotRow.price);
  const currentPrice = toNumberOrNull(currentBest?.price);
  const lockedImpliedProbability = americanToImpliedProbability(lockedPrice);
  const currentImpliedProbability = americanToImpliedProbability(currentPrice);
  const impliedProbabilityMove =
    lockedImpliedProbability !== null && currentImpliedProbability !== null
      ? currentImpliedProbability - lockedImpliedProbability
      : null;

  const clvStatus = getClvStatus(impliedProbabilityMove, currentPrice);

  const rawClvJson = {
    snapshotId: snapshotRow.id,
    captureType,
    capturedAt: new Date().toISOString(),
    rawPick,
    oddsMatched: Boolean(odds),
    currentBest
  };

  const result = await query(
    `
      INSERT INTO clv_line_snapshots (
        id,
        snapshot_id,
        requested_date,
        market_type,
        capture_type,
        game_pk,
        matchup,
        selection,
        side,
        line,
        locked_sportsbook,
        locked_price,
        current_sportsbook,
        current_price,
        current_line,
        locked_implied_probability,
        current_implied_probability,
        implied_probability_move,
        american_price_delta,
        clv_status,
        raw_clv_json
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21::jsonb
      )
      ON CONFLICT (snapshot_id, capture_type) DO UPDATE
      SET captured_at = NOW(),
          current_sportsbook = CASE
            WHEN EXCLUDED.current_price IS NULL THEN clv_line_snapshots.current_sportsbook
            ELSE EXCLUDED.current_sportsbook
          END,
          current_price = CASE
            WHEN EXCLUDED.current_price IS NULL THEN clv_line_snapshots.current_price
            ELSE EXCLUDED.current_price
          END,
          current_line = CASE
            WHEN EXCLUDED.current_price IS NULL THEN clv_line_snapshots.current_line
            ELSE EXCLUDED.current_line
          END,
          locked_implied_probability = EXCLUDED.locked_implied_probability,
          current_implied_probability = CASE
            WHEN EXCLUDED.current_price IS NULL THEN clv_line_snapshots.current_implied_probability
            ELSE EXCLUDED.current_implied_probability
          END,
          implied_probability_move = CASE
            WHEN EXCLUDED.current_price IS NULL THEN clv_line_snapshots.implied_probability_move
            ELSE EXCLUDED.implied_probability_move
          END,
          american_price_delta = CASE
            WHEN EXCLUDED.current_price IS NULL THEN clv_line_snapshots.american_price_delta
            ELSE EXCLUDED.american_price_delta
          END,
          clv_status = CASE
            WHEN EXCLUDED.current_price IS NULL
              AND clv_line_snapshots.current_price IS NOT NULL
              THEN clv_line_snapshots.clv_status
            ELSE EXCLUDED.clv_status
          END,
          raw_clv_json = EXCLUDED.raw_clv_json
      RETURNING *
    `,
    [
      crypto.randomUUID(),
      snapshotRow.id,
      snapshotRow.requested_date,
      snapshotRow.market_type,
      captureType,
      Number(rawPick.gamePk) || null,
      snapshotRow.matchup,
      snapshotRow.selection,
      snapshotRow.side,
      snapshotRow.line,
      snapshotRow.sportsbook,
      lockedPrice,
      currentBest?.sportsbook || null,
      currentPrice,
      currentBest?.point ?? null,
      roundNumber(lockedImpliedProbability, 6),
      roundNumber(currentImpliedProbability, 6),
      roundNumber(impliedProbabilityMove, 6),
      currentPrice !== null && lockedPrice !== null ? currentPrice - lockedPrice : null,
      clvStatus,
      JSON.stringify(rawClvJson)
    ]
  );

  return result?.rows?.[0] || null;
}

function normalizeClvRow(row) {
  return {
    snapshotId: row.snapshot_id,
    clvSnapshotId: row.clv_snapshot_id || row.id || null,
    requestedDate: formatDateValue(row.requested_date),
    marketType: row.market_type,
    captureType: row.capture_type || DEFAULT_CAPTURE_TYPE,
    capturedAt: row.captured_at || null,
    gamePk: toNumberOrNull(row.game_pk),
    matchup: row.matchup,
    selection: row.selection,
    side: row.side,
    line: toNumberOrNull(row.line),
    lockedSportsbook: row.locked_sportsbook || row.snapshot_sportsbook || null,
    lockedPrice: toNumberOrNull(row.locked_price ?? row.snapshot_price),
    currentSportsbook: row.current_sportsbook || null,
    currentPrice: toNumberOrNull(row.current_price),
    currentLine: toNumberOrNull(row.current_line),
    lockedImpliedProbability: toNumberOrNull(row.locked_implied_probability),
    currentImpliedProbability: toNumberOrNull(row.current_implied_probability),
    impliedProbabilityMove: toNumberOrNull(row.implied_probability_move),
    americanPriceDelta: toNumberOrNull(row.american_price_delta),
    clvStatus: row.clv_status || "not_captured"
  };
}

async function getClvTrackingForDate(date, options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureClvLineSnapshotsTable();

  const captureType = options.captureType || DEFAULT_CAPTURE_TYPE;

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
        clv.id AS clv_snapshot_id,
        clv.capture_type,
        clv.captured_at,
        clv.game_pk,
        clv.locked_sportsbook,
        clv.locked_price,
        clv.current_sportsbook,
        clv.current_price,
        clv.current_line,
        clv.locked_implied_probability,
        clv.current_implied_probability,
        clv.implied_probability_move,
        clv.american_price_delta,
        clv.clv_status
      FROM pick_snapshots ps
      LEFT JOIN clv_line_snapshots clv
        ON clv.snapshot_id = ps.id
        AND clv.capture_type = $2
      WHERE ps.snapshot_mode = 'official'
        AND ps.requested_date = $1::date
        AND ps.source_bucket = ANY($3::text[])
      ORDER BY ps.market_type ASC, ps.rank_within_bucket ASC, ps.saved_at ASC
    `,
    [date, captureType, CLV_MARKETS]
  );

  const records = (result?.rows || []).map(normalizeClvRow);

  return {
    ok: true,
    date,
    captureType,
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    capturedCount: records.filter((record) => record.clvStatus !== "not_captured").length,
    beatCloseCount: records.filter((record) => record.clvStatus === "beat_close").length,
    worseThanCloseCount: records.filter((record) => record.clvStatus === "worse_than_close").length,
    flatCloseCount: records.filter((record) => record.clvStatus === "flat_close").length,
    noCurrentLineCount: records.filter((record) => record.clvStatus === "no_current_line").length,
    records
  };
}

async function captureClvForDate(date, options = {}) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureClvLineSnapshotsTable();

  const captureType = options.captureType || DEFAULT_CAPTURE_TYPE;
  const [snapshots, oddsEvents] = await Promise.all([
    getOfficialSnapshotsForClv(date),
    fetchMlbOdds()
  ]);

  const oddsMap = buildOddsMap(oddsEvents, date);
  let savedCount = 0;
  let noCurrentLineCount = 0;

  for (const snapshotRow of snapshots) {
    const matchupKey = buildSnapshotMatchupKey(snapshotRow);
    const odds = matchupKey ? oddsMap[matchupKey] : null;
    const saved = await upsertClvSnapshot(snapshotRow, odds, captureType);

    if (saved) {
      savedCount += 1;

      if (saved.clv_status === "no_current_line") {
        noCurrentLineCount += 1;
      }
    }
  }

  const tracking = await getClvTrackingForDate(date, { captureType });

  return {
    ...tracking,
    savedCount,
    noCurrentLineCount
  };
}

module.exports = {
  DEFAULT_CAPTURE_TYPE,
  ensureClvLineSnapshotsTable,
  getClvTrackingForDate,
  captureClvForDate
};


