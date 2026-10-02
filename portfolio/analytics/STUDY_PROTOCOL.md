# Prospective usability / impact study — not collected results

Version 1, 2026-10-02. No participants recruited, no responses fabricated, and no treatment effect claimed.

## Question and design

Does SS2Code reduce time to an accepted responsive reconstruction compared with a participant's normal manual workflow, without reducing visual fidelity or accessibility?

Use a consented within-participant crossover on different but independently matched reference tasks. Counterbalance task and workflow order; do not let someone repeat the exact screenshot after learning it. Record experience level, task difficulty and device before assignment. Include realistic failures and timeouts. Freeze the build/prompt/routing policy before each study round.

## Outcomes and analysis

Primary: time to a pre-defined accepted artifact (maximum 30 minutes; unfinished is censored, not dropped). Co-primary guardrail: completion proportion under deterministic and blinded human acceptance. Secondary: user corrections, accessibility findings, visual rubric, task satisfaction and provider interruptions. Publish both failure-inclusive completion and time among completers; do not imply the latter describes all participants.

Recruit a small pilot for instrument/task usability only. Set a minimum practically important time reduction and completion non-inferiority margin before the main study. Estimate within-participant variability from the pilot, then perform paired-design power analysis and pre-register sample size/analysis; there is no honest universal sample size without these assumptions. Cluster uncertainty by participant, stratify task families, report missingness and confidence intervals. Do not stop early because a favourable result appears.

Human fidelity rubric: independently rate layout, typography, colour, text completeness and responsiveness on anchored 1–5 scales; record acceptance disagreements and adjudication separately. Blind reviewers to model/lane and inspect accessible interactions using keyboard-only navigation. A screenshot cannot establish hidden interaction correctness.

## Privacy and consent

Explain what is recorded, retention duration, withdrawal deadline and publication scope before consent. Use assigned participant IDs; keep the identity key separate. Avoid proprietary screenshots and collect screen recordings only by separate opt-in. Do not enter participant data into this repository. Default proposed retention: delete identifiable pilot recordings after review; the actual retention policy must be agreed before recruitment.

## Reporting template

Record protocol version, dates, recruitment, consent process, randomization, build/prompt hashes, exclusions, participant/task counts, censoring, confidence intervals, blinded rubric agreement, failure taxonomy and limitations. Leave uncollected outcomes labelled **not measured**, never fill them with example success numbers.
