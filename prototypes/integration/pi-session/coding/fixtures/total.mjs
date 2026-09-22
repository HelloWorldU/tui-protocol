/** Total cost in integer cents. Each item has priceCents and quantity. */
export function totalCents(items) {
  return items.reduce((sum, item) => sum + item.priceCents, 0);
}
