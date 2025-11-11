import DataManager from '../../data-manager/data-manager';
import { ChangeListenerManager } from '../../data-manager/change-listener.manager';
import { UserManager } from '../../user-manager/user-manager';

export function resetDataManager() {
  (DataManager as any).killInstance?.();
}

export function resetChangeListenerManager() {
  (ChangeListenerManager as any).killInstance?.();
}

export function resetUserManager() {
  (UserManager as any).killInstance?.();
}

export function resetAllSingletons() {
  resetDataManager();
  resetChangeListenerManager();
  resetUserManager();
}
