import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';

export default function ChampionScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const [champion, setChampion] = useState<any>(null);
  const [standings, setStandings] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('standings').select('*').eq('room_id', roomId).then(({ data }) => {
      const sorted = (data ?? []).sort((a: any, b: any) => {
        if (b.points !== a.points) return b.points - a.points;
        return (b.goals_for - b.goals_against) - (a.goals_for - a.goals_against);
      });
      setStandings(sorted);
      setChampion(sorted[0] ?? null);
    });
    supabase.from('game_rooms').update({ status: 'finished' }).eq('id', roomId);
  }, [roomId]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.firework}>🎇🎆🎇</Text>
      <Text style={styles.title}>ŞAMPİYON!</Text>

      {champion && (
        <View style={styles.championCard}>
          <Text style={styles.trophy}>🏆</Text>
          <Text style={styles.championName}>{champion.username}</Text>
          <Text style={styles.championStats}>
            {champion.played} maç · {champion.won}G {champion.drawn}B {champion.lost}M
          </Text>
          <Text style={styles.championStats}>
            {champion.goals_for} gol attı · {champion.goals_against} gol yedi
          </Text>
          <Text style={styles.points}>{champion.points} PUAN</Text>
        </View>
      )}

      <Text style={styles.finalTable}>Final Sıralaması</Text>
      {standings.map((s, i) => (
        <View key={s.user_id} style={styles.row}>
          <Text style={styles.rank}>{i + 1}.</Text>
          <Text style={styles.rowName}>{s.username}</Text>
          <Text style={styles.rowPoints}>{s.points} P</Text>
        </View>
      ))}

      <TouchableOpacity style={styles.homeBtn} onPress={() => router.replace('/home')}>
        <Text style={styles.homeBtnText}>🏠 Ana Sayfaya Dön</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  container: { padding: 24, paddingBottom: 60, alignItems: 'center' },
  firework: { fontSize: 40, textAlign: 'center', marginBottom: 8 },
  title: { color: '#fbbf24', fontWeight: '900', fontSize: 36, textAlign: 'center', marginBottom: 24 },
  championCard: {
    backgroundColor: '#1c2c0a', borderRadius: 20, padding: 28,
    alignItems: 'center', borderWidth: 2, borderColor: '#22c55e',
    width: '100%', marginBottom: 32,
  },
  trophy: { fontSize: 64, marginBottom: 8 },
  championName: { color: '#f3f4f6', fontWeight: '900', fontSize: 28, textAlign: 'center' },
  championStats: { color: '#9ca3af', fontSize: 14, marginTop: 4 },
  points: { color: '#fbbf24', fontWeight: '900', fontSize: 22, marginTop: 12 },
  finalTable: { color: '#6b7280', fontWeight: '700', fontSize: 14, marginBottom: 12, alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 6, width: '100%' },
  rank: { color: '#6b7280', fontWeight: '700', width: 28 },
  rowName: { color: '#f3f4f6', fontWeight: '600', flex: 1 },
  rowPoints: { color: '#fbbf24', fontWeight: '700' },
  homeBtn: { backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 40, marginTop: 24 },
  homeBtnText: { color: '#0f172a', fontWeight: '900', fontSize: 16 },
});
