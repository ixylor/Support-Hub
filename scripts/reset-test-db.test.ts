import { describe, expect, it } from "vitest";
import { assertSafeToReset, normalizeDbIdentity } from "./reset-test-db.mjs";

const TEST_URL = "postgres://support_hub:support_hub@localhost:5432/support_hub_test";

describe("assertSafeToReset", () => {
  it("refuses identical strings", () => {
    expect(() => assertSafeToReset(TEST_URL, TEST_URL)).toThrow(
      /resolves to the same database as DATABASE_URL/
    );
  });

  it("refuses a trailing-slash difference pointing at the same database", () => {
    const devUrl = "postgres://support_hub:support_hub@localhost:5432/support_hub_test/";

    expect(() => assertSafeToReset(TEST_URL, devUrl)).toThrow(
      /resolves to the same database as DATABASE_URL/
    );
  });

  it("refuses localhost vs. 127.0.0.1 on the same database", () => {
    const devUrl = "postgres://support_hub:support_hub@127.0.0.1:5432/support_hub_test";

    expect(() => assertSafeToReset(TEST_URL, devUrl)).toThrow(
      /resolves to the same database as DATABASE_URL/
    );
  });

  it("refuses localhost vs. ::1 on the same database", () => {
    const devUrl = "postgres://support_hub:support_hub@[::1]:5432/support_hub_test";

    expect(() => assertSafeToReset(TEST_URL, devUrl)).toThrow(
      /resolves to the same database as DATABASE_URL/
    );
  });

  it("refuses when only sslmode differs", () => {
    const devUrl = "postgres://support_hub:support_hub@localhost:5432/support_hub_test?sslmode=require";

    expect(() => assertSafeToReset(TEST_URL, devUrl)).toThrow(
      /resolves to the same database as DATABASE_URL/
    );
  });

  it("refuses when only the username differs", () => {
    const devUrl = "postgres://someone_else:support_hub@localhost:5432/support_hub_test";

    expect(() => assertSafeToReset(TEST_URL, devUrl)).toThrow(
      /resolves to the same database as DATABASE_URL/
    );
  });

  it("refuses an explicit :5432 vs. an omitted port on the same database", () => {
    const devUrl = "postgres://support_hub:support_hub@localhost/support_hub_test";

    expect(() => assertSafeToReset(TEST_URL, devUrl)).toThrow(
      /resolves to the same database as DATABASE_URL/
    );
  });

  it("allows genuinely different database names on the same host", () => {
    const devUrl = "postgres://support_hub:support_hub@localhost:5432/support_hub";

    expect(assertSafeToReset(TEST_URL, devUrl)).toEqual({
      host: "localhost",
      port: 5432,
      database: "support_hub_test",
    });
  });

  it("refuses a database name that doesn't contain \"test\"", () => {
    const stagingUrl = "postgres://support_hub:support_hub@localhost:5432/support_hub_staging";
    const devUrl = "postgres://support_hub:support_hub@localhost:5432/support_hub";

    expect(() => assertSafeToReset(stagingUrl, devUrl)).toThrow(/doesn't contain "test"/);
  });

  it("refuses an unset TEST_DATABASE_URL with a clear message, not a TypeError", () => {
    let caught: unknown;
    try {
      assertSafeToReset(undefined, "postgres://support_hub:support_hub@localhost:5432/support_hub");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe("TEST_DATABASE_URL is not set — see .env.example.");
  });

  it("refuses an empty TEST_DATABASE_URL with a clear message, not a TypeError", () => {
    let caught: unknown;
    try {
      assertSafeToReset("", "postgres://support_hub:support_hub@localhost:5432/support_hub");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe("TEST_DATABASE_URL is not set — see .env.example.");
  });

  it("refuses a whitespace-only TEST_DATABASE_URL with a clear message, not a TypeError", () => {
    let caught: unknown;
    try {
      assertSafeToReset("   ", "postgres://support_hub:support_hub@localhost:5432/support_hub");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(TypeError);
    expect((caught as Error).message).toBe("TEST_DATABASE_URL is not set — see .env.example.");
  });

  it("allows when DATABASE_URL is unset, provided the name still looks disposable", () => {
    expect(assertSafeToReset(TEST_URL, undefined)).toEqual({
      host: "localhost",
      port: 5432,
      database: "support_hub_test",
    });
  });
});

describe("normalizeDbIdentity", () => {
  it("defaults an omitted port to 5432", () => {
    expect(normalizeDbIdentity("postgres://user@localhost/db_test")).toEqual({
      host: "localhost",
      port: 5432,
      database: "db_test",
    });
  });

  it("strips a trailing slash from the database name", () => {
    expect(normalizeDbIdentity("postgres://user@localhost:5432/db_test/")).toEqual({
      host: "localhost",
      port: 5432,
      database: "db_test",
    });
  });

  it("ignores query parameters and userinfo", () => {
    expect(normalizeDbIdentity("postgres://a:b@localhost:5432/db_test?sslmode=require&x=1")).toEqual({
      host: "localhost",
      port: 5432,
      database: "db_test",
    });
  });
});
