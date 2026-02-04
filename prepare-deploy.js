import { readFile, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const toml = await readFile(resolve(__dirname, 'wrangler.toml'), 'utf-8');
const { version } = JSON.parse(await readFile(resolve(__dirname, 'package.json'), 'utf-8'));
await writeFile(resolve(__dirname, 'wrangler-versioned.toml'), toml.replaceAll('@@VERSION@@', version), 'utf-8');
