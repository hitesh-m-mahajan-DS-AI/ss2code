-- Grain: one project, one job, one revision, one model/stage attempt respectively.
CREATE VIEW job_outcomes AS
SELECT phase, COUNT(*) AS jobs,
       AVG((julianday(updated_at)-julianday(created_at))*86400000) AS mean_elapsed_ms
FROM jobs GROUP BY phase;

CREATE VIEW model_reliability AS
SELECT source, stage, model, COUNT(*) AS attempts,
       SUM(outcome='ok') AS successful_attempts,
       ROUND(AVG(outcome='ok'),4) AS attempt_success_rate,
       ROUND(AVG(duration_ms),1) AS mean_duration_ms,
       SUM(total_tokens) AS reported_tokens,
       COUNT(total_tokens) AS attempts_with_token_accounting,
       SUM(cost_credits) AS reported_cost_credits,
       COUNT(cost_credits) AS attempts_with_cost_accounting
FROM spans WHERE model IS NOT NULL GROUP BY source, stage, model;

CREATE VIEW observed_project_coverage AS
SELECT 'uploaded' AS stage, COUNT(*) AS projects FROM projects
UNION ALL SELECT 'spec_observed', COUNT(*) FROM projects p
 WHERE p.has_spec=1 OR EXISTS(SELECT 1 FROM spans s WHERE s.project_id=p.id AND s.stage='analysis' AND s.outcome='ok')
UNION ALL SELECT 'generation_started', COUNT(DISTINCT project_id) FROM jobs
UNION ALL SELECT 'validated', COUNT(DISTINCT project_id) FROM jobs WHERE phase='ready'
UNION ALL SELECT 'export_built', COUNT(DISTINCT project_id) FROM spans WHERE source='studio' AND stage='export_built' AND outcome='ok';

CREATE VIEW failure_stages AS
SELECT source, stage, error_code, COUNT(*) AS failures
FROM spans WHERE outcome!='ok' GROUP BY source, stage, error_code ORDER BY failures DESC;

CREATE VIEW daily_jobs AS
SELECT substr(created_at,1,10) AS day, COUNT(*) AS started,
       SUM(phase='ready') AS validated, SUM(phase='failed') AS failed,
       SUM(phase='cancelled') AS cancelled
FROM jobs GROUP BY day ORDER BY day;
