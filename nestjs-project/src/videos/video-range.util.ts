export interface VideoByteRange {
  start: number;
  end: number;
}

export function parseVideoRange(
  rangeHeader: string,
  size: number,
): VideoByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;

  const [, startValue, endValue] = match;
  if (!startValue && !endValue) return null;

  if (!startValue) {
    const suffixLength = BigInt(endValue);
    if (suffixLength <= 0n) return null;
    return {
      start: Number(
        BigInt(size) > suffixLength ? BigInt(size) - suffixLength : 0n,
      ),
      end: size - 1,
    };
  }

  const start = BigInt(startValue);
  const requestedEnd = endValue ? BigInt(endValue) : BigInt(size - 1);
  if (requestedEnd < start || start >= BigInt(size)) return null;

  return {
    start: Number(start),
    end: Number(requestedEnd < BigInt(size) ? requestedEnd : BigInt(size - 1)),
  };
}
