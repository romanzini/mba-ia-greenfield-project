import { parseVideoRange } from './video-range.util';

describe('parseVideoRange', () => {
  it('parses an explicit byte range', () => {
    expect(parseVideoRange('bytes=10-19', 100)).toEqual({
      start: 10,
      end: 19,
    });
  });

  it('clamps a range end to the file size', () => {
    expect(parseVideoRange('bytes=90-150', 100)).toEqual({
      start: 90,
      end: 99,
    });
  });

  it('clamps very large decimal range ends without integer overflow', () => {
    expect(parseVideoRange('bytes=0-999999999999999999999', 100)).toEqual({
      start: 0,
      end: 99,
    });
  });

  it('parses an open-ended range', () => {
    expect(parseVideoRange('bytes=90-', 100)).toEqual({
      start: 90,
      end: 99,
    });
  });

  it('parses a suffix range', () => {
    expect(parseVideoRange('bytes=-10', 100)).toEqual({
      start: 90,
      end: 99,
    });
  });

  it.each([
    ['bytes=100-', 100],
    ['bytes=10-9', 100],
    ['bytes=-0', 100],
    ['bytes=1-2,4-5', 100],
    ['items=1-2', 100],
    ['bytes=0-1', 0],
  ])('rejects invalid range %s for size %i', (range, size) => {
    expect(parseVideoRange(range, size)).toBeNull();
  });
});
