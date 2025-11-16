declare module "uuid" {
  export type V4Options = {
    random?: readonly number[];
    rng?: () => Uint8Array;
  };

  export function v1(options?: unknown, buffer?: ArrayLike<number>, offset?: number): string;
  export function v3(name: string | ArrayLike<number>, namespace: string | ArrayLike<number>): string;
  export function v4(options?: V4Options | null, buffer?: ArrayLike<number>, offset?: number): string;
  export function v5(name: string | ArrayLike<number>, namespace: string | ArrayLike<number>): string;

  export function parse(uuid: string): Uint8Array;
  export function stringify(buffer: ArrayLike<number>): string;
  export function validate(uuid: string): boolean;
  export function version(uuid: string): number;

  export const NIL: string;
}
