import { supabase } from './supabase';
import type { Squad, LLMMatchResponse } from '../types/game';

const MODEL = process.env.EXPO_PUBLIC_GEMINI_MODEL?.trim() || 'gemini-3.5-flash';

function scoreSquadStrength(squad: Squad): number {
  const coachBoost = squad.coach ? squad.coach.price * 1.5 : 0;
  const playerScore = squad.slots.reduce((total, slot) => total + (slot.player?.price ?? 4), 0);
  return coachBoost + playerScore;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(items: T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(Math.random() * items.length)];
}

function pickScorerCandidates(squad: Squad) {
  const filledPlayers = squad.slots.map((slot) => slot.player).filter(Boolean);
  const attackers = filledPlayers.filter((player) => player!.position_group === 'FWD');
  const midfielders = filledPlayers.filter((player) => player!.position_group === 'MID');
  const defenders = filledPlayers.filter((player) => player!.position_group === 'DEF');
  return [
    ...attackers,
    ...attackers,
    ...midfielders,
    ...midfielders,
    ...defenders,
  ].filter(Boolean);
}

export function simulateMatchLocally(
  homeSquad: Squad,
  awaySquad: Squad,
  homeUsername: string,
  awayUsername: string,
): LLMMatchResponse {
  const homeStrength = scoreSquadStrength(homeSquad);
  const awayStrength = scoreSquadStrength(awaySquad);
  const totalStrength = Math.max(1, homeStrength + awayStrength);
  const homeBias = homeStrength / totalStrength;

  const eventCount = randomInt(8, 14);
  const usedMinutes = new Set<number>();
  const events: LLMMatchResponse['events'] = [];
  let homeScore = 0;
  let awayScore = 0;

  const homeScorers = pickScorerCandidates(homeSquad);
  const awayScorers = pickScorerCandidates(awaySquad);
  const genericHome = homeSquad.slots.map((slot) => slot.player?.name).filter(Boolean) as string[];
  const genericAway = awaySquad.slots.map((slot) => slot.player?.name).filter(Boolean) as string[];

  for (let i = 0; i < eventCount; i += 1) {
    let minute = randomInt(2, 90);
    while (usedMinutes.has(minute)) minute = randomInt(2, 90);
    usedMinutes.add(minute);

    const team = Math.random() < homeBias ? 'home' : 'away';
    const typeRoll = Math.random();

    if (typeRoll < 0.28) {
      const scorer = pickRandom(team === 'home' ? homeScorers : awayScorers);
      const scorerName = scorer?.name ?? (pickRandom(team === 'home' ? genericHome : genericAway) ?? 'Bir oyuncu');
      events.push({
        minute,
        type: 'goal',
        team,
        description: `${minute}' ${scorerName} ceza sahasında fırsatı buldu ve topu ağlara gönderdi!`,
      });
      if (team === 'home') homeScore += 1;
      else awayScore += 1;
      continue;
    }

    if (typeRoll < 0.45) {
      const playerName = pickRandom(team === 'home' ? genericHome : genericAway) ?? 'Bir oyuncu';
      events.push({
        minute,
        type: 'chance',
        team,
        description: `${minute}' ${playerName} tehlikeli geldi ama son vuruşta isabeti bulamadı.`,
      });
      continue;
    }

    if (typeRoll < 0.62) {
      const playerName = pickRandom(team === 'home' ? genericHome : genericAway) ?? 'Kaleci';
      events.push({
        minute,
        type: 'save',
        team,
        description: `${minute}' ${playerName} kritik anda takımını oyunda tuttu.`,
      });
      continue;
    }

    if (typeRoll < 0.83) {
      const playerName = pickRandom(team === 'home' ? genericHome : genericAway) ?? 'Bir oyuncu';
      events.push({
        minute,
        type: 'action',
        team,
        description: `${minute}' ${playerName} orta sahada oyunun temposunu belirleyen önemli bir aksiyon yaptı.`,
      });
      continue;
    }

    const playerName = pickRandom(team === 'home' ? genericHome : genericAway) ?? 'Bir oyuncu';
    events.push({
      minute,
      type: 'yellow_card',
      team,
      description: `${minute}' ${playerName} sert müdahalesi sonrası sarı kart gördü.`,
    });
  }

  events.sort((a, b) => a.minute - b.minute);

  const mvpPool = [
    ...Array(Math.max(homeScore, 1)).fill(pickRandom(homeScorers)?.name ?? pickRandom(genericHome) ?? homeUsername),
    ...Array(Math.max(awayScore, 1)).fill(pickRandom(awayScorers)?.name ?? pickRandom(genericAway) ?? awayUsername),
  ].filter(Boolean) as string[];
  const mvp = pickRandom(mvpPool) ?? homeUsername;

  const summary = `${homeUsername} ile ${awayUsername} arasındaki maç ${homeScore}-${awayScore} sonuçlandı. ${mvp} maçın öne çıkan ismiydi. Karşılaşma hızlı tempoda geçti ve iki takım da üretken anlar buldu.`;

  return {
    events,
    home_score: homeScore,
    away_score: awayScore,
    summary,
    mvp,
  };
}

