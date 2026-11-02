'use client';
import { Database, HardDrive, RefreshCcw, Server } from 'lucide-react';
import type { SettingsResponse, SystemStatus } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Progress } from '../ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '../ui/table';
import { KeyValue } from '../common';
import { StatusLine } from './shared';
import { formatBytes } from '@/lib/utils';

export function MongoTab({ sys, settings, onTest, testing }: { sys?: SystemStatus; settings: SettingsResponse; onTest: () => void; testing: boolean }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" /> MongoDB
          </CardTitle>
          <CardDescription>Scripts, outlines, jobs, usage and configuration are stored here. Large files live on disk.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onTest} loading={testing}>
          <RefreshCcw /> Test connection
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <StatusLine ok={sys ? sys.mongo.state === 'connected' : null} label={`Connection: ${sys?.mongo.state ?? 'checking…'}`} detail={`Database: ${sys?.mongo.dbName ?? settings.environment.mongoDb}`} />
        <StatusLine ok={sys ? sys.vector.ok : null} label={`Vector store: ${sys?.vector.kind ?? settings.environment.vectorStore}`} detail={`${sys?.vector.message ?? ''} · collection ${settings.environment.qdrantCollection}`} />
      </CardContent>
    </Card>
  );
}

export function RedisTab({ sys }: { sys?: SystemStatus }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-4 w-4" /> Redis & queues
        </CardTitle>
        <CardDescription>BullMQ queues keep long-running work persistent across restarts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <StatusLine ok={sys ? sys.redis.ok : null} label={`Redis: ${sys?.redis.ok ? 'connected' : sys ? 'unreachable' : 'checking…'}`} detail={sys?.redis.message} />
        {sys?.queues && (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <THead>
                <TR>
                  <TH>Queue</TH>
                  {['waiting', 'active', 'delayed', 'failed', 'completed'].map((k) => (
                    <TH key={k} className="text-right">
                      {k}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {Object.entries(sys.queues).map(([q, c]) => (
                  <TR key={q}>
                    <TD className="font-medium">{q}</TD>
                    {['waiting', 'active', 'delayed', 'failed', 'completed'].map((k) => (
                      <TD key={k} className="text-right tabular-nums">
                        {c[k] ?? 0}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StorageTab({ sys }: { sys?: SystemStatus }) {
  const used = sys?.disk ? sys.disk.total - sys.disk.free : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-4 w-4" /> Storage
        </CardTitle>
        <CardDescription>PDFs, audio, scene clips, subtitles and final MP4s are organised by project → episode → generation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <KeyValue
          items={[
            ['Directory', <code key="d" className="text-xs">{sys?.storage.dir ?? '—'}</code>],
            ['Studio files', `${formatBytes(sys?.storage.bytes)} in ${sys?.storage.files ?? 0} files`],
            ['Disk free', sys?.disk ? `${formatBytes(sys.disk.free)} of ${formatBytes(sys.disk.total)}` : '—'],
          ]}
        />
        {sys?.disk && <Progress value={(used / sys.disk.total) * 100} tone={sys.disk.free / sys.disk.total < 0.1 ? 'danger' : 'primary'} />}
        <div className="grid gap-2 sm:grid-cols-2">
          {sys &&
            Object.entries(sys.binaries).map(([k, v]) => (
              <StatusLine key={k} ok={k === 'tesseract' ? (v ? true : null) : !!v} label={k} detail={v ?? (k === 'tesseract' ? 'Not installed (optional — Gemini OCR is used by default)' : 'Not found on PATH')} />
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
