require("dotenv").config();

const app = require("./app");
const { ensurePickSnapshotTable } = require("./services/pickSnapshotService");

const PORT = process.env.PORT || 3000;

async function startServer() {
  await ensurePickSnapshotTable();

  app.listen(PORT, () => {
    console.log(`MLB EV backend listening on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
