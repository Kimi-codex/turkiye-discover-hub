export function createBusinessMapPopup(
  name: string,
  ownerDocument: Pick<Document, "createElement"> = document,
): HTMLElement {
  const popup = ownerDocument.createElement("strong");
  popup.textContent = name;
  return popup;
}
