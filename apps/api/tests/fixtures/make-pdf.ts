/**
 * Generates a small Hindi test PDF: three text pages (with section headings) and one image-only
 * "scanned" page that has no text layer, so the OCR path is exercised.
 */
import { createCanvas, PDFDocument } from '@napi-rs/canvas';
import fs from 'node:fs';

export const FIXTURE_PAGES = [
  {
    heading: 'आदि पर्व',
    paragraphs: [
      'हस्तिनापुर के राजा शान्तनु एक दिन गंगा के तट पर गए। वहाँ उन्होंने एक अत्यंत सुंदर स्त्री को देखा। वह स्वयं देवी गंगा थीं।',
      'शान्तनु ने उनसे विवाह का प्रस्ताव रखा। गंगा ने एक शर्त रखी कि राजा कभी उनके किसी काम पर प्रश्न नहीं करेंगे। राजा ने यह वचन दे दिया।',
      'गंगा ने अपने सात पुत्रों को जन्म लेते ही नदी में बहा दिया। आठवें पुत्र के समय शान्तनु स्वयं को रोक नहीं पाए और उन्होंने प्रश्न कर दिया।',
    ],
  },
  {
    heading: '',
    paragraphs: [
      'वचन टूटते ही गंगा अपने आठवें पुत्र देवव्रत को लेकर चली गईं। वर्षों बाद उन्होंने युवा देवव्रत को शान्तनु को लौटा दिया।',
      'देवव्रत ने परशुराम से शस्त्र विद्या और बृहस्पति से नीति शास्त्र सीखा था। शान्तनु ने उन्हें युवराज घोषित किया।',
    ],
  },
  {
    heading: 'सत्यवती और भीष्म प्रतिज्ञा',
    paragraphs: [
      'कुछ समय बाद शान्तनु ने यमुना के तट पर निषादराज की पुत्री सत्यवती को देखा और उनसे विवाह करना चाहा।',
      'निषादराज ने शर्त रखी कि सत्यवती का पुत्र ही राजा बनेगा। पिता की उदासी देखकर देवव्रत ने आजीवन ब्रह्मचर्य की भीषण प्रतिज्ञा ली।',
      'इसी भीषण प्रतिज्ञा के कारण देवव्रत भीष्म कहलाए। प्रसन्न होकर शान्तनु ने उन्हें इच्छा मृत्यु का वरदान दिया।',
    ],
  },
];

function wrap(ctx: any, text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > width && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export function makeHindiPdf(out: string) {
  const W = 595;
  const H = 842;
  const doc = new PDFDocument({ title: 'Mahabharata Test Excerpt' });
  for (const page of FIXTURE_PAGES) {
    const ctx = doc.beginPage(W, H);
    ctx.fillStyle = '#000';
    let y = 70;
    if (page.heading) {
      ctx.font = 'bold 22px "Kohinoor Devanagari"';
      ctx.fillText(page.heading, 50, y);
      y += 50;
    }
    ctx.font = '15px "Kohinoor Devanagari"';
    for (const p of page.paragraphs) {
      for (const l of wrap(ctx, p, W - 100)) {
        ctx.fillText(l, 50, y);
        y += 24;
      }
      y += 18;
    }
    doc.endPage();
  }
  // Image-only page (simulated scan): text is rasterised so there is no text layer.
  const img = createCanvas(W * 2, H * 2);
  const ic = img.getContext('2d');
  ic.fillStyle = '#fbf8f0';
  ic.fillRect(0, 0, W * 2, H * 2);
  ic.fillStyle = '#111';
  ic.font = '30px "Kohinoor Devanagari"';
  ic.fillText('यह पृष्ठ स्कैन किया गया है और इसमें पाठ परत नहीं है।', 100, 200);
  const ctx = doc.beginPage(W, H);
  (ctx as unknown as { drawImage(i: unknown, x: number, y: number, w: number, h: number): void }).drawImage(img, 0, 0, W, H);
  doc.endPage();
  fs.writeFileSync(out, doc.close());
}

/** English edition excerpt (Latin text extracts cleanly from Skia PDFs). */
export function makeEnglishPdf(out: string) {
  const doc = new PDFDocument({ title: 'Mahabharata English Excerpt' });
  const paras = [
    'SECTION XCIX. Then Santanu, the king of Hastinapura, went to the banks of the Ganga and beheld a maiden of great beauty.',
    'The son of Ganga, Devavrata, seeing the sorrow of his father, went to the chief of the fishermen and asked for the hand of Satyavati for the king.',
    'Then Devavrata took the terrible vow that he would never accept the throne and would remain celibate for life, and the gods showered flowers upon him and named him Bhishma.',
  ];
  for (let p = 0; p < 3; p++) {
    const ctx = doc.beginPage(595, 842);
    ctx.fillStyle = '#000';
    ctx.font = '14px Helvetica';
    let y = 70;
    for (const para of paras) {
      for (const l of wrap(ctx, `${para} (page ${p + 1})`, 495)) {
        ctx.fillText(l, 50, y);
        y += 22;
      }
      y += 14;
    }
    doc.endPage();
  }
  fs.writeFileSync(out, doc.close());
}

if (process.argv[2]) makeHindiPdf(process.argv[2]);
