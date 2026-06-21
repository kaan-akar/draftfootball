import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { router } from 'expo-router';
import { signIn, signUp } from '../src/lib/supabase';

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handle = async () => {
    if (!email || !password) { setError('Email ve şifre gerekli'); return; }
    if (mode === 'register' && !username) { setError('Kullanıcı adı gerekli'); return; }
    setLoading(true); setError('');
    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password, username);
      }
      router.replace('/home');
    } catch (e: any) {
      setError(e.message ?? 'Bir hata oluştu');
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>⚽</Text>
        <Text style={styles.title}>A Milli Draft</Text>
        <Text style={styles.subtitle}>Tarihin en iyi 11'ini kur, şampiyonluğu kap</Text>

        <View style={styles.tabs}>
          {(['login', 'register'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.tab, mode === m && styles.tabActive]}
              onPress={() => { setMode(m); setError(''); }}
            >
              <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                {m === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.form}>
          {mode === 'register' && (
            <TextInput
              style={styles.input}
              placeholder="Kullanıcı adı"
              placeholderTextColor="#6b7280"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
            />
          )}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#6b7280"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            placeholder="Şifre"
            placeholderTextColor="#6b7280"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handle}
            disabled={loading}
          >
            <Text style={styles.btnText}>
              {loading ? 'Yükleniyor...' : mode === 'login' ? 'Giriş Yap' : 'Kayıt Ol'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0f172a' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: { fontSize: 64, textAlign: 'center', marginBottom: 8 },
  title: { color: '#f3f4f6', fontWeight: '900', fontSize: 32, textAlign: 'center', marginBottom: 4 },
  subtitle: { color: '#6b7280', fontSize: 14, textAlign: 'center', marginBottom: 32 },
  tabs: { flexDirection: 'row', backgroundColor: '#1f2937', borderRadius: 10, padding: 4, marginBottom: 24 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#22c55e' },
  tabText: { color: '#9ca3af', fontWeight: '600' },
  tabTextActive: { color: '#0f172a', fontWeight: '700' },
  form: { gap: 12 },
  input: {
    backgroundColor: '#1f2937', color: '#f3f4f6',
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 16,
  },
  error: { color: '#ef4444', textAlign: 'center', fontSize: 13 },
  btn: {
    backgroundColor: '#22c55e', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center', marginTop: 4,
  },
  btnDisabled: { backgroundColor: '#374151' },
  btnText: { color: '#0f172a', fontWeight: '900', fontSize: 16 },
});
