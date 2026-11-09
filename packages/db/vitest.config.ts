import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /*
     * One database, so one file at a time.
     *
     * These suites each reset the tables they use, which is the only way to make a test independent
     * of what ran before it. Run in parallel against a single Postgres, that reset wipes a sibling
     * file's fixtures mid-run, and the failures land in whichever file lost the race rather than in
     * the one that caused it. A few hundred milliseconds of serialisation is worth not debugging
     * that.
     */
    fileParallelism: false,
  },
});
