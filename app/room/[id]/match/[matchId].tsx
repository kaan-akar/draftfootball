import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../../src/lib/supabase';
import { simulateMatch, simulateMatchLocally, resetMatchSimulator } from '../../../../src/lib/matchSimulator';
import { assignPlayersToFormation } from '../../../../src/lib/formationUtils';
import MatchEventFeed from '../../../../src/components/MatchEventFeed';
import type { Squad, MatchEvent, Formation, MatchSimulationSource } from '../../../../src/types/game';

const SIMULATION_MINUTE_MS = 1000;

// Deterministically pick the single live match for a room. Ordering by round
// then id guarantees every client agrees on the same match, which prevents the
// redirect ping-pong that happens when more than one match is left 'live'.
function pickLiveMatch(matches: any[]) {
  return (matches ?? [])
    .filter((candidate) => candidate?.status === 'live')
    .sort((a, b) => (a.round ?? 0) - (b.round ?? 0) || String(a.id).localeCompare(String(b.id)))[0] ?? null;
}

// Resolved team names cached per match id at module scope so they survive even
// a full component remount (e.g. a redirect back to the same match). Without
// this, a remount resets local state and the labels briefly fall back to
// "Ev Sahibi / Deplasman" before the usernames are refetched — the flicker the
// host kept seeing.
const teamNameCache: Record<string, { home: string; away: string }> = {};

