'use client';
import * as React from 'react';
import { Settings } from 'lucide-react';
import { useSettings, useSystem } from '@/lib/queries/misc';
import { ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MongoTab, RedisTab, StorageTab } from '@/components/settings/system';
import { GoogleTab } from '@/components/settings/google';
import { OpenAITab } from '@/components/settings/openai';
import { ElevenTab } from '@/components/settings/eleven';
import { RenderTab, StoryTab } from '@/components/settings/engine';
import { BudgetTab, MusicTab, PricingTab } from '@/components/settings/library';

export default function SettingsPage() {
  const settings = useSettings();
  const system = useSystem();
  return (
    <>
      <PageHeader icon={Settings} title="AI Provider Settings" description="All API keys stay on the server, encrypted at rest. The browser only ever sees masked values." />
      {settings.error && <ErrorState error={settings.error} onRetry={() => settings.refetch()} className="mb-4" />}
      {settings.isLoading || !settings.data ? (
        <LoadingRows rows={8} />
      ) : (
        <Tabs defaultValue="openai">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="openai">Text AI · OpenAI</TabsTrigger>
            <TabsTrigger value="google">Google AI · Video</TabsTrigger>
            <TabsTrigger value="elevenlabs">ElevenLabs</TabsTrigger>
            <TabsTrigger value="mongo">MongoDB</TabsTrigger>
            <TabsTrigger value="redis">Redis & Queues</TabsTrigger>
            <TabsTrigger value="storage">Storage</TabsTrigger>
            <TabsTrigger value="story">Story Engine</TabsTrigger>
            <TabsTrigger value="render">Rendering</TabsTrigger>
            <TabsTrigger value="music">Music library</TabsTrigger>
            <TabsTrigger value="pricing">Pricing{settings.data.pricingFreshness.stale ? ' ⚠' : ''}</TabsTrigger>
            <TabsTrigger value="budget">Budget</TabsTrigger>
          </TabsList>
          <TabsContent value="openai">
            <OpenAITab data={settings.data} />
          </TabsContent>
          <TabsContent value="google">
            <GoogleTab data={settings.data} />
          </TabsContent>
          <TabsContent value="elevenlabs">
            <ElevenTab data={settings.data} />
          </TabsContent>
          <TabsContent value="mongo">
            <MongoTab sys={system.data} settings={settings.data} onTest={() => system.refetch()} testing={system.isFetching} />
          </TabsContent>
          <TabsContent value="redis">
            <RedisTab sys={system.data} />
          </TabsContent>
          <TabsContent value="storage">
            <StorageTab sys={system.data} />
          </TabsContent>
          <TabsContent value="story">
            <StoryTab data={settings.data} />
          </TabsContent>
          <TabsContent value="render">
            <RenderTab data={settings.data} />
          </TabsContent>
          <TabsContent value="music">
            <MusicTab />
          </TabsContent>
          <TabsContent value="pricing">
            <PricingTab data={settings.data} />
          </TabsContent>
          <TabsContent value="budget">
            <BudgetTab data={settings.data} />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
