/**
 * Local HTTP stand-ins for the Gemini and ElevenLabs REST APIs, used only by integration tests so the
 * real adapters, queues, database and FFmpeg pipeline can be exercised without credentials or cost.
 * Responses follow the documented response shapes.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { NARRATION_STYLES, estimateSpokenSeconds } from '@mas/shared';

export interface StubState {
  calls: Record<string, number>;
  failScenes: Set<number>;
  videoClipPath?: string;
  ttsAudioPath?: string;
  ttsDuration?: number;
  sceneCalls: number;
}

export const state: StubState = { calls: {}, failScenes: new Set(), sceneCalls: 0 };

function bump(k: string) {
  state.calls[k] = (state.calls[k] ?? 0) + 1;
}

function vectorFor(text: string, dims = 768): number[] {
  const out: number[] = [];
  let seed = crypto.createHash('sha256').update(text).digest();
  while (out.length < dims) {
    seed = crypto.createHash('sha256').update(seed).digest();
    for (let i = 0; i < seed.length && out.length < dims; i += 2) out.push((seed.readUInt16BE(i) / 65535) * 2 - 1);
  }
  const n = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
  return out.map((x) => x / n);
}

function respond(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function textResponse(obj: unknown) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 400 },
  };
}

const SENTENCES = [
  'उस समय हस्तिनापुर में सब कुछ शांत दिखाई देता था, लेकिन भीतर ही भीतर एक बड़ा तूफ़ान जन्म ले रहा था।',
  'राजा ने अपने मन की बात किसी से नहीं कही, पर उनकी आँखों में चिंता साफ़ दिखाई देती थी।',
  'देवव्रत ने पिता की उदासी का कारण जानने का निश्चय किया और वे सीधे निषादराज के पास पहुँचे।',
  'वहाँ जो शर्त सामने आई, उसने पूरे कुरु वंश का भविष्य बदल दिया।',
  'एक पल के लिए सब मौन हो गए... फिर देवव्रत ने वह वचन दिया जिसे सुनकर आकाश भी काँप उठा।',
  'देवताओं ने पुष्प बरसाए, और उसी दिन से संसार ने उन्हें भीष्म के नाम से जाना।',
];

function buildScript(prompt: string) {
  const epMatch = prompt.match(/EPISODE (\d+): (.+)/);
  const n = Number(epMatch?.[1] ?? 1);
  const hasNext = !/NEXT EPISODE: None/.test(prompt);
  const ids = [...prompt.matchAll(/\[\[([0-9a-f]{24}) \|/g)].map((m) => m[1]!);
  const hook = `क्या आप जानते हैं कि एपिसोड ${n} की इस घटना ने पूरे हस्तिनापुर का भविष्य बदल दिया?`;
  const ending = 'और इस तरह एक नया अध्याय शुरू हुआ।';
  const teaser = hasNext ? 'अब जानिए, इसके बाद क्या हुआ।' : '';
  const body: string[] = [];
  let i = 0;
  for (;;) {
    const next = SENTENCES[(i++ + n) % SENTENCES.length]!;
    if (estimateSpokenSeconds([hook, ...body, next, ending, teaser].join(' ')) > 58) break;
    body.push(next);
  }
  const narrationText = [hook, ...body, ending, teaser].filter(Boolean).join(' ');
  return {
    title: `एपिसोड ${n}: ${epMatch?.[2]?.trim() ?? 'कथा'}`,
    summary: 'शान्तनु और देवव्रत की कथा का एक महत्वपूर्ण क्षण।',
    hook,
    narrationText,
    ending,
    nextEpisodeTeaser: teaser,
    characters: ['Shantanu', 'Bhishma'],
    storyArc: { setup: 'राजा की चिंता', conflict: 'निषादराज की शर्त', climax: 'प्रतिज्ञा', resolution: 'भीष्म नाम' },
    storyTimeline: 'Shantanu era',
    sceneDescriptions: Array.from({ length: 8 }, (_, k) => ({
      sceneNumber: k + 1,
      narrationExcerpt: k === 0 ? hook : body[(k - 1) % body.length] ?? ending,
      visual: `King Shantanu on the banks of the Yamuna, scene ${k + 1}`,
      characters: k % 2 ? ['Bhishma'] : ['Shantanu'],
      environment: 'Yamuna riverbank at dusk',
      emotion: 'solemn',
    })),
    sourceChunkIds: ids.slice(0, 2),
    uncertaintyNotes: '',
    highlightWords: ['प्रतिज्ञा', 'भीष्म'],
  };
}

function handleGenerate(model: string, body: any) {
  const system: string = body.systemInstruction?.parts?.[0]?.text ?? '';
  const prompt: string = body.contents?.[0]?.parts?.[0]?.text ?? '';
  if (/OCR engine/.test(system)) {
    bump('ocr');
    return textResponse({ text: 'यह पृष्ठ स्कैन किया गया है और इसमें पाठ परत नहीं है।' });
  }
  if (/event index/.test(system)) {
    bump('map');
    const passages = [...prompt.matchAll(/\[\[([0-9a-f]{24}) \| pages (\d+)-(\d+)/g)];
    return textResponse({
      events: passages.map((p, i) => ({
        title: `घटना ${p[2]}-${i}`,
        summary: `Event narrated on pages ${p[2]}-${p[3]}.`,
        characters: ['Shantanu', 'Bhishma'],
        chunkIds: [p[1]],
        era: 'E02',
        importance: 4,
        certainty: 'certain',
        notes: '',
        embeddedTale: false,
        recap: false,
      })),
      characters: [
        { name: 'Shantanu', nameHi: 'शान्तनु', aliases: ['King of Hastinapura'], note: 'King of Hastinapura' },
        { name: 'Bhishma', nameHi: 'भीष्म', aliases: ['Devavrata'], note: 'Son of Ganga' },
      ],
      contradictions: [],
    });
  }
  if (/character designer/.test(system)) {
    bump('characters');
    const names = [...prompt.matchAll(/^- ([A-Za-z]+)/gm)].map((m) => m[1]!);
    return textResponse({
      characters: names.map((name) => ({
        name,
        nameHi: name === 'Bhishma' ? 'भीष्म' : 'शान्तनु',
        aliases: [],
        role: `${name} of the Kuru dynasty`,
        description: `${name} is central to the early Adi Parva.`,
        variants: [
          {
            key: 'adult',
            label: `Adult ${name}`,
            ageRange: '30-40',
            facialFeatures: 'strong jaw, calm eyes',
            hair: 'long black hair in a topknot',
            clothing: 'white silk dhoti, gold angavastram',
            armorAndAccessories: 'gold armlets',
            bodyType: 'tall, athletic',
            colorPalette: ['#FFFFFF', '#D4AF37'],
            identityPrompt: `${name}, a tall regal Kuru prince with long black hair in a topknot, white silk dhoti and gold angavastram`,
          },
        ],
      })),
    });
  }
  if (/head writer/.test(system)) {
    bump('plan');
    const ids = [...prompt.matchAll(/^(s\d+e\d+) \|/gm)].map((m) => m[1]!);
    return textResponse({
      episodes: ids.map((id, i) => ({ title: `भीष्म की कथा भाग ${i + 1}`, synopsis: `Covers event ${id}.`, eventIds: [id], characters: ['Shantanu', 'Bhishma'], continuityNote: '' })),
    });
  }
  if (/narration styles/.test(system)) {
    bump('style');
    return textResponse({ scores: NARRATION_STYLES.map((s, i) => ({ id: s.id, score: i === 10 ? 9 : i === 0 ? 8.7 : 5, reason: 'fits' })) });
  }
  if (/award-winning Hindi storyteller/.test(system)) {
    bump('script');
    return textResponse(buildScript(prompt));
  }
  if (/Hinglish/.test(system)) {
    bump('hinglish');
    const n = [...prompt.matchAll(/^(\d+)\. /gm)].length;
    return textResponse({ title: 'Bhishma ki katha', sentences: Array.from({ length: n }, (_, i) => `Kya aap jaante hain, yeh vaakya ${i + 1} hai.`) });
  }
  if (/strict editor/.test(system)) {
    bump('evaluate');
    return textResponse({
      storyAccuracy: 9, sourceConsistency: 9, chronologicalContinuity: 9, hookQuality: 9, narrationNaturalness: 9,
      endingQuality: 9, nonRepetition: 9, characterConsistency: 9, criticalIssues: [], issues: [],
    });
  }
  if (/cinematographer/.test(system)) {
    bump('scenePlan');
    const segs = [...prompt.matchAll(/^S(\d+) \[(\d+\.\d+)-(\d+\.\d+)s\]/gm)];
    return textResponse({
      scenes: segs.map((m, i) => ({
        segmentIds: [Number(m[1])],
        visualDescription: `Shantanu and Bhishma by the Yamuna, beat ${i + 1}`,
        characters: [{ name: i % 2 ? 'Bhishma' : 'Shantanu', variantKey: 'adult' }],
        environment: 'Yamuna riverbank, ancient Hastinapura',
        cameraMovement: 'slow dolly in',
        lighting: 'golden hour rim light',
        emotion: 'solemn resolve',
        continuity: 'same riverbank, same costumes as previous scene',
      })),
    });
  }
  bump('unknown');
  return textResponse({});
}

/** Checks the Responses API strict-schema rules: objects closed, every property required. */
function strictSchemaProblem(schema: any, path = '$'): string | null {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.type === 'object' && schema.properties) {
    if (schema.additionalProperties !== false) return `${path}: additionalProperties must be false`;
    const missing = Object.keys(schema.properties).filter((k) => !(schema.required ?? []).includes(k));
    if (missing.length) return `${path}: all properties must be required (missing ${missing.join(',')})`;
    for (const [k, v] of Object.entries(schema.properties)) {
      const p = strictSchemaProblem(v, `${path}.${k}`);
      if (p) return p;
    }
  }
  if (schema.items) return strictSchemaProblem(schema.items, `${path}[]`);
  return null;
}

