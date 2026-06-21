import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Alert, TouchableOpacity, useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { createPendingPick, initiateAuction, getCurrentPicker, passPendingPick } from '../../../src/lib/draftEngine';
import { assignPlayersToFormation, hasCompatibleSlot, getSlotsForFormation } from '../../../src/lib/formationUtils';
import PlayerCard from '../../../src/components/PlayerCard';
import BudgetBar from '../../../src/components/BudgetBar';
import DraftOrderIndicator from '../../../src/components/DraftOrderIndicator';
import AuctionModal from '../../../src/components/AuctionModal';
import ObjectionPromptModal from '../../../src/components/ObjectionPromptModal';
import type { FootballPlayer, Auction, Formation, DraftPhase, PendingPick } from '../../../src/types/game';

const PHASE_LABELS: Record<DraftPhase, string> = {
  coach: 'TD', gk: '🧤 Kaleciler', def: '🛡 Savunma', mid: '⚙️ Orta Saha', fwd: '⚡ Forvet',
};

function FormationPreview({
  formation,
  assignedSlots,
  floating,
}: {
  formation?: Formation;
  assignedSlots: Array<{ slotId: string; position: string; player?: FootballPlayer }>;
  floating: boolean;
}) {
  return (
    <View style={[styles.previewCard, floating && styles.previewFloating]}>
      <Text style={styles.previewTitle}>Taktiğin</Text>
      <Text style={styles.previewFormation}>{formation ?? 'Formasyon yok'}</Text>
      {assignedSlots.length === 0 ? (
        <Text style={styles.previewHint}>Oyuncular seçildikçe yerleşim burada görünecek.</Text>
      ) : (
        assignedSlots.map((slot) => (
          <View key={slot.slotId} style={styles.previewRow}>
            <Text style={styles.previewSlot}>{slot.position}</Text>
            <Text
              style={[styles.previewPlayer, !slot.player && styles.previewEmptyPlayer]}
              numberOfLines={1}
            >
              {slot.player?.name ?? 'Boş'}
            </Text>
          </View>
        ))
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions', filter: `room_id=eq.${roomId}` }, fetchAuction)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_picks', filter: `room_id=eq.${roomId}` }, fetchPendingPick)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  async function fetchAll() {
    const [{ data: p }, { data: rp }, { data: ds }, { data: picks }] = await Promise.all([
      supabase.from('football_players').select('*').order('price', { ascending: false }),
      supabase.from('room_players').select('*').eq('room_id', roomId),
      supabase.from('draft_sessions').select('*').eq('room_id', roomId).single(),
      supabase.from('draft_picks').select('football_player_id,picker_id').eq('room_id', roomId).not('football_player_id', 'is', null),
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
    fetchPendingPick();
  }

  async function fetchPendingPick() {
    const { data } = await supabase.from('pending_picks').select('*')
      .eq('room_id', roomId)
      .in('status', ['active', 'auctioning'])
      .limit(1)
      .maybeSingle();
    setPendingPick((data as PendingPick | null) ?? null);
    if (data?.football_player_id) {
      const { data: player } = await supabase.from('football_players').select('*').eq('id', data.football_player_id).single();
      setPendingTarget((player as FootballPlayer) ?? null);
      return;
    }
    setPendingTarget(null);
  }

  async function fetchAuction() {
    const { data } = await supabase.from('auctions').select('*')
      .eq('room_id', roomId).eq('status', 'active').maybeSingle();
    setAuction(data as Auction | null);
    if (data?.target_player_id) {
      const { data: pl } = await supabase.from('football_players').select('*').eq('id', data.target_player_id).single();
      setAuctionTarget(pl as FootballPlayer);
    }
  }

  function handleRoomChange({ new: r }: any) {
    if (r?.status === 'squad_review') router.replace(`/room/${roomId}/squad-review`);
  }

  const phase: DraftPhase = draftSession?.current_phase ?? 'gk';
  const round: number = draftSession?.current_round ?? 1;
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
  const myEmptySlots = myAssignedSlots.filter((slot) => !slot.player);
  const showFloatingPreview = width >= 1100;
  const canRespondToPendingPick = !!pendingPick
    && pendingPick.status === 'active'
    && pendingPick.picker_id !== myUserId
    && pendingPick.eligible_objectors.includes(myUserId)
    && !(pendingPick.passed_by ?? []).includes(myUserId);

  // Filter players for current phase
  const pgMap: Record<DraftPhase, string> = { coach: 'GK', gk: 'GK', def: 'DEF', mid: 'MID', fwd: 'FWD' };
  const visiblePlayers = allPlayers.filter((p) => p.position_group === pgMap[phase]);

  const getEligiblePlayerBidders = (player: FootballPlayer) => roomPlayers.filter((p) => {
    if (!p.formation) return false;
    const slots = getSlotsForFormation(p.formation as Formation);
    return p.player_budget >= player.price && hasCompatibleSlot(player.positions, slots);
  }).map((p) => p.user_id);

  const handleSelect = async (player: FootballPlayer) => {
    if (!isMyTurn) { Alert.alert('Şu an senin sıran değil'); return; }
    if (player.price > (me?.player_budget ?? 0)) { Alert.alert('Bütçen yetersiz'); return; }
    if (!hasCompatibleSlot(player.positions, myEmptySlots)) {
      Alert.alert('Formasyonunda bu mevki için boş slot yok');
      return;
    }
    try {
      const eligibleBidders = getEligiblePlayerBidders(player);
      const eligibleObjectors = roomPlayers
        .filter((p) => p.user_id !== myUserId && p.objection_rights > 0 && eligibleBidders.includes(p.user_id))
        .map((p) => p.user_id);
      await createPendingPick(roomId, myUserId, player.id, false, player.price, phase, round, eligibleObjectors);
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  const handlePassPendingPick = async () => {
    try {
      if (pendingPick) await passPendingPick(pendingPick.id, myUserId);
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  const handleObjectPendingPick = async () => {
    if (!pendingPick || !pendingTarget) return;
    try {
      await initiateAuction(pendingPick.id, myUserId, getEligiblePlayerBidders(pendingTarget));
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.phase}>{PHASE_LABELS[phase]} — Tur {round}/11</Text>
        {me && <BudgetBar budget={me.player_budget} maxBudget={100} label="Bütçe" />}
        {me && <Text style={styles.obj}>İtiraz: {me.objection_rights}/3</Text>}
        <Text style={styles.squad}>Kadro: {myPickedPlayerIds.size}/11</Text>
        {pendingPick && !auction && <Text style={styles.waiting}>Seçim beklemede. Önce itiraz turu tamamlanacak.</Text>}
      </View>

      {draftSession && (
        <DraftOrderIndicator
          pickOrder={draftSession.pick_order}
          currentPickerIndex={draftSession.current_picker_index}
          currentRound={round}
          usernames={usernames}
          myUserId={myUserId}
        />
      )}

      {!showFloatingPreview && (
        <FormationPreview
          formation={myFormation}
          assignedSlots={myAssignedSlots}
          floating={false}
        />
      )}

      <View style={styles.content}>
        <FlatList
          data={visiblePlayers}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => {
            const isPicked = pickedPlayerIds.has(item.id);
            const isMinePick = myPickedPlayerIds.has(item.id);
            const compatible = hasCompatibleSlot(item.positions, myEmptySlots);
            return (
              <PlayerCard
                player={item}
                picked={isPicked}
                myPick={isMinePick}
                showActions={!isPicked}
                disabled={waitingOnObjection || !isMyTurn || isPicked || item.price > (me?.player_budget ?? 0) || !compatible}
                onSelect={() => handleSelect(item)}
              />
            );
          }}
          contentContainerStyle={[styles.list, showFloatingPreview && styles.listWithPreview]}
          ListEmptyComponent={<Text style={styles.empty}>Bu fazda oyuncu bulunamadı</Text>}
        />

        {showFloatingPreview && (
          <FormationPreview
            formation={myFormation}
            assignedSlots={myAssignedSlots}
            floating
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  header: { padding: 16, backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  phase: { color: '#22c55e', fontWeight: '900', fontSize: 15, marginBottom: 8 },
  obj: { color: '#f59e0b', fontSize: 12, marginTop: 2 },
  squad: { color: '#60a5fa', fontSize: 12, marginTop: 2 },
  waiting: { color: '#93c5fd', fontSize: 12, marginTop: 4 },
  content: { flex: 1 },
  previewCard: {
    backgroundColor: '#111827', borderColor: '#1f2937', borderWidth: 1,
    borderRadius: 12, padding: 12, margin: 16, marginTop: 0,
  },
  previewFloating: {
    position: 'absolute', top: 16, right: 16, width: 240, margin: 0, zIndex: 3,
  },
  previewTitle: { color: '#f3f4f6', fontWeight: '900', fontSize: 14 },
  previewFormation: { color: '#60a5fa', fontSize: 12, marginTop: 2, marginBottom: 8 },
  previewHint: { color: '#6b7280', fontSize: 12, lineHeight: 18 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  previewSlot: { color: '#9ca3af', fontSize: 11, fontWeight: '700', width: 34 },
  previewPlayer: { color: '#e5e7eb', fontSize: 12, flex: 1 },
  previewEmptyPlayer: { color: '#6b7280', fontStyle: 'italic' },
  list: { padding: 16 },
  listWithPreview: { paddingRight: 272 },
  empty: { color: '#6b7280', textAlign: 'center', marginTop: 32 },
});
