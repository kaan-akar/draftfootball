import { supabase } from './supabase';
import { phaseForRound } from './formationUtils';
import type { DraftPhase } from '../types/game';

interface FinalizePickArgs {
  roomId: string;
  pickerId: string;
  entityId: string;
  isCoach: boolean;
  finalPrice: number;
  phase: DraftPhase;
  round: number;
  pickType: 'normal' | 'auction_won';
}

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
async function finalizePick({
  roomId,
  pickerId,
  entityId,
  isCoach,
  finalPrice,
  phase,
  round,
  pickType,
}: FinalizePickArgs) {
  await supabase.from('draft_picks').insert({
    room_id: roomId,
    round,
    phase,
    picker_id: pickerId,
    ...(isCoach ? { coach_id: entityId } : { football_player_id: entityId }),
    pick_type: pickType,
    final_price: finalPrice,
  });

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

  await advanceDraft(roomId, round, phase, isCoach);
}

export async function createPendingPick(
  roomId: string,
  pickerId: string,
  entityId: string,
  isCoach: boolean,
  finalPrice: number,
  phase: DraftPhase,
  round: number,
  eligibleObjectors: string[],
) {
  const { data: existingPending } = await supabase
    .from('pending_picks')
    .select('id')
    .eq('room_id', roomId)
    .in('status', ['active', 'auctioning'])
    .maybeSingle();
  if (existingPending) throw new Error('Önce mevcut seçim çözülmeli');

  const uniqueObjectors = [...new Set(eligibleObjectors.filter((userId) => userId !== pickerId))];

  if (uniqueObjectors.length === 0) {
    await finalizePick({
      roomId,
      pickerId,
      entityId,
      isCoach,
      finalPrice,
      phase,
      round,
      pickType: 'normal',
    });
    return null;
  }

  const { data, error } = await supabase.from('pending_picks').insert({
    room_id: roomId,
    picker_id: pickerId,
    round,
    phase,
    ...(isCoach ? { coach_id: entityId } : { football_player_id: entityId }),
    final_price: finalPrice,
    status: 'active',
    eligible_objectors: uniqueObjectors,
    passed_by: [],
  }).select().single();
  if (error) throw error;
  return data;
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
  pendingPickId: string,
  initiatedBy: string,
  eligibleBidders: string[],
) {
  const { data: pendingPick } = await supabase
    .from('pending_picks')
    .select('*')
    .eq('id', pendingPickId)
    .single();
  if (!pendingPick || pendingPick.status !== 'active') throw new Error('İtiraz edilecek aktif seçim yok');
  if (!pendingPick.eligible_objectors?.includes(initiatedBy)) throw new Error('Bu seçime itiraz edemezsin');

  const { data: rp } = await supabase
    .from('room_players')
    .select('objection_rights')
    .eq('room_id', pendingPick.room_id)
    .eq('user_id', initiatedBy)
    .single();
  const rights = (rp as any)?.objection_rights ?? 0;
  if (rights <= 0) throw new Error('İtiraz hakkın kalmadı');
  await supabase.from('room_players')
    .update({ objection_rights: rights - 1 })
    .eq('room_id', pendingPick.room_id)
    .eq('user_id', initiatedBy);

  const orderedBidders = [
    pendingPick.picker_id,
    ...eligibleBidders.filter((userId) => userId !== pendingPick.picker_id),
  ];

  await supabase.from('pending_picks').update({
    status: 'auctioning',
    updated_at: new Date().toISOString(),
  }).eq('id', pendingPickId);

  const { data, error } = await supabase.from('auctions').insert({
    room_id: pendingPick.room_id,
    pending_pick_id: pendingPickId,
    ...(pendingPick.coach_id
      ? { target_coach_id: pendingPick.coach_id }
      : { target_player_id: pendingPick.football_player_id }),
    initiated_by: initiatedBy,
    status: 'active',
    base_price: pendingPick.final_price,
    current_highest_bid: pendingPick.final_price,
    current_highest_bidder: pendingPick.picker_id,
    current_bidder_index: orderedBidders.length > 1 ? 1 : 0,
    eligible_bidders: orderedBidders,
    passed_bidders: [],
    bids: [],
  }).select().single();
  if (error) throw error;
  return data;
}

