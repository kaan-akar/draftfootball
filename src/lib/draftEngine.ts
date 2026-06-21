import { supabase } from './supabase';
import { phaseForRound } from './formationUtils';
import type { DraftPhase } from '../types/game';

// ─── Start draft (called by host after lobby) ────────────────────────────────
export async function startCoachDraft(roomId: string) {
  // Fetch all players in room and shuffle for random order
  const { data: roomPlayers } = await supabase
    .from('room_players')
    .select('user_id')
    .eq('room_id', roomId);
  if (!roomPlayers?.length) throw new Error('Odada oyuncu yok');

  const ids = roomPlayers.map((p) => p.user_id);
  const shuffled = [...ids].sort(() => Math.random() - 0.5);

  await supabase.from('draft_sessions').upsert({
    room_id: roomId,
    current_phase: 'coach',
    current_round: 1,
    pick_order: shuffled,
    current_picker_index: 0,
    updated_at: new Date().toISOString(),
  });

  await supabase.from('game_rooms').update({ status: 'coach_draft' }).eq('id', roomId);
}

// ─── Get current picker's user_id ───────────────────────────────────────────
export function getCurrentPicker(pickOrder: string[], round: number, indexInRound: number): string {
  const n = pickOrder.length;
  // Snake draft: even rounds go forward, odd rounds go backward (0-indexed)
  const roundIndex = round - 1;
  if (roundIndex % 2 === 0) {
    return pickOrder[indexInRound % n];
  } else {
    return pickOrder[n - 1 - (indexInRound % n)];
  }
}

// ─── Submit a pick ──────────────────────────────────────────────────────────
export async function submitPick(
  roomId: string,
  pickerId: string,
  entityId: string,
  isCoach: boolean,
  finalPrice: number,
  phase: DraftPhase,
  round: number,
) {
  // Insert pick record
  await supabase.from('draft_picks').insert({
    room_id: roomId,
    round,
    phase,
    picker_id: pickerId,
    ...(isCoach ? { coach_id: entityId } : { football_player_id: entityId }),
    pick_type: 'normal',
    final_price: finalPrice,
  });

  // Deduct budget
  const budgetField = isCoach ? 'coach_budget' : 'player_budget';
  const { data: rp } = await supabase
    .from('room_players')
    .select(budgetField)
    .eq('room_id', roomId)
    .eq('user_id', pickerId)
    .single();
  const currentBudget = (rp as any)?.[budgetField] ?? 0;
  await supabase
    .from('room_players')
    .update({ [budgetField]: currentBudget - finalPrice, ...(isCoach ? { picked_coach_id: entityId } : {}) })
    .eq('room_id', roomId)
    .eq('user_id', pickerId);

  // Advance draft session
  await advanceDraft(roomId, round, phase, isCoach);
}

// ─── Advance to next pick / phase ───────────────────────────────────────────
async function advanceDraft(roomId: string, round: number, phase: DraftPhase, isCoach: boolean) {
  const { data: session } = await supabase
    .from('draft_sessions')
    .select('*')
    .eq('room_id', roomId)
    .single();
  if (!session) return;

  const { data: roomPlayers } = await supabase
    .from('room_players')
    .select('user_id')
    .eq('room_id', roomId);
  const n = roomPlayers?.length ?? 1;

  let nextIndex = session.current_picker_index + 1;
  let nextRound = round;
  let nextPhase: DraftPhase = phase;
  let roomStatus: string | null = null;

  if (isCoach) {
    // Coach draft: 1 round, everyone picks once
    if (nextIndex >= n) {
      // Coach draft done, start player draft
      nextIndex = 0;
      nextRound = 1;
      nextPhase = 'gk';
      roomStatus = 'player_draft';
    }
  } else {
    if (nextIndex >= n) {
      // Move to next round
      nextIndex = 0;
      nextRound = round + 1;
      if (nextRound > 11) {
        // All 11 rounds done
        roomStatus = 'squad_review';
        nextPhase = 'fwd';
      } else {
        nextPhase = phaseForRound(nextRound) as DraftPhase;
      }
    }
  }

  await supabase.from('draft_sessions').update({
    current_phase: nextPhase,
    current_round: nextRound,
    current_picker_index: nextIndex,
    updated_at: new Date().toISOString(),
  }).eq('room_id', roomId);

  if (roomStatus) {
    await supabase.from('game_rooms').update({ status: roomStatus }).eq('id', roomId);
  }
}

