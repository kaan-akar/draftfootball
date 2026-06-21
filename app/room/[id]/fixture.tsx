import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';

export default function FixtureScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const [matches, setMatches] = useState<any[]>([]);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    fetchData();
    const channel = supabase.channel(`fixture-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `room_id=eq.${roomId}` }, fetchData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  async function fetchData() {
    const [{ data: m }, { data: rp }, { data: room }] = await Promise.all([
      supabase.from('matches').select('*').eq('room_id', roomId).order('round'),
      supabase.from('room_players').select('user_id,username').eq('room_id', roomId),
      supabase.from('game_rooms').select('host_id').eq('id', roomId).single(),
    ]);
    setMatches(m ?? []);
    setUsernames(Object.fromEntries((rp ?? []).map((p: any) => [p.user_id, p.username])));
    const uid = (await supabase.auth.getSession()).data.session?.user.id ?? '';
    setIsHost(room?.host_id === uid);

    const liveMatch = (m ?? []).find((match: any) => match.status === 'live');
    if (liveMatch) {
      router.replace(`/room/${roomId}/match/${liveMatch.id}`);
    }
  }

  const startMatch = (matchId: string) => {
    router.push(`/room/${roomId}/match/${matchId}`);
  };

  const goStandings = () => router.push(`/room/${roomId}/standings`);

  const STATUS_LABEL: Record<string, string> = {
    scheduled: '📅 Planlandı', live: '🔴 Canlı', finished: '✅ Bitti',
  };
  const liveMatchId = matches.find((match) => match.status === 'live')?.id;
  const nextScheduledMatchId = matches.find((match) => match.status === 'scheduled')?.id;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📅 FİKSTÜR</Text>
        <TouchableOpacity onPress={goStandings}>
          <Text style={styles.standingsBtn}>📊 Puan Tablosu</Text>
        </TouchableOpacity>
      </View>

      {matches.map((m) => (
        <View key={m.id} style={[styles.matchCard, m.status === 'finished' && styles.matchDone]}>
          <Text style={styles.matchRound}>Maç {m.round}</Text>
          <View style={styles.matchRow}>
            <Text style={styles.teamName}>{usernames[m.home_player_id] ?? '?'}</Text>
            {m.status === 'finished'
              ? <Text style={styles.score}>{m.home_score} – {m.away_score}</Text>
              : <Text style={styles.vs}>vs</Text>
            }
            <Text style={styles.teamName}>{usernames[m.away_player_id] ?? '?'}</Text>
          </View>
          <Text style={styles.status}>{STATUS_LABEL[m.status] ?? m.status}</Text>
          {isHost && !liveMatchId && m.status === 'scheduled' && m.id === nextScheduledMatchId && (
            <TouchableOpacity style={styles.playBtn} onPress={() => startMatch(m.id)}>
              <Text style={styles.playBtnText}>▶ Sıradaki Maçı Oyna</Text>
            </TouchableOpacity>
          )}
          {!liveMatchId && m.status === 'scheduled' && m.id !== nextScheduledMatchId && (
            <Text style={styles.queueNote}>Önce önceki maçların bitmesi gerekiyor.</Text>
          )}
          {liveMatchId === m.id && (
            <TouchableOpacity style={styles.watchBtn} onPress={() => startMatch(m.id)}>
              <Text style={styles.watchBtnText}>👀 Canlı Maçı İzle</Text>
            </TouchableOpacity>
          )}
          {m.status === 'finished' && (
            <TouchableOpacity style={styles.replayBtn} onPress={() => startMatch(m.id)}>
              <Text style={styles.replayBtnText}>📄 Özet</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      {matches.length > 0 && matches.every((m) => m.status === 'finished') && (
        <TouchableOpacity
          style={styles.championBtn}
          onPress={() => router.replace(`/room/${roomId}/champion`)}
        >
          <Text style={styles.championBtnText}>🏆 Şampiyonu Gör!</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  container: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { color: '#f3f4f6', fontWeight: '900', fontSize: 20 },
  standingsBtn: { color: '#60a5fa', fontSize: 13 },
  matchCard: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, marginBottom: 10 },
  matchDone: { opacity: 0.75 },
  matchRound: { color: '#6b7280', fontSize: 11, marginBottom: 8 },
  matchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  teamName: { color: '#f3f4f6', fontWeight: '700', fontSize: 14, flex: 1, textAlign: 'center' },
  score: { color: '#fbbf24', fontWeight: '900', fontSize: 22, marginHorizontal: 8 },
  vs: { color: '#6b7280', fontSize: 16, marginHorizontal: 8 },
  status: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 6 },
  playBtn: { backgroundColor: '#16a34a', borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 8 },
  playBtnText: { color: '#fff', fontWeight: '700' },
  queueNote: { color: '#94a3b8', fontSize: 11, textAlign: 'center', marginTop: 8 },
  watchBtn: { backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 8 },
  watchBtnText: { color: '#fff', fontWeight: '700' },
  replayBtn: { backgroundColor: '#1f2937', borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 8 },
  replayBtnText: { color: '#60a5fa', fontWeight: '700' },
  championBtn: { backgroundColor: '#d97706', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  championBtnText: { color: '#fff', fontWeight: '900', fontSize: 16 },
});
