function americanToDecimal(americanOdds) {
  if (americanOdds === null || americanOdds === undefined || americanOdds === 0) {
    return null;
  }

  if (americanOdds > 0) {
    return 1 + americanOdds / 100;
  }

  return 1 + 100 / Math.abs(americanOdds);
}

function americanToImpliedProbability(americanOdds) {
  if (americanOdds === null || americanOdds === undefined || americanOdds === 0) {
    return null;
  }

  if (americanOdds > 0) {
    return 100 / (americanOdds + 100);
  }

  return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
}

function probabilityToAmerican(probability) {
  if (
    probability === null ||
    probability === undefined ||
    probability <= 0 ||
    probability >= 1
  ) {
    return null;
  }

  if (probability >= 0.5) {
    return -Math.round((probability / (1 - probability)) * 100);
  }

  return Math.round(((1 - probability) / probability) * 100);
}

function expectedValue(probability, americanOdds) {
  const decimalOdds = americanToDecimal(americanOdds);

  if (decimalOdds === null || probability === null || probability === undefined) {
    return null;
  }

  return probability * decimalOdds - 1;
}

function roundNumber(value, decimals = 3) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

module.exports = {
  americanToDecimal,
  americanToImpliedProbability,
  probabilityToAmerican,
  expectedValue,
  roundNumber
};
