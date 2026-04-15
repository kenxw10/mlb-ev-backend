const express = require("express");
const cors = require("cors");

const gamesRoutes = require("./routes/gamesRoutes");
const picksRoutes = require("./routes/picksRoutes");
const apiKeyAuth = require("./middleware/apiKeyAuth");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "mlb-ev-backend",
    timestamp: new Date().toISOString()
  });
});

app.use("/v1/games", apiKeyAuth, gamesRoutes);
app.use("/v1/picks", apiKeyAuth, picksRoutes);

module.exports = app;
