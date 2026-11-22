/** The single definition of "can someone buy this right now". */
export function availableQuantity(tier: {
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
}): number {
  return Math.max(
    0,
    tier.quantityTotal - tier.quantitySold - tier.quantityReserved
  );
}
