import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import type { ComponentProps } from 'react';

import { cn } from '@/ui/lib/utils';

/**
 * shadcn/ui dropdown menu, copied in and owned here.
 *
 * ## Why Radix enters after `button.tsx:9-11` had kept it out
 *
 * That trim dropped `asChild`, a convenience: it renders a link as a button, and these surfaces
 * have no navigation. Nothing was lost by writing the markup by hand.
 *
 * A menu is not a convenience. It is roving focus, typeahead, arrow-key wrap, Escape, outside
 * click, focus returned to the trigger on close, `aria-expanded`/`aria-activedescendant`, and a
 * layer that escapes the popup's overflow. A hand-written version of that is a keyboard trap
 * waiting to happen in a surface that is 320 px wide and has exactly one gesture.
 *
 * Only what is used is kept: `Root`, `Trigger`, `Portal`, `Content`, `Item`. No sub-menus, no
 * checkbox or radio items, no shortcuts, no separators — they would be dead code the day they are
 * copied, and a primitive nobody exercises drifts from what the product actually renders.
 *
 * `asChild` is still not reintroduced into `button.tsx`: `DropdownMenu.Trigger` renders its own
 * `<button>` and takes `buttonVariants` on its `className` directly.
 */

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/**
 * The floating panel.
 *
 * Portalled: the popup is a short document with its own scroll, and a menu rendered in place would
 * be clipped by the first ancestor that establishes an overflow context.
 */
function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/**
 * One row of the menu.
 *
 * A disabled item keeps `pointer-events-none`, exactly as the buttons do: it takes no hover, so
 * whatever it has to say about itself has to be written in it, not hung off a tooltip.
 */
function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'relative flex cursor-default select-none flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger };
