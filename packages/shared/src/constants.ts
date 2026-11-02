export const SOURCE_STATUSES = [
  'uploaded',
  'extracting',
  'extracted',
  'chunking',
  'embedding',
  'indexed',
  'analyzing',
  'outlined',
  'failed',
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const OUTLINE_STATUSES = ['generating', 'draft', 'approved', 'failed'] as const;
export type OutlineStatus = (typeof OUTLINE_STATUSES)[number];

export const EPISODE_STATUSES = ['pending', 'generating', 'draft', 'review_required', 'approved', 'locked'] as const;
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number];

export const EPISODE_STATUS_LABELS: Record<EpisodeStatus, string> = {
  pending: 'Pending',
  generating: 'Generating',
  draft: 'Draft',
  review_required: 'Review Required',
  approved: 'Approved',
  locked: 'Locked',
};

/** Episodes in these states are protected from automatic regeneration. */
export const PROTECTED_EPISODE_STATUSES: readonly EpisodeStatus[] = ['approved', 'locked'];
/** Only these states can be sent to the Video Engine. */
export const VIDEO_READY_EPISODE_STATUSES: readonly EpisodeStatus[] = ['approved', 'locked'];

export const QUEUE_NAMES = {
  pdf: 'pdf-processing',
  embedding: 'embedding-generation',
  outline: 'story-outline',
  script: 'script-generation',
  audio: 'audio-generation',
  video: 'video-generation',
  render: 'video-rendering',
} as const;
export type QueueKey = keyof typeof QUEUE_NAMES;