function handleOpenAI(req: http.IncomingMessage, raw: string, res: http.ServerResponse) {
  if (req.headers.authorization !== 'Bearer test-openai-key') return respond(res, 401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } });
  const p = new URL(req.url!, 'http://x').pathname.replace(/^\/v1/, '');
  if (req.method === 'GET' && p === '/models') {
    return respond(res, 200, {
      object: 'list',
      data: ['gpt-6.1-sol', 'gpt-6.1-sol-2026-09-01', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.6-luna', 'gpt-5', 'text-embedding-3-small'].map((id, i) => ({
        id, object: 'model', created: 1_780_000_000 - i, owned_by: 'openai', shutdown_date: id === 'gpt-5' ? '2026-12-11' : null,
      })),
    });
  }
  if (req.method === 'POST' && p === '/responses') {
    bump('openai:responses');
    const body = JSON.parse(raw);
    const fmt = body.text?.format;
    if (fmt?.type !== 'json_schema' || fmt.strict !== true) return respond(res, 400, { error: { message: 'stub: expected strict json_schema format' } });
    const problem = strictSchemaProblem(fmt.schema);
    if (problem) return respond(res, 400, { error: { message: `Invalid schema for response_format 'result': ${problem}` } });
    const parts = body.input?.[0]?.content ?? [];
    const g = handleGenerate(body.model, { systemInstruction: { parts: [{ text: body.instructions }] }, contents: [{ parts: [{ text: parts.find((c: any) => c.type === 'input_text')?.text ?? '' }] }] });
    const text = g.candidates[0]!.content.parts[0]!.text;
    return respond(res, 200, {
      id: 'resp_stub', object: 'response', status: 'completed', model: body.model,
      output: [{ type: 'reasoning', id: 'rs_1', summary: [] }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
      usage: { input_tokens: 1500, input_tokens_details: { cached_tokens: 500 }, output_tokens: 600, output_tokens_details: { reasoning_tokens: 200 }, total_tokens: 2100 },
    });
  }
  if (req.method === 'POST' && p === '/embeddings') {
    bump('openai:embeddings');
    const body = JSON.parse(raw);
    const inputs: string[] = Array.isArray(body.input) ? body.input : [body.input];
    return respond(res, 200, {
      object: 'list', model: body.model,
      data: inputs.map((t, index) => ({ object: 'embedding', index, embedding: vectorFor(t, body.dimensions ?? 1536) })),
      usage: { prompt_tokens: inputs.join(' ').length / 3, total_tokens: inputs.join(' ').length / 3 },
    });
  }
  respond(res, 404, { error: { message: `stub: no route ${req.method} ${p}` } });
}

