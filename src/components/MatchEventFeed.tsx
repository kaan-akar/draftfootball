import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import type { MatchEvent } from '../types/game';

interface Props {
  events: MatchEvent[];
  homeUsername: string;
  awayUsername: string;
  homeScore: number;
  awayScore: number;
  isLive?: boolean;
}

const EVENT_ICON: Record<string, string> = {
  goal: '⚽', yellow_card: '🟨', red_card: '🟥',
  save: '🧤', chance: '💨', action: '▶',
};

export default function MatchEventFeed({ events, homeUsername, awayUsername, homeScore, awayScore, isLive }: Props) {

  return (
    <View style={styles.wrap}>
      {/* Scoreboard */}
      <View style={styles.scoreboard}>
        <Text style={styles.teamName}>{homeUsername}</Text>
        <Text style={styles.score}>{homeScore} – {awayScore}</Text>
        <Text style={styles.teamName}>{awayUsername}</Text>
      </View>
      {isLive && <Text style={styles.liveTag}>🔴 CANLI</Text>}

      {/* Events */}
      <ScrollView
        style={styles.feed}
        showsVerticalScrollIndicator={false}
      >
        {events.length === 0 && (
          <Text style={styles.waiting}>Maç başlıyor...</Text>
        )}
        {[...events].reverse().map((ev, i) => (
          <View
            key={i}
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
        {isLive && <View style={{ height: 24 }} />}
      </ScrollView>
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
