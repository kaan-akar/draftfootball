/**
 * Seed script — run once after creating Supabase schema:
 *   npx tsx scripts/seed-db.ts
 *
 * Requires .env file with EXPO_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY as fallback).
 */
import { createClient } from '@supabase/supabase-js';
import { PLAYERS, COACHES } from '../src/data/seed';
import * as dotenv from 'dotenv';
dotenv.config();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(url, key);

async function seed() {
  console.log(`Seeding ${PLAYERS.length} players and ${COACHES.length} coaches...`);

  // Clear existing data first
  await supabase.from('football_players').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('coaches').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Players — insert in batches of 50
  const playerRows = PLAYERS.map((p) => ({
    name: p.name,
    position_group: p.position_group,
    positions: p.positions,
    price: p.price,
    peak_years: p.peak_years,
    caps: p.caps,
    goals: p.goals,
    bio: p.bio,
  }));

  let playerErrors = 0;
  for (let i = 0; i < playerRows.length; i += 50) {
    const { error } = await supabase.from('football_players').insert(playerRows.slice(i, i + 50));
    if (error) { console.error(`Batch ${i / 50 + 1} error:`, error.message); playerErrors++; }
  }
  if (playerErrors === 0) console.log(`✓ ${PLAYERS.length} players inserted`);

  // Coaches
  const coachRows = COACHES.map((c) => ({
    name: c.name,
    preferred_formations: c.preferred_formations,
    price: c.price,
    style: c.style,
    bio: c.bio,
  }));
  const { error: ce } = await supabase.from('coaches').insert(coachRows);
  if (ce) { console.error('Coaches error:', ce.message); }
  else { console.log(`✓ ${COACHES.length} coaches inserted`); }

  console.log('Seeding complete!');
}

seed().catch(console.error);
