function apiKeyAuth(req, res, next) {
  const expectedApiKey = process.env.BACKEND_API_KEY;
  const providedApiKey = req.header("X-API-Key");

  if (!expectedApiKey) {
    return res.status(500).json({
      ok: false,
      error: "Server API key is not configured."
    });
  }

  if (!providedApiKey || providedApiKey !== expectedApiKey) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized."
    });
  }

  next();
}

module.exports = apiKeyAuth;
