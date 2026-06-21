import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { simulateMatch, resetMatchSimulator } from '../../../../src/lib/matchSimulator';
import { getSlotsForFormation } from '../../../../src/lib/formationUtils';
import MatchEventFeed from '../../../../src/components/MatchEventFeed';
import type { Squad, MatchEvent, Formation } from '../../../../src/types/game';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GEMINI_KEY_STORAGE = 'gemini_api_key';

export default function MatchScreen() {
  const { id: roomId, matchId } = useLocalSearchParams<{ id: string; matchId: string }>();
  const [match, setMatch] = useState<any>(null);
  const [homeSquad, setHomeSquad] = useState<Squad | null>(null);
  const [awaySquad, setAwaySquad] = useState<Squad | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [summary, setSummary] = useState('');
  const [mvp, setMvp] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [tempKey, setTempKey] = useState('');
  const [usernames, setUsernames] = useState<Record<string, string>>({});

  useEffect(() => {
    AsyncStorage.getItem(GEMINI_KEY_STORAGE).then((k) => { if (k) setApiKey(k); });
    fetchMatch();
  }, [matchId]);

  async function fetchMatch() {
    const { data: m } = await supabase.from('matches').select('*').eq('id', matchId).single();
    setMatch(m);
    if (m?.home_score !== undefined) { setHomeScore(m.home_score); setAwayScore(m.away_score); }
    if (m?.events?.length) { setEvents(m.events); setSummary(m.summary); setMvp(m.mvp); }

    const [{ data: rp }] = await Promise.all([
      supabase.from('room_players').select('user_id,username,formation,picked_coach_id').eq('room_id', roomId),
    ]);
    const unmap = Object.fromEntries((rp ?? []).map((p: any) => [p.user_id, p.username]));
    setUsernames(unmap);

    const buildSquad = async (userId: string): Promise<Squad | null> => {
      const player = (rp ?? []).find((p: any) => p.user_id === userId);
      if (!player) return null;
      const [{ data: picks }, { data: coach }] = await Promise.all([
        supabase.from('draft_picks').select('football_player_id').eq('room_id', roomId).eq('picker_id', userId).not('football_player_id', 'is', null),
        player.picked_coach_id
          ? supabase.from('coaches').select('*').eq('id', player.picked_coach_id).single()
          : Promise.resolve({ data: null }),
      ]);
      const playerIds = (picks ?? []).map((p: any) => p.football_player_id);
      const { data: footballPlayers } = await supabase.from('football_players').select('*').in('id', playerIds);

      const formation = player.formation as Formation;
      const slots = getSlotsForFormation(formation).map((slot) => ({
        ...slot,
        player: (footballPlayers ?? []).find((fp: any) =>
          fp.positions?.some((pos: string) => pos === slot.position)
        ),
      }));

      return {
        userId,
        formation,
        coach: coach ?? undefined,
        slots,
      };
    };

    if (m) {
      const [hs, as_] = await Promise.all([buildSquad(m.home_player_id), buildSquad(m.away_player_id)]);
      setHomeSquad(hs);
      setAwaySquad(as_);
    }
  }

  const saveApiKey = async () => {
    if (!tempKey.trim()) return;
    await AsyncStorage.setItem(GEMINI_KEY_STORAGE, tempKey.trim());
    setApiKey(tempKey.trim());
    setShowKeyInput(false);
  };

  const startSimulation = async () => {
    if (!apiKey) { setShowKeyInput(true); return; }
    if (!homeSquad || !awaySquad) { Alert.alert('Kadrolar yüklenemedi'); return; }

    resetMatchSimulator();
    setEvents([]);
    setHomeScore(0); setAwayScore(0);
    setSummary(''); setMvp('');
    setIsLive(true);

    await supabase.from('matches').update({ status: 'live' }).eq('id', matchId);

    simulateMatch(
      homeSquad, awaySquad,
      usernames[match.home_player_id] ?? 'Ev Sahibi',
      usernames[match.away_player_id] ?? 'Deplasman',
      apiKey,
      (event) => { setEvents((prev) => [...prev, event]); },
      async (result) => {
        setHomeScore(result.home_score);
        setAwayScore(result.away_score);
        setSummary(result.summary);
        setMvp(result.mvp);
        setIsLive(false);

        // Save to DB
        await supabase.from('matches').update({
          status: 'finished',
          home_score: result.home_score,
          away_score: result.away_score,
          events: result.events,
          summary: result.summary,
          mvp: result.mvp,
          played_at: new Date().toISOString(),
        }).eq('id', matchId);

        // Update standings
        await updateStandings(match.home_player_id, match.away_player_id, result.home_score, result.away_score);
      },
      (err) => { Alert.alert('Simülasyon Hatası', err); setIsLive(false); },
    );
  };

  async function updateStandings(homeId: string, awayId: string, hScore: number, aScore: number) {
    const updateRow = async (uid: string, gf: number, ga: number) => {
      const { data: s } = await supabase.from('standings').select('*').eq('room_id', roomId).eq('user_id', uid).single();
      if (!s) return;
      const won = gf > ga ? 1 : 0, drawn = gf === ga ? 1 : 0, lost = gf < ga ? 1 : 0;
      await supabase.from('standings').update({
        played: s.played + 1, won: s.won + won, drawn: s.drawn + drawn, lost: s.lost + lost,
        goals_for: s.goals_for + gf, goals_against: s.goals_against + ga,
        points: s.points + (won * 3) + drawn,
      }).eq('room_id', roomId).eq('user_id', uid);
    };
    await Promise.all([updateRow(homeId, hScore, aScore), updateRow(awayId, aScore, hScore)]);
  }

  const isFinished = match?.status === 'finished';

  return (
    <View style={styles.screen}>
      {showKeyInput ? (
        <View style={styles.keyModal}>
          <Text style={styles.keyTitle}>Gemini API Key</Text>
          <Text style={styles.keyDesc}>Google AI Studio'dan ücretsiz key alabilirsin: aistudio.google.com</Text>
          <TextInput
            style={styles.keyInput}
            placeholder="AIza..."
            placeholderTextColor="#6b7280"
            value={tempKey}
            onChangeText={setTempKey}
            secureTextEntry
          />
          <TouchableOpacity style={styles.keyBtn} onPress={saveApiKey}>
            <Text style={styles.keyBtnText}>Kaydet ve Devam Et</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowKeyInput(false)}>
            <Text style={styles.cancel}>İptal</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <MatchEventFeed
            events={events}
            homeUsername={usernames[match?.home_player_id] ?? 'Ev Sahibi'}
            awayUsername={usernames[match?.away_player_id] ?? 'Deplasman'}
            homeScore={homeScore}
            awayScore={awayScore}
            isLive={isLive}
          />

          {summary ? (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryTitle}>Maç Özeti</Text>
              <Text style={styles.summaryText}>{summary}</Text>
              <Text style={styles.mvp}>⭐ MVP: {mvp}</Text>
            </View>
          ) : null}

          <View style={styles.footer}>
            {!isFinished && !isLive && (
              <TouchableOpacity style={styles.startBtn} onPress={startSimulation}>
                <Text style={styles.startBtnText}>▶ Maçı Başlat</Text>
              </TouchableOpacity>
            )}
            {isLive && <Text style={styles.simulating}>🔄 Simüle ediliyor...</Text>}
            {isFinished && (
              <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
                <Text style={styles.backBtnText}>← Fikstüre Dön</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setShowKeyInput(true)}>
              <Text style={styles.changeKey}>🔑 API Key</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  summaryBox: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, marginTop: 8 },
  summaryTitle: { color: '#f3f4f6', fontWeight: '700', marginBottom: 6 },
  summaryText: { color: '#9ca3af', fontSize: 13, lineHeight: 20 },
  mvp: { color: '#fbbf24', fontWeight: '700', marginTop: 6 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  startBtn: { flex: 1, backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  startBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  simulating: { color: '#9ca3af', flex: 1, textAlign: 'center' },
  backBtn: { flex: 1, backgroundColor: '#1f2937', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  backBtnText: { color: '#60a5fa', fontWeight: '700' },
  changeKey: { color: '#6b7280', fontSize: 12 },
  keyModal: { flex: 1, justifyContent: 'center', padding: 24 },
  keyTitle: { color: '#f3f4f6', fontWeight: '900', fontSize: 20, textAlign: 'center', marginBottom: 8 },
  keyDesc: { color: '#9ca3af', fontSize: 13, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  keyInput: { backgroundColor: '#1f2937', color: '#f3f4f6', borderRadius: 10, padding: 14, fontSize: 14, marginBottom: 12 },
  keyBtn: { backgroundColor: '#22c55e', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  keyBtnText: { color: '#0f172a', fontWeight: '900' },
  cancel: { color: '#6b7280', textAlign: 'center' },
});
