require("dotenv").config();

const app = require("./app");
const { ensurePickSnapshotTable } = require("./services/pickSnapshotService");
const { ensureGradedPickResultsTable } = require("./services/pickGradingService");
const { ensureOfficialAutomationTables } = require("./services/officialAutomationService");
const { ensureCalibrationTables } = require("./services/calibrationService");
const { ensureBetPolicyTrackingTable } = require("./services/betPolicyTrackingService");

const PORT = process.env.PORT || 3000;

async function startServer() {
  await ensurePickSnapshotTable();
  await ensureGradedPickResultsTable();
  await ensureOfficialAutomationTables();
  await ensureCalibrationTables();
  await ensureBetPolicyTrackingTable();

  app.listen(PORT, () => {
    console.log(`MLB EV backend listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
