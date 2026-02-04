import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startContractEventPolling } from "../../src/lib/contractEventPolling.js";

// Minimal ABI with a single event
const testAbi = [
  {
    type: "event",
    name: "TestEvent",
    inputs: [{ name: "value", type: "uint256", indexed: false }],
  },
];

describe("startContractEventPolling", () => {
  let mockClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = {
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getContractEvents: vi.fn().mockResolvedValue([]),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws on missing required params", async () => {
    await expect(
      startContractEventPolling({
        address: "0x1",
        abi: testAbi,
        eventName: "TestEvent",
        onLogs: () => {},
      }),
    ).rejects.toThrow("client is required");

    await expect(
      startContractEventPolling({
        client: mockClient,
        abi: testAbi,
        eventName: "TestEvent",
        onLogs: () => {},
      }),
    ).rejects.toThrow("address is required");
  });

  it("starts from current block + 1 when no startBlock or cursor", async () => {
    const onLogs = vi.fn();

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      onLogs,
    });

    // First tick runs immediately — getBlockNumber returns 100n
    // lastProcessedBlock should be 101n (currentBlock + 1), so no new blocks to fetch
    await vi.advanceTimersByTimeAsync(0);
    expect(mockClient.getContractEvents).not.toHaveBeenCalled();

    unwatch();
  });

  it("resumes from blockCursor when available", async () => {
    const onLogs = vi.fn();
    const blockCursor = {
      get: vi.fn().mockResolvedValue(50n),
      set: vi.fn().mockResolvedValue(undefined),
    };

    // Block 50 was last processed, so start from 51
    // Current block is 100
    mockClient.getBlockNumber.mockResolvedValue(100n);
    mockClient.getContractEvents.mockResolvedValue([
      { args: { value: 42n }, blockNumber: 55n },
    ]);

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs,
    });

    // Wait for the initial tick to process
    await vi.advanceTimersByTimeAsync(0);

    // Should have called getContractEvents starting from block 51
    expect(mockClient.getContractEvents).toHaveBeenCalled();
    const callArgs = mockClient.getContractEvents.mock.calls[0][0];
    expect(callArgs.fromBlock).toBe(51n);

    // onLogs should have been called with our mock log
    expect(onLogs).toHaveBeenCalledWith([
      { args: { value: 42n }, blockNumber: 55n },
    ]);

    // blockCursor.set should have been called with the latest block
    expect(blockCursor.set).toHaveBeenCalledWith(100n);

    unwatch();
  });

  it("uses explicit startBlock over blockCursor", async () => {
    const blockCursor = {
      get: vi.fn().mockResolvedValue(50n),
      set: vi.fn(),
    };

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      startBlock: 75n,
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs: vi.fn(),
    });

    // blockCursor.get should NOT have been called since explicit startBlock takes priority
    expect(blockCursor.get).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);

    // Should start from block 75
    expect(mockClient.getContractEvents).toHaveBeenCalled();
    const callArgs = mockClient.getContractEvents.mock.calls[0][0];
    expect(callArgs.fromBlock).toBe(75n);

    unwatch();
  });

  it("persists block on each successful tick", async () => {
    const blockCursor = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    mockClient.getBlockNumber
      .mockResolvedValueOnce(100n) // initial
      .mockResolvedValueOnce(100n) // first tick
      .mockResolvedValueOnce(105n); // second tick

    const unwatch = await startContractEventPolling({
      client: mockClient,
      address: "0xABC",
      abi: testAbi,
      eventName: "TestEvent",
      pollingIntervalMs: 1_000,
      blockCursor,
      onLogs: vi.fn(),
    });

    // First tick — no new blocks (starts at 101, current is 100)
    await vi.advanceTimersByTimeAsync(0);

    // Advance to second tick (current block 105)
    await vi.advanceTimersByTimeAsync(1_000);

    // blockCursor.set should have been called with 105n
    expect(blockCursor.set).toHaveBeenCalledWith(105n);

    unwatch();
  });
});
