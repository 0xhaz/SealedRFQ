import { describe, expect, it } from "vitest";
import {
  type Candidate,
  RUBRIC_SCHEMA,
  type Rubric,
  RubricError,
  hashRubric,
  parseRubric,
  scoreAll,
} from "../src/rubric.js";

const rubric: Rubric = {
  schema: RUBRIC_SCHEMA,
  version: 1,
  criteria: [
    { id: "price", label: "Price", weightBps: 5_000, direction: "lower_is_better" },
    { id: "delivery", label: "Delivery", weightBps: 3_000, direction: "lower_is_better" },
    { id: "record", label: "Track record", weightBps: 2_000, direction: "higher_is_better" },
  ],
};

const bid = (bidder: string, price: bigint, delivery: bigint, record: bigint): Candidate => ({
  bidder,
  values: { price, delivery, record },
});

describe("a rubric that cannot be scored fairly", () => {
  it("is refused when the weights do not total 10000", () => {
    expect(() =>
      parseRubric({ ...rubric, criteria: [{ ...rubric.criteria[0], weightBps: 4_000 }] }),
    ).toThrow(/not 10000/);
  });

  it("is refused when a criterion is listed twice", () => {
    expect(() =>
      parseRubric({
        ...rubric,
        criteria: [
          { id: "price", label: "A", weightBps: 5_000, direction: "lower_is_better" },
          { id: "price", label: "B", weightBps: 5_000, direction: "lower_is_better" },
        ],
      }),
    ).toThrow(/more than once/);
  });

  it("refuses a bid that is missing a criterion rather than scoring it zero", () => {
    const incomplete = { bidder: "0xa", values: { price: 100n, delivery: 10n } };
    expect(() => scoreAll(rubric, [incomplete as Candidate])).toThrow(/no value for criterion/);
  });
});

describe("scoring against the best bid", () => {
  it("gives the cheapest full marks and half to a bid at twice the price", () => {
    const [best, dear] = scoreAll(rubric, [bid("0xa", 100n, 10n, 5n), bid("0xb", 200n, 10n, 5n)]);
    expect(best?.criteria.price).toBe(10_000);
    expect(dear?.criteria.price).toBe(5_000);
  });

  it("lets a quicker bid beat a cheaper one, when the gap is wide enough", () => {
    // 5% dearer but twice as fast. The price gap is worth little, the delivery gap a lot, and the
    // ranking follows the arithmetic rather than the headline weight.
    const ranked = scoreAll(rubric, [bid("0xcheap", 100n, 20n, 0n), bid("0xquick", 105n, 10n, 0n)]);
    expect(ranked[0]?.bidder).toBe("0xquick");
  });

  it("separates nobody when every bid is identical", () => {
    const ranked = scoreAll(rubric, [bid("0xa", 100n, 10n, 3n), bid("0xb", 100n, 10n, 3n)]);
    expect(ranked.map((r) => r.criteria.price)).toEqual([10_000, 10_000]);
    expect(ranked[0]?.totalBps).toBe(ranked[1]?.totalBps);
  });

  it("does not divide by zero when the best value is zero", () => {
    const ranked = scoreAll(rubric, [bid("0xa", 0n, 10n, 1n), bid("0xb", 50n, 10n, 1n)]);
    expect(ranked.find((r) => r.bidder === "0xa")?.criteria.price).toBe(10_000);
    expect(ranked.find((r) => r.bidder === "0xb")?.criteria.price).toBe(0);
  });
});

describe("reproducibility, which is the point of freezing a rubric", () => {
  const field = [
    bid("0xc", 1_000_003n, 77n, 2n),
    bid("0xa", 999_999n, 91n, 5n),
    bid("0xb", 1_000_000n, 90n, 5n),
  ];

  it("gives the same answer however the bids arrive", () => {
    const forwards = scoreAll(rubric, field);
    const backwards = scoreAll(rubric, [...field].reverse());
    expect(backwards).toEqual(forwards);
  });

  it("gives byte-identical output on a second run", () => {
    expect(JSON.stringify(scoreAll(rubric, field))).toBe(JSON.stringify(scoreAll(rubric, field)));
  });

  it("uses no floating point, so awkward ratios do not drift", () => {
    // 1/3 of the best price. In floats this is 3333.3333333333335 and rounding it is a judgement
    // call that another implementation may make differently; in integers it is 3333, everywhere.
    const [, third] = scoreAll(rubric, [bid("0xbest", 1n, 1n, 1n), bid("0xthird", 3n, 1n, 1n)]);
    expect(third?.criteria.price).toBe(3_333);
    expect(Number.isInteger(third?.criteria.price)).toBe(true);
    expect(Number.isInteger(third?.totalBps)).toBe(true);
  });

  it("handles values far beyond what a float can hold exactly", () => {
    // Above 2^53 a double silently loses precision. USDC amounts are bigint for this reason, and
    // the scorer keeps them that way until the final ratio.
    const huge = scoreAll(rubric, [
      bid("0xa", 9_007_199_254_740_993n, 1n, 1n),
      bid("0xb", 18_014_398_509_481_986n, 1n, 1n),
    ]);
    expect(huge[0]?.bidder).toBe("0xa");
    expect(huge[1]?.criteria.price).toBe(5_000);
  });
});

describe("ties", () => {
  it("breaks on the bidder id when every number matches, so the order is recomputable", () => {
    const ranked = scoreAll(rubric, [bid("0xbbb", 10n, 5n, 1n), bid("0xaaa", 10n, 5n, 1n)]);
    expect(ranked.map((r) => r.bidder)).toEqual(["0xaaa", "0xbbb"]);
  });

  it("prefers the better criterion before falling back to the id", () => {
    // Equal totals by construction: one is cheaper, the other quicker.
    const ranked = scoreAll(
      {
        ...rubric,
        criteria: [
          { id: "price", label: "Price", weightBps: 5_000, direction: "lower_is_better" },
          { id: "delivery", label: "Delivery", weightBps: 5_000, direction: "lower_is_better" },
          { id: "record", label: "Record", weightBps: 0, direction: "higher_is_better" },
        ],
      },
      [bid("0xzzz", 100n, 200n, 0n), bid("0xaaa", 200n, 100n, 0n)],
    );
    // Same total; the cheaper bid wins on the first criterion in rubric order.
    expect(ranked[0]?.bidder).toBe("0xzzz");
  });
});

describe("the rubric hash", () => {
  it("is stable across equal rubrics written in different key orders", () => {
    const reordered = {
      version: 1,
      schema: RUBRIC_SCHEMA,
      criteria: rubric.criteria.map((c) => ({
        direction: c.direction,
        weightBps: c.weightBps,
        label: c.label,
        id: c.id,
      })),
    } as Rubric;
    expect(hashRubric(reordered)).toBe(hashRubric(rubric));
  });

  it("changes when any scoring-relevant field changes", () => {
    const before = hashRubric(rubric);
    const after = hashRubric({
      ...rubric,
      criteria: [
        { ...(rubric.criteria[0] as never), weightBps: 6_000 },
        { ...(rubric.criteria[1] as never), weightBps: 2_000 },
        rubric.criteria[2] as never,
      ],
    });
    expect(after).not.toBe(before);
  });

  it("refuses to hash a rubric that does not add up", () => {
    expect(() => hashRubric({ ...rubric, criteria: [rubric.criteria[0] as never] })).toThrow(
      RubricError,
    );
  });
});
