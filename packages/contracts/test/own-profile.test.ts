// Perfil y nombre propios (redesign-account-profile, tarea 3.1, design D1): el perfil no admite
// campos de más, el avatar es su versión o null, y el nombre propio rechaza saltos de línea.
import { describe, expect, it } from "vitest";
import { changeOwnNameSchema, ownProfileSchema } from "../src/users.ts";

const PROFILE = {
  name: "Ana Admin",
  email: "ana@empresa.ec",
  role: "ADMIN",
  membershipStatus: "ACTIVE",
  memberSince: "2026-10-01T15:00:00.000Z",
  avatar: { version: "0123456789abcdef" },
  avatarMaxBytes: 524288,
};

describe("perfil propio", () => {
  it("admite el perfil con avatar o sin él, y nada más", () => {
    expect(ownProfileSchema.parse(PROFILE)).toEqual(PROFILE);
    expect(ownProfileSchema.parse({ ...PROFILE, avatar: null }).avatar).toBeNull();
    expect(ownProfileSchema.safeParse({ ...PROFILE, userId: "u-1" }).success).toBe(false);
    expect(
      ownProfileSchema.safeParse({ ...PROFILE, avatar: { version: "x", content: "" } }).success,
    ).toBe(false);
  });

  it("el nombre propio se recorta y no admite saltos de línea ni campos de más", () => {
    expect(changeOwnNameSchema.parse({ name: "  Ana María  " })).toEqual({ name: "Ana María" });
    for (const body of [{ name: "" }, { name: "Ana\nMaría" }, { name: "a".repeat(101) }]) {
      expect(changeOwnNameSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(changeOwnNameSchema.safeParse({ name: "Ana", userId: "u-2" }).success).toBe(false);
  });
});
