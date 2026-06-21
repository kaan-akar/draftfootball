import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { simulateMatch, simulateMatchLocally, resetMatchSimulator } from '../../../../src/lib/matchSimulator';
import { getSlotsForFormation } from '../../../../src/lib/formationUtils';
import MatchEventFeed from '../../../../src/components/MatchEventFeed';
import type { Squad, MatchEvent, Formation, MatchSimulationSource } from '../../../../src/types/game';

const SIMULATION_MINUTE_MS = 1000;

export default function MatchScreen() {
  const { id: roomId, matchId } = useLocalSearchParams<{ id: string; matchId: string }>();
  const [match, setMatch] = useState<any>(null);
  const [homeSquad, setHomeSquad] = useState<Squad | null>(null);
  const [awaySquad, setAwaySquad] = useState<Squad | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [currentMinute, setCurrentMinute] = useState(0);
  const [isLive, setIsLive] = useState(false);
  const [summary, setSummary] = useState('');
  const [mvp, setMvp] = useState('');
  const [simulationSource, setSimulationSource] = useState<MatchSimulationSource | null>(null);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [displayNames, setDisplayNames] = useState({ home: 'Ev Sahibi', away: 'Deplasman' });
  const [isHost, setIsHost] = useState(false);
  const currentMinuteRef = useRef(0);
  const eventsRef = useRef<MatchEvent[]>([]);
  const llmEnhancedRef = useRef<{ summary: string; mvp: string } | null>(null);
  const usernamesRef = useRef<Record<string, string>>({});

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

  useEffect(() => {
    const roomChannel = supabase
      .channel(`room-live-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `room_id=eq.${roomId}` }, async () => {
        const { data: roomMatches } = await supabase.from('matches').select('id,status').eq('room_id', roomId).order('round');
        const liveMatch = (roomMatches ?? []).find((candidate: any) => candidate.status === 'live');
        if (liveMatch && liveMatch.id !== matchId) {
          router.replace(`/room/${roomId}/match/${liveMatch.id}`);
          return;
        }

        const currentMatch = (roomMatches ?? []).find((candidate: any) => candidate.id === matchId);
        const hasRemainingMatches = (roomMatches ?? []).some((candidate: any) => candidate.status !== 'finished');
        if (currentMatch?.status === 'finished' && !hasRemainingMatches) {
          router.replace(`/room/${roomId}/champion`);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(roomChannel); };
  }, [matchId, roomId]);

  function applyMatchState(nextMatch: any) {
    const nextMinute = nextMatch?.current_minute ?? 0;
    const nextEvents = nextMatch?.events ?? [];
    if (nextMatch?.status === 'live') {
      const hasOlderMinute = nextMinute < currentMinuteRef.current;
      const hasFewerEvents = nextEvents.length < eventsRef.current.length;
      if (hasOlderMinute || hasFewerEvents) {
        return;
      }
    }

    setMatch(nextMatch);
    setHomeScore(nextMatch?.home_score ?? 0);
    setAwayScore(nextMatch?.away_score ?? 0);
    currentMinuteRef.current = nextMinute;
    eventsRef.current = nextEvents;
    setCurrentMinute(nextMinute);
    setEvents(nextEvents);
    setSummary(nextMatch?.summary ?? '');
    setMvp(nextMatch?.mvp ?? '');
    setSimulationSource(nextMatch?.simulation_source ?? null);
    setIsLive(nextMatch?.status === 'live');
    syncDisplayNames(nextMatch, usernamesRef.current);
  }

  function syncDisplayNames(nextMatch: any, nextUsernames: Record<string, string>) {
    const homeName = nextMatch?.home_player_id ? nextUsernames[nextMatch.home_player_id] : undefined;
    const awayName = nextMatch?.away_player_id ? nextUsernames[nextMatch.away_player_id] : undefined;

    setDisplayNames((prev) => ({
      home: homeName ?? prev.home,
      away: awayName ?? prev.away,
    }));
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

function syncPlaybackState(nextEvents: MatchEvent[], minute: number) {
    const score = calculateLiveScore(nextEvents);
    eventsRef.current = nextEvents;
    setEvents(nextEvents);
    setHomeScore(score.home);
    setAwayScore(score.away);
    currentMinuteRef.current = minute;
    setCurrentMinute(minute);
  }

  async function publishPlaybackSnapshot(
    nextEvents: MatchEvent[],
    source: MatchSimulationSource | null,
    minute: number,
  ) {
    const score = calculateLiveScore(nextEvents);

    await supabase.from('matches').update({
      status: 'live',
      simulation_source: source,
      current_minute: minute,
      home_score: score.home,
      away_score: score.away,
      events: nextEvents,
    }).eq('id', matchId);
  }

  async function persistPlaybackSnapshot(
    nextEvents: MatchEvent[],
    source: MatchSimulationSource | null,
    minute: number,
  ) {
    syncPlaybackState(nextEvents, minute);
    await publishPlaybackSnapshot(nextEvents, source, minute);
  }

  async function playLocalFallbackSimulation() {
    if (!homeSquad || !awaySquad || !match) return;

    setSimulationSource('local');
    await supabase.from('matches').update({
      status: 'live',
      simulation_source: 'local',
      current_minute: currentMinuteRef.current,
    }).eq('id', matchId);

    const result = simulateMatchLocally(
      homeSquad,
      awaySquad,
      usernames[match.home_player_id] ?? 'Ev Sahibi',
      usernames[match.away_player_id] ?? 'Deplasman',
    );

    await playTimeline(result, 'local', currentMinuteRef.current);
  }

  async function fetchMatch() {
    const [{ data: m }, { data: room }] = await Promise.all([
      supabase.from('matches').select('*').eq('id', matchId).single(),
      supabase.from('game_rooms').select('host_id').eq('id', roomId).single(),
    ]);
    applyMatchState(m);

    const [{ data: rp }] = await Promise.all([
      supabase.from('room_players').select('user_id,username,formation,picked_coach_id').eq('room_id', roomId),
    ]);
    const unmap = Object.fromEntries((rp ?? []).map((p: any) => [p.user_id, p.username]));
    usernamesRef.current = unmap;
    setUsernames(unmap);
    syncDisplayNames(m, unmap);
    const uid = (await supabase.auth.getSession()).data.session?.user.id ?? '';
    setIsHost(room?.host_id === uid);

    const liveMatch = (await supabase.from('matches').select('id,status').eq('room_id', roomId).order('round')).data?.find((candidate: any) => candidate.status === 'live');
    if (liveMatch && liveMatch.id !== matchId) {
      router.replace(`/room/${roomId}/match/${liveMatch.id}`);
      return;
    }

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
    const enhanced = llmEnhancedRef.current;
    const finalSummary = enhanced?.summary ?? result.summary;
    const finalMvp = enhanced?.mvp ?? result.mvp;
    const finalSource: MatchSimulationSource = enhanced ? 'llm' : (source ?? 'local');

    setHomeScore(result.home_score);
    setAwayScore(result.away_score);
    setCurrentMinute(90);
    setSummary(finalSummary);
    setMvp(finalMvp);
    setEvents(result.events);
    setSimulationSource(finalSource);
    setIsLive(false);

    await supabase.from('matches').update({
      status: 'finished',
      simulation_source: finalSource,
      current_minute: 90,
      home_score: result.home_score,
      away_score: result.away_score,
      events: result.events,
      summary: finalSummary,
      mvp: finalMvp,
      played_at: new Date().toISOString(),
    }).eq('id', matchId);

    await updateStandings(match.home_player_id, match.away_player_id, result.home_score, result.away_score);

    if (isHost) {
      await startNextMatchInQueue();
    }
  }

  async function getOrderedMatches() {
    const { data } = await supabase.from('matches').select('*').eq('room_id', roomId).order('round');
    return data ?? [];
  }

  async function startNextMatchInQueue() {
    const roomMatches = await getOrderedMatches();
    const nextMatch = roomMatches.find((candidate: any) => candidate.status === 'scheduled');

    if (!nextMatch) {
      router.replace(`/room/${roomId}/champion`);
      return;
    }

    const { data: claimedMatch, error } = await supabase
      .from('matches')
      .update({ status: 'live' })
      .eq('id', nextMatch.id)
      .eq('status', 'scheduled')
      .select('*')
      .single();

    if (error || !claimedMatch) {
      return;
    }

    router.replace(`/room/${roomId}/match/${claimedMatch.id}?autostart=1`);
  }

  async function playTimeline(
    result: { events: MatchEvent[]; home_score: number; away_score: number; summary: string; mvp: string },
    source: MatchSimulationSource,
    startMinute = 0,
  ) {
    const orderedEvents = buildMinuteTimeline(result.events);
    let shownEvents: MatchEvent[] = orderedEvents.filter((event) => event.minute <= startMinute);
    let nextEventIndex = shownEvents.length;

    eventsRef.current = shownEvents;
    setEvents(shownEvents);

    if (startMinute > 0) {
      syncPlaybackState(shownEvents, startMinute);
      void publishPlaybackSnapshot(shownEvents, source, startMinute);
    } else {
      currentMinuteRef.current = 0;
      eventsRef.current = [];
      setCurrentMinute(0);
    }

    for (let minute = Math.max(startMinute + 1, 1); minute <= 90; minute += 1) {
      while (nextEventIndex < orderedEvents.length && orderedEvents[nextEventIndex].minute <= minute) {
        shownEvents = [...shownEvents, orderedEvents[nextEventIndex]];
        nextEventIndex += 1;
      }

      syncPlaybackState(shownEvents, minute);
      void publishPlaybackSnapshot(shownEvents, source, minute);
      await new Promise((resolve) => setTimeout(resolve, SIMULATION_MINUTE_MS));
    }

    await persistMatchResult(result, source);
  }


  function buildMinuteTimeline(baseEvents: MatchEvent[]) {
    const sortedEvents = [...baseEvents].sort((a, b) => a.minute - b.minute);
    const minutesWithEvents = new Set(sortedEvents.map((event) => event.minute));
    const timeline: MatchEvent[] = [...sortedEvents];

    for (let minute = 1; minute <= 90; minute += 1) {
      if (minutesWithEvents.has(minute)) continue;
      timeline.push({
        minute,
        type: 'action',
        team: minute % 2 === 0 ? 'home' : 'away',
        description: `${minute}' Oyun bu dakikada kontrollu tempoda devam ediyor. Iki takim da bosluk ariyor.`,
      });
    }

    return timeline.sort((a, b) => a.minute - b.minute || a.type.localeCompare(b.type));
  }

  async function ensureCurrentMatchIsPlayable() {
    const roomMatches = await getOrderedMatches();
    const liveMatch = roomMatches.find((candidate: any) => candidate.status === 'live');
    if (liveMatch && liveMatch.id !== matchId) {
      router.replace(`/room/${roomId}/match/${liveMatch.id}`);
      return false;
    }

    const nextScheduledMatch = roomMatches.find((candidate: any) => candidate.status === 'scheduled');
    if (!liveMatch && nextScheduledMatch && nextScheduledMatch.id !== matchId && match?.status === 'scheduled') {
      Alert.alert('Sıralı oynatma aktif', 'Önce sıradaki maçı bitirmen gerekiyor.');
      router.replace(`/room/${roomId}/match/${nextScheduledMatch.id}`);
      return false;
    }

    return true;
  }

  const startSimulation = async () => {
    if (!homeSquad || !awaySquad) { Alert.alert('Kadrolar yüklenemedi'); return; }
    if (!(await ensureCurrentMatchIsPlayable())) return;

    const homeUsername = displayNames.home;
    const awayUsername = displayNames.away;

    resetMatchSimulator();
    llmEnhancedRef.current = null;
    eventsRef.current = [];
    setEvents([]);
    setHomeScore(0); setAwayScore(0);
    currentMinuteRef.current = 0;
    setCurrentMinute(0);
    setSummary(''); setMvp('');
    setSimulationSource('local');
    setIsLive(true);

    await supabase.from('matches').update({
      status: 'live', simulation_source: 'local', current_minute: 0, events: [],
    }).eq('id', matchId);

    // Fire LLM in background — result enhances summary/mvp only
    simulateMatch(
      homeSquad, awaySquad, homeUsername, awayUsername,
      () => {},
      (result) => {
        llmEnhancedRef.current = { summary: result.summary, mvp: result.mvp };
        setSimulationSource('llm');
      },
      () => {},
    );

    // Immediately run local simulation — drives the live feed reliably
    const localResult = simulateMatchLocally(homeSquad, awaySquad, homeUsername, awayUsername);
    await playTimeline(localResult, 'local');
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
  const { autostart } = useLocalSearchParams<{ autostart?: string }>();

  useEffect(() => {
    if (autostart !== '1') return;
    if (!isHost || isLive || isFinished || !homeSquad || !awaySquad || !match) return;
    void startSimulation();
  }, [autostart, isHost, isLive, isFinished, homeSquad, awaySquad, match]);

  return (
    <View style={styles.screen}>
      <MatchEventFeed
        events={events}
        homeUsername={displayNames.home}
        awayUsername={displayNames.away}
        homeScore={homeScore}
        awayScore={awayScore}
        currentMinute={currentMinute}
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
