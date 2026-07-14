INSERT INTO "artifacts" ("run_id", "step_id", "type", "title", "uri", "metadata")
SELECT
  "run_steps"."run_id",
  "run_steps"."id",
  'screenshot',
  'Validation screenshots',
  'artifact://validation/' || "run_steps"."run_id"::text || '/screenshots',
  jsonb_build_object(
    'expectedScreenshotEvidenceSchemaId', 'loopworks.screenshot_evidence.v1',
    'screenshotEvidenceMetadataKind', 'screenshot_evidence_contract',
    'screenshotEvidenceVersion', 1
  )
FROM "run_steps"
WHERE "run_steps"."stage" = 'validation'
  AND NOT EXISTS (
    SELECT 1
    FROM "artifacts"
    WHERE "artifacts"."step_id" = "run_steps"."id"
      AND "artifacts"."type" = 'screenshot'
  );
