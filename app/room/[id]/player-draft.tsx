import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Alert, TouchableOpacity, useWindowDimensions, ScrollView,
} from 'react-native';
import { useLocalSearchParams, router, type ErrorBoundaryProps } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { createPendingPick, initiateAuction, getCurrentPicker, passPendingPick } from '../../../src/lib/draftEngine';
import { assignPlayersToFormation, canFillSlot, getSlotFitScore, getTargetSlotForRound, phaseForRound, slotDisplayName } from '../../../src/lib/formationUtils';
import PlayerCard from '../../../src/components/PlayerCard';
import BudgetBar from '../../../src/components/BudgetBar';
import DraftOrderIndicator from '../../../src/components/DraftOrderIndicator';
import AuctionModal from '../../../src/components/AuctionModal';
import ObjectionPromptModal from '../../../src/components/ObjectionPromptModal';
import type { FootballPlayer, Auction, Formation, DraftPhase, PendingPick } from '../../../src/types/game';

const PHASE_LABELS: Record<DraftPhase, string> = {
  coach: 'TD', gk: '🧤 Kaleciler', def: '🛡 Savunma', mid: '⚙️ Orta Saha', fwd: '⚡ Forvet',
};

// Catches render crashes on this route so the user sees a readable error
// instead of a blank white screen, and we can diagnose the exact cause.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView style={errStyles.screen} contentContainerStyle={errStyles.content}>
      <Text style={errStyles.title}>Bir hata oluştu</Text>
      <Text style={errStyles.message}>{error?.message ?? 'Bilinmeyen hata'}</Text>
      {!!error?.stack && <Text style={errStyles.stack}>{error.stack}</Text>}
      <TouchableOpacity style={errStyles.button} onPress={retry}>
        <Text style={errStyles.buttonText}>Tekrar Dene</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function FormationPreview({
  formation,
  assignedSlots,
  floating,
  compact,
  activeSlotId,
}: {
  formation?: Formation;
  assignedSlots: Array<{ slotId: string; position: string; player?: FootballPlayer }>;
  floating: boolean;
  compact?: boolean;
  activeSlotId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const filledCount = assignedSlots.filter((slot) => slot.player).length;
  const activeSlot = activeSlotId ? assignedSlots.find((s) => s.slotId === activeSlotId) : undefined;

  if (compact && !expanded) {
    return (
      <TouchableOpacity
        style={styles.previewCompact}
        onPress={() => setExpanded(true)}
        activeOpacity={0.8}
      >
        <View style={styles.previewCompactMain}>
          <Text style={styles.previewTitle}>Taktiğin</Text>
          <Text style={styles.previewFormation}>{formation ?? 'Formasyon yok'}</Text>
        </View>
        <Text style={styles.previewCompactMeta}>
          {activeSlot
            ? `Tur: ${activeSlot.position} · ${filledCount}/11`
            : `${filledCount}/11 dolu · Göster ▾`}
        </Text>
      </TouchableOpacity>
    );
  }

  const slotList = assignedSlots.length === 0 ? (
    <Text style={styles.previewHint}>Oyuncular seçildikçe yerleşim burada görünecek.</Text>
  ) : (
    assignedSlots.map((slot) => (
      <View
        key={slot.slotId}
        style={[styles.previewRow, slot.slotId === activeSlotId && styles.previewRowActive]}
      >
        <Text style={[styles.previewSlot, slot.slotId === activeSlotId && styles.previewSlotActive]}>
          {slot.position}
        </Text>
        <Text
          style={[
            styles.previewPlayer,
            !slot.player && styles.previewEmptyPlayer,
            slot.slotId === activeSlotId && styles.previewPlayerActive,
          ]}
          numberOfLines={1}
        >
          {slot.player?.name ?? (slot.slotId === activeSlotId ? '← Bu tur' : 'Boş')}
        </Text>
      </View>
    ))
  );

  return (
    <View style={[styles.previewCard, floating && styles.previewFloating, compact && styles.previewCardCompact]}>
      <View style={styles.previewHeader}>
        <View>
          <Text style={styles.previewTitle}>Taktiğin</Text>
          <Text style={styles.previewFormation}>{formation ?? 'Formasyon yok'}</Text>
        </View>
        {compact ? (
          <TouchableOpacity onPress={() => setExpanded(false)} hitSlop={8}>
            <Text style={styles.previewCollapse}>Gizle ▴</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {compact ? (
        <ScrollView style={styles.previewSlotScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
          {slotList}
        </ScrollView>
      ) : (
        slotList
      )}
    </View>
  );
}

export default function PlayerDraftScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [myUserId, setMyUserId] = useState('');
  const [allPlayers, setAllPlayers] = useState<FootballPlayer[]>([]);
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);
  const [draftSession, setDraftSession] = useState<any>(null);
  const [pickedPlayerIds, setPickedPlayerIds] = useState<Set<string>>(new Set());
  const [myPickedPlayerIds, setMyPickedPlayerIds] = useState<Set<string>>(new Set());
  const [picksByUser, setPicksByUser] = useState<Record<string, string[]>>({});
  const [auction, setAuction] = useState<Auction | null>(null);
  const [auctionTarget, setAuctionTarget] = useState<FootballPlayer | null>(null);
  const [pendingPick, setPendingPick] = useState<PendingPick | null>(null);
  const [pendingTarget, setPendingTarget] = useState<FootballPlayer | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setMyUserId(s?.user.id ?? '');
    });
    fetchAll();
    const channel = supabase.channel(`player-draft-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_sessions', filter: `room_id=eq.${roomId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_picks', filter: `room_id=eq.${roomId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` }, handleRoomChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions', filter: `room_id=eq.${roomId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_picks', filter: `room_id=eq.${roomId}` }, fetchAll)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  async function fetchAll() {
    const [{ data: p }, { data: rp }, { data: ds }, { data: picks }, { data: pending }, { data: activeAuction }] = await Promise.all([
      supabase.from('football_players').select('*').order('price', { ascending: false }),
      supabase.from('room_players').select('*').eq('room_id', roomId),
      supabase.from('draft_sessions').select('*').eq('room_id', roomId).single(),
      supabase.from('draft_picks').select('football_player_id,picker_id').eq('room_id', roomId).not('football_player_id', 'is', null),
      supabase.from('pending_picks').select('*').eq('room_id', roomId).in('status', ['active', 'auctioning']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('auctions').select('*').eq('room_id', roomId).eq('status', 'active').maybeSingle(),
    ]);
    setAllPlayers((p ?? []) as FootballPlayer[]);
    setRoomPlayers(rp ?? []);
    setDraftSession(ds);
    setPickedPlayerIds(new Set((picks ?? []).map((x: any) => x.football_player_id).filter(Boolean)));
    const uid = (await supabase.auth.getSession()).data.session?.user.id;
    setMyPickedPlayerIds(new Set(
      (picks ?? [])
        .filter((x: any) => x.picker_id === uid)
        .map((x: any) => x.football_player_id)
        .filter(Boolean),
    ));
    // Group every player's picks by user so we can tell which positions each
    // person has already filled (used to gate auction/objection eligibility).
    const byUser: Record<string, string[]> = {};
    (picks ?? []).forEach((x: any) => {
      if (!x.football_player_id) return;
      (byUser[x.picker_id] ??= []).push(x.football_player_id);
    });
    setPicksByUser(byUser);

    setPendingPick((pending as PendingPick | null) ?? null);
    if (pending?.football_player_id) {
      const { data: player } = await supabase.from('football_players').select('*').eq('id', pending.football_player_id).single();
      setPendingTarget((player as FootballPlayer) ?? null);
    } else {
      setPendingTarget(null);
    }

    setAuction((activeAuction as Auction | null) ?? null);
    if (activeAuction?.target_player_id) {
      const { data: pl } = await supabase.from('football_players').select('*').eq('id', activeAuction.target_player_id).single();
      setAuctionTarget(pl as FootballPlayer);
    } else {
      setAuctionTarget(null);
    }
  }

  function handleRoomChange({ new: r }: any) {
    if (r?.status === 'squad_review') router.replace(`/room/${roomId}/squad-review`);
  }

  const round: number = draftSession?.current_round ?? 1;
  // Round is the source of truth for which position group is being drafted.
  const phase: DraftPhase = phaseForRound(round);
  const currentPickerUserId = draftSession
    ? getCurrentPicker(draftSession.pick_order, round, draftSession.current_picker_index)
    : null;
  const isMyTurn = currentPickerUserId === myUserId;
  const me = roomPlayers.find((p) => p.user_id === myUserId);
  const usernames = Object.fromEntries(roomPlayers.map((p) => [p.user_id, p.username]));
  const waitingOnObjection = !!pendingPick || !!auction;
  const myFormation = me?.formation as Formation | undefined;
  const myPickedPlayers = allPlayers.filter((player) => myPickedPlayerIds.has(player.id));
  const myAssignedSlots = myFormation ? assignPlayersToFormation(myPickedPlayers, myFormation) : [];
  const targetSlot = myFormation ? getTargetSlotForRound(myFormation, round) : undefined;
  const targetSlotFilled = targetSlot
    ? myAssignedSlots.find((slot) => slot.slotId === targetSlot.slotId)?.player
    : undefined;
  const showFloatingPreview = width >= 1100;
  const canRespondToPendingPick = !!pendingPick
    && pendingPick.status === 'active'
    && pendingPick.picker_id !== myUserId
    && pendingPick.eligible_objectors.includes(myUserId)
    && !(pendingPick.passed_by ?? []).includes(myUserId);

  // Each round maps to the next slot in the player's formation (GK → RB → CB …).
  const visiblePlayers = targetSlot
    ? allPlayers
      .filter((p) => !pickedPlayerIds.has(p.id) && canFillSlot(p.positions, targetSlot.position))
      .sort((a, b) => getSlotFitScore(b.positions, targetSlot.position) - getSlotFitScore(a.positions, targetSlot.position))
    : [];

  const getEligiblePlayerBidders = (player: FootballPlayer) => roomPlayers.filter((p) => {
    if (!p.formation) return false;
    if (p.player_budget < player.price) return false;
    const slot = getTargetSlotForRound(p.formation as Formation, round);
    if (!slot) return false;
    const theirPickedIds = picksByUser[p.user_id] ?? [];
    const theirPlayers = allPlayers.filter((pl) => theirPickedIds.includes(pl.id));
    const theirAssigned = assignPlayersToFormation(theirPlayers, p.formation as Formation);
    if (theirAssigned.find((s) => s.slotId === slot.slotId)?.player) return false;
    return canFillSlot(player.positions, slot.position);
  }).map((p) => p.user_id);

  const handleSelect = async (player: FootballPlayer) => {
    if (!isMyTurn) { Alert.alert('Şu an senin sıran değil'); return; }
    if (!myFormation || !targetSlot) { Alert.alert('Önce formasyon seçmelisin'); return; }
    if (targetSlotFilled) { Alert.alert('Bu turdaki mevki zaten dolu'); return; }
    if (player.price > (me?.player_budget ?? 0)) { Alert.alert('Bütçen yetersiz'); return; }
    if (!canFillSlot(player.positions, targetSlot.position)) {
      Alert.alert('Bu oyuncu formasyonundaki bu mevkiye uygun değil', slotDisplayName(targetSlot));
      return;
    }
    try {
      const eligibleBidders = getEligiblePlayerBidders(player);
      const eligibleObjectors = roomPlayers
        .filter((p) => p.user_id !== myUserId && p.objection_rights > 0 && eligibleBidders.includes(p.user_id))
        .map((p) => p.user_id);
      await createPendingPick(roomId, myUserId, player.id, false, player.price, phase, round, eligibleObjectors);
      await fetchAll();
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  const handlePassPendingPick = async () => {
    try {
      if (pendingPick) await passPendingPick(pendingPick.id, myUserId);
      await fetchAll();
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  const handleObjectPendingPick = async () => {
    if (!pendingPick || !pendingTarget) return;
    try {
      await initiateAuction(pendingPick.id, myUserId, getEligiblePlayerBidders(pendingTarget));
      await fetchAll();
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.phase}>
          {targetSlot
            ? `Tur ${round}/11 — ${slotDisplayName(targetSlot)} (${targetSlot.position})`
            : `${PHASE_LABELS[phase]} — Tur ${round}/11`}
        </Text>
        {me && <BudgetBar budget={me.player_budget} maxBudget={120} label="Toplam Bütçe" />}
        {me && <Text style={styles.obj}>İtiraz: {me.objection_rights}/3</Text>}
        <Text style={styles.squad}>Kadro: {myPickedPlayerIds.size}/11</Text>
        {pendingPick && !auction && <Text style={styles.waiting}>Seçim beklemede. Önce itiraz turu tamamlanacak.</Text>}
      </View>

      {draftSession && (
        <View style={styles.orderWrap}>
          <DraftOrderIndicator
            pickOrder={draftSession.pick_order}
            currentPickerIndex={draftSession.current_picker_index}
            currentRound={round}
            usernames={usernames}
            myUserId={myUserId}
          />
        </View>
      )}

      <View style={styles.content}>
        {!showFloatingPreview && (
          <FormationPreview
            formation={myFormation}
            assignedSlots={myAssignedSlots}
            floating={false}
            compact
            activeSlotId={targetSlot?.slotId}
          />
        )}

        <FlatList
          style={styles.listFlex}
          data={visiblePlayers}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => {
            const isPicked = pickedPlayerIds.has(item.id);
            const isMinePick = myPickedPlayerIds.has(item.id);
            const compatible = targetSlot ? canFillSlot(item.positions, targetSlot.position) : false;
            return (
              <PlayerCard
                player={item}
                picked={isPicked}
                myPick={isMinePick}
                showActions={!isPicked}
                disabled={waitingOnObjection || !isMyTurn || !!targetSlotFilled || isPicked || item.price > (me?.player_budget ?? 0) || !compatible}
                onSelect={() => handleSelect(item)}
              />
            );
          }}
          contentContainerStyle={[styles.list, showFloatingPreview && styles.listWithPreview]}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {targetSlot
                ? `${slotDisplayName(targetSlot)} mevkisi için uygun oyuncu bulunamadı`
                : 'Formasyon seçilmedi'}
            </Text>
          }
        />

        {showFloatingPreview && (
          <FormationPreview
            formation={myFormation}
            assignedSlots={myAssignedSlots}
            floating
            activeSlotId={targetSlot?.slotId}
          />
        )}
      </View>

      <ObjectionPromptModal
        visible={canRespondToPendingPick && !auction}
        pickerName={usernames[pendingPick?.picker_id ?? ''] ?? 'Bir oyuncu'}
        targetName={pendingTarget?.name ?? ''}
        onPass={handlePassPendingPick}
        onObject={handleObjectPendingPick}
      />

      <AuctionModal
        auction={auction}
        myUserId={myUserId}
        myBudget={me?.player_budget ?? 0}
        targetName={auctionTarget?.name ?? ''}
        usernames={usernames}
        onClose={() => setAuction(null)}
      />
    </View>
  );
}

const errStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 20, gap: 12 },
  title: { color: '#ef4444', fontSize: 18, fontWeight: '900' },
  message: { color: '#f3f4f6', fontSize: 14 },
  stack: { color: '#9ca3af', fontSize: 11, fontFamily: 'monospace' },
  button: { backgroundColor: '#2563eb', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '800' },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  phase: { color: '#22c55e', fontWeight: '900', fontSize: 15, marginBottom: 8 },
  obj: { color: '#f59e0b', fontSize: 12, marginTop: 2 },
  squad: { color: '#60a5fa', fontSize: 12, marginTop: 2 },
  waiting: { color: '#93c5fd', fontSize: 12, marginTop: 4 },
  orderWrap: { paddingHorizontal: 16, paddingTop: 8 },
  content: { flex: 1, minHeight: 0 },
  previewCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderColor: '#1f2937',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  previewCompactMain: { flex: 1, marginRight: 8 },
  previewCompactMeta: { color: '#60a5fa', fontSize: 11, fontWeight: '700' },
  previewCard: {
    backgroundColor: '#111827', borderColor: '#1f2937', borderWidth: 1,
    borderRadius: 12, padding: 12, marginHorizontal: 16, marginBottom: 8,
  },
  previewCardCompact: { marginTop: 0 },
  previewHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  previewCollapse: { color: '#60a5fa', fontSize: 11, fontWeight: '700' },
  previewSlotScroll: { maxHeight: 120 },
  previewFloating: {
    position: 'absolute', top: 16, right: 16, width: 240, margin: 0, zIndex: 3,
  },
  previewTitle: { color: '#f3f4f6', fontWeight: '900', fontSize: 14 },
  previewFormation: { color: '#60a5fa', fontSize: 12, marginTop: 2, marginBottom: 8 },
  previewHint: { color: '#6b7280', fontSize: 12, lineHeight: 18 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2, borderRadius: 4, paddingHorizontal: 4, marginHorizontal: -4 },
  previewRowActive: { backgroundColor: '#1e3a5f', borderWidth: 1, borderColor: '#22c55e' },
  previewSlot: { color: '#9ca3af', fontSize: 11, fontWeight: '700', width: 34 },
  previewSlotActive: { color: '#22c55e' },
  previewPlayer: { color: '#e5e7eb', fontSize: 12, flex: 1 },
  previewPlayerActive: { color: '#86efac', fontWeight: '700' },
  previewEmptyPlayer: { color: '#6b7280', fontStyle: 'italic' },
  listFlex: { flex: 1 },
  list: { padding: 16, paddingTop: 0 },
  listWithPreview: { paddingRight: 272 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 32 },
});
