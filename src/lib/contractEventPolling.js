/**
 * @typedef {Object} ContractEventPollingParams
 * @property {import('viem').PublicClient} client
 * @property {`0x${string}`} address
 * @property {import('viem').Abi} abi
 * @property {string} eventName
 * @property {bigint} [startBlock]
 * @property {number} [pollingIntervalMs]
 * @property {bigint} [maxBlockRange]
 * @property {(logs: any[]) => Promise<void> | void} onLogs
 * @property {(error: unknown) => void} [onError]
 * @property {{ get: () => Promise<bigint|null>, set: (block: bigint) => Promise<void> }} [blockCursor]
 */

/**
 * @param {ContractEventPollingParams} params
 * @returns {Promise<() => void>}
 */
export async function startContractEventPolling(params) {
  const {
    client,
    address,
    abi,
    eventName,
    startBlock,
    pollingIntervalMs = 4_000,
    maxBlockRange = 2_000n,
    onLogs,
    onError,
    blockCursor,
  } = params;

  if (!client) {
    throw new Error("client is required");
  }

  if (!address) {
    throw new Error("address is required");
  }

  if (!abi) {
    throw new Error("abi is required");
  }

  if (!eventName) {
    throw new Error("eventName is required");
  }

  if (typeof onLogs !== "function") {
    throw new Error("onLogs is required");
  }

  let stopped = false;
  let lastProcessedBlock;

  // Determine start block: explicit param > persisted cursor > current block
  if (typeof startBlock === "bigint") {
    lastProcessedBlock = startBlock;
  } else if (blockCursor) {
    const persisted = await blockCursor.get();
    if (persisted !== null && persisted !== undefined) {
      // Resume from the block AFTER the last fully processed one
      lastProcessedBlock = persisted + 1n;
    } else {
      const currentBlock = await client.getBlockNumber();
      lastProcessedBlock = currentBlock + 1n;
    }
  } else {
    const currentBlock = await client.getBlockNumber();
    lastProcessedBlock = currentBlock + 1n;
  }

  const tick = async () => {
    if (stopped) return;

    try {
      const currentBlock = await client.getBlockNumber();

      if (currentBlock < lastProcessedBlock) {
        return;
      }

      let fromBlock = lastProcessedBlock;
      const toBlock = currentBlock;

      while (!stopped && fromBlock <= toBlock) {
        const remaining = toBlock - fromBlock;
        const chunkSize = remaining > maxBlockRange ? maxBlockRange : remaining;
        const chunkToBlock = fromBlock + chunkSize;

        const logs = await client.getContractEvents({
          address,
          abi,
          eventName,
          fromBlock,
          toBlock: chunkToBlock,
        });

        if (logs.length > 0) {
          await onLogs(logs);
        }

        fromBlock = chunkToBlock + 1n;
      }

      lastProcessedBlock = currentBlock + 1n;

      // Persist the last fully processed block
      if (blockCursor) {
        await blockCursor.set(currentBlock);
      }
    } catch (error) {
      if (typeof onError === "function") {
        onError(error);
      }
    }
  };

  const intervalId = setInterval(() => {
    void tick();
  }, pollingIntervalMs);

  void tick();

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTransientRpcError(error) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);

  return (
    message.includes("responded with 503") ||
    message.includes("responded with 429") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET")
  );
}

/**
 * @param {number} attempt
 * @returns {number}
 */
function getBackoffMs(attempt) {
  const base = 500;
  const max = 10_000;
  const ms = base * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(ms, max);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {ContractEventPollingParams & { fromBlock: bigint, toBlock: bigint, maxRetries?: number }} params
 * @returns {Promise<any[]>}
 */
export async function getContractEventsInChunks(params) {
  const {
    client,
    address,
    abi,
    eventName,
    fromBlock,
    toBlock,
    maxBlockRange = 2_000n,
    maxRetries = 5,
  } = params;

  if (fromBlock > toBlock) return [];

  /** @type {any[]} */
  const allLogs = [];

  let currentFrom = fromBlock;
  while (currentFrom <= toBlock) {
    const remaining = toBlock - currentFrom;
    const chunkSize = remaining > maxBlockRange ? maxBlockRange : remaining;
    const currentTo = currentFrom + chunkSize;

    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const logs = await client.getContractEvents({
          address,
          abi,
          eventName,
          fromBlock: currentFrom,
          toBlock: currentTo,
        });
        allLogs.push(...logs);
        break;
      } catch (error) {
        attempt += 1;
        if (!isTransientRpcError(error) || attempt > maxRetries) {
          throw error;
        }

        await sleep(getBackoffMs(attempt));
      }
    }

    currentFrom = currentTo + 1n;
  }

  return allLogs;
}
