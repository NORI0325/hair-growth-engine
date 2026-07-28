const operationTails = new Map<string, Promise<void>>();

export async function withOperationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  operationTails.set(key, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (operationTails.get(key) === tail) operationTails.delete(key);
  }
}

export const operationLockKey = (ownerId: string, locationId: string | null): string =>
  `${ownerId}:${locationId ?? "missing-location"}`;
