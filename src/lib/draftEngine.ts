import { supabase } from './supabase';
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

async function finalizeDraftPick(
  pendingPickId: string,
  winnerId: string | null,
  finalPrice: number | null,
  pickType: 'normal' | 'auction_won',
) {
  const { error } = await supabase.rpc('finalize_draft_pick', {
    p_pending_pick_id: pendingPickId,
    p_winner_id: winnerId,
    p_final_price: finalPrice,
    p_pick_type: pickType,
  });
  if (error) throw error;
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

  if (uniqueObjectors.length === 0) {
    await finalizeDraftPick(data.id, null, finalPrice, 'normal');
    return null;
  }

  return data;
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

  // Picker is always first; the objector who started the auction must always be
  // able to bid; then the rest of the eligible bidders. Deduplicated.
  const orderedBidders = [...new Set([
    pendingPick.picker_id,
    initiatedBy,
    ...eligibleBidders,
  ])].filter(Boolean);

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
    const { error } = await supabase.from('pending_picks').update({
      passed_by: passedBy,
      updated_at: new Date().toISOString(),
    }).eq('id', pendingPickId);
    if (error) throw error;

    await finalizeDraftPick(pendingPick.id, null, pendingPick.final_price, 'normal');
    return;
  }

  const { error } = await supabase.from('pending_picks').update({
    passed_by: passedBy,
    updated_at: new Date().toISOString(),
  }).eq('id', pendingPickId);
  if (error) throw error;
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

  await finalizeDraftPick(
    pendingPick.id,
    auction.current_highest_bidder ?? pendingPick.picker_id,
    auction.current_highest_bid,
    'auction_won',
  );
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

  const { error } = await supabase.from('auctions').update({
    current_highest_bid: amount,
    current_highest_bidder: bidderId,
    current_bidder_index: nextIndex,
    bids: updatedBids,
    updated_at: new Date().toISOString(),
  }).eq('id', auctionId);
  if (error) throw error;
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
    const { error } = await supabase.from('auctions').update({
      passed_bidders: passedBidders,
      bids: updatedBids,
      updated_at: new Date().toISOString(),
    }).eq('id', auctionId);
    if (error) throw error;
    await finalizeAuction({ ...auction, bids: updatedBids, passed_bidders: passedBidders });
    return;
  }

  const nextIndex = getNextActiveBidderIndex(auction.eligible_bidders, passedBidders, auction.current_bidder_index + 1);

  const { error } = await supabase.from('auctions').update({
    passed_bidders: passedBidders,
    current_bidder_index: nextIndex,
    bids: updatedBids,
    updated_at: new Date().toISOString(),
  }).eq('id', auctionId);
  if (error) throw error;
}