// ─── Initiate an objection / auction ────────────────────────────────────────
export async function initiateAuction(
  roomId: string,
  initiatedBy: string,
  targetId: string,
  isCoach: boolean,
  basePrice: number,
  eligibleBidders: string[],
) {
  // Deduct 1 objection right from initiator
  const { data: rp } = await supabase
    .from('room_players')
    .select('objection_rights')
    .eq('room_id', roomId)
    .eq('user_id', initiatedBy)
    .single();
  const rights = (rp as any)?.objection_rights ?? 0;
  if (rights <= 0) throw new Error('İtiraz hakkın kalmadı');
  await supabase.from('room_players')
    .update({ objection_rights: rights - 1 })
    .eq('room_id', roomId)
    .eq('user_id', initiatedBy);

  const { data, error } = await supabase.from('auctions').insert({
    room_id: roomId,
    ...(isCoach ? { target_coach_id: targetId } : { target_player_id: targetId }),
    initiated_by: initiatedBy,
    status: 'active',
    base_price: basePrice,
    current_highest_bid: basePrice,
    current_highest_bidder: null,
    current_bidder_index: 0,
    eligible_bidders: eligibleBidders,
    bids: [],
  }).select().single();
  if (error) throw error;
  return data;
}

// ─── Submit an auction bid ───────────────────────────────────────────────────
export async function submitBid(auctionId: string, bidderId: string, amount: number) {
  const { data: auction } = await supabase
    .from('auctions')
    .select('*')
    .eq('id', auctionId)
    .single();
  if (!auction || auction.status !== 'active') throw new Error('Artırma aktif değil');
  if (amount <= auction.current_highest_bid) throw new Error('Daha yüksek teklif ver');

  const newBid = { bidderId, amount, timestamp: new Date().toISOString() };
  const updatedBids = [...(auction.bids ?? []), newBid];

  const nextIndex = (auction.current_bidder_index + 1) % auction.eligible_bidders.length;

  await supabase.from('auctions').update({
    current_highest_bid: amount,
    current_highest_bidder: bidderId,
    current_bidder_index: nextIndex,
    bids: updatedBids,
    updated_at: new Date().toISOString(),
  }).eq('id', auctionId);
}

// ─── Pass auction turn ───────────────────────────────────────────────────────
export async function passAuctionTurn(auctionId: string) {
  const { data: auction } = await supabase
    .from('auctions')
    .select('*')
    .eq('id', auctionId)
    .single();
  if (!auction || auction.status !== 'active') return;

  const nextIndex = (auction.current_bidder_index + 1) % auction.eligible_bidders.length;

  // Check if we've gone full circle back to highest bidder (or no bids at all)
  // If everyone has passed after the last bid, close the auction
  const bids: any[] = auction.bids ?? [];
  const passCount = bids.filter((b: any) => b.amount === undefined).length;
  // Simple approach: track passes in bids array
  const passBid = { bidderId: 'PASS', amount: null, timestamp: new Date().toISOString() };
  const updatedBids = [...bids, passBid];

  // Count consecutive passes since last real bid
  let consecutivePasses = 0;
  for (let i = updatedBids.length - 1; i >= 0; i--) {
    if (updatedBids[i].bidderId === 'PASS') consecutivePasses++;
    else break;
  }

  if (consecutivePasses >= auction.eligible_bidders.length) {
    // Everyone passed, close auction
    await supabase.from('auctions').update({
      status: 'finished',
      current_bidder_index: nextIndex,
      bids: updatedBids,
      updated_at: new Date().toISOString(),
    }).eq('id', auctionId);
  } else {
    await supabase.from('auctions').update({
      current_bidder_index: nextIndex,
      bids: updatedBids,
      updated_at: new Date().toISOString(),
    }).eq('id', auctionId);
  }
}
