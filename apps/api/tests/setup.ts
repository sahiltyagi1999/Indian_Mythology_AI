import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Isolated resources for tests: separate DB, queue prefix, vector collection and storage dir.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-test-'));
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
process.env.MONGODB_DB = 'mas_test';
process.env.QUEUE_PREFIX = `mastest${process.pid}`;
process.env.QDRANT_COLLECTION = `mas_test_${process.pid}`;
process.env.STORAGE_DIR = dir;
process.env.GEMINI_BASE_URL = 'http://127.0.0.1:4799/v1beta';
process.env.ELEVENLABS_BASE_URL = 'http://127.0.0.1:4798';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:4797/v1';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.ELEVENLABS_API_KEY = 'test-eleven-key';
process.env.SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
