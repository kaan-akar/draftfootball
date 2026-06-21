import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  pickOrder: string[];
  currentPickerIndex: number;
  currentRound: number;
  usernames: Record<string, string>;
  myUserId: string;
}

export default function DraftOrderIndicator({ pickOrder, currentPickerIndex, currentRound, usernames, myUserId }: Props) {
  const n = pickOrder.length;
  const roundIndex = (currentRound - 1) % 2;
  const orderedThisRound = roundIndex === 0 ? pickOrder : [...pickOrder].reverse();
  const currentPicker = orderedThisRound[currentPickerIndex % n];

  return (
    <View style={styles.wrap}>
      <Text style={styles.round}>Tur {currentRound} · Sıra:</Text>
      <View style={styles.row}>
        {orderedThisRound.map((uid, i) => {
          const isActive = i === currentPickerIndex % n;
          const isMe = uid === myUserId;
          return (
            <View
              key={uid}
              style={[
                styles.chip,
                isActive && styles.chipActive,
                isMe && styles.chipMe,
              ]}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {i + 1}. {usernames[uid] ?? '?'}{isMe ? ' (sen)' : ''}
              </Text>
            </View>
          );
        })}
      </View>
      {currentPicker === myUserId && (
        <Text style={styles.yourTurn}>⚡ SENİN SIRAN!</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#1f2937', borderRadius: 8, padding: 10, marginBottom: 8 },
  round: { color: '#9ca3af', fontSize: 12, marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: '#374151', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  chipActive: { backgroundColor: '#2563eb' },
  chipMe: { borderWidth: 1, borderColor: '#f59e0b' },
  chipText: { color: '#9ca3af', fontSize: 11 },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  yourTurn: { color: '#f59e0b', fontWeight: '700', fontSize: 14, marginTop: 8, textAlign: 'center' },
});
