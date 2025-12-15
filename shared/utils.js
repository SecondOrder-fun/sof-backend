// Utility functions shared between Fastify and Hono services

export function validateAddress(address) {
  if (!address) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function validateSignature(signature) {
  if (!signature) return false;
  return /^0x[a-fA-F0-9]{130}$/.test(signature);
}

export function formatResponse(data, success = true) {
  return {
    success,
    timestamp: new Date().toISOString(),
    data
  };
}

export function formatError(message, code = 'UNKNOWN_ERROR') {
  return {
    success: false,
    timestamp: new Date().toISOString(),
    error: {
      code,
      message
    }
  };
}

export function paginateResults(results, page = 1, limit = 10) {
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  
  return {
    data: results.slice(startIndex, endIndex),
    pagination: {
      page,
      limit,
      total: results.length,
      pages: Math.ceil(results.length / limit)
    }
  };
}

export function calculateHybridPrice(raftPosition, marketSentiment, weightRaft = 0.7, weightMarket = 0.3) {
  return (raftPosition * weightRaft) + (marketSentiment * weightMarket);
}

export function detectArbitrageOpportunity(raftValue, infoFiValue, threshold = 0.02) {
  const difference = Math.abs(raftValue - infoFiValue);
  const percentageDifference = difference / ((raftValue + infoFiValue) / 2);
  
  return {
    isOpportunity: percentageDifference > threshold,
    percentageDifference,
    raftValue,
    infoFiValue,
    potentialProfit: difference
  };
}

export function generateMarketId(seasonId, playerAddress, marketType) {
  return `${seasonId}-${playerAddress}-${marketType}`;
}