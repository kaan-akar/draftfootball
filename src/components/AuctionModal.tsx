import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView,
} from 'react-native';
import type { Auction } from '../types/game';
import { submitBid, passAuctionTurn } from '../lib/draftEngine';

interface Props {
  auction: Auction | null;
  myUserId: string;
  myBudget: number;
  targetName: string;
  usernames: Record<string, string>;
  onClose: () => void;
}

export default function AuctionModal({ auction, myUserId, myBudget, targetName, usernames, onClose }: Props) {
  const [bidAmount, setBidAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!auction || auction.status !== 'active') return null;

  const currentBidder = auction.eligible_bidders[auction.current_bidder_index % auction.eligible_bidders.length];
  const isMyTurn = currentBidder === myUserId;
  const minBid = auction.current_highest_bid + 1;

  const handleBid = async () => {
    const amount = parseInt(bidAmount, 10);
    if (isNaN(amount) || amount < minBid) { setError(`En az ${minBid} TL teklif ver`); return; }
    if (amount > myBudget) { setError('Bütçen yetersiz'); return; }
    setLoading(true); setError('');
    try {
      await submitBid(auction.id, myUserId, amount);
      setBidAmount('');
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const handlePass = async () => {
    setLoading(true);
    try { await passAuctionTurn(auction.id); } catch {}
    setLoading(false);
  };

  return (
    <Modal transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>🔨 AÇIK ARTIRMA</Text>
          <Text style={styles.target}>{targetName}</Text>
          <Text style={styles.currentBid}>
            Güncel teklif: <Text style={styles.bidValue}>{auction.current_highest_bid} TL</Text>
            {auction.current_highest_bidder
              ? ` — ${usernames[auction.current_highest_bidder] ?? '?'}`
              : ' (henüz teklif yok)'}
          </Text>
          <Text style={styles.turn}>
            Sıra: <Text style={styles.turnName}>{usernames[currentBidder] ?? '?'}</Text>
            {isMyTurn ? ' (SEN!)' : ''}
          </Text>

          {/* Bid history */}
          <ScrollView style={styles.history} showsVerticalScrollIndicator={false}>
            {[...(auction.bids ?? [])].reverse().map((b, i) => (
              <Text key={i} style={styles.histLine}>
                {b.bidderId === 'PASS' ? `${usernames[b.bidderId] ?? '?'} — PAS` : `${usernames[b.bidderId] ?? '?'} → ${b.amount} TL`}
              </Text>
            ))}
          </ScrollView>

          {isMyTurn && (
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={bidAmount}
                onChangeText={setBidAmount}
                keyboardType="numeric"
                placeholder={`Min ${minBid} TL`}
                placeholderTextColor="#6b7280"
              />
              <TouchableOpacity style={styles.bidBtn} onPress={handleBid} disabled={loading}>
                <Text style={styles.bidBtnText}>TEKLİF VER</Text>
              </TouchableOpacity>
            </View>
          )}
          {isMyTurn && (
            <TouchableOpacity style={styles.passBtn} onPress={handlePass} disabled={loading}>
              <Text style={styles.passBtnText}>PAS GEÇ</Text>
            </TouchableOpacity>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#111827', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '70%',
  },
  title: { color: '#f59e0b', fontWeight: '900', fontSize: 18, textAlign: 'center', marginBottom: 8 },
  target: { color: '#f3f4f6', fontWeight: '700', fontSize: 16, textAlign: 'center', marginBottom: 4 },
  currentBid: { color: '#9ca3af', textAlign: 'center', marginBottom: 4 },
  bidValue: { color: '#22c55e', fontWeight: '700' },
  turn: { color: '#9ca3af', textAlign: 'center', marginBottom: 12 },
  turnName: { color: '#fbbf24', fontWeight: '700' },
  history: { maxHeight: 120, marginBottom: 12 },
  histLine: { color: '#6b7280', fontSize: 12, marginBottom: 2 },
  inputRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  input: {
    flex: 1, backgroundColor: '#1f2937', color: '#f3f4f6',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 16,
  },
  bidBtn: { backgroundColor: '#16a34a', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  bidBtnText: { color: '#fff', fontWeight: '700' },
  passBtn: {
    backgroundColor: '#374151', borderRadius: 8,
    paddingVertical: 10, alignItems: 'center', marginBottom: 8,
  },
  passBtnText: { color: '#9ca3af', fontWeight: '700' },
  error: { color: '#ef4444', textAlign: 'center', fontSize: 12 },
});
