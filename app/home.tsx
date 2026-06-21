import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { supabase, createRoom, joinRoom, signOut } from '../src/lib/supabase';

export default function HomeScreen() {
  const [userId, setUserId] = useState('');
  const [username, setUsername] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/auth'); return; }
      setUserId(session.user.id);
      const { data } = await supabase.from('profiles').select('username').eq('id', session.user.id).single();
      setUsername(data?.username ?? '');
    });
  }, []);

  const handleCreate = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const room = await createRoom(userId);
      // Also join as player
      await supabase.from('room_players').insert({
        room_id: room.id, user_id: userId, username,
      });
      router.push(`/room/${room.id}/lobby`);
    } catch (e: any) {
      Alert.alert('Hata', e.message);
    }
    setLoading(false);
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) { Alert.alert('Oda kodunu gir'); return; }
    setLoading(true);
    try {
      const room = await joinRoom(joinCode.trim(), userId, username);
      router.push(`/room/${room.id}/lobby`);
    } catch (e: any) {
      Alert.alert('Hata', e.message);
    }
    setLoading(false);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/auth');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.welcome}>Hoş geldin, <Text style={styles.name}>{username}</Text></Text>
        <TouchableOpacity onPress={handleSignOut}>
          <Text style={styles.signout}>Çıkış</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hero}>⚽</Text>
      <Text style={styles.title}>A Milli Draft Football</Text>
      <Text style={styles.desc}>
        1995 sonrası A Milli oyunculardan takımını kur,{'\n'}
        rakip teknik direktörlerle turnuvada şampiyonluğu kazan.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Yeni Oyun Oluştur</Text>
        <Text style={styles.cardDesc}>Oda kodunu arkadaşlarınla paylaş, draft başlasın.</Text>
        <TouchableOpacity
          style={[styles.btn, styles.btnGreen, loading && styles.btnDisabled]}
          onPress={handleCreate}
          disabled={loading}
        >
          <Text style={styles.btnText}>+ ODA OLUŞTUR</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Odaya Katıl</Text>
        <TextInput
          style={styles.input}
          placeholder="6 haneli oda kodu (örn. AB3X9K)"
          placeholderTextColor="#6b7280"
          value={joinCode}
          onChangeText={setJoinCode}
          autoCapitalize="characters"
          maxLength={6}
        />
        <TouchableOpacity
          style={[styles.btn, styles.btnBlue, (!joinCode || loading) && styles.btnDisabled]}
          onPress={handleJoin}
          disabled={!joinCode || loading}
        >
          <Text style={styles.btnText}>ODAYA KATIL</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.rules}>
        <Text style={styles.rulesTitle}>Nasıl Oynanır?</Text>
        {[
          '💼 Önce TD draftı (120 TL toplam bütçeden harcanır)',
          '⚽ Sonra oyuncu draftı (aynı kalan bütçeyle devam eder)',
          '🔨 Seçime itiraz et → açık artırma başlar',
          '🏆 İlk 11 hazır → lig fikstürü → LLM maçları',
        ].map((r, i) => (
          <Text key={i} style={styles.rule}>{r}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0f172a' },
  container: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  welcome: { color: '#9ca3af', fontSize: 14 },
  name: { color: '#f3f4f6', fontWeight: '700' },
  signout: { color: '#ef4444', fontSize: 13 },
  hero: { fontSize: 64, textAlign: 'center', marginBottom: 8 },
  title: { color: '#f3f4f6', fontWeight: '900', fontSize: 24, textAlign: 'center', marginBottom: 8 },
  desc: { color: '#6b7280', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  card: { backgroundColor: '#1f2937', borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { color: '#f3f4f6', fontWeight: '700', fontSize: 16, marginBottom: 4 },
  cardDesc: { color: '#6b7280', fontSize: 13, marginBottom: 12 },
  input: {
    backgroundColor: '#111827', color: '#f3f4f6',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12,
    fontSize: 16, letterSpacing: 2, marginBottom: 12,
  },
  btn: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnGreen: { backgroundColor: '#16a34a' },
  btnBlue: { backgroundColor: '#2563eb' },
  btnDisabled: { backgroundColor: '#374151' },
  btnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  rules: { backgroundColor: '#1f2937', borderRadius: 12, padding: 16, marginTop: 8 },
  rulesTitle: { color: '#f3f4f6', fontWeight: '700', marginBottom: 10 },
  rule: { color: '#9ca3af', fontSize: 13, marginBottom: 6, lineHeight: 20 },
});
