import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Share,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { supabase } from '../../../src/lib/supabase';
import { startCoachDraft } from '../../../src/lib/draftEngine';
import { FORMATIONS } from '../../../src/lib/formationUtils';
import type { Formation } from '../../../src/types/game';

export default function LobbyScreen() {
  const { id: roomId } = useLocalSearchParams<{ id: string }>();
  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [myUserId, setMyUserId] = useState('');
  const [myFormation, setMyFormation] = useState<Formation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setMyUserId(session?.user.id ?? '');
    });
    fetchData();
    const channel = supabase
      .channel(`lobby-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_players', filter: `room_id=eq.${roomId}` }, fetchData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_rooms', filter: `id=eq.${roomId}` }, handleRoomChange)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId]);

  async function fetchData() {
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from('game_rooms').select('*').eq('id', roomId).single(),
      supabase.from('room_players').select('*').eq('room_id', roomId),
    ]);
    setRoom(r); setPlayers(p ?? []);
    const me = p?.find((x: any) => x.user_id === myUserId);
    if (me?.formation) setMyFormation(me.formation);
  }

  function handleRoomChange({ new: newRoom }: any) {
    setRoom(newRoom);
    if (newRoom?.status === 'coach_draft') router.replace(`/room/${roomId}/coach-draft`);
  }

  const selectFormation = async (f: Formation) => {
    setMyFormation(f);
    await supabase.from('room_players')
      .update({ formation: f })
      .eq('room_id', roomId).eq('user_id', myUserId);
  };

  const toggleReady = async () => {
    const me = players.find((p) => p.user_id === myUserId);
    if (!me?.formation) { Alert.alert('Önce formasyon seç'); return; }
    await supabase.from('room_players')
      .update({ is_ready: !me.is_ready })
      .eq('room_id', roomId).eq('user_id', myUserId);
    fetchData();
  };

  const startDraft = async () => {
    const notReady = players.filter((p) => !p.is_ready);
    if (players.length < 2) { Alert.alert('En az 2 oyuncu gerekli'); return; }
    if (notReady.length > 0) { Alert.alert('Herkes hazır değil'); return; }
    setLoading(true);
    try { await startCoachDraft(roomId); }
    catch (e: any) { Alert.alert('Hata', e.message); }
    setLoading(false);
  };

  const shareCode = () => {
    Share.share({ message: `A Milli Draft'a katıl! Oda kodu: ${room?.join_code}` });
  };

  const isHost = room?.host_id === myUserId;
  const me = players.find((p) => p.user_id === myUserId);
  const allReady = players.length >= 2 && players.every((p) => p.is_ready);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>ODA KODU</Text>
        <Text style={styles.code}>{room?.join_code ?? '...'}</Text>
        <TouchableOpacity onPress={shareCode}>
          <Text style={styles.share}>📤 Paylaş</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Oyuncular ({players.length}/20)</Text>
      {players.map((p) => (
        <View key={p.user_id} style={styles.playerRow}>
          <Text style={styles.playerName}>{p.username}{p.user_id === room?.host_id ? ' 👑' : ''}</Text>
          <Text style={[styles.readyBadge, { color: p.is_ready ? '#22c55e' : '#6b7280' }]}>
            {p.is_ready ? '✓ Hazır' : '• Bekliyor'}
          </Text>
          {p.formation && <Text style={styles.formation}>{p.formation}</Text>}
        </View>
      ))}

      <Text style={styles.section}>Formasyon Seç</Text>
      <View style={styles.formations}>
        {FORMATIONS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.formationBtn, myFormation === f && styles.formationBtnActive]}
            onPress={() => selectFormation(f)}
          >
            <Text style={[styles.formationText, myFormation === f && styles.formationTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.btn, me?.is_ready ? styles.btnRed : styles.btnGreen]}
        onPress={toggleReady}
        disabled={!myFormation}
      >
        <Text style={styles.btnText}>{me?.is_ready ? 'Hazır Değilim' : 'Hazırım!'}</Text>
      </TouchableOpacity>

      {isHost && (
        <TouchableOpacity
          style={[styles.btn, styles.btnYellow, (!allReady || loading) && styles.btnDisabled]}
          onPress={startDraft}
          disabled={!allReady || loading}
        >
          <Text style={styles.btnText}>
            {loading ? 'Başlatılıyor...' : allReady ? '🚀 Draftı Başlat' : 'Herkes hazır olunca başlatabilirsin'}
          </Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  container: { padding: 20, paddingBottom: 40 },
  codeBox: { backgroundColor: '#1f2937', borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 20 },
  codeLabel: { color: '#6b7280', fontSize: 12, marginBottom: 4 },
  code: { color: '#fbbf24', fontWeight: '900', fontSize: 36, letterSpacing: 6 },
  share: { color: '#60a5fa', marginTop: 8, fontSize: 14 },
  section: { color: '#9ca3af', fontWeight: '700', fontSize: 13, marginBottom: 8, marginTop: 16 },
  playerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1f2937', borderRadius: 8, padding: 12, marginBottom: 6 },
  playerName: { color: '#f3f4f6', fontWeight: '600', flex: 1 },
  readyBadge: { fontSize: 12, fontWeight: '600', marginRight: 8 },
  formation: { color: '#a78bfa', fontSize: 11 },
  formations: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  formationBtn: { backgroundColor: '#1f2937', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  formationBtnActive: { backgroundColor: '#7c3aed' },
  formationText: { color: '#9ca3af', fontWeight: '600' },
  formationTextActive: { color: '#fff' },
  btn: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  btnGreen: { backgroundColor: '#16a34a' },
  btnRed: { backgroundColor: '#dc2626' },
  btnYellow: { backgroundColor: '#d97706' },
  btnDisabled: { backgroundColor: '#374151' },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
});
