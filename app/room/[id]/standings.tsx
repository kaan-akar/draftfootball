import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { buildStandings } from '../../../src/lib/tournamentEngine';
import type { Standing } from '../../../src/types/game';

export default function StandingsScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const [standings, setStandings] = useState<Standing[]>([]);

  useEffect(() => {
    fetchStandings();
    const channel = supabase.channel(`standings-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'standings', filter: `room_id=eq.${roomId}` }, fetchStandings)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  async function fetchStandings() {
    const { data } = await supabase.from('standings').select('*').eq('room_id', roomId);
    setStandings(
      (data ?? []).sort((a: any, b: any) => {
        if (b.points !== a.points) return b.points - a.points;
        const gdA = a.goals_for - a.goals_against;
        const gdB = b.goals_for - b.goals_against;
        if (gdB !== gdA) return gdB - gdA;
        return b.goals_for - a.goals_for;
      })
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>📊 PUAN TABLOSU</Text>
      <View style={styles.tableHeader}>
        {['#', 'Oyuncu', 'O', 'G', 'B', 'M', 'GF', 'GA', 'Av', 'P'].map((h) => (
          <Text key={h} style={[styles.th, h === 'Oyuncu' && styles.thName]}>{h}</Text>
        ))}
      </View>
      {standings.map((s: any, i) => (
        <View key={s.user_id} style={[styles.row, i === 0 && styles.rowFirst]}>
          <Text style={[styles.td, styles.tdRank]}>{i + 1}</Text>
          <Text style={[styles.td, styles.tdName]}>{s.username ?? s.user_id.slice(0, 6)}</Text>
          <Text style={styles.td}>{s.played}</Text>
          <Text style={[styles.td, { color: '#22c55e' }]}>{s.won}</Text>
          <Text style={styles.td}>{s.drawn}</Text>
          <Text style={[styles.td, { color: '#ef4444' }]}>{s.lost}</Text>
          <Text style={styles.td}>{s.goals_for}</Text>
          <Text style={styles.td}>{s.goals_against}</Text>
          <Text style={styles.td}>{s.goals_for - s.goals_against}</Text>
          <Text style={[styles.td, styles.tdPoints]}>{s.points}</Text>
        </View>
      ))}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backText}>← Fikstüre Dön</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  container: { padding: 16, paddingBottom: 40 },
  title: { color: '#f3f4f6', fontWeight: '900', fontSize: 20, textAlign: 'center', marginBottom: 16 },
  tableHeader: { flexDirection: 'row', backgroundColor: '#1f2937', borderRadius: 8, padding: 8, marginBottom: 4 },
  th: { color: '#6b7280', fontSize: 10, fontWeight: '700', flex: 1, textAlign: 'center' },
  thName: { flex: 3, textAlign: 'left' },
  row: { flexDirection: 'row', backgroundColor: '#111827', borderRadius: 6, padding: 8, marginBottom: 3 },
  rowFirst: { backgroundColor: '#1c2c1c', borderWidth: 1, borderColor: '#16a34a' },
  td: { color: '#e5e7eb', fontSize: 12, flex: 1, textAlign: 'center' },
  tdRank: { color: '#6b7280' },
  tdName: { flex: 3, textAlign: 'left', fontWeight: '600' },
  tdPoints: { fontWeight: '900', color: '#fbbf24' },
  backBtn: { backgroundColor: '#1f2937', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  backText: { color: '#60a5fa', fontWeight: '700' },
});
