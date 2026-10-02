import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const chunkSchema = z.object({ id: z.string(), file: z.string(), startLine: z.number().int().positive(), endLine: z.number().int().positive(), text: z.string().max(4000) });
export const indexSchema = z.object({ version: z.literal(1), root: z.string(), createdAt: z.string(), documents: z.array(z.object({ file: z.string(), sha256: z.string() })).max(64), chunks: z.array(chunkSchema).max(10000) });
export type Index = z.infer<typeof indexSchema>;
type Chunk = Index["chunks"][number];
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const stopwords = new Set("a an and are as at be by can do does for from how i in is it my of on or that the this to what when where which with you your".split(" "));
export const tokens = (text: string) => text.toLowerCase().match(/[a-z0-9_]+/g)?.filter(t => !stopwords.has(t)) ?? [];

async function filesUnder(root: string, directory = root, depth = 0): Promise<string[]> {
  if (depth > 6) throw new Error("Corpus nesting exceeds six levels");
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const target = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error("Corpus symlinks are not permitted");
    if (item.isDirectory()) files.push(...await filesUnder(root, target, depth + 1));
    else if (/\.(md|txt)$/i.test(item.name)) files.push(path.relative(root, target).replaceAll("\\", "/"));
    if (files.length > 64) throw new Error("Corpus exceeds 64 documents");
  }
  return files.sort();
}

async function safeRead(root: string, file: string) {
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root + path.sep) || (await realpath(resolved)) !== resolved || !(await lstat(resolved)).isFile()) throw new Error("Unsafe corpus path");
  if ((await lstat(resolved)).size > 500_000) throw new Error("Document exceeds 500 KB");
  return readFile(resolved, "utf8");
}

export async function buildIndex(directory: string): Promise<Index> {
  const root = await realpath(path.resolve(directory));
  const documents: Index["documents"] = [], chunks: Chunk[] = [];
  for (const file of await filesUnder(root)) {
    const text = await safeRead(root, file);
    documents.push({ file, sha256: hash(text) });
    const lines = text.split(/\r?\n/);
    let start = 0, current: string[] = [];
    const flush = (end: number) => { const content = current.join("\n").trim(); if (content) chunks.push({ id: hash(file + ":" + start + ":" + content).slice(0, 20), file, startLine: start + 1, endLine: end, text: content }); current = []; };
    for (const [line, content] of lines.entries()) {
      if (content.length > 3000) throw new Error("Split corpus lines longer than 3000 characters");
      if (current.join("\n").length + content.length > 1600) { flush(line); start = line; }
      current.push(content);
      if (!content.trim() && current.join("\n").length > 200) { flush(line + 1); start = line + 1; }
    }
    flush(lines.length);
  }
  if (!chunks.length) throw new Error("No usable Markdown/text documents");
  return indexSchema.parse({ version: 1, root, createdAt: new Date().toISOString(), documents, chunks });
}

export async function assertFresh(index: Index) {
  const root = await realpath(index.root);
  const files = await filesUnder(root);
  if (JSON.stringify(files) !== JSON.stringify(index.documents.map(d => d.file).sort())) throw new Error("Corpus changed; rebuild the index");
  for (const document of index.documents) if (hash(await safeRead(root, document.file)) !== document.sha256) throw new Error("Corpus changed; rebuild the index");
}

export function retrieve(index: Index, question: string, limit = 3) {
  if (question.length > 2000) throw new Error("Question exceeds 2000 characters");
  const query = [...new Set(tokens(question))];
  if (!query.length) return [];
  const documents = index.chunks.map(chunk => tokens(chunk.text));
  const average = documents.reduce((sum, doc) => sum + doc.length, 0) / documents.length;
  const frequencies = new Map(query.map(term => [term, documents.filter(doc => doc.includes(term)).length]));
  return index.chunks.map((chunk, i) => {
    const words = documents[i]; let bm25 = 0, matches = 0;
    for (const term of query) {
      const count = words.filter(w => w === term).length;
      if (!count) continue;
      matches++;
      const df = frequencies.get(term)!;
      bm25 += Math.log(1 + (documents.length - df + .5) / (df + .5)) * count * 2.2 / (count + 1.2 * (.25 + .75 * words.length / average));
    }
    const coverage = matches / query.length;
    // Transparent lexical reranking, not a claim of neural/semantic reranking.
    return { ...chunk, coverage, score: bm25 * (.5 + coverage) };
  }).filter(hit => hit.coverage >= .4 && hit.score >= .5).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

export function verifyCitations(hits: Chunk[], citations: { sourceId: string; quote: string }[]) {
  return citations.map(citation => {
    const source = hits.find(hit => hit.id === citation.sourceId);
    if (!source || !source.text.includes(citation.quote) || citation.quote.length < 20) throw new Error("Unsupported citation; answer withheld");
    return { quote: citation.quote, file: source.file, startLine: source.startLine, endLine: source.endLine, sourceId: source.id };
  });
}
