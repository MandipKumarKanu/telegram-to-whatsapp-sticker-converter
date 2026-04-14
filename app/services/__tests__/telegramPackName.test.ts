import { extractTelegramPackName } from "../telegramPackName";

describe("extractTelegramPackName", () => {
  it("extracts from full Telegram URL", () => {
    expect(extractTelegramPackName("https://t.me/addstickers/Animals")).toBe(
      "Animals",
    );
  });

  it("extracts from URL with trailing slash and query", () => {
    expect(
      extractTelegramPackName(
        "https://telegram.me/addstickers/Funny_Cats/?startapp=123",
      ),
    ).toBe("Funny_Cats");
  });

  it("extracts from username-like input", () => {
    expect(extractTelegramPackName("@MemePack_01")).toBe("MemePack_01");
  });

  it("returns null for invalid values", () => {
    expect(extractTelegramPackName("https://t.me/addstickers/invalid-pack"))
      .toBeNull();
    expect(extractTelegramPackName("   ")).toBeNull();
  });
});