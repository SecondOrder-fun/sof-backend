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

  if (typeof startBlock === "bigint") {
    lastProcessedBlock = startBlock;
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
