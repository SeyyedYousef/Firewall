import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchDashboardSnapshot } from './api.ts';
import type {
  DashboardInsights,
  DashboardPromotions,
  ManagedGroup,
  GroupStatusActive,
} from './types.ts';

const DAY_MS = 86_400_000;

function isActiveGroup(group: ManagedGroup): group is ManagedGroup & { status: GroupStatusActive } {
  return group.status.kind === 'active';
}
const EMPTY_INSIGHTS: DashboardInsights = {
  expiringSoon: 0,
  messagesToday: 0,
  newMembersToday: 0,
};
const EMPTY_PROMOTIONS: DashboardPromotions = {
  slots: [],
  rotationSeconds: 0,
  metadata: {
    maxSlots: 3,
    recommendedWidth: 0,
    recommendedHeight: 0,
  },
  canManage: false,
};

type State = {
  groups: ManagedGroup[];
  loading: boolean;
  error: Error | null;
  insights: DashboardInsights;
  promotions: DashboardPromotions;
};

function normalizeGroups(groups: ManagedGroup[]): ManagedGroup[] {
  const now = Date.now();

  return groups
    .map((group) => {
      if (group.status.kind === 'active') {
        const remaining = Math.max(
          0,
          Math.ceil((new Date(group.status.expiresAt).getTime() - now) / DAY_MS),
        );
        return {
          ...group,
          status: {
            ...group.status,
            daysLeft: remaining,
          },
        } as ManagedGroup;
      }
      if (group.status.kind === 'removed') {
        if (new Date(group.status.graceEndsAt).getTime() < now) {
          return null;
        }
      }
      return group;
    })
    .filter((group): group is ManagedGroup => Boolean(group));
}

export function useDashboardData() {
  const [state, setState] = useState<State>({
    groups: [],
    loading: true,
    error: null,
    insights: EMPTY_INSIGHTS,
    promotions: EMPTY_PROMOTIONS,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const snapshot = await fetchDashboardSnapshot();
      const normalized = normalizeGroups(snapshot.groups);
      setState({
        groups: normalized,
        loading: false,
        error: null,
        insights: snapshot.insights,
        promotions: snapshot.promotions,
      });
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      setState({
        groups: [],
        loading: false,
        error: normalizedError,
        insights: EMPTY_INSIGHTS,
        promotions: EMPTY_PROMOTIONS,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(
    () => ({
      total: state.groups.length,
      active: state.groups.filter((group) => group.status.kind === 'active').length,
      expired: state.groups.filter((group) => group.status.kind === 'expired').length,
      removed: state.groups.filter((group) => group.status.kind === 'removed').length,
    }),
    [state.groups],
  );

  const expiringSoonGroups = useMemo(
    () =>
      state.groups
        .filter(isActiveGroup)
        .filter((group) => group.status.daysLeft <= 5)
        .sort((a, b) => a.status.daysLeft - b.status.daysLeft),
    [state.groups],
  );

  return {
    ...state,
    summary,
    expiringSoonGroups,
    refresh: load,
  };
}

