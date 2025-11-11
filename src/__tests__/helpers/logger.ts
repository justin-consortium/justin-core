import { Log } from '../../logger/logger-manager';

export function mockLogger() {
  const info = jest.spyOn(Log, 'info').mockImplementation(() => {});
  const warn = jest.spyOn(Log, 'warn').mockImplementation(() => {});
  const error = jest.spyOn(Log, 'error').mockImplementation(() => {});
  const dev = jest.spyOn(Log, 'dev').mockImplementation(() => {});

  return {
    info,
    warn,
    error,
    dev,
    restore: () => {
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
      dev.mockRestore();
    },
  };
}
