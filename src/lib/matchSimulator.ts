import type { Squad, LLMMatchResponse } from '../types/game';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.0-flash';

function buildMatchPrompt(homeSquad: Squad, awaySquad: Squad, homeUsername: string, awayUsername: string): string {
  const formatSquad = (squad: Squad, username: string) => {
    const slotLines = squad.slots
      .map((s) => `  ${s.position}: ${s.player?.name ?? '?'} (${s.player?.peakYears ?? ''})`)
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
  apiKey: string,
  onEvent: (event: LLMMatchResponse['events'][number]) => void,
  onDone: (result: LLMMatchResponse) => void,
  onError: (err: string) => void,
) {
  const prompt = buildMatchPrompt(homeSquad, awaySquad, homeUsername, awayUsername);
  const url = `${GEMINI_BASE}/${MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
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