export async function passPendingPick(pendingPickId: string, userId: string) {
  const { data: pendingPick } = await supabase
    .from('pending_picks')
    .select('*')
    .eq('id', pendingPickId)
    .single();
  if (!pendingPick || pendingPick.status !== 'active') return;
  if (!pendingPick.eligible_objectors?.includes(userId)) return;

  const passedBy = [...new Set([...(pendingPick.passed_by ?? []), userId])];
  const everyonePassed = pendingPick.eligible_objectors.every((eligibleId: string) => passedBy.includes(eligibleId));

  if (everyonePassed) {
    await supabase.from('pending_picks').update({
      status: 'resolved',
      passed_by: passedBy,
      updated_at: new Date().toISOString(),
    }).eq('id', pendingPickId);

    await finalizePick({
      roomId: pendingPick.room_id,
      pickerId: pendingPick.picker_id,
      entityId: pendingPick.coach_id ?? pendingPick.football_player_id,
      isCoach: !!pendingPick.coach_id,
      finalPrice: pendingPick.final_price,
      phase: pendingPick.phase,
      round: pendingPick.round,
      pickType: 'normal',
    });
    return;
  }

  await supabase.from('pending_picks').update({
    passed_by: passedBy,
    updated_at: new Date().toISOString(),
  }).eq('id', pendingPickId);
}

function getNextActiveBidderIndex(eligibleBidders: string[], passedBidders: string[], startIndex: number) {
  for (let offset = 0; offset < eligibleBidders.length; offset += 1) {
    const index = (startIndex + offset) % eligibleBidders.length;
    if (!passedBidders.includes(eligibleBidders[index])) {
      return index;
    }
  }
  return 0;
}

async function finalizeAuction(auction: any) {
  const { data: pendingPick } = await supabase
    .from('pending_picks')
    .select('*')
    .eq('id', auction.pending_pick_id)
    .single();
  if (!pendingPick) return;

  await supabase.from('auctions').update({
    status: 'finished',
    updated_at: new Date().toISOString(),
  }).eq('id', auction.id);

  await supabase.from('pending_picks').update({
    status: 'resolved',
    updated_at: new Date().toISOString(),
  }).eq('id', pendingPick.id);

  await finalizePick({
    roomId: pendingPick.room_id,
    pickerId: auction.current_highest_bidder ?? pendingPick.picker_id,
    entityId: pendingPick.coach_id ?? pendingPick.football_player_id,
    isCoach: !!pendingPick.coach_id,
    finalPrice: auction.current_highest_bid,
    phase: pendingPick.phase,
    round: pendingPick.round,
    pickType: 'auction_won',
  });
}

// ─── Submit an auction bid ───────────────────────────────────────────────────
export async function submitBid(auctionId: string, bidderId: string, amount: number) {
  const { data: auction } = await supabase
    .from('auctions')
    .select('*')
    .eq('id', auctionId)
    .single();
  if (!auction || auction.status !== 'active') throw new Error('Artırma aktif değil');
  const currentBidder = auction.eligible_bidders[auction.current_bidder_index % auction.eligible_bidders.length];
  if (currentBidder !== bidderId) throw new Error('Sıra sende değil');
  if (amount <= auction.current_highest_bid) throw new Error('Daha yüksek teklif ver');

  const newBid = { bidderId, amount, timestamp: new Date().toISOString() };
  const updatedBids = [...(auction.bids ?? []), newBid];
  const nextIndex = getNextActiveBidderIndex(
    auction.eligible_bidders,
    auction.passed_bidders ?? [],
    auction.current_bidder_index + 1,
  );

  await supabase.from('auctions').update({
    current_highest_bid: amount,
    current_highest_bidder: bidderId,
    current_bidder_index: nextIndex,
    bids: updatedBids,
    updated_at: new Date().toISOString(),
  }).eq('id', auctionId);
}

// ─── Pass auction turn ───────────────────────────────────────────────────────
export async function passAuctionTurn(auctionId: string, bidderId: string) {
  const { data: auction } = await supabase
    .from('auctions')
    .select('*')
    .eq('id', auctionId)
    .single();
  if (!auction || auction.status !== 'active') return;

  const currentBidder = auction.eligible_bidders[auction.current_bidder_index % auction.eligible_bidders.length];
  if (currentBidder !== bidderId) throw new Error('Sıra sende değil');

  const passedBidders = [...new Set([...(auction.passed_bidders ?? []), bidderId])];
  const activeBidders = auction.eligible_bidders.filter((userId: string) => !passedBidders.includes(userId));

  const passBid = { bidderId, amount: null, timestamp: new Date().toISOString() };
  const updatedBids = [...(auction.bids ?? []), passBid];

  if (activeBidders.length <= 1) {
    await supabase.from('auctions').update({
      passed_bidders: passedBidders,
      bids: updatedBids,
      updated_at: new Date().toISOString(),
    }).eq('id', auctionId);
    await finalizeAuction({ ...auction, bids: updatedBids, passed_bidders: passedBidders });
    return;
  }

  const nextIndex = getNextActiveBidderIndex(auction.eligible_bidders, passedBidders, auction.current_bidder_index + 1);

  await supabase.from('auctions').update({
    passed_bidders: passedBidders,
    current_bidder_index: nextIndex,
    bids: updatedBids,
    updated_at: new Date().toISOString(),
  }).eq('id', auctionId);
}
