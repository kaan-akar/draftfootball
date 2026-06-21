import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  budget: number;
  maxBudget: number;
  label?: string;
  color?: string;
}

export default function BudgetBar({ budget, maxBudget, label = 'Bütçe', color = '#22c55e' }: Props) {
  const pct = Math.max(0, Math.min(1, budget / maxBudget));
  const barColor = pct > 0.5 ? color : pct > 0.2 ? '#f59e0b' : '#ef4444';

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color: barColor }]}>{budget} TL</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` as any, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label: { color: '#9ca3af', fontSize: 12 },
  value: { fontWeight: '700', fontSize: 14 },
  track: { height: 6, backgroundColor: '#374151', borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
