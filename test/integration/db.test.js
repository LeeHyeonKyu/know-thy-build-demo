import { test, expect } from "vitest";
import { execSync } from "node:child_process";
test("postgres reachable via docker", () => {
  const out = execSync(`docker compose -f docker-compose.test.yml exec -T db psql -U postgres -d demo -tAc "select 1"`).toString().trim();
  expect(out).toBe("1");
});
