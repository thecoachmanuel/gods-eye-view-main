import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

async function optimizeAndBundle() {
  const dir = 'public/cctv/nigeria';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg'));
  const imageMap = {};

  for (const file of files) {
    const input = path.join(dir, file);
    const rawBytes = fs.readFileSync(input);
    const optimizedBuffer = await sharp(rawBytes)
      .resize(960, 540, { fit: 'cover' })
      .jpeg({ quality: 82, progressive: true })
      .toBuffer();

    fs.writeFileSync(input, optimizedBuffer);
    imageMap[file] = optimizedBuffer.toString('base64');
    console.log(`Optimized ${file} -> ${optimizedBuffer.length} bytes`);
  }

  let js = '// Embedded high-resolution surveillance frames for Nigeria (1080p/960x540)\n';
  js += 'export const NIGERIA_CCTV_IMAGES = {\n';
  for (const [name, b64] of Object.entries(imageMap)) {
    js += `  ${JSON.stringify(name)}: Buffer.from(${JSON.stringify(b64)}, 'base64'),\n`;
  }
  js += '};\n';
  fs.mkdirSync('server/providers/cctv', { recursive: true });
  fs.writeFileSync('server/providers/cctv/nigeria-images.js', js, 'utf8');
  console.log('Generated server/providers/cctv/nigeria-images.js successfully!');
}

optimizeAndBundle().catch((err) => {
  console.error(err);
  process.exit(1);
});
