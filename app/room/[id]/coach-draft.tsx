import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { submitPick, initiateAuction } from '../../../src/lib/draftEngine';
import { getCurrentPicker } from '../../../src/lib/draftEngine';
import CoachCard from '../../../src/components/CoachCard';
import BudgetBar from '../../../src/components/BudgetBar';
import DraftOrderIndicator from '../../../src/components/DraftOrderIndicator';
import AuctionModal from '../../../src/components/AuctionModal';
import type { Coach, Auction } from '../../../src/types/game';

export default function CoachDraftScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const [myUserId, setMyUserId] = useState('');
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [session, setSession] = useState<any>(null);
  const [roomPlayers, setRoomPlayers] = useState<any[]>([]);
  const [draftSession, setDraftSession] = useState<any>(null);
  const [pickedCoachIds, setPickedCoachIds] = useState<Set<string>>(new Set());
  const [auction, setAuction] = useState<Auction | null>(null);
  const [auctionTarget, setAuctionTarget] = useState<Coach | null>(null);

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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  async function fetchAll() {
    const [{ data: c }, { data: rp }, { data: ds }, { data: picks }] = await Promise.all([
      supabase.from('coaches').select('*').order('price', { ascending: false }),
      supabase.from('room_players').select('*').eq('room_id', roomId),
      supabase.from('draft_sessions').select('*').eq('room_id', roomId).single(),
      supabase.from('draft_picks').select('coach_id').eq('room_id', roomId).not('coach_id', 'is', null),
    ]);
    setCoaches((c ?? []) as Coach[]);
    setRoomPlayers(rp ?? []);
    setDraftSession(ds);
    setPickedCoachIds(new Set((picks ?? []).map((p: any) => p.coach_id).filter(Boolean)));
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

  const handleSelect = async (coach: Coach) => {
    if (!isMyTurn) { Alert.alert('Şu an senin sıran değil'); return; }
    if (coach.price > (me?.coach_budget ?? 0)) { Alert.alert('Bütçen yetersiz'); return; }
    try {
      await submitPick(roomId, myUserId, coach.id, true, coach.price, 'coach', 1);
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  const handleObject = async (coach: Coach) => {
    if ((me?.objection_rights ?? 0) <= 0) { Alert.alert('İtiraz hakkın kalmadı'); return; }
    // Eligible: players with budget >= coach.price and no coach yet
    const eligible = roomPlayers
      .filter((p) => p.coach_budget >= coach.price && !p.picked_coach_id)
      .map((p) => p.user_id);
    try {
      await initiateAuction(roomId, myUserId, coach.id, true, coach.price, eligible);
    } catch (e: any) { Alert.alert('Hata', e.message); }
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.phase}>🧑‍💼 TEKNİK DİREKTÖR DRAFTI</Text>
        {me && <BudgetBar budget={me.coach_budget} maxBudget={20} label="TD Bütçesi" color="#8b5cf6" />}
        {me && <Text style={styles.objections}>İtiraz: {'⚡'.repeat(me.objection_rights)}{'○'.repeat(Math.max(0, 3 - me.objection_rights))} ({me.objection_rights}/3)</Text>}
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
            disabled={!isMyTurn || pickedCoachIds.has(item.id) || item.price > (me?.coach_budget ?? 0)}
            onSelect={() => handleSelect(item)}
            onObject={!isMyTurn && !pickedCoachIds.has(item.id) ? () => handleObject(item) : undefined}
          />
        )}
        contentContainerStyle={styles.list}
      />

      <AuctionModal
        auction={auction}
        myUserId={myUserId}
        myBudget={me?.coach_budget ?? 0}
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
  list: { padding: 16 },
});
