import { performance } from "node:perf_hooks";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { DocumentSnapshotSchema } = await server.ssrLoadModule("/src/contracts/events.ts");
  const { parseOrContractError } = await server.ssrLoadModule("/src/contracts/validation.ts");
  const paragraph = (index) => ({ id: `block-${index}`, type: "paragraph", content: [
    { type: "text", text: `Paragraph ${index} ${"evidence ".repeat(40)}`, styles: index % 2 ? { bold: true } : {} },
  ] });
  const blocks = Array.from({ length: 500 }, (_, index) => paragraph(index));
  blocks.push({ id: "nested", type: "bulletListItem", content: "Parent", children: [paragraph(501)] });
  blocks.push({ id: "table", type: "table", content: { rows: [{ cells: ["One", "Two"] }] } });
  const snapshot = { id: "document", projectId: "project", title: "Performance fixture", blocks,
    schemaVersion: 1, revision: 1, updatedAt: 1 };
  parseOrContractError(DocumentSnapshotSchema, snapshot, "warmup");
  const samples = [];
  for (let index = 0; index < 100; index += 1) {
    const started = performance.now();
    parseOrContractError(DocumentSnapshotSchema, snapshot, "performance");
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const percentile = (value) => samples[Math.min(samples.length - 1, Math.floor(samples.length * value))];
  const result = { bytes: Buffer.byteLength(JSON.stringify(snapshot)), samples: samples.length,
    medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: samples.at(-1) };
  console.log(JSON.stringify(result, null, 2));
  if (result.medianMs > 2) process.exitCode = 1;
} finally {
  await server.close();
}
