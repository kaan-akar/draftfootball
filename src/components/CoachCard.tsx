import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { Coach } from '../types/game';

interface Props {
  coach: Coach;
  onSelect?: () => void;
  onObject?: () => void;
  disabled?: boolean;
  picked?: boolean;
  myPick?: boolean;
  showActions?: boolean;
}

export default function CoachCard({ coach, onSelect, onObject, disabled, picked, myPick, showActions }: Props) {
  const bg = picked ? '#1f2937' : myPick ? '#1e3a5f' : '#111827';

  return (
    <View style={[styles.card, { backgroundColor: bg }]}>
      <View style={styles.header}>
        <Text style={styles.emoji}>🧑‍💼</Text>
        <Text style={styles.price}>{coach.price} TL</Text>
      </View>
      <Text style={styles.name}>{coach.name}</Text>
      <Text style={styles.style}>{coach.style}</Text>
      <Text style={styles.formations}>{coach.preferredFormations.join(' · ')}</Text>
      {picked && (
        <Text style={[styles.badge, { color: myPick ? '#10b981' : '#ef4444' }]}>
          {myPick ? '✓ SENİN TD\'N' : '✗ SEÇİLDİ'}
        </Text>
      )}
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
    borderLeftWidth: 4, borderLeftColor: '#8b5cf6',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  emoji: { fontSize: 18 },
  price: { color: '#fbbf24', fontWeight: '700', fontSize: 14 },
  name: { color: '#f3f4f6', fontWeight: '700', fontSize: 15, marginBottom: 2 },
  style: { color: '#a78bfa', fontSize: 12, marginBottom: 2 },
  formations: { color: '#9ca3af', fontSize: 11 },
  badge: { fontWeight: '700', fontSize: 11, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  selectBtn: { backgroundColor: '#7c3aed' },
  objBtn: { backgroundColor: '#dc2626' },
  btnDisabled: { backgroundColor: '#374151' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
});
