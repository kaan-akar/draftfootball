import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { generateFixture } from '../../../src/lib/tournamentEngine';
import type { FootballPlayer, Coach } from '../../../src/types/game';

interface PlayerSquad {
  username: string;
  formation: string;
  coach: Coach | null;
  players: FootballPlayer[];
}

export default function SquadReviewScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const [squads, setSquads] = useState<PlayerSquad[]>([]);
  const [myUserId, setMyUserId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => { setMyUserId(s?.user.id ?? ''); });
    fetchSquads();
  }, [roomId]);

  async function fetchSquads() {
    const [{ data: room }, { data: rp }, { data: picks }] = await Promise.all([
      supabase.from('game_rooms').select('*').eq('id', roomId).single(),
      supabase.from('room_players').select('*').eq('room_id', roomId),
      supabase.from('draft_picks').select('*, fp:football_player_id(football_players(*)), c:coach_id(coaches(*))').eq('room_id', roomId),
    ]);
    const uid = (await supabase.auth.getSession()).data.session?.user.id ?? '';
    setIsHost(room?.host_id === uid);

    const result: PlayerSquad[] = (rp ?? []).map((p: any) => {
      const myPickRows = (picks ?? []).filter((pk: any) => pk.picker_id === p.user_id);
      const playersPicked = myPickRows.filter((pk: any) => pk.football_player_id).map((pk: any) => pk.fp) as FootballPlayer[];
      const coachPicked = myPickRows.find((pk: any) => pk.coach_id)?.c as Coach | null ?? null;
      return { username: p.username, formation: p.formation, coach: coachPicked, players: playersPicked };
    });
    setSquads(result);
  }

  const startTournament = async () => {
    const { data: rp } = await supabase.from('room_players').select('user_id').eq('room_id', roomId);
    const ids = (rp ?? []).map((p: any) => p.user_id);
    const fixtures = generateFixture(ids);
    setLoading(true);
    try {
      const matchRows = fixtures.map(([homeId, awayId], i) => ({
        room_id: roomId, home_player_id: homeId, away_player_id: awayId,
        round: i + 1, status: 'scheduled', home_score: 0, away_score: 0, events: [], summary: '', mvp: '',
      }));
      await supabase.from('matches').insert(matchRows);

      const standingRows = ids.map((uid: string) => ({
        room_id: roomId, user_id: uid, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0,
      }));
      await supabase.from('standings').insert(standingRows);
      await supabase.from('game_rooms').update({ status: 'tournament' }).eq('id', roomId);
      router.replace(`/room/${roomId}/fixture`);
    } catch (e: any) { Alert.alert('Hata', e.message); }
    setLoading(false);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>📋 KADROLAR</Text>
      {squads.map((sq, i) => (
        <View key={i} style={styles.squadCard}>
          <Text style={styles.squadName}>{sq.username}</Text>
          <Text style={styles.info}>Formasyon: <Text style={styles.highlight}>{sq.formation}</Text></Text>
          <Text style={styles.info}>TD: <Text style={styles.highlight}>{sq.coach?.name ?? 'Seçilmedi'}</Text></Text>
          <Text style={styles.sectionLabel}>İlk 11</Text>
          {sq.players.map((p) => (
            <View key={p.id} style={styles.playerRow}>
              <View style={[styles.posBadge, { backgroundColor: posBg(p.position_group) }]}>
                <Text style={styles.posText}>{p.position_group}</Text>
              </View>
              <Text style={styles.playerName}>{p.name}</Text>
              <Text style={styles.playerPrice}>{p.price} TL</Text>
            </View>
          ))}
        </View>
      ))}
      {isHost && (
        <TouchableOpacity
          style={[styles.btn, loading && styles.btnDisabled]}
          onPress={startTournament}
          disabled={loading}
        >
          <Text style={styles.btnText}>{loading ? 'Turnuva oluşturuluyor...' : '🏆 Turnuvayı Başlat'}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const posBg = (g: string) => ({ GK: '#f59e0b', DEF: '#3b82f6', MID: '#22c55e', FWD: '#ef4444' }[g] ?? '#6b7280');

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  container: { padding: 20, paddingBottom: 40 },
  title: { color: '#f3f4f6', fontWeight: '900', fontSize: 20, textAlign: 'center', marginBottom: 20 },
  squadCard: { backgroundColor: '#1f2937', borderRadius: 12, padding: 16, marginBottom: 16 },
  squadName: { color: '#fbbf24', fontWeight: '900', fontSize: 16, marginBottom: 8 },
  info: { color: '#9ca3af', fontSize: 13, marginBottom: 2 },
  highlight: { color: '#f3f4f6', fontWeight: '600' },
  sectionLabel: { color: '#6b7280', fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  playerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  posBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, marginRight: 8 },
  posText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  playerName: { color: '#e5e7eb', fontSize: 13, flex: 1 },
  playerPrice: { color: '#fbbf24', fontSize: 12, fontWeight: '600' },
  btn: { backgroundColor: '#16a34a', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnDisabled: { backgroundColor: '#374151' },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
