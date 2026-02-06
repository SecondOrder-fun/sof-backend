/**
 * Sponsor Hat Auto-Minter
 * Watches StakingEligibility_Staked events and automatically mints Sponsor hats
 * 
 * Required env vars:
 * - HATS_STAKING_ELIGIBILITY: StakingEligibility contract address
 * - HATS_PROTOCOL: Hats Protocol contract address
 * - HATS_SPONSOR_HAT_ID: The Sponsor hat ID (uint256)
 * - BACKEND_PRIVATE_KEY: Private key for minting (must wear Top Hat)
 * - RPC_URL_TESTNET: Base Sepolia RPC URL
 */

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const STAKING_ELIGIBILITY_ABI = parseAbi([
  'event StakingEligibility_Staked(address staker, uint248 amount)',
]);

const HATS_ABI = parseAbi([
  'function mintHat(uint256 _hatId, address _wearer) returns (bool success)',
  'function isWearerOfHat(address _wearer, uint256 _hatId) view returns (bool)',
  'function isEligible(address _wearer, uint256 _hatId) view returns (bool)',
]);

let unwatch = null;

export async function startSponsorHatListener() {
  const stakingAddress = process.env.HATS_STAKING_ELIGIBILITY;
  const hatsAddress = process.env.HATS_PROTOCOL;
  const sponsorHatId = process.env.HATS_SPONSOR_HAT_ID;
  const privateKey = process.env.BACKEND_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL_TESTNET;

  if (!stakingAddress || !hatsAddress || !sponsorHatId) {
    console.log('[SponsorHat] Missing Hats config (HATS_STAKING_ELIGIBILITY, HATS_PROTOCOL, HATS_SPONSOR_HAT_ID), skipping listener');
    return;
  }

  if (!privateKey) {
    console.log('[SponsorHat] No BACKEND_PRIVATE_KEY, skipping auto-mint');
    return;
  }

  if (!rpcUrl) {
    console.log('[SponsorHat] No RPC_URL_TESTNET, skipping listener');
    return;
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });

  console.log(`[SponsorHat] Watching StakingEligibility at ${stakingAddress}`);
  console.log(`[SponsorHat] Will mint hat ${sponsorHatId} via ${account.address}`);

  unwatch = publicClient.watchContractEvent({
    address: stakingAddress,
    abi: STAKING_ELIGIBILITY_ABI,
    eventName: 'StakingEligibility_Staked',
    onLogs: async (logs) => {
      for (const log of logs) {
        const { staker, amount } = log.args;
        console.log(`[SponsorHat] Staked event: ${staker} staked ${amount}`);

        try {
          // Check if already wearing the hat
          const isWearer = await publicClient.readContract({
            address: hatsAddress,
            abi: HATS_ABI,
            functionName: 'isWearerOfHat',
            args: [staker, BigInt(sponsorHatId)],
          });

          if (isWearer) {
            console.log(`[SponsorHat] ${staker} already has Sponsor hat, skipping`);
            continue;
          }

          // Check eligibility
          const isEligible = await publicClient.readContract({
            address: hatsAddress,
            abi: HATS_ABI,
            functionName: 'isEligible',
            args: [staker, BigInt(sponsorHatId)],
          });

          if (!isEligible) {
            console.log(`[SponsorHat] ${staker} not eligible yet, skipping`);
            continue;
          }

          // Mint the hat
          console.log(`[SponsorHat] Minting Sponsor hat to ${staker}...`);
          const hash = await walletClient.writeContract({
            address: hatsAddress,
            abi: HATS_ABI,
            functionName: 'mintHat',
            args: [BigInt(sponsorHatId), staker],
          });

          console.log(`[SponsorHat] Minted! tx: ${hash}`);

          // Wait for confirmation
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          console.log(`[SponsorHat] Confirmed in block ${receipt.blockNumber}`);

        } catch (err) {
          console.error(`[SponsorHat] Error minting for ${staker}:`, err.message);
        }
      }
    },
    onError: (error) => {
      console.error('[SponsorHat] Watch error:', error);
    },
  });

  return unwatch;
}

export function stopSponsorHatListener() {
  if (unwatch) {
    unwatch();
    unwatch = null;
    console.log('[SponsorHat] Listener stopped');
  }
}
