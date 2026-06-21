import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { FootballPlayer } from '../types/game';

interface Props {
  player: FootballPlayer;
  onSelect?: () => void;
  onObject?: () => void;
  disabled?: boolean;
  picked?: boolean;
  myPick?: boolean;
  showActions?: boolean;
}

const POS_COLOR: Record<string, string> = {
  GK: '#f59e0b', DEF: '#3b82f6', MID: '#22c55e', FWD: '#ef4444',
};

export default function PlayerCard({ player, onSelect, onObject, disabled, picked, myPick, showActions }: Props) {
  const bg = picked ? '#1f2937' : myPick ? '#14532d' : '#111827';
  const border = POS_COLOR[player.position_group] ?? '#6b7280';

  return (
    <View style={[styles.card, { backgroundColor: bg, borderLeftColor: border }]}>
      <View style={styles.header}>
        <View style={[styles.badge, { backgroundColor: border }]}>
          <Text style={styles.badgeText}>{player.position_group}</Text>
        </View>
        <Text style={styles.price}>{player.price} TL</Text>
      </View>
      <Text style={styles.name}>{player.name}</Text>
      <Text style={styles.sub}>{player.positions.join(' / ')} · {player.peak_years}</Text>
      <Text style={styles.stats}>{player.caps} maç · {player.goals} gol</Text>
      {picked && <Text style={styles.pickedBadge}>{myPick ? '✓ SENİN' : '✗ SEÇİLDİ'}</Text>}
      {showActions && !picked && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.selectBtn, disabled && styles.btnDisabled]}
            onPress={onSelect}
            disabled={disabled}
          >
            <Text style={styles.btnText}>SEÇ</Text>
          </TouchableOpacity>
          {onObject && (
            <TouchableOpacity style={[styles.btn, styles.objBtn]} onPress={onObject}>
              <Text style={styles.btnText}>İTİRAZ</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 8, padding: 12, marginBottom: 8,
    borderLeftWidth: 4,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  price: { color: '#fbbf24', fontWeight: '700', fontSize: 14 },
  name: { color: '#f3f4f6', fontWeight: '700', fontSize: 15, marginBottom: 2 },
  sub: { color: '#9ca3af', fontSize: 12, marginBottom: 2 },
  stats: { color: '#6b7280', fontSize: 11 },
  pickedBadge: { color: '#10b981', fontWeight: '700', fontSize: 11, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  selectBtn: { backgroundColor: '#2563eb' },
  objBtn: { backgroundColor: '#dc2626' },
  btnDisabled: { backgroundColor: '#374151' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
