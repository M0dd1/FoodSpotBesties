// FoodiSpots – Sicherung: holt alle Daten und Fotos über die Edge Function "backup-export"
// und schreibt sie in einen Ordner (im GitHub-Workflow: den Branch "backup").
// Aufruf: BACKUP_TOKEN=… SUPABASE_URL=… node scripts/backup.mjs <zielordner>
import fs from 'node:fs/promises';
import path from 'node:path';

const target = process.argv[2];
const { BACKUP_TOKEN, SUPABASE_URL } = process.env;
if (!target || !BACKUP_TOKEN || !SUPABASE_URL) {
  console.error('Aufruf: BACKUP_TOKEN=… SUPABASE_URL=… node scripts/backup.mjs <zielordner>');
  process.exit(2);
}

const res = await fetch(`${SUPABASE_URL}/functions/v1/backup-export`, { method: 'POST', headers: { 'x-backup-token': BACKUP_TOKEN } });
if (!res.ok) { console.error(`Export fehlgeschlagen: ${res.status} ${await res.text()}`); process.exit(1); }
const { exported_at, tables, photo_urls } = await res.json();

// Daten: eine JSON-Datei pro Tabelle (sortiert, damit Änderungen im Git-Verlauf gut lesbar sind)
const dataDir = path.join(target, 'data');
await fs.mkdir(dataDir, { recursive: true });
for (const [name, rows] of Object.entries(tables)) {
  rows.sort((a, b) => String(a.id ?? a.key ?? a.user_id ?? '').localeCompare(String(b.id ?? b.key ?? b.user_id ?? '')) || String(a.group_id ?? '').localeCompare(String(b.group_id ?? '')));
  await fs.writeFile(path.join(dataDir, `${name}.json`), JSON.stringify(rows, null, 2) + '\n');
}

// Fotos: nur neue herunterladen, gelöschte entfernen (alte Stände bleiben im Git-Verlauf)
const photoDir = path.join(target, 'photos');
await fs.mkdir(photoDir, { recursive: true });
const wanted = new Set(Object.keys(photo_urls));
let added = 0, removed = 0, failed = 0;
for (const [p, url] of Object.entries(photo_urls)) {
  const file = path.join(photoDir, p);
  if (!file.startsWith(photoDir + path.sep)) continue; // Schutz vor merkwürdigen Pfaden
  try { await fs.access(file); continue; } catch { /* neu */ }
  const r = await fetch(url);
  if (!r.ok) { failed++; console.warn(`Foto nicht ladbar: ${p} (${r.status})`); continue; }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
  added++;
}
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { await walk(full); continue; }
    const rel = path.relative(photoDir, full).split(path.sep).join('/');
    if (!wanted.has(rel)) { await fs.rm(full); removed++; }
  }
}
await walk(photoDir);

const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
await fs.writeFile(path.join(target, 'README.md'), `# FoodiSpots – Sicherung

Stand: ${exported_at}

| Tabelle | Einträge |
|---|---|
${Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}
| Fotos | ${wanted.size} |

Automatisch erstellt durch den GitHub-Workflow „Sicherung“. Ältere Stände sind im Git-Verlauf dieses Branches.
Wiederherstellen: \`data/*.json\` enthält alle Tabellen, \`photos/\` die Bilddateien mit ihrem Speicherpfad.
`);
console.log(`Sicherung ok: ${JSON.stringify(counts)}, Fotos +${added} −${removed}${failed ? `, ${failed} fehlgeschlagen` : ''}`);
if (failed) process.exit(1);
