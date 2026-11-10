import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A Concordium wallet export is the account: whoever holds one can spend from it and sign as it.
 * The registration script invites you to drop that file in the repo root, so the ignore rules are
 * the only thing standing between a convenience and a committed key.
 *
 * Asserted rather than assumed, because a reordered `.gitignore` or a stray negation would be
 * silent until the moment it was not.
 */
const ROOT = resolve(import.meta.dirname, "../../..");

function isGitIgnored(path: string): boolean {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
}

describe("wallet key exports stay out of the repo", () => {
  it("ignores an export in the root, which is where the script tells you to put it", () => {
    expect(isGitIgnored("4DBCxp3GVDmTwtB1Z718ojSCEy1eBp6oJ7RrNTJk8BUsJn7FGb.export")).toBe(true);
  });

  it("ignores one anywhere else too, since a stray copy is the likelier accident", () => {
    for (const p of ["apps/web/wallet.export", "packages/db/a.export", "deep/nested/x.export"]) {
      expect(isGitIgnored(p)).toBe(true);
    }
  });

  it("ignores the .export.json spelling as well", () => {
    expect(isGitIgnored("account.export.json")).toBe(true);
  });

  it("still tracks ordinary files, so the rule is not quietly ignoring everything", () => {
    // Without this the three tests above would pass against a .gitignore reading `*`.
    expect(isGitIgnored("package.json")).toBe(false);
    expect(isGitIgnored("scripts/concordium/register-agent.mjs")).toBe(false);
  });

  it("keeps exports out of a Docker build context, which gitignore has no say over", () => {
    const dockerignore = execFileSync("cat", [".dockerignore"], { cwd: ROOT }).toString();
    expect(dockerignore).toMatch(/^\*\.export$/m);
  });

  it("keeps .env files out of both", () => {
    // The same guarantee the keys have relied on all along, pinned next to the new one.
    expect(isGitIgnored(".env.testnet")).toBe(true);
    expect(isGitIgnored(".env.mainnet")).toBe(true);
    expect(isGitIgnored(".env.example")).toBe(false);
  });
});
