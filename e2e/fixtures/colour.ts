/**
 * How light a rendered colour is, on a 0 (black) to 1 (white) scale.
 *
 * Used to state that a surface is still readable under a theme, which is the one thing about colour
 * a suite can legitimately assert. Nothing here compares a colour to an expected value: the states
 * of the product are read from `data-state`, the icon and the wording, never from a hue.
 *
 * Two notations have to be handled because the browser decides which one it serialises: a custom
 * property declared in `oklch()` stays in `oklch()` through `getComputedStyle`, while anything the
 * browser had to convert comes back as `rgb()`. Everything else is refused loudly — a colour this
 * cannot read is a colour the assertion above it would silently stop checking.
 */
export function lightnessOf(computed: string): number {
  const oklch = /^oklch\(\s*([\d.]+)(%?)/.exec(computed);
  if (oklch) {
    const value = Number(oklch[1]);
    return oklch[2] === '%' ? value / 100 : value;
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(computed);
  if (rgb) {
    const [red, green, blue] = rgb.slice(1, 4).map((channel) => Number(channel) / 255);
    // Rec. 709 luma, close enough to perceived lightness for "is this dark or light".
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  }

  throw new Error(`no lightness could be read from ${computed}`);
}
