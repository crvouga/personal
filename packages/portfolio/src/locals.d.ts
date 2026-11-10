import type { Presentation } from './archetypes/presentation';

declare global {
  namespace App {
    interface Locals {
      /** Set by a page before its components render; absent means the default. */
      presentation?: Presentation;
    }
  }
}
