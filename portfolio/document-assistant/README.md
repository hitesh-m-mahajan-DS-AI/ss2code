# Evidence-grounded document assistant

A separate working CLI project: ingest local Markdown/text, retrieve source passages, optionally ask a free OpenRouter model to select evidence, then verify every quote before displaying it. Output is extractive evidence, not an unsupported free-form answer.

## Use

From the repository root after the main Node installation:

```powershell
npm run documents -- index
npm run documents -- ask --question "Where do I configure OPENROUTER_API_KEY?"
npm run documents -- ask --question "Where do I configure OPENROUTER_API_KEY?" --live
npm run documents -- evaluate --check
```

Index your own permitted documents with `npm run documents -- index --root "C:\path\to\documents"`. This replaces the local index, so re-index the default corpus before running the bundled authored evaluation. Markdown and plain text only; PDF/OCR and web crawling are not implemented. Limits: 64 documents, 500 KB each, nesting depth six, question length 2,000 characters. Hidden files are skipped; symlinks, escaped paths and oversized files/lines are rejected.

Without `--live`, no AI inference occurs. With it, the question and up to three retrieved chunks leave the machine through OpenRouter. Check document permissions and provider data-handling requirements first. Empty retrieval abstains before making a provider call. The API key is read server-side from `.env.local`, not put in the corpus.

## System / data card

Ingestion creates paragraph/line-aware chunks with stable source IDs, line ranges and document hashes. BM25-style lexical scoring plus query-coverage reranking selects candidate chunks. Coverage/score thresholds are fixed in code; this is **not embeddings, vector search or a neural reranker**. English tokenization and lexical overlap limit paraphrase/multilingual performance.

Before each query, additions, edits and deletions invalidate the index; re-index explicitly. The evidence schema permits only abstention and source-ID/exact-quote pairs. Fabricated IDs, modified quotes or quotes not in retrieved chunks cause the answer to be withheld. Sources and questions are untrusted data; the model has no action tools. A quoted instruction can still be malicious or irrelevant: source validity is not semantic correctness, and prompt injection is not proven solved.

The default corpus is three original project help documents. Sixteen authored questions contain 12 answerable and four deliberately unrelated examples. Retrieval-only evaluation records recall@3, MRR, abstention and latency with document hashes. The recorded initial scores are recall@3 **1.0**, MRR **0.9583**, unrelated-question abstention **1.0**. This is a tiny, easy lexical smoke set, **not an LLM answer-accuracy result** or a representative semantic benchmark.

A separate live smoke query returned a verified configuration quote via free Nemotron. That establishes one working inference path, not general answer reliability. Expand questions with paraphrases, ambiguous/unanswerable near-matches, stale documents and adversarial passages before stronger claims. Keep development and held-out questions separate and report answer support/relevance by human review.

## Artifacts and operations

The private index and query records are under `.data/document-assistant/`; query artifacts contain the question, evidence, document hashes, prompt version and resolved model, so treat them as content-bearing private data. Telemetry separately contains only operational metadata. The committed `reports/retrieval.json` contains the authored test questions/results, not user queries. No public document service, user accounts, retention scheduler or production deployment is claimed.

Tests cover lexical retrieval, exact citation validation and stale sources. CI evaluates only the bundled corpus with no inference key. `--check` enforces the bundled smoke thresholds; this is regression detection, not proof of broad quality.
