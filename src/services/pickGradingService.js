const crypto = require("crypto");
const { query, isDatabaseEnabled } = require("../config/db");
const { fetchScheduleForDate } = require("../providers/mlbStatsProvider");
const { getEasternDateFromIso } = require("../utils/teamUtils");
const { americanToDecimal } = require("../utils/oddsUtils");

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseRawPickJson(rawValue) {
  if (!rawValue) {
    return {};
  }

  if (typeof rawValue === "string") {
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      return {};
    }
  }

  return rawValue;
}

function isFinalGame(game) {
  const status = String(game?.status?.detailedState || "").toLowerCase();

  return (
    status.includes("final") ||
    status.includes("game over") ||
    status.includes("completed early")
  );
}

function buildFinalGameMap(requestedDate, scheduleData) {
  const rawGames =
    scheduleData?.dates?.flatMap((scheduleDate) => scheduleDate.games || []) || [];

  const finalGames = rawGames.filter(
    (game) =>
      getEasternDateFromIso(game.gameDate) === requestedDate &&
      isFinalGame(game)
  );

  const gameMap = new Map();

  for (const game of finalGames) {
    gameMap.set(Number(game.gamePk), {
      gamePk: Number(game.gamePk),
      awayTeamName: game?.teams?.away?.team?.name || null,
      homeTeamName: game?.teams?.home?.team?.name || null,
      awayScore: toNumberOrNull(game?.teams?.away?.score),
      homeScore: toNumberOrNull(game?.teams?.home?.score),
      status: game?.status?.detailedState || null
    });
  }

  return gameMap;
}

function getSelectionRole(selection, finalGame) {
  if (selection === finalGame.awayTeamName) {
    return "away";
  }

  if (selection === finalGame.homeTeamName) {
    return "home";
  }

  return null;
}

function getProfitUnits(price, outcome) {
  const numericPrice = toNumberOrNull(price);

  if (outcome === "push") {
    return 0;
  }

  if (outcome === "loss") {
    return -1;
  }

  if (outcome !== "win" || numericPrice === null) {
    return null;
  }

  const decimalOdds = americanToDecimal(numericPrice);

  if (decimalOdds === null) {
    return null;
  }

  return Number((decimalOdds - 1).toFixed(4));
}

function gradeMoneyline(snapshot, finalGame) {
  const selectionRole = getSelectionRole(snapshot.selection, finalGame);

  if (!selectionRole) {
    return null;
  }

  const awayScore = finalGame.awayScore;
  const homeScore = finalGame.homeScore;

  let outcome = "loss";

  if (
    (selectionRole === "away" && awayScore > homeScore) ||
    (selectionRole === "home" && homeScore > awayScore)
  ) {
    outcome = "win";
  }

  return {
    outcome,
    profitUnits: getProfitUnits(snapshot.price, outcome)
  };
}

function gradeRunLine(snapshot, finalGame) {
  const selectionRole = getSelectionRole(snapshot.selection, finalGame);

  if (!selectionRole) {
    return null;
  }

  const line = toNumberOrNull(snapshot.line);

  if (line === null) {
    return null;
  }

  const teamMargin =
    selectionRole === "away"
      ? finalGame.awayScore - finalGame.homeScore
      : finalGame.homeScore - finalGame.awayScore;

  const adjustedMargin = teamMargin + line;

  let outcome = "loss";

  if (adjustedMargin > 0) {
    outcome = "win";
  } else if (adjustedMargin === 0) {
    outcome = "push";
  }

  return {
    outcome,
    profitUnits: getProfitUnits(snapshot.price, outcome)
  };
}

function gradeTotals(snapshot, finalGame) {
  const side = String(snapshot.side || "").toLowerCase();
  const line = toNumberOrNull(snapshot.line);

  if (!side || line === null) {
    return null;
  }

  const totalRuns = finalGame.awayScore + finalGame.homeScore;

  let outcome = "loss";

  if (side === "over") {
    if (totalRuns > line) {
      outcome = "win";
    } else if (totalRuns === line) {
      outcome = "push";
    }
  } else if (side === "under") {
    if (totalRuns < line) {
      outcome = "win";
    } else if (totalRuns === line) {
      outcome = "push";
    }
  } else {
    return null;
  }

  return {
    outcome,
    profitUnits: getProfitUnits(snapshot.price, outcome)
  };
}

function gradeSnapshot(snapshot, finalGame) {
  if (!finalGame) {
    return null;
  }

  if (snapshot.marketType === "moneyline") {
    return gradeMoneyline(snapshot, finalGame);
  }

  if (snapshot.marketType === "runLine") {
    return gradeRunLine(snapshot, finalGame);
  }

  if (snapshot.marketType === "totals") {
    return gradeTotals(snapshot, finalGame);
  }

  return null;
}