export function startStubServer(port = 4799, elevenPort = 4798, openaiPort = 4797): Promise<() => Promise<void>> {
  const oai = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => handleOpenAI(req, raw, res));
  });
  const gemini = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const url = new URL(req.url!, `http://127.0.0.1:${port}`);
      const p = url.pathname.replace(/^\/v1beta/, '');
      if (req.headers['x-goog-api-key'] !== 'test-gemini-key' && url.searchParams.get('key') !== 'test-gemini-key') return respond(res, 403, { error: { message: 'API key not valid' } });
      if (req.method === 'GET' && p === '/models') {
        return respond(res, 200, {
          models: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-embedding-2', 'gemini-omni-1.1-flash'].map((id) => ({
            name: `models/${id}`,
            displayName: id,
            supportedGenerationMethods: id.includes('embedding') ? ['embedContent', 'batchEmbedContents'] : ['generateContent'],
          })),
        });
      }
      const getModel = p.match(/^\/models\/([^:]+)$/);
      if (req.method === 'GET' && getModel) return respond(res, 200, { name: `models/${getModel[1]}`, displayName: getModel[1], supportedGenerationMethods: ['generateContent'] });
      const gen = p.match(/^\/models\/([^:]+):generateContent$/);
      if (gen) return respond(res, 200, handleGenerate(gen[1]!, JSON.parse(raw)));
      const emb = p.match(/^\/models\/([^:]+):batchEmbedContents$/);
      if (emb) {
        bump('embed');
        const body = JSON.parse(raw);
        return respond(res, 200, { embeddings: body.requests.map((r: any) => ({ values: vectorFor(r.content.parts[0].text.replace(/^(title|task): [^|]*\| (text|query): /, '')) })) });
      }
      if (req.method === 'POST' && p === '/interactions') {
        const body = JSON.parse(raw);
        const sceneNo = Number(String(body.input?.[0]?.text ?? '').match(/SCENE (\d+)/)?.[1] ?? 0);
        state.sceneCalls++;
        bump('interactions');
        if (state.failScenes.has(sceneNo)) return respond(res, 400, { error: { message: `Simulated provider rejection for scene ${sceneNo}` } });
        const data = fs.readFileSync(state.videoClipPath!).toString('base64');
        return respond(res, 200, { id: `v1_${sceneNo}_${Date.now()}`, status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data }] }] });
      }
      respond(res, 404, { error: { message: `stub: no route ${req.method} ${p}` } });
    });
  });

  const eleven = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      if (req.headers['xi-api-key'] !== 'test-eleven-key') return respond(res, 401, { detail: { message: 'invalid api key' } });
      const url = new URL(req.url!, `http://127.0.0.1:${elevenPort}`);
      if (url.pathname === '/v1/models') {
        return respond(res, 200, [
          { model_id: 'eleven_multilingual_v2', name: 'Multilingual v2', can_do_text_to_speech: true, languages: [{ language_id: 'hi', name: 'Hindi' }], maximum_text_length_per_request: 10000 },
          { model_id: 'eleven_flash_v2_5', name: 'Flash', can_do_text_to_speech: true, languages: [{ language_id: 'hi', name: 'Hindi' }] },
        ]);
      }
      if (url.pathname === '/v1/user/subscription') return respond(res, 200, { tier: 'creator', status: 'active', character_count: 1000, character_limit: 100000 });
      if (url.pathname.startsWith('/v2/voices')) return respond(res, 200, { voices: [{ voice_id: 'voice-hindi-1', name: 'Narrator', category: 'premade', labels: {} }], has_more: false });
      const tts = url.pathname.match(/^\/v1\/text-to-speech\/([^/]+)\/with-timestamps$/);
      if (tts) {
        bump('tts');
        const body = JSON.parse(raw);
        const chars = [...body.text] as string[];
        const dur = state.ttsDuration ?? 55;
        const step = dur / chars.length;
        return respond(res, 200, {
          audio_base64: fs.readFileSync(state.ttsAudioPath!).toString('base64'),
          alignment: {
            characters: chars,
            character_start_times_seconds: chars.map((_, i) => +(i * step).toFixed(3)),
            character_end_times_seconds: chars.map((_, i) => +((i + 1) * step).toFixed(3)),
          },
        });
      }
      respond(res, 404, { detail: { message: `stub: no route ${url.pathname}` } });
    });
  });

  return new Promise((resolve) => {
    gemini.listen(port, '127.0.0.1', () =>
      eleven.listen(elevenPort, '127.0.0.1', () =>
        oai.listen(openaiPort, '127.0.0.1', () =>
          resolve(
            () =>
              new Promise<void>((r) => {
                gemini.close(() => eleven.close(() => oai.close(() => r())));
              }),
          ),
        ),
      ),
    );
  });
}
