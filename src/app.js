const express = require("express");
const cors = require("cors");

const gamesRoutes = require("./routes/gamesRoutes");
const picksRoutes = require("./routes/picksRoutes");

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

app.use("/v1/games", gamesRoutes);
app.use("/v1/picks", picksRoutes);

module.exports = app;