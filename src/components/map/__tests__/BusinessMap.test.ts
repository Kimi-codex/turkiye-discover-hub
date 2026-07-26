import { describe, expect, it } from "vitest";
import { createBusinessMapPopup } from "../map-popup";

describe("createBusinessMapPopup", () => {
  it("renders imported business names as text content, not HTML", () => {
    const payload = `<img src=x onerror=alert(1)><script>alert("xss")</script>`;
    let createdTag = "";
    const node = {
      textContent: "",
      innerHTML: "",
    } as unknown as HTMLElement;
    const fakeDocument = {
      createElement: (tagName: string) => {
        createdTag = tagName;
        return node;
      },
    } as Pick<Document, "createElement">;

    const popup = createBusinessMapPopup(payload, fakeDocument);

    expect(createdTag).toBe("strong");
    expect(popup.textContent).toBe(payload);
    expect(popup.innerHTML).toBe("");
  });
});