export const JOB_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'awaiting_confirmation',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const VIDEO_STATUSES = [
  'queued',
  'narrating',
  'planning',
  'generating_scenes',
  'rendering',
  'completed',
  'failed',
  'cancelled',
  'awaiting_confirmation',
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const SCENE_STATUSES = ['pending', 'generating', 'completed', 'failed'] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

export const BATCH_STATUSES = ['estimating', 'awaiting_confirmation', 'running', 'completed', 'partial', 'failed', 'cancelled'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const USAGE_CATEGORIES = ['text', 'embedding', 'narration', 'video', 'rendering', 'storage', 'ocr'] as const;
export type UsageCategory = (typeof USAGE_CATEGORIES)[number];

export const PROVIDER_KEYS = ['google', 'openai', 'llm', 'elevenlabs', 'pricing', 'budget', 'render', 'storage', 'story'] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export interface NarrationStyle {
  id: string;
  name: string;
  nameHi: string;
  description: string;
  recommendedFor: string[];
  voice: string;
  pacing: 'slow' | 'measured' | 'moderate' | 'brisk' | 'fast';
  /** 1 (restrained) – 5 (maximum intensity) */
  intensity: 1 | 2 | 3 | 4 | 5;
  musicMood: string;
  /** Writing guidance injected into the script prompt. */
  writingGuidance: string;
  /** Suggested ElevenLabs voice_settings adjustments relative to the user's defaults. */
  ttsHints: { stability: number; style: number; speed: number };
}

export const NARRATION_STYLES: NarrationStyle[] = [
  {
    id: 'epic-narrator',
    name: 'Epic Mahabharata Narrator',
    nameHi: 'महाकाव्य सूत्रधार',
    description: 'Grand, timeless voice of the epic itself — the classic sutradhar who frames destiny and consequence.',
    recommendedFor: ['origin stories', 'turning points of dynasties', 'prologues', 'episodes spanning many years'],
    voice: 'Deep baritone, resonant, unhurried, authoritative',
    pacing: 'measured',
    intensity: 4,
    musicMood: 'epic orchestral with tanpura drone and slow percussion',
    writingGuidance:
      'Speak as the timeless narrator of the epic. Frame events in terms of destiny (नियति), dharma and consequence. Use grand but simple sentences. Occasional rhetorical questions.',
    ttsHints: { stability: 0.55, style: 0.35, speed: 0.95 },
  },
  {
    id: 'majestic-storyteller',
    name: 'Deep Majestic Storyteller',
    nameHi: 'गंभीर कथावाचक',
    description: 'Warm, deep fireside storyteller — intimate yet majestic, like a grandfather recounting the epic.',
    recommendedFor: ['childhood episodes', 'family relationships', 'quiet character moments', 'lineage and births'],
    voice: 'Deep, warm, gentle gravitas',
    pacing: 'slow',
    intensity: 3,
    musicMood: 'soft strings, flute (bansuri), warm ambient pads',
    writingGuidance:
      'Tell it like a revered elder speaking to listeners gathered close. Warm, vivid imagery, gentle pauses marked by commas and ellipses.',
    ttsHints: { stability: 0.6, style: 0.3, speed: 0.92 },
  },
  {
    id: 'emotional-tragedy',
    name: 'Emotional Tragedy',
    nameHi: 'करुण कथा',
    description: 'Heart-heavy narration for loss, betrayal, sacrifice and grief.',
    recommendedFor: ['deaths', 'curses', 'betrayals', 'separations', 'sacrifices'],
    voice: 'Soft, breaking at key words, restrained grief',
    pacing: 'slow',
    intensity: 4,
    musicMood: 'melancholic sarangi, solo cello, sparse piano',
    writingGuidance:
      'Let emotion lead. Short sentences at the emotional peak. Focus on what the character feels and loses. Never melodramatic exaggeration beyond the source.',
    ttsHints: { stability: 0.45, style: 0.5, speed: 0.9 },
  },
  {
    id: 'suspense-mystery',
    name: 'Suspense & Mystery',
    nameHi: 'रहस्य और रोमांच',
    description: 'Hushed, tense narration that withholds and reveals — ideal for secrets and hidden identities.',
    recommendedFor: ['hidden identities', 'secrets', 'conspiracies', 'prophecies', 'disguises'],
    voice: 'Low, controlled, slightly whispered tension',
    pacing: 'moderate',
    intensity: 3,
    musicMood: 'low drones, ticking percussion, dark ambient',
    writingGuidance:
      'Build tension by withholding the key fact until late. Use questions and "लेकिन..." turns. Reveal with a short punchy sentence.',
    ttsHints: { stability: 0.5, style: 0.45, speed: 0.95 },
  },
  {
    id: 'warrior-battlefield',
    name: 'Warrior & Battlefield',
    nameHi: 'वीर रस — रणभूमि',
    description: 'Powerful, rousing narration for duels, battles and martial feats.',
    recommendedFor: ['battles', 'duels', 'weapon training', 'feats of archery', 'Kurukshetra war days'],
    voice: 'Strong, commanding, rising energy',
    pacing: 'brisk',
    intensity: 5,
    musicMood: 'war drums (dhol, nagada), brass, heroic choir',
    writingGuidance:
      'Vivid action verbs, short rhythmic sentences, sensory detail of arrows, chariots and conch shells. Build to a climactic moment.',
    ttsHints: { stability: 0.4, style: 0.6, speed: 1.02 },
  },
  {
    id: 'divine-spiritual',
    name: 'Divine & Spiritual',
    nameHi: 'दिव्य और आध्यात्मिक',
    description: 'Reverent, luminous narration for divine interventions, boons and revelations.',
    recommendedFor: ['divine appearances', 'boons', 'Krishna’s teachings', 'celestial weapons', 'miracles'],
    voice: 'Calm, reverent, luminous, spacious',
    pacing: 'slow',
    intensity: 3,
    musicMood: 'temple bells, choir aahs, shankh, ethereal pads',
    writingGuidance:
      'Reverent tone without sermonising. Describe divine presence through light, sound and stillness. Keep philosophy accessible.',
    ttsHints: { stability: 0.65, style: 0.25, speed: 0.9 },
  },
  {
    id: 'royal-court',
    name: 'Royal Court Storytelling',
    nameHi: 'राजदरबार की कथा',
    description: 'Formal, dignified narration of politics, assemblies, coronations and diplomacy.',
    recommendedFor: ['court assemblies', 'coronations', 'dice game', 'diplomatic missions', 'succession disputes'],
    voice: 'Dignified, crisp, formal',
    pacing: 'moderate',
    intensity: 3,
    musicMood: 'shehnai, courtly strings, measured tabla',
    writingGuidance:
      'Describe the court, the stakes and the power play. Use dialogue fragments sparingly and attribute them clearly.',
    ttsHints: { stability: 0.6, style: 0.3, speed: 0.97 },
  },
  {
    id: 'philosophical',
    name: 'Philosophical Reflection',
    nameHi: 'दार्शनिक चिंतन',
    description: 'Thoughtful narration that surfaces the moral dilemma at the heart of an event.',
    recommendedFor: ['moral dilemmas', 'Bhagavad Gita', 'Yaksha prashna', 'questions of dharma'],
    voice: 'Measured, contemplative, clear',
    pacing: 'measured',
    intensity: 2,
    musicMood: 'minimal sitar, ambient drone, soft rain textures',
    writingGuidance:
      'Center the dilemma. Pose the question the character faces, then show their choice. Keep vocabulary simple; avoid heavy Sanskrit.',
    ttsHints: { stability: 0.65, style: 0.2, speed: 0.93 },
  },
  {
    id: 'fast-dramatic',
    name: 'Fast-Paced Dramatic',
    nameHi: 'तेज़ नाटकीय',
    description: 'High-energy, rapid-fire storytelling for episodes packed with events.',
    recommendedFor: ['chases', 'escapes', 'sequences with many events', 'Lakshagriha escape', 'swayamvar contests'],
    voice: 'Energetic, urgent, clear diction',
    pacing: 'fast',
    intensity: 4,
    musicMood: 'driving percussion, staccato strings, risers',
    writingGuidance:
      'Momentum first: one event per sentence, quick transitions ("तभी...", "उसी पल..."). Keep sentences short for clean TTS delivery.',
    ttsHints: { stability: 0.45, style: 0.5, speed: 1.05 },
  },
  {
    id: 'character-centric',
    name: 'Character-Centric Emotional',
    nameHi: 'पात्र-केंद्रित भावकथा',
    description: 'Narration anchored in one character’s inner world — their pride, pain, love or resolve.',
    recommendedFor: ['Karna', 'Draupadi', 'Eklavya', 'Bhishma’s vow', 'Kunti’s secret', 'personal turning points'],
    voice: 'Intimate, empathetic, controlled intensity',
    pacing: 'measured',
    intensity: 4,
    musicMood: 'solo flute or violin theme, subtle strings',
    writingGuidance:
      'Stay close to one character’s perspective. Name what they feel and why. Ground every emotion in events from the source.',
    ttsHints: { stability: 0.5, style: 0.45, speed: 0.94 },
  },
  {
    id: 'vow-and-destiny',
    name: 'Vows, Curses & Destiny',
    nameHi: 'प्रतिज्ञा, श्राप और नियति',
    description: 'Ominous, weighty narration for vows, curses and prophecies whose consequences echo across the epic.',
    recommendedFor: ['vows (pratigya)', 'curses (shraap)', 'prophecies', 'boons with conditions'],
    voice: 'Grave, resonant, ominous undertone',
    pacing: 'measured',
    intensity: 4,
    musicMood: 'deep gong, low choir, thunder textures',
    writingGuidance:
      'Make the listener feel the weight of words spoken. Quote the vow or curse simply, then foreshadow its consequence only as far as the source supports.',
    ttsHints: { stability: 0.55, style: 0.4, speed: 0.92 },
  },
  {
    id: 'romance-devotion',
    name: 'Love & Devotion',
    nameHi: 'प्रेम और भक्ति',
    description: 'Tender narration for love stories, devotion and loyalty.',
    recommendedFor: ['Shantanu and Ganga', 'Shantanu and Satyavati', 'Arjuna and Subhadra', 'Savitri', 'devotion to Krishna'],
    voice: 'Soft, lyrical, warm',
    pacing: 'slow',
    intensity: 2,
    musicMood: 'santoor, soft flute, gentle strings',
    writingGuidance: 'Lyrical but plain Hindi. Emphasise longing, loyalty and promise. Keep it dignified.',
    ttsHints: { stability: 0.6, style: 0.35, speed: 0.92 },
  },
];

export const NARRATION_STYLE_IDS = NARRATION_STYLES.map((s) => s.id);

export interface VisualStyle {
  id: string;
  name: string;
  description: string;
  promptPrefix: string;
  negativeGuidance: string;
  /** FFmpeg filter fragment applied as a consistent grade across the whole video. */
  colorGrade: string;
}

export const VISUAL_STYLES: VisualStyle[] = [
  {
    id: 'photoreal-cinematic',
    name: 'Photorealistic Cinematic',
    description: 'Live-action film look, natural skin, anamorphic lighting.',
    promptPrefix:
      'Photorealistic cinematic live-action film still in motion, ancient India, shot on a large-format cinema camera, anamorphic lens, shallow depth of field, volumetric light, film grain',
    negativeGuidance: 'no text, no captions, no logos, no modern objects, no cartoon look, no distorted faces or hands',
    colorGrade: 'eq=contrast=1.06:saturation=1.08:gamma=0.98,curves=preset=medium_contrast',
  },
  {
    id: 'epic-mythology',
    name: 'Epic Indian Mythology',
    description: 'Golden-hour grandeur, rich jewel tones, divine glow — the classic epic look.',
    promptPrefix:
      'Epic Indian mythology cinematic scene, grand ancient Bharat architecture, rich jewel tones of gold, saffron and deep blue, divine rim light, atmospheric haze, majestic composition',
    negativeGuidance: 'no text, no captions, no logos, no modern objects, no western medieval armor, no distorted faces',
    colorGrade: 'eq=contrast=1.08:saturation=1.15:gamma=0.97,colorbalance=rs=0.04:gs=0.01:bs=-0.04:rh=0.03:bh=-0.03',
  },
  {
    id: '3d-animation',
    name: 'High-end 3D Animation',
    description: 'Feature-film quality stylised 3D characters and environments.',
    promptPrefix:
      'High-end stylised 3D animated feature film scene, ancient India, expressive characters, detailed textures, global illumination, cinematic lighting',
    negativeGuidance: 'no text, no captions, no logos, no photorealistic live action, no low-poly look',
    colorGrade: 'eq=contrast=1.04:saturation=1.1',
  },
  {
    id: 'traditional-illustration',
    name: 'Traditional Mythological Illustration',
    description: 'Painterly motion inspired by Indian miniature and classical devotional painting.',
    promptPrefix:
      'Animated painterly illustration inspired by classical Indian miniature and devotional painting, ornate borders of light, gold leaf accents, gentle parallax motion, rich pigments',
    negativeGuidance: 'no text, no captions, no logos, no photorealism, no modern objects',
    colorGrade: 'eq=contrast=1.03:saturation=1.12',
  },
];

export const VISUAL_STYLE_IDS = VISUAL_STYLES.map((s) => s.id);

export const DEFAULT_TARGET_DURATION_SEC = 55;
export const DEFAULT_DURATION_TOLERANCE_SEC = 5;
