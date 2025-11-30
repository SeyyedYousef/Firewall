import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Avatar, Button, Text, Title } from "@telegram-apps/telegram-ui";

import { classNames } from "@/css/classnames.ts";
import { formatMembersCount } from "@/utils/format.ts";

import type { ManagedGroup } from "./types.ts";

import styles from "./GroupCard.module.css";

type GroupCardProps = {
  group: ManagedGroup;
  onOpenDashboard?: (group: ManagedGroup) => void;
  onUpgrade?: (group: ManagedGroup) => void;
};

function initialsFromTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "?";
  }
  const [first, second] = words;
  if (!second) {
    return words[0]?.charAt(0).toUpperCase() ?? '?';
  }
  return `${first?.charAt(0) ?? ''}${second?.charAt(0) ?? ''}`.toUpperCase();
}

export function GroupCard({ group, onOpenDashboard, onUpgrade }: GroupCardProps) {
  const isPremium = group.subscriptionType === 'premium';
  const isRemoved = group.status.kind === 'removed';
  const disabled = isRemoved || !group.canManage;

  return (
    <div className={classNames(styles.card, isRemoved && styles.cardRemoved)}>
      <div className={styles.header}>
        <Avatar
          size={40}
          src={group.photoUrl ?? undefined}
          acronym={group.photoUrl ? undefined : initialsFromTitle(group.title)}
          alt={group.title}
        />
        <div className={styles.info}>
          <Title level="3" className={styles.title}>{group.title}</Title>
          <Text className={styles.meta}>{formatMembersCount(group.membersCount)}</Text>
        </div>
        <span className={classNames(styles.badge, isPremium ? styles.badgePremium : styles.badgeFree)}>
          {isPremium ? '⭐' : '🆓'}
        </span>
      </div>
      <div className={styles.actions}>
        <Button
          size="s"
          mode="filled"
          stretched
          onClick={() => {
            hapticFeedback.impactOccurred("light");
            onOpenDashboard?.(group);
          }}
          disabled={disabled}
        >
          Open Dashboard
        </Button>
        {!isPremium && onUpgrade && (
          <Button
            size="s"
            mode="outline"
            onClick={() => {
              hapticFeedback.impactOccurred("light");
              onUpgrade(group);
            }}
          >
            Upgrade
          </Button>
        )}
      </div>
      {isRemoved && (
        <Text className={styles.removalHint}>
          Bot removed. Re-add to restore protection.
        </Text>
      )}
    </div>
  );
}

