import { renderProject, type RenderInput } from "../server/render-project";

let input = "";
for await (const chunk of process.stdin) {
  input += chunk.toString();
  if (input.length > 35_000_000) throw new Error("Render input limit exceeded.");
}
try {
  const result = await renderProject(JSON.parse(input) as RenderInput);
  process.stdout.write(JSON.stringify({ result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 8000) : "Rendering failed." }));
  process.exitCode = 1;
}
