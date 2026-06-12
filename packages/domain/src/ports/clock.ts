export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface IdGenerator {
  next(prefix: string): string;
}

let counter = 0;
export const randomIdGenerator: IdGenerator = {
  next: (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`,
};