const MatchLineups = React.memo(({
  homeSquad,
  awaySquad,
  displayNames,
}: {
  homeSquad: Squad | null;
  awaySquad: Squad | null;
  displayNames: { home: string; away: string };
}) => {
  if (!homeSquad || !awaySquad) return null;

  return (
    <View style={styles.lineupBox}>
      {(['home', 'away'] as const).map((side) => {
        const squad = side === 'home' ? homeSquad : awaySquad;
        const name = side === 'home' ? displayNames.home : displayNames.away;
        return (
          <View key={side} style={styles.lineupCol}>
            <Text style={styles.lineupTeam} numberOfLines={1}>{name}</Text>
            <Text style={styles.lineupFormation}>{squad.formation}</Text>
            {squad.coach ? (
              <Text style={styles.lineupCoach} numberOfLines={1}>🧑‍🏫 {squad.coach.name}</Text>
            ) : null}
            {squad.slots.map((slot) => (
              <View key={slot.slotId} style={styles.lineupRow}>
                <Text style={styles.lineupSlot}>{slot.position}</Text>
                <Text style={styles.lineupPlayer} numberOfLines={1}>
                  {slot.player?.name ?? '—'}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
});

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
  const [isHost, setIsHost] = useState(false);

  // Team names are derived from the match + usernames, never stored as their own
  // state. Once we have resolved real names for this match we cache them at
  // module scope (keyed by matchId) and never fall back to the defaults again,
  // so a transient empty `usernames` snapshot — or even a full remount — can't
  // flip the labels between real names and "Ev Sahibi / Deplasman".
  const displayNames = useMemo(() => {
    const cached = teamNameCache[matchId as string];
    const homeName = match?.home_player_id ? usernames[match.home_player_id] : undefined;
    const awayName = match?.away_player_id ? usernames[match.away_player_id] : undefined;
    const home = homeName || cached?.home || 'Ev Sahibi';
    const away = awayName || cached?.away || 'Deplasman';
    if (homeName || awayName) teamNameCache[matchId as string] = { home, away };
    return { home, away };
  }, [matchId, match?.home_player_id, match?.away_player_id, usernames]);

  const isPlayingRef = useRef(false);
  const currentMinuteRef = useRef(0);
  const eventsRef = useRef<MatchEvent[]>([]);
  const llmEnhancedRef = useRef<{ summary: string; mvp: string } | null>(null);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `room_id=eq.${roomId}` }, async ({ new: changedRow }: any) => {
        // While we (the host) are actively playing this match, never react to
        // room updates — our own per-minute writes would otherwise trigger a
        // redirect check and could bounce us to another screen mid-playback.
        if (isPlayingRef.current) return;
        // Skip noisy live-playback updates for the current match — only act on status transitions
        if (changedRow?.id === matchId && changedRow?.status === 'live') return;
        const { data: roomMatches } = await supabase.from('matches').select('id,status,round').eq('room_id', roomId).order('round');
        // If our own match is currently live, never redirect away from it. This
        // is what stops the back-and-forth between two simultaneously-live matches.
        const current = (roomMatches ?? []).find((candidate: any) => candidate.id === matchId);
        if (current?.status === 'live') return;
        const liveMatch = pickLiveMatch(roomMatches ?? []);
        if (liveMatch && liveMatch.id !== matchId) {
          router.replace(`/room/${roomId}/match/${liveMatch.id}`);
        }
        // Champion redirect is handled by the game_rooms channel below.
      })
      .subscribe();

    // When the host finishes the tournament, game_rooms.status becomes 'finished'.
    // All players (including non-host viewers) redirect to the champion screen.
    const roomStatusChannel = supabase
      .channel(`room-status-${roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` }, ({ new: room }: any) => {
        if (room?.status === 'finished') {
          router.replace(`/room/${roomId}/champion`);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(roomChannel);
      supabase.removeChannel(roomStatusChannel);
    };
  }, [matchId, roomId]);

  function applyMatchState(nextMatch: any) {
    // If we are the host and actively running playback, ignore realtime snapshots
    // (they are our own writes bouncing back, which causes PC flicker)
    if (isPlayingRef.current) return;

    const nextMinute = nextMatch?.current_minute ?? 0;
    const nextEvents = nextMatch?.events ?? [];
    if (nextMatch?.status === 'live') {
      const hasOlderMinute = nextMinute < currentMinuteRef.current;
      const hasFewerEvents = nextEvents.length < eventsRef.current.length;
      if (hasOlderMinute || hasFewerEvents) {
        return;
      }

      const minuteUnchanged = nextMinute === currentMinuteRef.current;
      const eventsUnchanged = nextEvents.length === eventsRef.current.length;
      if (minuteUnchanged && eventsUnchanged) {
        return;
      }

      // Minute tick only — update clock ref without re-rendering the feed tree.
      if (eventsUnchanged) {
        currentMinuteRef.current = nextMinute;
        return;
      }
    }

    setMatch(nextMatch);
    setHomeScore(nextMatch?.home_score ?? 0);
    setAwayScore(nextMatch?.away_score ?? 0);
    currentMinuteRef.current = nextMinute;
    eventsRef.current = nextEvents;
    setEvents(nextEvents);
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

function syncPlaybackState(nextEvents: MatchEvent[], minute: number) {
    const score = calculateLiveScore(nextEvents);
    const eventsChanged = nextEvents !== eventsRef.current;
    eventsRef.current = nextEvents;
    currentMinuteRef.current = minute;

    if (eventsChanged) {
      setEvents(nextEvents);
      setHomeScore(score.home);
      setAwayScore(score.away);
    }
  }

  async function publishPlaybackSnapshot(
    nextEvents: MatchEvent[],
    source: MatchSimulationSource | null,
    minute: number,
    options?: { eventsChanged?: boolean },
  ) {
    const score = calculateLiveScore(nextEvents);
    const eventsChanged = options?.eventsChanged ?? true;

    if (eventsChanged) {
      await supabase.from('matches').update({
        status: 'live',
        simulation_source: source,
        current_minute: minute,
        home_score: score.home,
        away_score: score.away,
        events: nextEvents,
      }).eq('id', matchId);
      return;
    }

    await supabase.from('matches').update({
      current_minute: minute,
      home_score: score.home,
      away_score: score.away,
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

  async function fetchMatch() {
    const [{ data: m }, { data: room }, { data: rp }] = await Promise.all([
      supabase.from('matches').select('*').eq('id', matchId).single(),
      supabase.from('game_rooms').select('host_id').eq('id', roomId).single(),
      supabase.from('room_players').select('user_id,username,formation,picked_coach_id').eq('room_id', roomId),
    ]);

    // Populate usernames BEFORE applying the match so the derived team names are
    // already resolved on the first render that has match data — otherwise the
    // labels briefly show "Ev Sahibi / Deplasman" and then flip to real names.
    const unmap = Object.fromEntries((rp ?? []).map((p: any) => [p.user_id, p.username]));
    setUsernames(unmap);
    applyMatchState(m);

    const uid = (await supabase.auth.getSession()).data.session?.user.id ?? '';
    setIsHost(room?.host_id === uid);

    // Stay put if our own match is already live; otherwise follow the single
    // deterministic live match (prevents redirect ping-pong).
    if (m?.status !== 'live') {
      const roomMatches = (await supabase.from('matches').select('id,status,round').eq('room_id', roomId).order('round')).data ?? [];
      const liveMatch = pickLiveMatch(roomMatches);
      if (liveMatch && liveMatch.id !== matchId) {
        router.replace(`/room/${roomId}/match/${liveMatch.id}`);
        return;
      }
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
      const slots = assignPlayersToFormation(footballPlayers ?? [], formation);

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
    currentMinuteRef.current = 90;
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
    // Host manually proceeds via the "Devam Et" button — no auto-redirect here.
  }

  async function getOrderedMatches() {
    const { data } = await supabase.from('matches').select('*').eq('room_id', roomId).order('round');
    return data ?? [];
  }

  // Only one match in a room may be 'live' at a time (playback is sequential).
  // When we start a match, any other match still marked live is an orphan from
  // an interrupted playback, so reset it back to 'scheduled'. This prevents the
  // two-live-matches state that caused the redirect ping-pong.
  async function resetOtherLiveMatches(exceptId: string) {
    await supabase.from('matches')
      .update({ status: 'scheduled', current_minute: 0, events: [], home_score: 0, away_score: 0, simulation_source: null })
      .eq('room_id', roomId)
      .eq('status', 'live')
      .neq('id', exceptId);
  }

  async function startNextMatchInQueue() {
    const roomMatches = await getOrderedMatches();
    const nextMatch = roomMatches.find((candidate: any) => candidate.status === 'scheduled');

    if (!nextMatch) {
      // Tournament over — mark room finished so all players get redirected via game_rooms channel
      await supabase.from('game_rooms').update({ status: 'finished' }).eq('id', roomId);
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

    await resetOtherLiveMatches(claimedMatch.id);
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
    }

    for (let minute = Math.max(startMinute + 1, 1); minute <= 90; minute += 1) {
      let eventsChanged = false;
      while (nextEventIndex < orderedEvents.length && orderedEvents[nextEventIndex].minute <= minute) {
        shownEvents = [...shownEvents, orderedEvents[nextEventIndex]];
        nextEventIndex += 1;
        eventsChanged = true;
      }

      syncPlaybackState(shownEvents, minute);
      void publishPlaybackSnapshot(shownEvents, source, minute, { eventsChanged });
      await new Promise((resolve) => setTimeout(resolve, SIMULATION_MINUTE_MS));
    }

    await persistMatchResult(result, source);
  }


  function buildMinuteTimeline(baseEvents: MatchEvent[]) {
    // Only real events — no filler. The for-loop in playTimeline advances the
    // clock minute by minute regardless of whether an event exists that minute.
    return [...baseEvents].sort((a, b) => a.minute - b.minute);
  }

  async function ensureCurrentMatchIsPlayable() {
    const roomMatches = await getOrderedMatches();
    // Enforce fixture order: the earliest still-scheduled match must be played
    // first. (Orphan live matches are cleared separately in startSimulation.)
    const nextScheduledMatch = roomMatches.find((candidate: any) => candidate.status === 'scheduled');
    if (nextScheduledMatch && nextScheduledMatch.id !== matchId && match?.status === 'scheduled') {
      Alert.alert('Sıralı oynatma aktif', 'Önce sıradaki maçı bitirmen gerekiyor.');
      router.replace(`/room/${roomId}/match/${nextScheduledMatch.id}`);
      return false;
    }

    return true;
  }

  const [isSimulating, setIsSimulating] = useState(false);

  const startSimulation = async () => {
    // Guard against double taps / re-entry while we are already preparing or
    // playing a match.
    if (isSimulating || isPlayingRef.current) return;
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
    setSummary(''); setMvp('');
    setSimulationSource('llm');
    setIsSimulating(true);

    await resetOtherLiveMatches(matchId);
    await supabase.from('matches').update({
      status: 'live', simulation_source: 'llm', current_minute: 0, events: [],
    }).eq('id', matchId);

    // Fetch LLM result first, show loading while waiting. Capture the failure
    // reason so we can surface it (Alert does not render on web).
    const llmOutcome = await new Promise<
      | { ok: true; result: { events: MatchEvent[]; home_score: number; away_score: number; summary: string; mvp: string } }
      | { ok: false; error: string }
    >((resolve) => {
      simulateMatch(
        homeSquad, awaySquad, homeUsername, awayUsername,
        () => {},
        (result) => resolve({ ok: true, result: result as any }),
        (error) => resolve({ ok: false, error }),
      );
    });

    setIsSimulating(false);
    setIsLive(true);
    isPlayingRef.current = true;

    if (llmOutcome.ok) {
      await playTimeline(llmOutcome.result, 'llm');
      isPlayingRef.current = false;
      return;
    }

    // LLM failed — fall back to a local simulation so the match always plays
    // instead of silently resetting the "Maçı Başlat" button.
    console.warn('LLM simülasyonu başarısız, yerel simülasyona geçiliyor:', llmOutcome.error);
    const localResult = simulateMatchLocally(homeSquad, awaySquad, homeUsername, awayUsername);
    setSimulationSource('local');
    await supabase.from('matches').update({ simulation_source: 'local' }).eq('id', matchId);
    await playTimeline(localResult, 'local');
    isPlayingRef.current = false;
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
      <View style={styles.feedShell}>
        <View style={styles.feedWrapper}>
        <MatchEventFeed
          events={events}
          homeUsername={displayNames.home}
          awayUsername={displayNames.away}
          homeScore={homeScore}
          awayScore={awayScore}
          currentMinuteRef={currentMinuteRef}
          isLive={isLive}
        />
        </View>
      </View>

      <ScrollView
        style={[styles.detailsScroll, Platform.OS === 'web' && styles.detailsScrollWeb]}
        contentContainerStyle={styles.container}
      >
        <MatchLineups
          homeSquad={homeSquad}
          awaySquad={awaySquad}
          displayNames={displayNames}
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
          {!isFinished && !isLive && !isSimulating && autostart !== '1' && (
            <TouchableOpacity style={styles.startBtn} onPress={startSimulation}>
              <Text style={styles.startBtnText}>▶ Maçı Başlat</Text>
            </TouchableOpacity>
          )}
          {!isFinished && !isLive && !isSimulating && autostart === '1' && (
            <Text style={styles.simulating}>⏳ Maç hazırlanıyor...</Text>
          )}
          {isSimulating && <Text style={styles.simulating}>⏳ LLM maç simüle ediyor...</Text>}
          {isLive && <Text style={styles.simulating}>🔄 Simüle ediliyor...</Text>}
          {isFinished && isHost && (
            <TouchableOpacity style={styles.startBtn} onPress={startNextMatchInQueue}>
              <Text style={styles.startBtnText}>➡ Devam Et</Text>
            </TouchableOpacity>
          )}
          {isFinished && !isHost && (
            <Text style={styles.simulating}>Host maçı okuyuyor, bekleniyor...</Text>
          )}
          {isFinished && (
            <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
              <Text style={styles.backBtnText}>← Fikstüre Dön</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  feedShell: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  detailsScroll: { flex: 1 },
  detailsScrollWeb: { overflowAnchor: 'none' } as object,
  container: { paddingHorizontal: 16, paddingBottom: 32 },
  feedWrapper: { height: 340 },
  lineupBox: {
    flexDirection: 'row', backgroundColor: '#1f2937', borderRadius: 10,
    padding: 12, marginTop: 10, gap: 8,
  },
  lineupCol: { flex: 1 },
  lineupTeam: { color: '#f3f4f6', fontWeight: '900', fontSize: 13, marginBottom: 2 },
  lineupFormation: { color: '#60a5fa', fontSize: 11, marginBottom: 2 },
  lineupCoach: { color: '#a78bfa', fontSize: 11, marginBottom: 6 },
  lineupRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 1 },
  lineupSlot: { color: '#6b7280', fontSize: 10, fontWeight: '700', width: 28 },
  lineupPlayer: { color: '#d1d5db', fontSize: 12, flex: 1 },
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
