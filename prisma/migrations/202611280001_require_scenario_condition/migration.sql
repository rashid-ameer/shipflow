-- Preserve the match-all behavior of scenarios saved before conditions were required.
INSERT INTO "RateCondition" ("scenarioId", "position", "condition")
SELECT scenario."id", 0, '{"field":"cartQuantity","operator":"gte","value":"0"}'::jsonb
FROM "RateScenario" AS scenario
WHERE NOT EXISTS (
  SELECT 1 FROM "RateCondition" WHERE "scenarioId" = scenario."id"
);
