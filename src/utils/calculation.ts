/**
 * Randomly picks an item from a weighted iterable
 * @param iterable list of elements with associated weights as [item, weight] pairs
 * @returns randomly selected item based on weights, or undefined if iterable is empty
 */
export function weightedRandom<T>(iterable: Iterable<[T, number]>): T | undefined {
  // If iterable is empty, return undefined
  const items = Array.from(iterable);
  if (items.length === 0) {
    return undefined;
  }

  // Calculate the sum of all weights
  const totalWeight = items.reduce((sum, [_, weight]) => sum + weight, 0);

  // If total weight is 0, all items have equal probability
  if (totalWeight <= 0) {
    const randomIndex = Math.floor(Math.random() * items.length);
    return items[randomIndex][0];
  }

  // Generate a random number between 0 and totalWeight
  const randomValue = Math.random() * totalWeight;

  // Find the item that corresponds to the random value
  let cumulativeWeight = 0;
  for (const [item, weight] of items) {
    cumulativeWeight += weight;
    if (randomValue < cumulativeWeight) {
      return item;
    }
  }

  // Fallback (shouldn't normally reach here)
  return items[items.length - 1][0];
}
