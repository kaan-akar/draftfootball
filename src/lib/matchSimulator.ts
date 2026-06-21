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

function ratingLabel(price: number): string {
  if (price >= 9) return 'Efsane (10 üzerinden 9-10)';
  if (price >= 7) return 'Yıldız (10 üzerinden 7-8)';
  if (price >= 5) return 'İyi (10 üzerinden 5-6)';
  return 'Orta seviye (10 üzerinden 1-4)';
}

function buildMatchPrompt(homeSquad: Squad, awaySquad: Squad, homeUsername: string, awayUsername: string): string {
  const formatSquad = (squad: Squad, username: string) => {
    const coachSection = squad.coach
      ? `Teknik Direktör: ${squad.coach.name}
  Taktik Stil: ${squad.coach.style}
  Tercih Formasyonları: ${squad.coach.preferred_formations.join(', ')}
  Değer: ${ratingLabel(squad.coach.price)}
  Biyografi / Felsefe: ${squad.coach.bio}`
      : `Teknik Direktör: Bilinmiyor`;

    const slotLines = squad.slots
      .map((s) => {
        if (!s.player) return `  ${s.position}: (Boş)`;
        const p = s.player;
        return `  ${s.position}: ${p.name}
    Grup: ${p.position_group} | Detay: ${p.positions.join('/')}
    Zirve Yılları: ${p.peak_years} | A Milli: ${p.caps} maç, ${p.goals} gol
    Değer: ${ratingLabel(p.price)}
    Kariyer & Oyun Tarzı: ${p.bio}`;
      })
      .join('\n');

    return `═══ TAKIM: ${username} ═══
Formasyon: ${squad.formation}
${coachSection}

İLK 11:
${slotLines}`;
  };

  return `Sen Türk futbol tarihini derinlemesine bilen, heyecanlı ve usta bir TV maç spikerisin. Lig TV / TRT spiker üslubuyla, akıcı ve canlı bir dille anlatım yap.

Aşağıdaki iki Türkiye A Milli Takım kadrosu hayali bir maçta karşı karşıya geliyor. Her oyuncu kendi gerçek kariyerinin zirvesindeymiş gibi oynuyor.

${formatSquad(homeSquad, homeUsername)}

${formatSquad(awaySquad, awayUsername)}

SİMÜLASYON KURALLARI:
1. Her oyuncunun gerçek kariyer istatistiklerini (cap, gol, zirve yılları, değer), oyun stilini ve biyografisini birebir maça yansıt. Olaylarda oyuncuların gerçek isimlerini sıkça kullan.
2. Teknik direktörlerin taktik anlayışını, formasyon tercihlerini ve oyun felsefesini maçın akışına entegre et; kimin planı tuttu, kim hamle yaptı belirt.
3. Fiziksel özellikler, teknik beceriler, liderlik kalitesi ve o döneme ait gerçek form durumunu hesaba kat.
4. Tarihe sadık kal: örneğin Hakan Şükür'ün ön alan baskısı ve kafa gücü, Rüştü Reçber'in efsane refleksleri, Tugay Kerrimoğlu'nun pas temposu, Emre Belözoğlu'nun sert ve zeki liderliği, Arda Turan'ın dar alan çalımları.
5. Değer farkları belirleyici olsun: efsane oyuncular (9-10) belirleyici anlar yaratsın; orta seviye oyuncular (1-4) daha sınırlı etki yapsın. Maç sonucu güç dengesini mantıklı şekilde yansıtsın.
6. Formasyon çarpışmasını yansıt: hangi taraf orta sahaya hâkim? Kanatlarda kim üstün? Defans hattı ne kadar sağlam? Bu üstünlükler olaylara yansısın.
7. Maçı baştan sona bir hikâye gibi kur: erken tempo, ilk yarı gelişimi, devre arası etkisi, ikinci yarı baskısı ve final dakikalarındaki gerilim. Olaylar 1-90. dakikalara dengeli dağılsın.
8. 'action' tipini önemli taktiksel anlar için kullan (kritik press, hattı kıran pas, pozisyon değişikliği, tempo değişimi); anlam taşımayan dolgu ekleme.
9. Toplam event sayısı 16-22 arasında olsun; maçı zengin ve akıcı bir şekilde anlat.
10. Her event için 'type': goal | yellow_card | red_card | save | chance | action
11. Her event için 'team': 'home' veya 'away'
12. Her 'description' canlı spiker üslubunda 1-2 akıcı cümle olsun (yaklaşık 25-45 kelime): oyuncu adı, pozisyonun nasıl geliştiği ve heyecanı aktar. Gol ve büyük fırsatlarda biraz daha betimleyici ol.
13. SADECE geçerli JSON döndür, başka hiçbir şey yazma. JSON'u eksiksiz tamamla.

Döndüreceğin JSON formatı:
{
  "events": [
    { "minute": 7, "type": "chance", "team": "home", "description": "..." },
    { "minute": 23, "type": "goal", "team": "home", "description": "..." }
  ],
  "home_score": 2,
  "away_score": 1,
  "summary": "Maç özeti: 4-6 cümle. Oyunun genel kalitesini, taktiksel üstünlüğü, dönüm noktalarını ve sonucu vurgulayan dolu dolu bir değerlendirme yaz.",
  "mvp": "MVP oyuncunun adı (en etkili performansı sergileyen)"
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

    // SSE frames can be split across chunks at arbitrary byte boundaries, so we
    // must buffer and only process complete lines. Otherwise a "data: {...}"
    // line cut in half is dropped by JSON.parse and the final text is truncated.
    const processLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === '[DONE]' || jsonStr === '') return;
      try {
        const parsed = JSON.parse(jsonStr);
        const parts = parsed?.candidates?.[0]?.content?.parts ?? [];
        // Skip "thought" parts (thinking summaries) — only the real answer
        // parts contain the JSON we want to accumulate.
        for (const part of parts) {
          if (part?.thought) continue;
          if (typeof part?.text === 'string') fullText += part.text;
        }
        tryEmitPartialEvents(fullText, onEvent);
      } catch {
        // Incomplete/garbled SSE frame — ignore.
      }
    };

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer for next chunk.
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
    // Flush whatever is left in the buffer after the stream ends.
    buffer += decoder.decode();
    if (buffer) processLine(buffer);

    // Parse final complete response
    try {
      const clean = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const result: LLMMatchResponse = JSON.parse(clean);
      onDone(result);
    } catch {
      // The JSON may be truncated (e.g. the model stopped mid-array). Rather
      // than throwing away a perfectly good set of events, salvage whatever
      // complete event objects we received and rebuild a valid result.
      const salvaged = salvageMatchResult(fullText, homeUsername, awayUsername);
      if (salvaged) {
        onDone(salvaged);
        return;
      }
      onError(
        `Maç sonucu parse edilemedi. Uzunluk: ${fullText.length}. ` +
        `Baş: ${fullText.slice(0, 120)} … Son: ${fullText.slice(-120)}`,
      );
    }
  } catch (err: any) {
    onError(`Ağ hatası: ${err?.message ?? String(err)}`);
  }
}

// Rebuild a usable result from a (possibly truncated) raw response by pulling
// out every complete event object. Used as a fallback when JSON.parse fails so
// we keep the LLM narrative instead of falling back to the local simulator.
const EVENT_REGEX = /\{[^{}]*"minute"[^{}]*"type"[^{}]*"team"[^{}]*"description"[^{}]*\}/g;

function salvageMatchResult(
  fullText: string,
  homeUsername: string,
  awayUsername: string,
): LLMMatchResponse | null {
  const eventsMatch = fullText.match(/"events"\s*:\s*\[([\s\S]*)/);
  if (!eventsMatch) return null;

  const events: LLMMatchResponse['events'] = [];
  for (const m of eventsMatch[1].matchAll(EVENT_REGEX)) {
    try {
      const ev = JSON.parse(m[0]);
      if (ev && typeof ev.minute === 'number' && ev.description) events.push(ev);
    } catch {
      // Skip malformed/incomplete event.
    }
  }
  if (events.length === 0) return null;

  events.sort((a, b) => a.minute - b.minute);

  const goalsHome = events.filter((e) => e.type === 'goal' && e.team === 'home').length;
  const goalsAway = events.filter((e) => e.type === 'goal' && e.team === 'away').length;
  const homeScoreMatch = fullText.match(/"home_score"\s*:\s*(\d+)/);
  const awayScoreMatch = fullText.match(/"away_score"\s*:\s*(\d+)/);
  const home_score = homeScoreMatch ? parseInt(homeScoreMatch[1], 10) : goalsHome;
  const away_score = awayScoreMatch ? parseInt(awayScoreMatch[1], 10) : goalsAway;

  const summaryMatch = fullText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const mvpMatch = fullText.match(/"mvp"\s*:\s*"((?:[^"\\]|\\.)*)"/);

  return {
    events,
    home_score,
    away_score,
    summary: summaryMatch?.[1] ??
      `${homeUsername} ile ${awayUsername} arasındaki maç ${home_score}-${away_score} sonuçlandı.`,
    mvp: mvpMatch?.[1] ?? homeUsername,
  };
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
