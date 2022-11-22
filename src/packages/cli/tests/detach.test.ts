import assert from "assert";
import { stripDetachArg, formatUptime } from "../src/detach";

describe("@ganache/cli", () => {
  describe("detach", () => {
    describe("formatUptime()", () => {
      const durations: [number, string][] = [
        [0, "Just started"],
        [0.1, "Just started"],
        [1, "Just started"],
        [-1, "Just started"],
        [2, "Just started"],
        [1000, "1 second"],
        [1001, "1 second"],
        [-1000, "In 1 second"],
        [-1001, "In 1 second"],
        [2000, "2 seconds"],
        [60000, "1 minute"],
        [62000, "1 minute, 2 seconds"],
        [1000000, "16 minutes, 40 seconds"],
        [-171906000, "In 1 day, 23 hours, 45 minutes, 6 seconds"],
        [171906000, "1 day, 23 hours, 45 minutes, 6 seconds"]
      ];

      durations.forEach(duration => {
        const [ms, formatted] = duration;
        it(`should format an input of ${ms} as "${formatted}"`, () => {
          const result = formatUptime(ms as number);
          assert.strictEqual(result, formatted);
        });
      });
    });

    describe("stripDetachArg()", () => {
      ["--detach", "-D", "--😈"].forEach(detachArg => {
        it(`should strip the ${detachArg} argument when it's the only argument`, () => {
          const args = [detachArg];
          const stripped = stripDetachArg(args);

          assert.deepStrictEqual(stripped, []);
        });

        it(`should strip the ${detachArg} argument when it's the first argument`, () => {
          const args = [detachArg, "--b"];
          const stripped = stripDetachArg(args);

          assert.deepStrictEqual(stripped, ["--b"]);
        });

        it(`should strip the ${detachArg} argument when it's the last argument`, () => {
          const args = [detachArg, "--b"];
          const stripped = stripDetachArg(args);

          assert.deepStrictEqual(stripped, ["--b"]);
        });

        it(`should strip the ${detachArg} argument when it's the middle argument`, () => {
          const args = ["--a", detachArg, "--b"];
          const stripped = stripDetachArg(args);

          assert.deepStrictEqual(stripped, ["--a", "--b"]);
        });

        it(`should strip the ${detachArg} argument when it has a provided value`, () => {
          const args = ["--a", `${detachArg}=true`, "--b"];
          const stripped = stripDetachArg(args);

          assert.deepStrictEqual(stripped, ["--a", "--b"]);
        });

        it(`should strip the ${detachArg} argument when it appears twice`, () => {
          const args = ["--a", `${detachArg}`, "--b", `${detachArg}`, "--c"];
          const stripped = stripDetachArg(args);

          assert.deepStrictEqual(stripped, ["--a", "--b", "--c"]);
        });

        it(`should strip the ${detachArg} argument when it has a provided value as the following argument`, () => {
          const args = ["--a", detachArg, "true", "--b"];
          const stripped = stripDetachArg(args);

          assert.deepStrictEqual(stripped, ["--a", "--b"]);
        });
      });

      it(`should strip the different detach arguments when it appears twice`, () => {
        const args = ["--a", "--detach", "--b", "-D", "--c", "--😈", "--d"];
        const stripped = stripDetachArg(args);

        assert.deepStrictEqual(stripped, ["--a", "--b", "--c", "--d"]);
      });

      ["-detach", "--D", "-😈", "--detachy", "detach", "-E"].forEach(
        incorrectArgument => {
          it(`should not strip ${incorrectArgument}`, () => {
            const args = ["--a", incorrectArgument, "--b"];
            const stripped = stripDetachArg(args);

            assert.deepStrictEqual(stripped, args);
          });
        }
      );
    });
  });
});
