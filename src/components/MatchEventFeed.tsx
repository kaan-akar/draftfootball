import React, { memo, useEffect, useState } from 'react';
import { Platform, ScrollView, View, Text, StyleSheet } from 'react-native';
import type { MatchEvent } from '../types/game';

function eventsSignature(events: MatchEvent[]) {
  if (events.length === 0) return '0';
  const last = events[events.length - 1];
  return `${events.length}:${last.minute}:${last.type}:${last.description}`;
}

interface Props {
  events: MatchEvent[];
  homeUsername: string;
  awayUsername: string;
  homeScore: number;
  awayScore: number;
  currentMinute?: number;
  currentMinuteRef?: { current: number };
  isLive?: boolean;
}

const EVENT_ICON: Record<string, string> = {
  goal: '⚽', yellow_card: '🟨', red_card: '🟥',
  save: '🧤', chance: '💨', action: '▶',
};

// Memoised so the feed only re-renders when new events arrive,
// NOT every second when currentMinute changes. This stops PC scroll flicker.
const EventList = memo(
  ({ events }: { events: MatchEvent[] }) => (
    <ScrollView
      style={styles.feed}
      contentContainerStyle={Platform.OS === 'web' ? styles.feedWeb : undefined}
      showsVerticalScrollIndicator={false}
    >
      {events.length === 0 && (
        <Text style={styles.waiting}>Maç başlıyor...</Text>
      )}
      {[...events].reverse().map((ev, reversedIdx) => (
        <View
          key={`${events.length - 1 - reversedIdx}-${ev.minute}-${ev.type}`}
          style={[
            styles.event,
            ev.type === 'goal' && styles.goalEvent,
            ev.type === 'red_card' && styles.redEvent,
          ]}
        >
          <Text style={styles.minute}>{ev.minute}'</Text>
          <Text style={styles.icon}>{EVENT_ICON[ev.type] ?? '▶'}</Text>
          <Text style={styles.desc}>{ev.description}</Text>
        </View>
      ))}
      <View style={{ height: 24 }} />
    </ScrollView>
  ),
  (prev, next) => eventsSignature(prev.events) === eventsSignature(next.events),
);

const LiveMinuteTag = memo(({
  currentMinute,
  currentMinuteRef,
  isLive,
}: {
  currentMinute?: number;
  currentMinuteRef?: { current: number };
  isLive?: boolean;
}) => {
  const [displayMinute, setDisplayMinute] = useState(currentMinute ?? 0);

  useEffect(() => {
    setDisplayMinute(currentMinute ?? 0);
  }, [currentMinute]);

  useEffect(() => {
    if (!isLive || !currentMinuteRef) return undefined;

    const intervalId = setInterval(() => {
      const nextMinute = currentMinuteRef.current ?? 0;
      setDisplayMinute((prevMinute) => (prevMinute === nextMinute ? prevMinute : nextMinute));
    }, 150);

    return () => clearInterval(intervalId);
  }, [currentMinuteRef, isLive]);

  if (!isLive) return null;
  return <Text style={styles.liveTag}>🔴 CANLI {displayMinute}'</Text>;
});

export default function MatchEventFeed({
  events,
  homeUsername,
  awayUsername,
  homeScore,
  awayScore,
  currentMinute,
  currentMinuteRef,
  isLive,
}: Props) {

  return (
    <View style={styles.wrap}>
      {/* Scoreboard */}
      <View style={styles.scoreboard}>
        <Text style={styles.teamName}>{homeUsername}</Text>
        <Text style={styles.score}>{homeScore} – {awayScore}</Text>
        <Text style={styles.teamName}>{awayUsername}</Text>
      </View>
      <LiveMinuteTag
        currentMinute={currentMinute}
        currentMinuteRef={currentMinuteRef}
        isLive={isLive}
      />

      <EventList events={events} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scoreboard: {
    flexDirection: 'row', justifyContent: 'space-around',
    alignItems: 'center', backgroundColor: '#1f2937',
    borderRadius: 12, padding: 16, marginBottom: 8,
  },
  teamName: { color: '#f3f4f6', fontWeight: '700', fontSize: 14, flex: 1, textAlign: 'center' },
  score: { color: '#fbbf24', fontWeight: '900', fontSize: 28, marginHorizontal: 12 },
  liveTag: { color: '#ef4444', fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  feed: { flex: 1 },
  feedWeb: { overflowAnchor: 'none' } as object,
  waiting: { color: '#6b7280', textAlign: 'center', marginTop: 24, fontSize: 14 },
  event: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#111827', borderRadius: 6,
    padding: 10, marginBottom: 6, gap: 8,
  },
  goalEvent: { backgroundColor: '#14532d', borderLeftWidth: 3, borderLeftColor: '#22c55e' },
  redEvent: { backgroundColor: '#450a0a', borderLeftWidth: 3, borderLeftColor: '#ef4444' },
  minute: { color: '#6b7280', fontSize: 11, width: 28, marginTop: 2 },
  icon: { fontSize: 14 },
  desc: { color: '#e5e7eb', fontSize: 13, flex: 1, lineHeight: 19 },
});
