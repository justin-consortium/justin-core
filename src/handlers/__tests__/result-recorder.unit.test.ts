import sinon from 'sinon';
import { Log } from '../../logger/logger-manager';
import * as recorder from '../result-recorder';
import DataManager from '../../data-manager/data-manager';
import { DECISION_RULE_RESULTS, TASK_RESULTS } from '../../data-manager/data-manager.constants';

const {
  hasResultRecord,
  handleDecisionRuleResult,
  handleTaskResult,
  setDecisionRuleResultRecorder,
  setTaskResultRecorder,
  setResultRecorderPersistenceEnabled,
} = recorder as any;

describe('Result Recorder Module', () => {
  let warnStub: sinon.SinonStub;
  let devStub: sinon.SinonStub;

  // Fresh stubbed DM instance returned by DataManager.getInstance()
  let dmInstance: { addItemToCollection: sinon.SinonStub };

  const emptyRecord = { steps: [] } as any;
  const nonEmptyRecord = {
    steps: [{}, {}],
    taskName: 'T',
    ruleName: 'R',
    userId: 'U1',
    status: 'OK',
  } as any;

  const TAG_DECISION = '[ResultRecorder:decision]';
  const TAG_TASK = '[ResultRecorder:task]';

  beforeEach(() => {
    // Ensure clean internal module state between tests
    if ((recorder as any).__testOnlyResetRecorderState__) {
      (recorder as any).__testOnlyResetRecorderState__();
    } else {
      setDecisionRuleResultRecorder(null as any);
      setTaskResultRecorder(null as any);
      if (typeof setResultRecorderPersistenceEnabled === 'function') {
        setResultRecorderPersistenceEnabled(true);
      }
    }

    warnStub = sinon.stub(Log, 'warn');
    devStub = sinon.stub(Log, 'dev');

    dmInstance = { addItemToCollection: sinon.stub().resolves() };
    // By default, DM is available and works
    jest.spyOn(DataManager, 'getInstance').mockReturnValue(dmInstance as any);
  });

  afterEach(() => {
    sinon.restore();
    (DataManager.getInstance as jest.Mock).mockRestore();
  });

  describe('hasResultRecord', () => {
    it('returns false for empty steps', () => {
      expect(hasResultRecord(emptyRecord)).toBe(false);
    });
    it('returns true for non-empty steps', () => {
      expect(hasResultRecord(nonEmptyRecord)).toBe(true);
    });
  });

  describe('handleDecisionRuleResult', () => {
    it('calls decision recorder when set (success path) and does not touch DM', async () => {
      const callback = sinon.spy();
      setDecisionRuleResultRecorder(callback);

      await handleDecisionRuleResult(nonEmptyRecord);

      sinon.assert.calledOnceWithExactly(callback, nonEmptyRecord);
      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.notCalled(devStub);
      sinon.assert.notCalled(warnStub);
    });

    it('defaults to DM add when no writer is set', async () => {
      await handleDecisionRuleResult(nonEmptyRecord);

      sinon.assert.calledOnceWithExactly(
        dmInstance.addItemToCollection,
        DECISION_RULE_RESULTS,
        nonEmptyRecord
      );
      sinon.assert.notCalled(devStub);
    });

    it('falls back to console when DM not available (getInstance throws)', async () => {
      (DataManager.getInstance as jest.Mock).mockImplementation(() => {
        throw new Error('no DM');
      });

      await handleDecisionRuleResult(nonEmptyRecord);

      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.calledOnce(devStub);
      expect(devStub.firstCall.args[0]).toBe(TAG_DECISION);
      expect(devStub.firstCall.args[1]).toBe(nonEmptyRecord);
    });

    it('warns and falls back when custom decision writer throws', async () => {
      setDecisionRuleResultRecorder(() => {
        throw new Error('boom');
      });

      await handleDecisionRuleResult(nonEmptyRecord);

      sinon.assert.called(warnStub);
      sinon.assert.calledOnceWithExactly(
        dmInstance.addItemToCollection,
        DECISION_RULE_RESULTS,
        nonEmptyRecord
      );
      sinon.assert.notCalled(devStub);
    });

    it('if DM write fails, warns and logs to console', async () => {
      dmInstance.addItemToCollection.rejects(new Error('dm write failed'));

      await handleDecisionRuleResult(nonEmptyRecord);

      sinon.assert.calledOnce(dmInstance.addItemToCollection);
      sinon.assert.called(warnStub);
      sinon.assert.calledOnce(devStub);
      expect(devStub.firstCall.args[0]).toBe(TAG_DECISION);
      expect(devStub.firstCall.args[1]).toBe(nonEmptyRecord);
    });

    it('no-op when steps are empty (no DM, no console)', async () => {
      await handleDecisionRuleResult(emptyRecord);
      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.notCalled(devStub);
      sinon.assert.notCalled(warnStub);
    });
  });

  describe('handleTaskResult', () => {
    it('calls task recorder when set (success path) and does not touch DM', async () => {
      const taskCb = sinon.spy();
      setTaskResultRecorder(taskCb);

      await handleTaskResult(nonEmptyRecord);

      sinon.assert.calledOnceWithExactly(taskCb, nonEmptyRecord);
      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.notCalled(devStub);
      sinon.assert.notCalled(warnStub);
    });

    it('falls back to decision recorder when task recorder not set', async () => {
      const decisionCb = sinon.spy();
      setDecisionRuleResultRecorder(decisionCb);

      await handleTaskResult(nonEmptyRecord);

      sinon.assert.calledOnceWithExactly(decisionCb, nonEmptyRecord);
      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.notCalled(devStub);
    });

    it('defaults to DM add when no writers set', async () => {
      await handleTaskResult(nonEmptyRecord);

      sinon.assert.calledOnceWithExactly(
        dmInstance.addItemToCollection,
        TASK_RESULTS,
        nonEmptyRecord
      );
      sinon.assert.notCalled(devStub);
    });

    it('warns and falls back when task writer throws', async () => {
      setTaskResultRecorder(() => {
        throw new Error('boom');
      });

      await handleTaskResult(nonEmptyRecord);

      sinon.assert.called(warnStub);
      sinon.assert.calledOnceWithExactly(
        dmInstance.addItemToCollection,
        TASK_RESULTS,
        nonEmptyRecord
      );
      sinon.assert.notCalled(devStub);
    });

    it('warns and falls back when delegated decision writer throws', async () => {
      setDecisionRuleResultRecorder(() => {
        throw new Error('boom');
      });

      await handleTaskResult(nonEmptyRecord);

      sinon.assert.called(warnStub);
      sinon.assert.calledOnceWithExactly(
        dmInstance.addItemToCollection,
        TASK_RESULTS,
        nonEmptyRecord
      );
      sinon.assert.notCalled(devStub);
    });

    it('console fallback when DM unavailable (getInstance throws)', async () => {
      (DataManager.getInstance as jest.Mock).mockImplementation(() => {
        throw new Error('no DM');
      });

      await handleTaskResult(nonEmptyRecord);

      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.calledOnce(devStub);
      expect(devStub.firstCall.args[0]).toBe(TAG_TASK);
      expect(devStub.firstCall.args[1]).toBe(nonEmptyRecord);
    });

    it('console fallback when DM write rejects', async () => {
      dmInstance.addItemToCollection.rejects(new Error('dm write failed'));

      await handleTaskResult(nonEmptyRecord);

      sinon.assert.calledOnce(dmInstance.addItemToCollection);
      sinon.assert.called(warnStub);
      sinon.assert.calledOnce(devStub);
      expect(devStub.firstCall.args[0]).toBe(TAG_TASK);
      expect(devStub.firstCall.args[1]).toBe(nonEmptyRecord);
    });

    it('no-op when steps are empty (no DM, no console)', async () => {
      await handleTaskResult(emptyRecord);
      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.notCalled(devStub);
      sinon.assert.notCalled(warnStub);
    });
  });

  //
  // Lite/serverless mode behavior (persistence disabled)
  //
  describe('Lite mode (persistence disabled)', () => {
    beforeEach(() => {
      if (typeof setResultRecorderPersistenceEnabled === 'function') {
        setResultRecorderPersistenceEnabled(false);
      }
      sinon.resetHistory();
      (DataManager.getInstance as jest.Mock).mockClear();
    });

    afterEach(() => {
      if (typeof setResultRecorderPersistenceEnabled === 'function') {
        setResultRecorderPersistenceEnabled(true);
      }
    });

    it('decision: with no writers, logs to console and never calls DataManager.getInstance', async () => {
      await handleDecisionRuleResult(nonEmptyRecord);

      expect((DataManager.getInstance as jest.Mock).mock.calls.length).toBe(0);
      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.calledOnce(devStub);
      expect(devStub.firstCall.args[0]).toBe(TAG_DECISION);
      expect(devStub.firstCall.args[1]).toBe(nonEmptyRecord);
      sinon.assert.notCalled(warnStub);
    });

    it('task: with no writers, logs to console and never calls DataManager.getInstance', async () => {
      await handleTaskResult(nonEmptyRecord);

      expect((DataManager.getInstance as jest.Mock).mock.calls.length).toBe(0);
      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.calledOnce(devStub);
      expect(devStub.firstCall.args[0]).toBe(TAG_TASK);
      expect(devStub.firstCall.args[1]).toBe(nonEmptyRecord);
      sinon.assert.notCalled(warnStub);
    });

    it('custom writer still used and no DM calls (decision)', async () => {
      const cb = sinon.stub().resolves();
      setDecisionRuleResultRecorder(cb);

      await handleDecisionRuleResult(nonEmptyRecord);

      sinon.assert.calledOnceWithExactly(cb, nonEmptyRecord);
      expect((DataManager.getInstance as jest.Mock).mock.calls.length).toBe(0);
      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.notCalled(devStub);
      sinon.assert.notCalled(warnStub);
    });

    it('custom writer throws → warn + console fallback, but still no DM calls (task)', async () => {
      setTaskResultRecorder(() => {
        throw new Error('boom');
      });

      await handleTaskResult(nonEmptyRecord);

      expect((DataManager.getInstance as jest.Mock).mock.calls.length).toBe(0);
      sinon.assert.notCalled(dmInstance.addItemToCollection);
      sinon.assert.called(warnStub);
      sinon.assert.calledOnce(devStub);
      expect(devStub.firstCall.args[0]).toBe(TAG_TASK);
      expect(devStub.firstCall.args[1]).toBe(nonEmptyRecord);
    });
  });
});
