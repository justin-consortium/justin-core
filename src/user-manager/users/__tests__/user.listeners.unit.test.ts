import sinon from 'sinon';
import {
  makeTestJUser,
  makeCoreManagersSandbox,
  loggerSpies,
  resetGlobalLoggerState,
} from '../../../testing';
import type { CoreManagersSandbox, LoggerSpies } from '../../../testing';
import { CollectionChangeTypeEnum } from '../../../data-manager';
import { USERS } from '../../constants';
import { clearUsersCache, upsertUserInCache, __testing__usersCache } from '../../users/cache';
import { setupUserChangeListeners, removeUserChangeListeners } from '../../users/listeners';

describe('user listeners unit tests', () => {
  let t: CoreManagersSandbox;
  let lg: LoggerSpies;

  beforeEach(() => {
    t?.restore();
    lg?.restore();
    t = makeCoreManagersSandbox();
    lg = loggerSpies();
    clearUsersCache();
  });

  afterEach(() => {
    t?.restore();
    lg?.restore();
    resetGlobalLoggerState();
    clearUsersCache();
  });

  // CoreManagersSandbox types clm as the real ChangeListenerManager instance, so
  // TypeScript only sees the real method signatures — not sinon's .args, .firstCall etc.
  // Casting to any gives us access to the stub API at the cost of type safety here.
  const addChangeListener = () => (t.clm as any).addChangeListener;
  const removeChangeListener = () => (t.clm as any).removeChangeListener;

  describe('setupUserChangeListeners', () => {
    it('registers INSERT listener that upserts the user into cache', () => {
      setupUserChangeListeners();

      const user = makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' });
      const [, , callback] = addChangeListener().firstCall.args;
      callback(user);

      expect(__testing__usersCache._cache.getById('u1')).not.toBeNull();
    });

    it('registers UPDATE listener that upserts the updated user into cache', () => {
      setupUserChangeListeners();

      const updated = makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice', score: 99 });
      const [, , callback] = addChangeListener().secondCall.args;
      callback(updated);

      expect((__testing__usersCache._cache.getById('u1') as any)?.score).toBe(99);
    });

    it('registers DELETE listener that removes the user from cache', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      setupUserChangeListeners();

      const [, , callback] = addChangeListener().thirdCall.args;
      callback('u1');

      expect(__testing__usersCache._cache.getById('u1')).toBeNull();
    });

    it('calls the onUserDeletedByUniqueIdentifier hook with the deleted user uniqueIdentifier', () => {
      upsertUserInCache(makeTestJUser({ id: 'u1', uniqueIdentifier: 'alice' }));
      const hook = sinon.stub();

      setupUserChangeListeners(hook);

      const [, , callback] = addChangeListener().thirdCall.args;
      callback('u1');

      expect(hook.calledWith('alice')).toBe(true);
    });

    it('does not call the hook if the deleted user was not in cache', () => {
      const hook = sinon.stub();
      setupUserChangeListeners(hook);

      const [, , callback] = addChangeListener().thirdCall.args;
      callback('nonexistent-id');

      expect(hook.called).toBe(false);
    });

    it('logs an error when the INSERT callback throws', () => {
      setupUserChangeListeners();

      const [, , callback] = addChangeListener().firstCall.args;
      callback(null as any);

      expect(lg.captured.some((c) => c.entry.severity === 'ERROR')).toBe(true);
    });

    it('registers listeners for INSERT, UPDATE, and DELETE change types', () => {
      setupUserChangeListeners();

      const changeTypes = addChangeListener().args.map(
        ([, changeType]: [string, string]) => changeType,
      );

      expect(changeTypes).toContain(CollectionChangeTypeEnum.INSERT);
      expect(changeTypes).toContain(CollectionChangeTypeEnum.UPDATE);
      expect(changeTypes).toContain(CollectionChangeTypeEnum.DELETE);
    });

    it('registers all listeners on the USERS collection', () => {
      setupUserChangeListeners();

      expect(addChangeListener().args.every(([collection]: [string]) => collection === USERS)).toBe(
        true,
      );
    });
  });

  describe('removeUserChangeListeners', () => {
    it('removes INSERT, UPDATE, and DELETE listeners for USERS', async () => {
      await removeUserChangeListeners();

      const changeTypes = removeChangeListener().args.map(
        ([, changeType]: [string, string]) => changeType,
      );

      expect(changeTypes).toContain(CollectionChangeTypeEnum.INSERT);
      expect(changeTypes).toContain(CollectionChangeTypeEnum.UPDATE);
      expect(changeTypes).toContain(CollectionChangeTypeEnum.DELETE);
    });

    it('removes all listeners from the USERS collection', async () => {
      await removeUserChangeListeners();

      expect(
        removeChangeListener().args.every(([collection]: [string]) => collection === USERS),
      ).toBe(true);
    });
  });
});
