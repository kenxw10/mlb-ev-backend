const { Pool } = require("pg");

let pool = null;

function getDbConfig() {
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
  const hasDiscreteConfig =
    Boolean(process.env.PGHOST) &&
    Boolean(process.env.PGPORT) &&
    Boolean(process.env.PGUSER) &&
    Boolean(process.env.PGPASSWORD) &&
    Boolean(process.env.PGDATABASE);

  console.log("DB DEBUG - DATABASE_URL present:", hasDatabaseUrl);
  console.log("DB DEBUG - discrete PG config present:", hasDiscreteConfig);

  if (hasDatabaseUrl) {
    return {
      connectionString: process.env.DATABASE_URL
    };
  }

  if (hasDiscreteConfig) {
    return {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE
    };
  }

  return null;
}

function isDatabaseEnabled() {
  return Boolean(getDbConfig());
}

function getPool() {
  const dbConfig = getDbConfig();

  if (!dbConfig) {
    return null;
  }

  if (!pool) {
    pool = new Pool(dbConfig);
  }

  return pool;
}

async function query(text, params = []) {
  const activePool = getPool();

  if (!activePool) {
    return null;
  }

  return activePool.query(text, params);
}

module.exports = {
  getPool,
  query,
  isDatabaseEnabled
};