function buildMatchPrompt(homeSquad: Squad, awaySquad: Squad, homeUsername: string, awayUsername: string): string {
  const formatSquad = (squad: Squad, username: string) => {
    const slotLines = squad.slots
      .map((s) => `  ${s.position}: ${s.player?.name ?? '?'} (${s.player?.peak_years ?? ''})`)
      .join('\n');
    return `TAKIM: ${username}
Formasyon: ${squad.formation}
Teknik Direktör: ${squad.coach?.name ?? 'Bilinmiyor'} — Stil: ${squad.coach?.style ?? ''}
İlk 11:
${slotLines}`;
  };

  return `Sen gerçekçi bir futbol maç simülatörüsün. Aşağıdaki iki takım arasında 90 dakikalık bir maç simüle et.

${formatSquad(homeSquad, homeUsername)}

${formatSquad(awaySquad, awayUsername)}

KURALLAR:
- Her oyuncunun gerçek A Milli kariyer istatistiklerini, güçlü/zayıf yönlerini ve dönemini dikkate al
- Teknik direktörlerin taktik stilini ve tercih formasyonunu oyuna yansıt
- Maçı 90 dakika boyunca dakika dakika simüle et; önemli her anı bir event olarak ver
- Goller, sarı kartlar, kırmızı kartlar, kaçan fırsatlar, müdahaleler ve kritik anlar dahil
- Tarihi gerçekliğe sadık kal: örneğin Hakan Şükür kafa golü atar, Rüştü Reçber müthiş kurtarışlar yapar
- Canlı yorum hissi yarat: "23' Hakan Şükür ceza sahasında döndü, güçlü sol ayak şutu — GOL!"
- Her event için 'type' alanını şunlardan biri yap: goal | yellow_card | red_card | save | chance | action
- Her event için 'team' alanını 'home' veya 'away' olarak belirt
- SADECE geçerli JSON döndür, başka hiçbir şey yazma

Döndüreceğin JSON formatı:
{
  "events": [
    { "minute": 1, "type": "action", "team": "home", "description": "..." },
    { "minute": 23, "type": "goal", "team": "home", "description": "..." }
  ],
  "home_score": 2,
  "away_score": 1,
  "summary": "Maç özeti (3-4 cümle)",
  "mvp": "MVP oyuncunun adı"
}`;
}

// ─── Stream match simulation ─────────────────────────────────────────────────
export async function simulateMatch(
  homeSquad: Squad,
  awaySquad: Squad,
  homeUsername: string,
  awayUsername: string,
  onEvent: (event: LLMMatchResponse['events'][number]) => void,
  onDone: (result: LLMMatchResponse) => void,
  onError: (err: string) => void,
) {
  const prompt = buildMatchPrompt(homeSquad, awaySquad, homeUsername, awayUsername);
  
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const url = `${supabaseUrl}/functions/v1/simulate-match`;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ prompt, model: MODEL }),
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) {
        onError(`RATE_LIMIT:${errText}`);
        return;
      }
      if (response.status === 404) {
        onError(`MODEL_NOT_FOUND:${errText}`);
        return;
      }
      onError(`Gemini API hatası: ${response.status} — ${errText}`);
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    if (!reader) { onError('Stream okuyucu açılamadı'); return; }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          fullText += text;

          // Try to emit partial events as they come in
          tryEmitPartialEvents(fullText, onEvent);
        } catch {
          // Partial JSON, keep accumulating
        }
      }
    }

    // Parse final complete response
    try {
      const clean = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result: LLMMatchResponse = JSON.parse(clean);
      onDone(result);
    } catch {
      onError('Maç sonucu parse edilemedi. Ham yanıt: ' + fullText.slice(0, 200));
    }
  } catch (err: any) {
    onError(`Ağ hatası: ${err?.message ?? String(err)}`);
  }
}

// Track which events have already been emitted
let _lastEmittedCount = 0;
function tryEmitPartialEvents(fullText: string, onEvent: (e: any) => void) {
  try {
    const eventsMatch = fullText.match(/"events"\s*:\s*\[([\s\S]*)/);
    if (!eventsMatch) return;

    // Find complete event objects
    const eventsStr = eventsMatch[1];
    const eventMatches = [...eventsStr.matchAll(/\{[^{}]*"minute"[^{}]*"type"[^{}]*"team"[^{}]*"description"[^{}]*\}/g)];

    for (let i = _lastEmittedCount; i < eventMatches.length; i++) {
      try {
        const event = JSON.parse(eventMatches[i][0]);
        onEvent(event);
        _lastEmittedCount = i + 1;
      } catch {
        // Not yet complete
      }
    }
  } catch {
    // Keep accumulating
  }
}

export function resetMatchSimulator() {
  _lastEmittedCount = 0;
}
