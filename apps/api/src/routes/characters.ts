import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import { ah, objectId, parse } from './util';
import { CharacterModel, EpisodeModel } from '../models';
import { AppError, notFound } from '../lib/errors';
import { storage, keys } from '../storage';
import { characterKey } from '../services/story/characters';

export const charactersRouter = Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(png|jpeg|webp)$/.test(file.mimetype)),
});

const variantSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/),
  label: z.string().min(1).max(120),
  ageRange: z.string().max(80).default(''),
  facialFeatures: z.string().max(1000).default(''),
  hair: z.string().max(500).default(''),
  clothing: z.string().max(1000).default(''),
  armorAndAccessories: z.string().max(1000).default(''),
  bodyType: z.string().max(300).default(''),
  colorPalette: z.array(z.string().max(20)).max(8).default([]),
  identityPrompt: z.string().max(2000).default(''),
  referenceImages: z.array(z.string()).max(6).default([]),
});

const characterSchema = z.object({
  sourceId: z.string().optional(),
  name: z.string().min(1).max(100),
  nameHi: z.string().max(100).optional(),
  aliases: z.array(z.string().max(100)).max(30).default([]),
  description: z.string().max(3000).default(''),
  role: z.string().max(300).default(''),
  variants: z.array(variantSchema).max(6).default([]),
});

charactersRouter.get(
  '/',
  ah(async (req, res) => {
    const q = parse(z.object({ sourceId: z.string().optional(), search: z.string().max(100).optional() }), req.query);
    const filter: Record<string, unknown> = {};
    if (q.sourceId) filter.sourceId = objectId(q.sourceId);
    if (q.search) {
      const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { nameHi: rx }, { aliases: rx }];
    }
    const items = await CharacterModel.find(filter).sort({ name: 1 }).lean();
    const counts = await EpisodeModel.aggregate([{ $unwind: '$characters' }, { $group: { _id: '$characters', n: { $sum: 1 } } }]);
    const byName = new Map(counts.map((c) => [String(c._id).toLowerCase(), c.n as number]));
    res.json({ items: items.map((c) => ({ ...c, episodeCount: byName.get(c.name.toLowerCase()) ?? 0 })) });
  }),
);

charactersRouter.post(
  '/',
  ah(async (req, res) => {
    const body = parse(characterSchema, req.body);
    const c = await CharacterModel.create({ ...body, sourceId: body.sourceId ? objectId(body.sourceId) : undefined, nameKey: characterKey(body.name), userEdited: true });
    res.status(201).json(c);
  }),
);

charactersRouter.get(
  '/:id',
  ah(async (req, res) => {
    const c = await CharacterModel.findById(objectId(req.params.id!)).lean();
    if (!c) throw notFound('Character');
    const episodes = await EpisodeModel.find({ characters: c.name }).select('episodeNumber title status').sort({ episodeNumber: 1 }).limit(200).lean();
    res.json({ character: c, episodes });
  }),
);

charactersRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const body = parse(characterSchema.partial().omit({ sourceId: true }), req.body);
    const update: Record<string, unknown> = { ...body, userEdited: true };
    if (body.name) update.nameKey = characterKey(body.name);
    const c = await CharacterModel.findByIdAndUpdate(objectId(req.params.id!), { $set: update }, { new: true });
    if (!c) throw notFound('Character');
    res.json(c);
  }),
);

charactersRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const c = await CharacterModel.findByIdAndDelete(objectId(req.params.id!));
    if (!c) throw notFound('Character');
    await storage().deletePrefix(`characters/${c._id}`).catch(() => undefined);
    res.status(204).end();
  }),
);

/** Uploads a visual reference image for a character variant (used by providers that accept reference images). */
charactersRouter.post(
  '/:id/variants/:variant/images',
  imageUpload.single('image'),
  ah(async (req, res) => {
    if (!req.file) throw new AppError('PNG, JPEG or WebP image required (field "image")', 400, 'NO_FILE');
    const c = await CharacterModel.findById(objectId(req.params.id!));
    if (!c) throw notFound('Character');
    const v = c.variants.find((x) => x.key === req.params.variant);
    if (!v) throw notFound('Variant');
    if (v.referenceImages.length >= 6) throw new AppError('A variant can have at most 6 reference images', 422, 'LIMIT');
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[req.file.mimetype] ?? path.extname(req.file.originalname);
    const key = keys.characterImage(String(c._id), `${v.key}-${Date.now()}${ext}`);
    await storage().put(key, req.file.buffer);
    v.referenceImages.push(key);
    c.userEdited = true;
    await c.save();
    res.status(201).json(c);
  }),
);

charactersRouter.delete(
  '/:id/variants/:variant/images',
  ah(async (req, res) => {
    const { key } = parse(z.object({ key: z.string() }), req.query);
    const c = await CharacterModel.findById(objectId(req.params.id!));
    if (!c) throw notFound('Character');
    const v = c.variants.find((x) => x.key === req.params.variant);
    if (!v || !v.referenceImages.includes(key)) throw notFound('Reference image');
    v.referenceImages = v.referenceImages.filter((k) => k !== key);
    await c.save();
    await storage().delete(key);
    res.json(c);
  }),
);
