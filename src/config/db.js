const { Pool } = require("pg");

let pool = null;

function isDatabaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!isDatabaseEnabled()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL
    });
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
