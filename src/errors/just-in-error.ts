import { JustinErrorCode } from './types';

/**
 * Standard errors class for the Justin package.
 *
 * Extends `Error` with a `code` for programmatic branching, an `isLogged`
 * flag to ensure each error is logged exactly once at its origin, and a
 * `data` record for structured context that accumulates as the errors
 * propagates up through layers.
 */
export class JustInError extends Error {
  code: string;
  isLogged: boolean;
  data: Record<string, any>;

  constructor(
    message: string,
    code: string,
    {
      name = 'JustInError',
      isLogged = false,
      data = {},
    }: {
      name?: string;
      isLogged?: boolean;
      data?: Record<string, any>;
    } = {},
  ) {
    super(message);
    this.name = name;
    this.code = code;
    this.isLogged = isLogged;
    this.data = data;
  }
}
