#!/usr/bin/env node
/* eslint-disable no-console */
// scripts/reset-local-db.js
// Resets local database when Anvil is restarted to prevent stale data

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

// Safety check: only run on local development
const isLocal = process.env.NODE_ENV !== 'production' && 
                process.env.NETWORK !== 'TESTNET' &&
                process.env.NETWORK !== 'MAINNET';

if (!isLocal && !process.argv.includes('--force')) {
  console.error('❌ This script is only for LOCAL development.');
  console.error('   Set NODE_ENV to development or use --force flag.');
  process.exit(1);
}

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Tables to clear in order (respecting foreign key constraints)
const TABLES_TO_CLEAR = [
  'infofi_positions',
  'infofi_winnings',
  'market_pricing_cache',
  'arbitrage_opportunities',
  'infofi_markets',
  'players',
  'raffles',
  'event_processing_state',
];

async function clearRedisCache() {
  console.log('\n🗑️  Clearing Redis cache...');
  
  try {
    // Use redis-cli command instead of redis package
    await execAsync('redis-cli FLUSHDB');
    console.log('✅ Redis cache cleared');
  } catch (error) {
    console.warn('⚠️  Redis clear failed (non-fatal):', error.message);
    console.log('   Continuing with database reset...');
  }
}

async function clearTable(tableName) {
  try {
    // Special handling for tables with different primary keys
    const pkColumn = tableName === 'market_pricing_cache' ? 'market_id' : 'id';
    
    const { error, count } = await supabase
      .from(tableName)
      .delete()
      .gte(pkColumn, 0); // Delete all rows (gte 0 matches everything)

    if (error) {
      // If table doesn't exist or not found in cache, that's okay
      if (error.code === '42P01' || error.message?.includes('not find the table')) {
        console.log(`⚠️  Table ${tableName} does not exist (skipping)`);
        return;
      }
      throw error;
    }

    console.log(`✅ Cleared ${tableName} (${count || 0} rows deleted)`);
  } catch (error) {
    console.error(`❌ Failed to clear ${tableName}:`, error.message);
    throw error;
  }
}

async function resetSequences() {
  console.log('\n🔄 Resetting sequences...');
  
  try {
    // Reset infofi_markets sequence
    const { error: error1 } = await supabase.rpc('reset_infofi_markets_sequence');
    if (error1 && error1.code !== '42883') { // 42883 = function does not exist
      console.warn('⚠️  Could not reset infofi_markets sequence:', error1.message);
    } else if (!error1) {
      console.log('✅ Reset infofi_markets sequence');
    }

    // Reset market_pricing_cache sequence
    const { error: error2 } = await supabase.rpc('reset_market_pricing_cache_sequence');
    if (error2 && error2.code !== '42883') {
      console.warn('⚠️  Could not reset market_pricing_cache sequence:', error2.message);
    } else if (!error2) {
      console.log('✅ Reset market_pricing_cache sequence');
    }
  } catch (error) {
    console.warn('⚠️  Sequence reset failed (non-fatal):', error.message);
  }
}

async function main() {
  console.log('\n🚀 Starting local database reset...\n');
  console.log('📋 This will clear all application data from Supabase');
  console.log('   Network:', process.env.NETWORK || 'LOCAL');
  console.log('   Supabase:', supabaseUrl);
  console.log('');

  try {
    // Clear Redis cache first
    await clearRedisCache();

    // Clear all tables in order
    console.log('\n🗑️  Clearing database tables...\n');
    for (const table of TABLES_TO_CLEAR) {
      await clearTable(table);
    }

    // Reset sequences
    await resetSequences();

    console.log('\n✅ Database reset complete!\n');
    console.log('📝 Next steps:');
    console.log('   1. Deploy contracts: npm run anvil:deploy');
    console.log('   2. Restart backend: npm run dev:backend');
    console.log('   3. Start frontend: npm run dev:frontend\n');

  } catch (error) {
    console.error('\n❌ Database reset failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

main();
