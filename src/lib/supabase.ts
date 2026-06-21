import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ─── Auth helpers ─────────────────────────────────────────────────────────────
export async function signUp(email: string, password: string, username: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (data.user) {
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: data.user.id, username });
    if (profileError) throw profileError;
  }
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

// ─── Room helpers ─────────────────────────────────────────────────────────────
export function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function createRoom(hostId: string) {
  const joinCode = generateJoinCode();
  const { data, error } = await supabase
    .from('game_rooms')
    .insert({ host_id: hostId, join_code: joinCode })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function joinRoom(joinCode: string, userId: string, username: string) {
  const { data: room, error: roomError } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('join_code', joinCode.toUpperCase())
    .single();
  if (roomError) throw new Error('Oda bulunamadı');
  if (room.status !== 'lobby') throw new Error('Oyun zaten başlamış');

  const { error } = await supabase
    .from('room_players')
    .insert({ room_id: room.id, user_id: userId, username });
  if (error && !error.message.includes('duplicate')) throw error;
  return room;
}
