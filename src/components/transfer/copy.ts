// Spec-exact copy that more than one screen shows; keep each string here so they can't drift apart.

export const ONE_ENV = 'Grant this app access to another environment in Cloud Portal to transfer between environments.';

export const treeWarning = (count: number, target: string) =>
  count === 1 ? `1 item replaces everything below it on ${target}.` : `${count} items replace everything below them on ${target}.`;

export const cancelNote = (target: string) =>
  `Large trees can take a few minutes. You can cancel until the import into ${target} starts; after that the target finishes on its own.`;
