import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Class name helper every copied-in shadcn/ui component expects to import from here. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
