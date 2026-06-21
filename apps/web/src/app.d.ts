declare global {
  namespace App {
    interface Locals {
      user: unknown | null;
      session: unknown | null;
    }
  }
}

export {};
