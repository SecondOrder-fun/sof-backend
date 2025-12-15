/**
 * Query logs in chunks to avoid RPC block range limits
 * @param {import('viem').PublicClient} client - Viem public client
 * @param {Object} params - Query parameters
 * @param {string} params.address - Contract address
 * @param {Object} params.event - Event ABI definition
 * @param {bigint} params.fromBlock - Starting block
 * @param {bigint} params.toBlock - Ending block
 * @param {bigint} chunkSize - Number of blocks per chunk (default 10000)
 * @returns {Promise<Array>} Array of log entries
 */
export async function queryLogsInChunks(client, params, chunkSize = 10000n) {
  const { address, event, fromBlock, toBlock } = params;
  const allLogs = [];

  let currentBlock = fromBlock;

  while (currentBlock <= toBlock) {
    const endBlock =
      currentBlock + chunkSize - 1n > toBlock
        ? toBlock
        : currentBlock + chunkSize - 1n;

    try {
      const logs = await client.getLogs({
        address,
        event,
        fromBlock: currentBlock,
        toBlock: endBlock,
      });

      allLogs.push(...logs);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        `Failed to fetch logs for blocks ${currentBlock}-${endBlock}:`,
        error.message
      );
      // Continue with next chunk even if one fails
    }

    currentBlock = endBlock + 1n;
  }

  return allLogs;
}
