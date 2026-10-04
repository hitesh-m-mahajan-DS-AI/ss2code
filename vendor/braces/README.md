# Bounded braces compatibility fork

Based on MIT-licensed braces 3.0.3 (upstream: https://github.com/micromatch/braces/tree/3.0.3). Original LICENSE is retained. This is a local fork, NOT an upstream patched release.

GHSA-vfj7-8cjw-p6xm has no patched upstream version as of 2026-10-04. Replacing the vulnerable implementation is deliberate, not an audit suppression: parse performs an iterative depth preflight and checks its actual stack so mismatched delimiters cannot bypass the limit; compile, expand and stringify validate externally supplied AST depth/node count/cycles iteratively before recursive work. All callers receive a controlled RangeError for excessive nesting. Limits are fixed at 64 levels and 50,000 AST nodes and cannot be disabled through options. Conservative preflight can reject unusually nested quoted/literal glob patterns.

The fork keeps upstream behavior for ordinary globs, and tests the installed dependency path as well as this source. It does not claim to eliminate all possible expansion/resource-exhaustion attacks. Generated projects use fixed trusted glob patterns and isolated resource-capped workers. Replace this fork with a reviewed upstream fix when available; do not change its name/version to conceal an unpatched implementation.

npm audit does not evaluate this local fork. A clean audit is therefore only dependency-database evidence, not proof of security. Regression tests and source review are required.
