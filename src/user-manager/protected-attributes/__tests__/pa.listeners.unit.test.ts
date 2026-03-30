import { makeCoreManagersSandbox, loggerSpies, resetGlobalLoggerState } from '../../../testing';
import type { CoreManagersSandbox, LoggerSpies } from '../../../testing';
import type { ProtectedAttributesRecord } from '../../types';
import { CollectionChangeTypeEnum } from '../../../data-manager';
import { PROTECTED_ATTRIBUTES } from '../../constants';
import { clearUsersCache } from '../../users/cache';
import {
  clearProtectedAttributesCache,
  upsertProtectedAttributesInCache,
  __testing__protectedAttributesCache,
} from '../../protected-attributes/cache';
import {
  setupProtectedAttributesChangeListeners,
  removeProtectedAttributesChangeListeners,
} from '../../protected-attributes/listeners';

describe('protected attributes listeners unit tests', () => {
  let t: CoreManagersSandbox;
  let lg: LoggerSpies;

  beforeEach(() => {
    t?.restore();
    lg?.restore();
    t = makeCoreManagersSandbox();
    lg = loggerSpies();
    clearUsersCache();
    clearProtectedAttributesCache();
  });

  afterEach(() => {
    t?.restore();
    lg?.restore();
    resetGlobalLoggerState();
    clearUsersCache();
    clearProtectedAttributesCache();
  });

  function makePA(overrides: Partial<ProtectedAttributesRecord> = {}): ProtectedAttributesRecord {
    return {
      id: overrides.id ?? 'pa1',
      uniqueIdentifier: overrides.uniqueIdentifier ?? 'alice',
      namespace: overrides.namespace ?? 'health',
      protectedAttributes: overrides.protectedAttributes ?? { steps: 1000 },
    };
  }

  // CoreManagersSandbox types clm as the real ChangeListenerManager instance, so
  // TypeScript only sees the real method signatures — not sinon's .args, .firstCall etc.
  // Casting to any gives us access to the stub API at the cost of type safety here.
  const addChangeListener = () => (t.clm as any).addChangeListener;
  const removeChangeListener = () => (t.clm as any).removeChangeListener;

  describe('setupProtectedAttributesChangeListeners', () => {
    it('registers INSERT listener that upserts the record into cache', () => {
      setupProtectedAttributesChangeListeners();

      const pa = makePA();
      const [, , callback] = addChangeListener().firstCall.args;
      callback(pa);

      expect(__testing__protectedAttributesCache._cache.getById('pa1')).not.toBeNull();
    });

    it('registers UPDATE listener that upserts the updated record into cache', () => {
      setupProtectedAttributesChangeListeners();

      const updated = makePA({ id: 'pa1', protectedAttributes: { steps: 9999 } });
      const [, , callback] = addChangeListener().secondCall.args;
      callback(updated);

      expect(
        __testing__protectedAttributesCache._cache.getById('pa1')?.protectedAttributes?.steps,
      ).toBe(9999);
    });

    it('registers DELETE listener that removes the record from cache by id', () => {
      upsertProtectedAttributesInCache(makePA({ id: 'pa1' }));
      setupProtectedAttributesChangeListeners();

      const [, , callback] = addChangeListener().thirdCall.args;
      callback('pa1');

      expect(__testing__protectedAttributesCache._cache.getById('pa1')).toBeNull();
    });

    it('registers listeners on the PROTECTED_ATTRIBUTES collection', () => {
      setupProtectedAttributesChangeListeners();

      expect(
        addChangeListener().args.every(
          ([collection]: [string]) => collection === PROTECTED_ATTRIBUTES,
        ),
      ).toBe(true);
    });

    it('logs an error when the INSERT callback throws', () => {
      setupProtectedAttributesChangeListeners();

      const [, , callback] = addChangeListener().firstCall.args;
      callback(null as any);

      expect(lg.captured.some((c) => c.entry.severity === 'ERROR')).toBe(true);
    });
  });

  describe('removeProtectedAttributesChangeListeners', () => {
    it('removes INSERT, UPDATE, and DELETE listeners for PROTECTED_ATTRIBUTES', async () => {
      await removeProtectedAttributesChangeListeners();

      const changeTypes = removeChangeListener().args.map(
        ([, changeType]: [string, string]) => changeType,
      );

      expect(changeTypes).toContain(CollectionChangeTypeEnum.INSERT);
      expect(changeTypes).toContain(CollectionChangeTypeEnum.UPDATE);
      expect(changeTypes).toContain(CollectionChangeTypeEnum.DELETE);
    });

    it('removes all listeners from the PROTECTED_ATTRIBUTES collection', async () => {
      await removeProtectedAttributesChangeListeners();

      expect(
        removeChangeListener().args.every(
          ([collection]: [string]) => collection === PROTECTED_ATTRIBUTES,
        ),
      ).toBe(true);
    });
  });
});
