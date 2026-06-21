import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { View, ActivityIndicator } from 'react-native';

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#22c55e" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#111827' },
        headerTintColor: '#f3f4f6',
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: '#0f172a' },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ title: 'Giriş / Kayıt', headerShown: false }} />
      <Stack.Screen name="home" options={{ title: '⚽ Draft Football', headerBackVisible: false }} />
      <Stack.Screen name="room/[id]/lobby" options={{ title: 'Lobi' }} />
      <Stack.Screen name="room/[id]/coach-draft" options={{ title: 'TD Drafı' }} />
      <Stack.Screen name="room/[id]/player-draft" options={{ title: 'Oyuncu Drafı' }} />
      <Stack.Screen name="room/[id]/squad-review" options={{ title: 'Kadrolar' }} />
      <Stack.Screen name="room/[id]/fixture" options={{ title: 'Fikstür' }} />
      <Stack.Screen name="room/[id]/match/[matchId]" options={{ title: 'Maç' }} />
      <Stack.Screen name="room/[id]/standings" options={{ title: 'Puan Tablosu' }} />
      <Stack.Screen name="room/[id]/champion" options={{ title: 'Şampiyon!', headerShown: false }} />
    </Stack>
  );
}
