import type { QueueKey } from '@mas/shared';
import { getSettings } from '../services/settings';
import { onTerminal, registerHandler } from './runtime';
import { StoryOutlineModel, StorySourceModel } from '../models';
import { embedSource, processPdf } from '../services/story/ingest';
import { generateOutline } from '../services/story/outline';
import { generateHinglishJob, generateScript } from '../services/story/scripts';
import { generateScene, narrate, planScenes, registerVideoTerminalHook, renderVideoJob } from '../services/video/pipeline';

export function registerAllHandlers() {
  registerHandler('process-pdf', processPdf);
  registerHandler('embed-source', embedSource);
  registerHandler('generate-outline', generateOutline);
  registerHandler('generate-script', generateScript);
  registerHandler('hinglish', generateHinglishJob);
  registerHandler('narrate', narrate);
  registerHandler('plan-scenes', planScenes);
  registerHandler('generate-scene', generateScene);
  registerHandler('render-video', renderVideoJob);
  registerVideoTerminalHook();
  registerStoryTerminalHook();
}

let storyHook = false;
/** Surfaces story-pipeline failures on the source/outline so the UI never shows a stalled "in progress" state. */
function registerStoryTerminalHook() {
  if (storyHook) return;
  storyHook = true;
  onTerminal(async (job, outcome, err) => {
    if (!job.sourceId || !['process-pdf', 'embed-source', 'generate-outline'].includes(job.type)) return;
    const stage = job.type === 'process-pdf' ? 'extraction' : job.type === 'embed-source' ? 'embedding' : 'outline';
    const message = `${stage} ${outcome === 'cancelled' ? 'cancelled' : 'failed'}: ${err.message}`;
    if (job.type === 'generate-outline') {
      // The outline keeps its checkpoints; it stays resumable from the source page.
      await StoryOutlineModel.updateOne({ _id: job.payload?.outlineId }, { $set: { error: message, 'progress.message': message } });
    }
    await StorySourceModel.updateOne({ _id: job.sourceId }, { $set: { status: 'failed', 'progress.stage': `${stage} failed`, 'progress.message': message } });
  });
}

export async function workerConcurrency(): Promise<Record<QueueKey, number>> {
  const story = await getSettings('story');
  return { pdf: 1, embedding: 1, outline: 1, script: story.scriptConcurrency, audio: 2, video: 3, render: 1 };
}