async function ensureGradedPickResultsTable() {
  if (!isDatabaseEnabled()) {
    return false;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS graded_pick_results (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL UNIQUE,
      graded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      requested_date DATE NOT NULL,
      game_pk INTEGER NULL,
      market_type TEXT NOT NULL,
      selection TEXT NULL,
      side TEXT NULL,
      line NUMERIC NULL,
      sportsbook TEXT NULL,
      price INTEGER NULL,
      away_team TEXT NULL,
      home_team TEXT NULL,
      away_score INTEGER NULL,
      home_score INTEGER NULL,
      outcome TEXT NOT NULL,
      profit_units NUMERIC NULL,
      raw_grade_json JSONB NOT NULL
    )
  `);

  return true;
}

async function getUngradedSnapshotsForDate(date) {
  const result = await query(
    `
      SELECT
        ps.id,
        ps.requested_date,
        ps.market_type,
        ps.selection,
        ps.side,
        ps.line,
        ps.sportsbook,
        ps.price,
        ps.raw_pick_json
      FROM pick_snapshots ps
      LEFT JOIN graded_pick_results g
        ON g.snapshot_id = ps.id
      WHERE ps.requested_date = $1
        AND g.snapshot_id IS NULL
      ORDER BY ps.saved_at ASC, ps.rank_overall ASC
    `,
    [date]
  );

  return result?.rows || [];
}

async function insertGradedResult(snapshotRow, finalGame, gradeResult, rawPick) {
  await query(
    `
      INSERT INTO graded_pick_results (
        id,
        snapshot_id,
        requested_date,
        game_pk,
        market_type,
        selection,
        side,
        line,
        sportsbook,
        price,
        away_team,
        home_team,
        away_score,
        home_score,
        outcome,
        profit_units,
        raw_grade_json
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17::jsonb
      )
      ON CONFLICT (snapshot_id) DO NOTHING
    `,
    [
      crypto.randomUUID(),
      snapshotRow.id,
      snapshotRow.requested_date,
      finalGame.gamePk,
      snapshotRow.market_type,
      snapshotRow.selection,
      snapshotRow.side,
      snapshotRow.line,
      snapshotRow.sportsbook,
      snapshotRow.price,
      finalGame.awayTeamName,
      finalGame.homeTeamName,
      finalGame.awayScore,
      finalGame.homeScore,
      gradeResult.outcome,
      gradeResult.profitUnits,
      JSON.stringify({
        snapshotId: snapshotRow.id,
        requestedDate: snapshotRow.requested_date,
        marketType: snapshotRow.market_type,
        selection: snapshotRow.selection,
        side: snapshotRow.side,
        line: snapshotRow.line,
        sportsbook: snapshotRow.sportsbook,
        price: snapshotRow.price,
        outcome: gradeResult.outcome,
        profitUnits: gradeResult.profitUnits,
        finalGame
      })
    ]
  );
}

async function gradeSnapshotsForDate(date) {
  if (!isDatabaseEnabled()) {
    return {
      ok: false,
      error: "DATABASE_URL not configured."
    };
  }

  await ensureGradedPickResultsTable();

  const ungradedSnapshots = await getUngradedSnapshotsForDate(date);
  const scheduleData = await fetchScheduleForDate(date);
  const finalGameMap = buildFinalGameMap(date, scheduleData);

  let gradedCount = 0;
  let pendingCount = 0;
  let skippedCount = 0;

  for (const snapshotRow of ungradedSnapshots) {
    const rawPick = parseRawPickJson(snapshotRow.raw_pick_json);
    const snapshot = {
      marketType: snapshotRow.market_type || rawPick.marketType || null,
      selection: snapshotRow.selection || rawPick.selection || null,
      side: snapshotRow.side || rawPick.side || null,
      line: snapshotRow.line ?? rawPick.line ?? null,
      price: snapshotRow.price ?? rawPick.price ?? null
    };

    const gamePk = Number(rawPick.gamePk);

    if (!gamePk || !finalGameMap.has(gamePk)) {
      pendingCount += 1;
      continue;
    }

    const finalGame = finalGameMap.get(gamePk);
    const gradeResult = gradeSnapshot(snapshot, finalGame);

    if (!gradeResult) {
      skippedCount += 1;
      continue;
    }

    await insertGradedResult(snapshotRow, finalGame, gradeResult, rawPick);
    gradedCount += 1;
  }

  return {
    ok: true,
    date,
    ungradedSnapshotCount: ungradedSnapshots.length,
    finalGamesFound: finalGameMap.size,
    gradedCount,
    pendingCount,
    skippedCount
  };
}

module.exports = {
  ensureGradedPickResultsTable,
  gradeSnapshotsForDate
};
