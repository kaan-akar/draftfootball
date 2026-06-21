import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { createPendingPick, initiateAuction, passPendingPick } from '../../../src/lib/draftEngine';
import { getCurrentPicker } from '../../../src/lib/draftEngine';
import CoachCard from '../../../src/components/CoachCard';
import BudgetBar from '../../../src/components/BudgetBar';
import DraftOrderIndicator from '../../../src/components/DraftOrderIndicator';
import AuctionModal from '../../../src/components/AuctionModal';
import ObjectionPromptModal from '../../../src/components/ObjectionPromptModal';
import type { Coach, Auction, PendingPick } from '../../../src/types/game';

export default function CoachDraftScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const [myUserId, setMyUserId] = useState('');
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [session, setSession] = useState<any>(null);
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);
  const [draftSession, setDraftSession] = useState<any>(null);
  const [pickedCoachIds, setPickedCoachIds] = useState<Set<string>>(new Set());
  const [coachPickedByUser, setCoachPickedByUser] = useState<Set<string>>(new Set());
  const [auction, setAuction] = useState<Auction | null>(null);
  const [auctionTarget, setAuctionTarget] = useState<Coach | null>(null);
  const [pendingPick, setPendingPick] = useState<PendingPick | null>(null);
  const [pendingTarget, setPendingTarget] = useState<Coach | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setMyUserId(s?.user.id ?? '');
    });
    fetchAll();
    const channel = supabase.channel(`coach-draft-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_sessions', filter: `room_id=eq.${roomId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` }, handleRoomChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'auctions', filter: `room_id=eq.${roomId}` }, fetchAuction)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_picks', filter: `room_id=eq.${roomId}` }, fetchPendingPick)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  async function fetchAll() {
    const [{ data: c }, { data: rp }, { data: ds }, { data: picks }] = await Promise.all([
      supabase.from('coaches').select('*').order('price', { ascending: false }),
      supabase.from('room_players').select('*').eq('room_id', roomId),
      supabase.from('draft_sessions').select('*').eq('room_id', roomId).single(),
      supabase.from('draft_picks').select('coach_id,picker_id').eq('room_id', roomId).not('coach_id', 'is', null),
    ]);
    setCoaches((c ?? []) as Coach[]);
    setRoomPlayers(rp ?? []);
    setDraftSession(ds);
    setPickedCoachIds(new Set((picks ?? []).map((p: any) => p.coach_id).filter(Boolean)));
    setCoachPickedByUser(new Set((picks ?? []).map((p: any) => p.picker_id).filter(Boolean)));
    fetchPendingPick();
  }

  async function fetchPendingPick() {
    const { data } = await supabase.from('pending_picks').select('*')
      .eq('room_id', roomId)
      .in('status', ['active', 'auctioning'])
      .limit(1)
      .maybeSingle();
    setPendingPick((data as PendingPick | null) ?? null);
    if (data?.coach_id) {
      const { data: coach } = await supabase.from('coaches').select('*').eq('id', data.coach_id).single();
      setPendingTarget((coach as Coach) ?? null);
      return;
    }
    setPendingTarget(null);
  }

  async function fetchAuction() {
    const { data } = await supabase.from('auctions').select('*')
      .eq('room_id', roomId).eq('status', 'active').maybeSingle();
    setAuction(data as Auction | null);
    if (data?.target_coach_id) {
      const { data: c } = await supabase.from('coaches').select('*').eq('id', data.target_coach_id).single();
      setAuctionTarget(c as Coach);
    }
  }

  function handleRoomChange({ new: r }: any) {
    if (r?.status === 'player_draft') router.replace(`/room/${roomId}/player-draft`);
  }

  const currentPickerUserId = draftSession
    ? getCurrentPicker(draftSession.pick_order, draftSession.current_round, draftSession.current_picker_index)
    : null;
  const isMyTurn = currentPickerUserId === myUserId;
  const me = roomPlayers.find((p) => p.user_id === myUserId);
  const usernames = Object.fromEntries(roomPlayers.map((p) => [p.user_id, p.username]));
  const waitingOnObjection = !!pendingPick || !!auction;
  const canRespondToPendingPick = !!pendingPick
    && pendingPick.status === 'active'
    && pendingPick.picker_id !== myUserId
    && pendingPick.eligible_objectors.includes(myUserId)
    && !(pendingPick.passed_by ?? []).includes(myUserId);

  // A player who has already secured a coach must not be able to object to or
  // bid on another coach. We check both the room_players flag and the durable
  // draft_picks record so a delayed realtime update can't let them slip through.
  const getEligibleCoachBidders = useCallback((coach: Coach) => roomPlayers
    .filter((p) => p.player_budget >= coach.price && !p.picked_coach_id && !coachPickedByUser.has(p.user_id))
    .map((p) => p.user_id), [roomPlayers, coachPickedByUser]);

  const handleSelect = async (coach: Coach) => {
    if (!isMyTurn) { Alert.alert('Şu an senin sıran değil'); return; }
    if (coach.price > (me?.player_budget ?? 0)) { Alert.alert('Bütçen yetersiz'); return; }
    try {
      const eligibleBidders = getEligibleCoachBidders(coach);
      const eligibleObjectors = roomPlayers
        .filter((p) => p.user_id !== myUserId && p.objection_rights > 0 && eligibleBidders.includes(p.user_id))
        .map((p) => p.user_id);
      await createPendingPick(roomId, myUserId, coach.id, true, coach.price, 'coach', 1, eligibleObjectors);
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
      await initiateAuction(pendingPick.id, myUserId, getEligibleCoachBidders(pendingTarget));
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.phase}>🧑‍💼 TEKNİK DİREKTÖR DRAFTI</Text>
        {me && <BudgetBar budget={me.player_budget} maxBudget={120} label="Toplam Bütçe" color="#8b5cf6" />}
        {me && <Text style={styles.objections}>İtiraz: {'⚡'.repeat(me.objection_rights)}{'○'.repeat(Math.max(0, 3 - me.objection_rights))} ({me.objection_rights}/3)</Text>}
        {pendingPick && !auction && <Text style={styles.waiting}>Seçim beklemede. Önce itiraz turu tamamlanacak.</Text>}
      </View>

      {draftSession && (
        <DraftOrderIndicator
          pickOrder={draftSession.pick_order}
          currentPickerIndex={draftSession.current_picker_index}
          currentRound={1}
          usernames={usernames}
          myUserId={myUserId}
        />
      )}

      <FlatList
        data={coaches}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <CoachCard
            coach={item}
            picked={pickedCoachIds.has(item.id)}
            myPick={me?.picked_coach_id === item.id}
            showActions={true}
            disabled={waitingOnObjection || !isMyTurn || pickedCoachIds.has(item.id) || item.price > (me?.player_budget ?? 0)}
            onSelect={() => handleSelect(item)}
          />
        )}
        contentContainerStyle={styles.list}
      />

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
  phase: { color: '#a78bfa', fontWeight: '900', fontSize: 16, marginBottom: 8 },
  objections: { color: '#f59e0b', fontSize: 12, marginTop: 4 },
  waiting: { color: '#93c5fd', fontSize: 12, marginTop: 6 },
  list: { padding: 16 },
});
