import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { simulateMatch, simulateMatchLocally, resetMatchSimulator } from '../../../../src/lib/matchSimulator';
import { getSlotsForFormation } from '../../../../src/lib/formationUtils';
import MatchEventFeed from '../../../../src/components/MatchEventFeed';
import type { Squad, MatchEvent, Formation, MatchSimulationSource } from '../../../../src/types/game';

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
  const [simulationSource, setSimulationSource] = useState<MatchSimulationSource | null>(null);
  const [usernames, setUsernames] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchMatch();
  }, [matchId]);

  useEffect(() => {
    const channel = supabase
      .channel(`match-live-${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, ({ new: nextMatch }: any) => {
        if (!nextMatch) return;
        applyMatchState(nextMatch);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [matchId]);

  function applyMatchState(nextMatch: any) {
    setMatch(nextMatch);
    setHomeScore(nextMatch?.home_score ?? 0);
    setAwayScore(nextMatch?.away_score ?? 0);
    setEvents(nextMatch?.events ?? []);
    setSummary(nextMatch?.summary ?? '');
    setMvp(nextMatch?.mvp ?? '');
    setSimulationSource(nextMatch?.simulation_source ?? null);
    setIsLive(nextMatch?.status === 'live');
  }

  function getSimulationSourceLabel(source: MatchSimulationSource | null) {
    if (source === 'llm') return 'LLM destekli canlı anlatım';
    if (source === 'local') return 'Yerel hızlı simülasyon';
    return null;
  }

  function calculateLiveScore(nextEvents: MatchEvent[]) {
    return nextEvents.reduce(
      (score, event) => {
        if (event.type === 'goal') {
          if (event.team === 'home') score.home += 1;
          else score.away += 1;
        }
        return score;
      },
      { home: 0, away: 0 },
    );
  }

  async function persistLiveSnapshot(nextEvents: MatchEvent[], source: MatchSimulationSource | null) {
    const score = calculateLiveScore(nextEvents);
    setHomeScore(score.home);
    setAwayScore(score.away);

    await supabase.from('matches').update({
      status: 'live',
      simulation_source: source,
      home_score: score.home,
      away_score: score.away,
      events: nextEvents,
    }).eq('id', matchId);
  }

  async function playLocalFallbackSimulation() {
    if (!homeSquad || !awaySquad || !match) return;

    setSimulationSource('local');
    await supabase.from('matches').update({ status: 'live', simulation_source: 'local' }).eq('id', matchId);

    const result = simulateMatchLocally(
      homeSquad,
      awaySquad,
      usernames[match.home_player_id] ?? 'Ev Sahibi',
      usernames[match.away_player_id] ?? 'Deplasman',
    );

    let streamedEvents: MatchEvent[] = [];
    for (const event of result.events) {
      streamedEvents = [...streamedEvents, event];
      setEvents(streamedEvents);
      await persistLiveSnapshot(streamedEvents, 'local');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await persistMatchResult(result, 'local');
  }

  async function fetchMatch() {
    const { data: m } = await supabase.from('matches').select('*').eq('id', matchId).single();
    applyMatchState(m);

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

  async function persistMatchResult(
    result: { home_score: number; away_score: number; summary: string; mvp: string; events: MatchEvent[] },
    source: MatchSimulationSource | null,
  ) {
    setHomeScore(result.home_score);
    setAwayScore(result.away_score);
    setSummary(result.summary);
    setMvp(result.mvp);
    setEvents(result.events);
    setSimulationSource(source);
    setIsLive(false);

    await supabase.from('matches').update({
      status: 'finished',
      simulation_source: source,
      home_score: result.home_score,
      away_score: result.away_score,
      events: result.events,
      summary: result.summary,
      mvp: result.mvp,
      played_at: new Date().toISOString(),
    }).eq('id', matchId);

    await updateStandings(match.home_player_id, match.away_player_id, result.home_score, result.away_score);
  }

  const startSimulation = async () => {
    if (!homeSquad || !awaySquad) { Alert.alert('Kadrolar yüklenemedi'); return; }

    resetMatchSimulator();
    setEvents([]);
    setHomeScore(0); setAwayScore(0);
    setSummary(''); setMvp('');
    setSimulationSource('llm');
    setIsLive(true);

    await supabase.from('matches').update({ status: 'live', simulation_source: 'llm' }).eq('id', matchId);

    simulateMatch(
      homeSquad, awaySquad,
      usernames[match.home_player_id] ?? 'Ev Sahibi',
      usernames[match.away_player_id] ?? 'Deplasman',
      (event) => {
        setEvents((prev) => {
          const nextEvents = [...prev, event];
          void persistLiveSnapshot(nextEvents, 'llm');
          return nextEvents;
        });
      },
      async (result) => { await persistMatchResult(result, 'llm'); },
      async (err) => {
        if (err.startsWith('RATE_LIMIT:')) {
          Alert.alert('Gemini limitine takıldı', 'Geçici olarak yerel hızlı simülasyona geçiliyor.');
          await playLocalFallbackSimulation();
          return;
        }
        if (err.startsWith('MODEL_NOT_FOUND:')) {
          Alert.alert('Gemini modeli bulunamadı', 'Güncel model endpointi kullanılamadı. Yerel hızlı simülasyona geçiliyor.');
          await playLocalFallbackSimulation();
          return;
        }
        if (err.startsWith('Ağ hatası:')) {
          Alert.alert('Gemini ağına ulaşılamadı', 'API servisine erişilemedi. Yerel hızlı simülasyona geçiliyor.');
          await playLocalFallbackSimulation();
          return;
        }
        Alert.alert('Simülasyon Hatası', err);
        setIsLive(false);
      },
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
  const simulationSourceLabel = getSimulationSourceLabel(simulationSource);

  return (
    <View style={styles.screen}>
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

      {(isLive || isFinished) && simulationSourceLabel ? (
        <Text style={styles.simulationNote}>Bu maç {simulationSourceLabel.toLowerCase()} ile oynatıldı.</Text>
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a', padding: 16 },
  summaryBox: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, marginTop: 8 },
  summaryTitle: { color: '#f3f4f6', fontWeight: '700', marginBottom: 6 },
  summaryText: { color: '#9ca3af', fontSize: 13, lineHeight: 20 },
  mvp: { color: '#fbbf24', fontWeight: '700', marginTop: 6 },
  simulationNote: { color: '#94a3b8', fontSize: 12, marginTop: 8, textAlign: 'center' },
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
